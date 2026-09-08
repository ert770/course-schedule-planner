// 排課限制條件合併：REST 與 AI Agent 兩條路徑共用同一份邏輯，
// 避免兩處各自漂移導致參數只在其中一條路徑生效。

import { PERIODS_PER_DAY, normalizeBlockedPeriods } from '../utils/periods.js';

const MONDAY = 1;

// 陣列型偏好：空陣列不帶任何資訊，視同「未指定」並退回已儲存偏好。
// 若用 `||`，空陣列在 JS 是 truthy，會把使用者存好的偏好整個蓋掉。
function pickList(requestValue, savedValue) {
  if (Array.isArray(requestValue) && requestValue.length > 0) return requestValue;
  if (Array.isArray(savedValue) && savedValue.length > 0) return savedValue;
  return [];
}

// 純 request 狀態（本次操作的當下選課狀態），不從已儲存偏好回填。
function pickRequestList(requestValue) {
  return Array.isArray(requestValue) && requestValue.length > 0 ? requestValue : [];
}

function pickFlag(requestValue, savedValue, fallback = false) {
  return requestValue ?? savedValue ?? fallback;
}

function pickNumber(requestValue, savedValue, fallback) {
  return requestValue || savedValue || fallback;
}

function buildBlockedPeriods(input, prefs) {
  // request 與已儲存偏好都可能帶時間字串（例如 "08:00"），一律先正規化成
  // 排課引擎認得的 { day, period }，否則比對時 bp.day 為 undefined 會靜默失效。
  const blockedPeriods = normalizeBlockedPeriods(
    pickList(input.blockedPeriods, prefs.blockedPeriods)
  );

  if (input.mondayFree || prefs.mondayFree) {
    for (let period = 1; period <= PERIODS_PER_DAY; period += 1) {
      if (!blockedPeriods.some(item => item.day === MONDAY && item.period === period)) {
        blockedPeriods.push({ day: MONDAY, period });
      }
    }
  }

  return blockedPeriods;
}

export function buildScheduleConstraints(input = {}, prefs = {}, context = {}) {
  return {
    // #13：必修範圍必須依學生的系所與年級收斂，否則全校 2094 筆必修都會被
    // 當成這位學生的必修。這兩個值先前沒有帶進排課限制，排課引擎無從判定。
    department: input.department || prefs.department || null,
    gradeLevel: pickNumber(input.gradeLevel ?? input.grade, prefs.gradeLevel ?? prefs.grade, null),
    degree: input.degree || prefs.degree || undefined,
    // 必修不得換班（資工系明文），因此必修範圍要再收斂到班別。
    // 見 `docs/COURSE_SELECTION_RULES.md` 第八節。
    className: input.className || prefs.className || null,

    // 校規：上限 25、下限 12（四年級 9），超修申請後 30。
    // 見 `docs/COURSE_SELECTION_RULES.md`；未指定時交由排課引擎依年級與超修選擇決定。
    maxCredits: input.maxCredits ?? prefs.targetCreditsMax ?? undefined,
    minCredits: input.minCredits ?? prefs.targetCreditsMin ?? undefined,
    allowCreditOverload: pickFlag(input.allowCreditOverload, prefs.allowCreditOverload),
    // 每日課程數上限沒有校方依據，不再預設 4 門。
    maxCoursesPerDay: input.maxCoursesPerDay ?? undefined,
    blockedPeriods: buildBlockedPeriods(input, prefs),

    noMorningClasses: pickFlag(input.noMorningClasses, prefs.noMorningClasses),
    noEveningClasses: pickFlag(input.noEveningClasses, prefs.noEveningClasses),
    lunchBreakFree: pickFlag(input.lunchBreakFree, prefs.lunchBreakFree),

    noMidterm: pickFlag(input.noMidterm, prefs.noMidterm),
    noGroupReport: pickFlag(input.noGroupReport, prefs.noGroupReport),
    discussion: pickFlag(input.discussion, prefs.preferDiscussion),
    learnMore: pickFlag(input.learnMore, prefs.learnMore),
    weightDaily: pickFlag(input.weightDaily, prefs.weightDaily),
    hideConflict: pickFlag(input.hideConflict, prefs.hideConflict),
    practicalExam: pickFlag(input.practicalExam, prefs.practicalExam),
    finalReport: pickFlag(input.finalReport, prefs.finalReport),
    englishTaught: pickFlag(input.englishTaught, prefs.englishTaught),

    mustTakeCourseIds: pickList(input.mustTakeCourseIds, prefs.mustTakeCourses),
    // 修課歷史直通，**不做 request／偏好合併**。
    //
    // `pickList()` 的用途是「request 可以覆蓋已儲存偏好」，但修課歷史沒有任何
    // 呼叫端會在 request 裡送：`POST /api/schedule/generate` 不送，AI Agent 的
    // `run_csp_scheduler` 工具參數也不含它（見 `promptService.js`）。寫成雙來源
    // 合併只會暗示一個不存在的覆蓋能力，還讓模型有機會塞造假的修課紀錄。
    //
    // 先前這裡是 `completedCourseIds: pickList(input.completedCourseIds, prefs.completedCourseIds)`，
    // 兩邊恆為 `undefined` 與 `[]`，結果永遠是空陣列——這正是已修排除從未生效的原因之一。
    // 已修課號改由 `skills/scheduler.js` 呼叫 `data/courseHistory.js` 當場推導。
    courseHistory: prefs.courseHistory ?? [],

    // 課程評價直通，**不做 request／偏好合併**——與 courseHistory 同理：沒有
    // 呼叫端會在 request 送評價（`promptService.js` 的 tool 契約也不含它）；
    // 寫成雙來源合併只會暗示一個不存在的覆蓋能力，還讓 Agent 有機會塞造假評分。
    // 由 `scheduleService.js` 從 `getAll('reviews')` 取得後放進 `context`。
    courseReviews: context.courseReviews ?? [],

    // roadmap #5B：學到的偏好權重直通，**不做 request／偏好合併**——與
    // courseReviews／courseHistory 完全同理：沒有呼叫端會在 request 送它，
    // 寫成雙來源合併只會讓 Agent 有機會塞一份造假的個人化權重進來。
    // 由 `scheduleService.js` 呼叫 `getSchedulingPreferenceWeights()` 取得後
    // 放進 `context`；`null` 代表沒有可用的學習結果，排課退回顯式 0/1 行為。
    learnedPreference: context.learnedPreference ?? null,

    selectedCourseIds: pickRequestList(input.selectedCourseIds),
    watchingCourseIds: pickRequestList(input.watchingCourseIds),
    // 使用者在課程瀏覽器手動勾選的課（`POST /api/schedule/generate` 的 `courseIds`）。
    // 這些課不得因系外選修認列條件被靜默剔除——那條規則講的是能不能計入畢業學分，
    // 不是能不能修。屬本次操作的當下狀態，不從已儲存偏好回填。
    explicitCourseIds: pickRequestList(input.explicitCourseIds),
    courseStates: input.courseStates || {},

    preferCompact: pickFlag(input.preferCompact, prefs.preferCompact),
    preferEasyCourses: pickFlag(
      input.preferEasyCourses ?? input.preferEasy,
      prefs.preferEasyCourses ?? prefs.preferEasy
    ),
    // roadmap #5B：難度**方向**的另一半，與 `preferEasyCourses` 同層級的顯式旗標。
    // 兩者同時為 true 是使用者自己的條件互相矛盾，由 `scheduler.js` 的
    // `resolveEasyDirection()` 統一視為未表態並發出警告——這裡不做取捨，
    // 因為合併層無從判斷哪一個才是使用者真正的意思。
    preferChallengingCourses: pickFlag(
      input.preferChallengingCourses,
      prefs.preferChallengingCourses
    ),
    preferredTrack: input.preferredTrack || prefs.preferredTrack || null,
    preferredKeywords: pickList(input.preferredKeywords, prefs.preferredKeywords),
    // **不從 `preferenceTags` 回填**（roadmap #10）。
    //
    // 這裡原本是 `prefs.interests ?? prefs.preferenceTags`，而 `prefs.interests`
    // 這個欄位並不存在，因此永遠退回偏好標籤——`#不排早八`、`#全英授課`、
    // `#盡量集中排課` 這些**排課偏好**被當成**興趣主題**，拿去比對課程名稱、
    // 課程介紹與 ragTag（見 scheduler.js 的 getInterestScore()）。那是兩件不同
    // 的事：前者講「什麼時候上課、用什麼形式上課」，後者講「想學什麼主題」。
    // 實測 demo 帳號 16 門可修課 0 門命中，「興趣」這個維度從來沒有真正生效過。
    //
    // 移除 fallback 後沒有興趣關鍵字時 `interests` 為空陣列，
    // `hasExpressedPreference` 會據實回報，而不是靠比不中的標籤假裝有偏好。
    interests: pickList(input.interests, prefs.interests),

    digitalCreditsNeeded: pickFlag(input.digitalCreditsNeeded, prefs.digitalCreditsNeeded),

    // roadmap #21：opt-in 放寬階梯的開關，預設 false——沒有任何呼叫端會
    // 設定這個旗標，因此改動前後行為完全相同。`pickFlag` 的 `??` 語意讓
    // `false` 也是有效的明確覆蓋值，跟其餘布林旗標一致。
    allowRelaxation: pickFlag(input.allowRelaxation, prefs.allowRelaxation),
    // 放寬階梯的順序，使用者可自訂（constraintId 陣列，例如
    // `['LUNCH_BREAK_FREE', 'NO_MORNING_CLASSES', 'NO_EVENING_CLASSES']`）；
    // 未提供時 `scheduler.js` 會退回 `constraintSchema.js` 的預設順序。
    timePreferencePriority: pickList(input.timePreferencePriority, prefs.timePreferencePriority),
    // Roadmap #24：這次請求中絕對不可被自動放寬的偏好。
    //
    // **純 request、不從 prefs 回填**——「這次絕對不行」是當下這句話的語氣，
    // 不該靜默沉澱成永久設定；使用者要永久固定應該走 update_preferences。
    nonNegotiablePreferenceIds: Array.isArray(input.nonNegotiablePreferenceIds)
      ? input.nonNegotiablePreferenceIds
      : [],
  };
}

export default { buildScheduleConstraints };
