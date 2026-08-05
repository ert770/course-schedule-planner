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

export function buildScheduleConstraints(input = {}, prefs = {}) {
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
    completedCourseIds: pickList(input.completedCourseIds, prefs.completedCourseIds),
    retakeCourseIds: pickList(
      input.retakeCourseIds || input.failedRequiredCourseIds,
      prefs.retakeCourseIds || prefs.failedRequiredCourseIds
    ),

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
    preferredTrack: input.preferredTrack || prefs.preferredTrack || null,
    preferredKeywords: pickList(input.preferredKeywords, prefs.preferredKeywords),
    interests: pickList(input.interests, prefs.interests ?? prefs.preferenceTags),

    digitalCreditsNeeded: pickFlag(input.digitalCreditsNeeded, prefs.digitalCreditsNeeded),
  };
}

export default { buildScheduleConstraints };
