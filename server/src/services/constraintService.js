// 排課限制條件合併：REST 與 AI Agent 兩條路徑共用同一份邏輯，
// 避免兩處各自漂移導致參數只在其中一條路徑生效。

const PERIODS_PER_DAY = 14;
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
  const blockedPeriods = [...pickList(input.blockedPeriods, prefs.blockedPeriods)];

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
    maxCredits: pickNumber(input.maxCredits, prefs.targetCreditsMax, 22),
    minCredits: pickNumber(input.minCredits, prefs.targetCreditsMin, 15),
    maxCoursesPerDay: pickNumber(input.maxCoursesPerDay, null, 4),
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
