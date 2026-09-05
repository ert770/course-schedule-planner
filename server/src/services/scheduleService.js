// 排課的**唯一**進入點。
//
// **為什麼要有這一層**：先前 REST 與 Chat 各自組一次排課流程——
//
//   REST  routes/schedule.js       → getUserPreferences → buildScheduleConstraints
//                                   → searchCoursesForSchedule → generateSchedule
//   Chat  agentService.js:120-126  → buildScheduleConstraints(args, prefs)
//                                   → searchCoursesForSchedule → generateSchedule
//
// 兩份看似相同，但只要其中一條加了前置條件（身分解析、學期過濾、候選池規則），
// 另一條就會靜默落後，而且沒有任何測試會失敗——使用者只會發現「用聊天排出來的課表
// 跟按按鈕排出來的不一樣」，卻找不出原因。
//
// **Chat 只是讓使用者用自然語言表達需求與條件的介面，不該是另一套排課實作。**
// 它與 REST 的唯一差別是 input 從哪裡來：HTTP body 還是模型參數。

import crypto from 'node:crypto';
import { generateSchedule } from '../skills/scheduler.js';
import { searchCoursesForSchedule } from '../skills/courseQuery.js';
import { getUserPreferences } from './memoryService.js';
import { buildScheduleConstraints } from './constraintService.js';
import { buildStudentScope } from '../skills/courseScope.js';
import { getAll } from '../db/database.js';
import { getFailedRequiredCourseCodes } from '../data/courseHistory.js';
import { ACTIVE_TERM } from '../data/activeTerm.js';
import { INTERACTION_EVENT_TYPES, INTERACTION_SOURCES } from '../data/interactionEventSchema.js';
import { recordInteractionEvents } from './interactionEventService.js';
import { getSchedulingPreferenceWeights } from './preferenceLearningService.js';
import { RECOMMENDATION_REASON_VERSION } from '../skills/recommendationReason.js';
import { buildCounterfactuals } from '../skills/planComparison.js';
import { logger } from '../utils/logger.js';

// Roadmap #2：讓「這一次推薦」可以被指認。
//
// 排課回應原本沒有任何請求識別碼，`plan.id` 又只是 variant 名稱
// （`required_first` 等），因此五個方案在**不同次**排課之間完全無法區分——
// 曝光事件記下 `required_first` 也說不出那是哪一次推薦的 `required_first`。
//
// 識別碼屬於請求層，不屬於排課演算法，所以加在這裡而不是 `skills/scheduler.js`。
// `planId` 用 `${requestId}:${variantId}` 組合而非另一個 UUID，是為了從 planId
// 本身就能反推是哪一次請求的哪一個 variant，不必再做一次 join。
//
// 這是向後相容的欄位新增，既有欄位語意不變。
export function annotateScheduleIdentifiers(result, requestId) {
  if (!result || typeof result !== 'object') return result;
  result.requestId = requestId;
  if (Array.isArray(result.plans)) {
    for (const plan of result.plans) {
      plan.variantId = plan.id;
      plan.planId = `${requestId}:${plan.id}`;
    }
  }
  return result;
}

// #29 的 course ref shape。與 `client/src/services/interactionLog.js` 的
// `courseRef()` 刻意保持同樣的邏輯——缺任一項就回 null，不補空值上去。
function courseRef(course) {
  const sectionId = Number(course?.sectionId ?? course?.id);
  const catalogCourseCode = course?.catalogCourseCode;
  if (!Number.isInteger(sectionId) || sectionId <= 0) return null;
  if (typeof catalogCourseCode !== 'string' || !catalogCourseCode.trim()) return null;
  return { catalogCourseCode, sectionId };
}

// 對抗式審查發現：`recommendation_exposed` 原本由前端在收到排課回應後自己
// 回報，等於「系統顯示了什麼」這件事由使用者的瀏覽器自己說了算——任何登入
// 帳號都能捏一組假的曝光紀錄，再讓後續的 accepted／withdrawn 對上它。
//
// 現在改成**伺服器在算出結果的當下自己寫入**，用的是伺服器自己剛剛算出來的
// `schedule`／`excludedCourses`，不是事後由 client 回報、伺服器只能照單全收
// 的資料。`interactionEventService.recordInteractionEvents()` 只有帶
// `allowExposureWrite:true` 才接受這個事件類型，一般呼叫端（含
// `/api/interactions`）一律拒絕，因此這是唯一合法的寫入點。
// exported 供 scheduleService.test.js 直接測試——純資料整形，不碰 DB，
// 跟 loadCourseReviewsSafely／buildNoCandidatesResult 同樣的理由。
export function buildExposureDraft(result, requestId, { surface, trigger } = {}) {
  // roadmap #27：使用者現在能切換到 `plans[0]` 以外的方案，所以「這次曝光
  // 顯示過哪些課」不能只看主推方案的 `result.schedule`——那是 plans[0] 的
  // 副本。用全部方案的課程聯集，否則使用者切到別的方案後接受推薦、或退掉
  // 只存在於那個方案的課，會被 `assertProvenance()` 誤判成偽造證據
  // （這正是實測時發現的真實情況：切到「涼課與高分優先」按下「符合」，
  // 因為 planId 對不上曝光紀錄裡只存的主推 planId 而被拒絕寫入）。
  const plans = Array.isArray(result.plans) ? result.plans : [];
  const displayedSetMap = new Map();
  for (const plan of plans) {
    for (const course of (plan.schedule || [])) {
      const ref = courseRef(course);
      if (ref) displayedSetMap.set(ref.sectionId, ref);
    }
  }
  const displayedSet = [...displayedSetMap.values()];

  const excluded = (result.excludedCourses || []).map(item => courseRef(item?.course)).filter(Boolean);
  const seen = new Set(displayedSetMap.keys());
  const candidateSet = [...displayedSet];
  for (const ref of excluded) {
    if (seen.has(ref.sectionId)) continue;
    seen.add(ref.sectionId);
    candidateSet.push(ref);
  }
  // 沒有任何候選課可談，寫一筆空曝光沒有意義。
  if (candidateSet.length === 0) return null;

  const primary = plans[0] ?? null;
  const displayedPlanIds = plans.map(plan => plan.planId).filter(Boolean);
  return {
    eventType: INTERACTION_EVENT_TYPES.RECOMMENDATION_EXPOSED,
    requestId,
    actionId: crypto.randomUUID(),
    term: { academicYear: ACTIVE_TERM.academicYear, semester: ACTIVE_TERM.semester },
    // `plan`／`position` 仍記主推方案——這是預設顯示、Agent 回覆引用的那一個。
    // 使用者實際能接受的完整清單在 `exposureContext.displayedPlanIds`。
    plan: primary?.planId ? { planId: primary.planId, variantId: primary.variantId } : null,
    position: { planRank: primary?.planId ? 1 : null, courseRank: null },
    exposureContext: { surface, trigger, candidateSet, displayedSet, displayedPlanIds },
    source: INTERACTION_SOURCES.SYSTEM_RECOMMENDATION,
    // roadmap #26：這個欄位從 #2／#29 建好之後就一直是 `null`，註記寫著「等 #26」。
    // 現在有真的理由結構了，記下它的版本——日後理由的欄位語意改變時，
    // 才分得出「這筆曝光當時的理由是用哪一版算的」。
    versionSnapshot: { recommendationReasonVersion: RECOMMENDATION_REASON_VERSION },
  };
}

// 這是排課請求同步流程裡唯一的資料庫寫入，且是**新加的**——先前
// `/api/schedule/generate` 完全沒有互動記錄相關的 side effect。因此刻意
// fail-open（比照下面 `loadCourseReviewsSafely()` 的同一個原則）：consent
// 未同意、資料庫暫時不可用或任何寫入失敗，都只記警告、不讓排課請求本身失敗
// ——使用者要的是課表，不是曝光紀錄有沒有寫成功。
async function recordExposureSafely(identity, result, requestId, surfaceOptions) {
  if (!result?.success) return;
  const draft = buildExposureDraft(result, requestId, surfaceOptions);
  if (!draft) return;
  try {
    await recordInteractionEvents(identity, [draft], { allowExposureWrite: true });
  } catch (err) {
    logger.warn(`推薦曝光事件寫入失敗，不影響排課結果：${err.message}`, { label: 'Interaction' });
  }
}

export function buildNoCandidatesResult(reviewDataLoaded) {
  const unmetRequirements = [{
    type: 'required-course',
    courseIds: [],
    constraintIds: [],
    reason: '沒有可用的候選課程資料',
    adjustable: true,
  }];
  return {
    success: false,
    schedule: [],
    plans: [],
    totalCredits: 0,
    graduationCredits: 0,
    nonGraduationCredits: 0,
    courseCount: 0,
    excludedCourses: [],
    watchedCourses: [],
    unscheduledCourses: [],
    draftSchedule: [],
    draftUnscheduledCourses: [],
    isDraft: false,
    unmetRequirements,
    clarification: {
      required: true,
      reason: 'data-insufficient',
      questions: [{
        id: 'describe-target-schedule',
        type: 'schedule-goal',
        prompt: '請告訴我你一定要修的課程、期望學分，以及不能上課的日期與節次，我會依這些條件重新排課。',
        courseIds: [],
        constraintIds: [],
      }],
      adjustableConstraintIds: [],
      relatedCourseIds: [],
    },
    solver: {
      status: 'data-insufficient',
      repairAttempted: false,
      resultSource: 'none',
      fallbackUsed: false,
      timeoutMs: 2000,
      elapsedMs: 0,
      nodesVisited: 0,
      prunedNodes: 0,
      seed: 0,
      baseline: null,
      improved: false,
      optimizationComplete: true,
    },
    warnings: ['沒有可用的候選課程'],
    message: '找不到符合條件的課程，請調整篩選條件。',
    // #4 的回應契約要求成功與失敗路徑都帶 reviewDataLoaded；這條早退路徑
    // 先前遺漏了這個欄位，讓呼叫端無法分辨「false」與「欄位不存在」。
    reviewDataLoaded,
  };
}

// 評價是加分用的 enrichment，不是排課的必要條件。scheduler.js 明確支援
// `courseReviews` 缺席（`reviewDataLoaded: false` + 中性分計分），因此這裡
// 刻意不讓評價查詢失敗變成排課請求整體失敗——資料庫暫時性錯誤、schema
// 不同步或查詢逾時都不該讓使用者連課表都排不出來。
//
// `loadReviews` 可注入，測試不必連真實資料庫就能驗證 fail-open 行為。
export async function loadCourseReviewsSafely(loadReviews) {
  try {
    return await loadReviews();
  } catch (err) {
    logger.warn(`評價資料查詢失敗，本次排課改以無評價資料繼續：${err.message}`, { label: 'Schedule' });
    return [];
  }
}

// roadmap #5B：學到的偏好權重是加分項，不是排課的必要條件——跟上面
// `loadCourseReviewsSafely()` 同一個原則。未同意、沒算過、資料庫暫時不可用
// 或任何例外，一律退回今天的顯式 0/1 行為，絕不讓使用者因為個人化管線壞掉
// 而排不出課表。
//
// `loadWeights` 可注入，測試不必連真實資料庫就能驗證 fail-open 行為。
export async function loadLearnedPreferenceSafely(loadWeights) {
  try {
    return await loadWeights();
  } catch (err) {
    logger.warn(`學到的偏好權重讀取失敗，本次排課改用顯式設定：${err.message}`, { label: 'Schedule' });
    return {
      applied: false, reason: 'unavailable', boosts: null, modelVersion: null, computedAt: null, sufficiency: null,
    };
  }
}

// 候選池與限制的組裝。
//
// roadmap #27 的 counterfactual 需要用**完全相同的候選池與限制**重跑排課，
// 只換掉一個偏好旗標。若它自己複製一份這段流程，就正好犯下這個檔案開頭警告的
// 錯誤——兩條路徑看似相同，其中一條加了前置條件另一條靜默落後，而
// counterfactual 的答案會因此變成「取消偏好會換掉這些課」的假因果。
// 抽成共用函式，兩邊只能有同一份。
async function prepareGenerationInputs(identity, input = {}, options = {}) {
  const { courseIds = [], filters = {}, constraints = {} } = input;

  const prefs = options.prefs ?? await getUserPreferences(identity);

  // Course_Reviews 全表 181 列，一次撈完比逐課查詢便宜；經 `getMysqlReviews()`
  // 的 TTL 快取（`database.js`），到期前不會重複下全表查詢。
  const courseReviews = await loadCourseReviewsSafely(() => getAll('reviews'));
  const reviewDataLoaded = Array.isArray(courseReviews) && courseReviews.length > 0;

  // roadmap #5B：`options.prefs` 已經在手上，傳給 `getSchedulingPreferenceWeights()`
  // 避免它再查一次 Profile——與 `#30` 的 `recomputeLearnedWeights()` 同一個
  // `options.prefs` 注入模式。這裡讀的是**已存**的權重，不重算、不寫入
  // （見該函式的說明），排課因此不會把一次讀取變成一次全量事件掃描。
  const learnedPreference = await loadLearnedPreferenceSafely(
    () => getSchedulingPreferenceWeights(identity, { prefs })
  );

  const mergedConstraints = buildScheduleConstraints(
    {
      ...constraints,
      // `courseIds` 是使用者手動勾選的課。它決定候選池，但不會進入
      // `selectedCourseIds`，因此必須另外告訴排課引擎「這些是使用者指定的」，
      // 否則不符合系外選修認列條件的課會被當成系統自撿的候選而靜默剔除。
      explicitCourseIds: [...(constraints.explicitCourseIds || []), ...courseIds],
    },
    prefs,
    { courseReviews, learnedPreference }
  );

  const studentScope = buildStudentScope(mergedConstraints);

  const failedRequiredCodes = new Set(getFailedRequiredCourseCodes(prefs.courseHistory));
  let candidates;
  if (courseIds.length > 0) {
    const courseIdSet = new Set(courseIds.map(String));
    const allCourses = await getAll('courses');
    candidates = allCourses.filter(course => (
      courseIdSet.has(String(course.id))
      || failedRequiredCodes.has(course.catalogCourseCode)
    ));
  } else {
    candidates = await searchCoursesForSchedule(filters, studentScope);
    if (failedRequiredCodes.size > 0) {
      const seen = new Set(candidates.map(course => String(course.id)));
      const allCourses = await getAll('courses');
      for (const course of allCourses) {
        if (failedRequiredCodes.has(course.catalogCourseCode) && !seen.has(String(course.id))) {
          candidates.push(course);
          seen.add(String(course.id));
        }
      }
    }
  }

  return { candidates, mergedConstraints, reviewDataLoaded };
}

/**
 * Roadmap #27：counterfactual——「取消某項偏好，課表會怎麼變」。
 *
 * **刻意不併進 `/generate`**：一次 counterfactual 是一次完整重排，實測候選池
 * 放大後（#13C 解掉之後的真實情況）一次排課 289ms、逐項重跑 13 項偏好會是
 * 數秒等級。多數使用者不會展開這個面板，讓每次排課都付這個代價不合理。
 *
 * 這條路徑**不寫任何互動事件**——使用者只是在問假設性問題，沒有推薦被曝光，
 * 把它記成曝光會汙染 #2 的訓練資料。
 */
export async function counterfactualForUser(identity, input = {}, options = {}) {
  const { candidates, mergedConstraints, reviewDataLoaded } =
    await prepareGenerationInputs(identity, input, options);

  if (candidates.length === 0) {
    return { baseline: null, competablePoolSize: 0, counterfactuals: [], reviewDataLoaded };
  }

  return {
    ...buildCounterfactuals(candidates, mergedConstraints),
    reviewDataLoaded,
  };
}

/**
 * 為指定使用者產生課表。
 *
 * @param identity `resolveIdentity()` 的結果，不是原始 userId。
 * @param input    `{ courseIds, filters, constraints, surface, trigger }`；
 *                 除 `surface`／`trigger` 外皆可省略。REST 從 body 取得，
 *                 Chat 從模型的 tool 參數取得；`surface`／`trigger` 只用來
 *                 標記這次推薦曝光是在哪個畫面、被什麼動作觸發，不參與
 *                 候選池或排課邏輯——省略時單純不記錄這次曝光，不用猜的。
 * @param options  `{ prefs }` 已載入的 profile，避免同一次對話重複查詢。
 */
export async function generateForUser(identity, input = {}, options = {}) {
  const { courseIds = [], filters = {}, constraints = {}, surface, trigger } = input;
  const requestId = options.requestId || crypto.randomUUID();

  const prefs = options.prefs ?? await getUserPreferences(identity);

  const { candidates, mergedConstraints, reviewDataLoaded } = await prepareGenerationInputs(
    identity,
    { courseIds, filters, constraints },
    { ...options, prefs }
  );

  if (candidates.length === 0) {
    return annotateScheduleIdentifiers(buildNoCandidatesResult(reviewDataLoaded), requestId);
  }

  const result = annotateScheduleIdentifiers(generateSchedule(candidates, mergedConstraints), requestId);
  await recordExposureSafely(identity, result, requestId, { surface, trigger });
  return result;
}

export default {
  generateForUser,
  counterfactualForUser,
  loadCourseReviewsSafely,
  buildNoCandidatesResult,
  annotateScheduleIdentifiers,
};
