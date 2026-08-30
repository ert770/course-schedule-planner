// Roadmap #24：排課**之前**的確定性矛盾偵測。
//
// **與 Roadmap #22 的分工**：`scheduler.js` 的 `buildClarification()` 是
// 「排完課、發現排不出來」之後才產生的澄清；它看不到「這組參數本身就自相矛盾
// 或資料根本不足」這件事。本模組跑在 `run_csp_scheduler` 進入排課引擎之前，
// 把那些不必真的跑一次排課就能斷定的問題先攔下來。
//
// **刻意不重複 #22 已覆蓋的範圍**：`mustTakeCourseIds` 指向不存在的課程 id
// 已由 Z5（`docs/TEST_PLAN.md`）在排課層處理，這裡不再檢查。
//
// **回傳形狀刻意與 `buildClarification()` 完全一致**
// （`{ required, reason, questions, adjustableConstraintIds, relatedCourseIds }`），
// 這樣模型既有的 #22 澄清指令可以原封不動套用，不必為了這一層再教它一套新詞彙。
// `requirementPreflight.test.js` 有一項測試專門釘住兩者的 key 一致，避免日後漂移。
//
// 純函式，所有外部資料由呼叫端注入（比照 `executeAgentTool(name, args, ctx, deps)`
// 與 `scheduleService.loadCourseReviewsSafely()` 的既有作法）。

import { normalizeBlockedPeriods } from '../utils/periods.js';

// 取出一門課的所有上課時段。
//
// 與 `scheduler.js` 的 `getTimeBlocks()` 保持同樣語意：優先用 `timeBlocks`
// （#16 多時段課程，資料庫中約 9% 屬於此類），沒有才退回單一 `dayOfWeek`／
// `startPeriod`。欄位名是 `dayOfWeek` 而不是 `day`——這點與 `blockedPeriods`
// 正規化後的 `{ day, period }` 不同，混用會靜默失效。
function timeBlocksOf(course) {
  if (Array.isArray(course?.timeBlocks) && course.timeBlocks.length > 0) {
    return course.timeBlocks;
  }
  if (course?.dayOfWeek == null || course?.startPeriod == null) return [];
  return [{
    dayOfWeek: course.dayOfWeek,
    startPeriod: course.startPeriod,
    endPeriod: course.endPeriod ?? course.startPeriod,
  }];
}

// 課程的上課時段與使用者自訂的封鎖時段是否相交。任一時段落入即算衝突。
export function courseIntersectsBlockedPeriods(course, blockedPeriods = []) {
  const blocked = normalizeBlockedPeriods(blockedPeriods);
  if (blocked.length === 0) return false;

  return timeBlocksOf(course).some(block => blocked.some(
    bp => Number(bp.day) === Number(block.dayOfWeek)
      && Number(bp.period) >= Number(block.startPeriod)
      && Number(bp.period) <= Number(block.endPeriod ?? block.startPeriod)
  ));
}

/**
 * 排課前的矛盾與資料不足檢查。
 *
 * @param constraints   模型送進 `run_csp_scheduler` 的參數（已由 JSON Schema 驗過型別）。
 * @param studentScope  `buildStudentScope(prefs)` 的結果。
 * @param courseById    `Map<sectionId, course>`，只需含 `mustTakeCourseIds` 指到的課；
 *                      呼叫端負責查詢，本函式不碰資料庫。
 */
export function checkPreflightContradictions({
  constraints = {},
  studentScope = null,
  courseById = new Map(),
} = {}) {
  const questions = [];

  // (1) 系所／年級無法解析。
  //
  // `scheduleService.generateForUser()` 目前拿到 `resolved: false` 的 scope 也照排
  // 不誤，使用者不會知道這份課表的必修判定其實是懸空的。而 `courseScope.js` 自己
  // 的註解明講這種情況不得用猜的補值——那就不該靜默排完了事，要先問。
  if (studentScope && studentScope.resolved === false) {
    questions.push({
      id: 'confirm-student-scope',
      type: 'missing-data',
      prompt: studentScope.departmentUnmapped
        ? '你的系所名稱對不到系統的系所對照表，請確認正確的系所全名，我才能判斷哪些是你的必修。'
        : '請提供你的系所與年級（或班別，例如「資訊三甲」），我才能正確判斷必修課範圍。',
      courseIds: [],
      constraintIds: ['REQUIRED_COURSE_COVERAGE'],
    });
  }

  // (2) 使用者指名一定要修的課，本身就落在他自己設定的封鎖時段裡。
  //
  // 這是使用者自己給的兩個條件互相打架，不是排課排不出來——直接問他要保留哪一邊，
  // 比跑完一次排課再回報「無解」誠實也快得多。
  for (const rawId of constraints.mustTakeCourseIds ?? []) {
    const course = courseById.get(Number(rawId));
    if (!course) continue;
    if (!courseIntersectsBlockedPeriods(course, constraints.blockedPeriods)) continue;

    questions.push({
      id: 'confirm-required-course-conflict',
      type: 'course-priority',
      prompt: `你指定一定要修的「${course.name}」上課時間落在你設定的不能上課時段裡，`
        + '請確認要保留這門課，還是保留那個時段。',
      courseIds: [Number(rawId)],
      constraintIds: ['BLOCKED_PERIODS'],
    });
  }

  return {
    required: questions.length > 0,
    reason: questions.length > 0 ? 'pre-scheduling-contradiction' : null,
    questions,
    // 這一層的問題都是「使用者自己的條件互相矛盾」或「資料不足」，不是排課引擎
    // 可以自行放寬的軟性偏好，因此恆為空——放寬與否要由使用者回答後決定。
    adjustableConstraintIds: [],
    relatedCourseIds: [...new Set(questions.flatMap(q => q.courseIds))],
  };
}

export default { checkPreflightContradictions, courseIntersectsBlockedPeriods };
