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
function buildExposureDraft(result, requestId, { surface, trigger } = {}) {
  const displayedSet = (result.schedule || []).map(courseRef).filter(Boolean);
  const excluded = (result.excludedCourses || []).map(item => courseRef(item?.course)).filter(Boolean);
  const seen = new Set(displayedSet.map(ref => ref.sectionId));
  const candidateSet = [...displayedSet];
  for (const ref of excluded) {
    if (seen.has(ref.sectionId)) continue;
    seen.add(ref.sectionId);
    candidateSet.push(ref);
  }
  // 沒有任何候選課可談，寫一筆空曝光沒有意義。
  if (candidateSet.length === 0) return null;

  const primary = Array.isArray(result.plans) ? result.plans[0] : null;
  return {
    eventType: INTERACTION_EVENT_TYPES.RECOMMENDATION_EXPOSED,
    requestId,
    actionId: crypto.randomUUID(),
    term: { academicYear: ACTIVE_TERM.academicYear, semester: ACTIVE_TERM.semester },
    plan: primary?.planId ? { planId: primary.planId, variantId: primary.variantId } : null,
    position: { planRank: primary?.planId ? 1 : null, courseRank: null },
    exposureContext: { surface, trigger, candidateSet, displayedSet },
    source: INTERACTION_SOURCES.SYSTEM_RECOMMENDATION,
    versionSnapshot: { recommendationReasonVersion: null },
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
  return {
    success: false,
    schedule: [],
    totalCredits: 0,
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

  // Course_Reviews 全表 181 列，一次撈完比逐課查詢便宜；經 `getMysqlReviews()`
  // 的 TTL 快取（`database.js`），到期前不會重複下全表查詢。
  const courseReviews = await loadCourseReviewsSafely(() => getAll('reviews'));
  const reviewDataLoaded = Array.isArray(courseReviews) && courseReviews.length > 0;

  const mergedConstraints = buildScheduleConstraints(
    {
      ...constraints,
      // `courseIds` 是使用者手動勾選的課。它決定候選池，但不會進入
      // `selectedCourseIds`，因此必須另外告訴排課引擎「這些是使用者指定的」，
      // 否則不符合系外選修認列條件的課會被當成系統自撿的候選而靜默剔除。
      explicitCourseIds: [...(constraints.explicitCourseIds || []), ...courseIds],
    },
    prefs,
    { courseReviews }
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

  if (candidates.length === 0) {
    return annotateScheduleIdentifiers(buildNoCandidatesResult(reviewDataLoaded), requestId);
  }

  const result = annotateScheduleIdentifiers(generateSchedule(candidates, mergedConstraints), requestId);
  await recordExposureSafely(identity, result, requestId, { surface, trigger });
  return result;
}

export default {
  generateForUser,
  loadCourseReviewsSafely,
  buildNoCandidatesResult,
  annotateScheduleIdentifiers,
};
