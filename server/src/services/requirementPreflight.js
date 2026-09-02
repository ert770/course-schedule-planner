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

import { normalizeBlockedPeriods, PERIODS_PER_DAY } from '../utils/periods.js';
import { isActiveTermCourse } from '../data/activeTerm.js';

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

// 兩門課的時段是否重疊。與 `scheduler.js` 的 `blocksOverlap()` 同一套判定。
function coursesOverlap(a, b) {
  return timeBlocksOf(a).some(x => timeBlocksOf(b).some(y => (
    Number(x.dayOfWeek) === Number(y.dayOfWeek)
    && Number(x.startPeriod) <= Number(y.endPeriod ?? y.startPeriod)
    && Number(y.startPeriod) <= Number(x.endPeriod ?? x.startPeriod)
  )));
}

// 時段類偏好合起來還剩幾個可用節次。
//
// 早八／午休／晚課的節次定義**沿用 `scheduler.js` 的既有規則**，不自己另定一套：
// 早八 = 第 1 節、午休 = 第 5 節、晚間 = 第 12 節以後。
function countAvailableSlots(constraints) {
  const blocked = new Set(
    normalizeBlockedPeriods(constraints.blockedPeriods).map(bp => `${bp.day}-${bp.period}`)
  );
  const days = constraints.mondayFree ? [2, 3, 4, 5] : [1, 2, 3, 4, 5];

  let available = 0;
  for (const day of days) {
    for (let period = 1; period <= PERIODS_PER_DAY; period += 1) {
      if (blocked.has(`${day}-${period}`)) continue;
      if (constraints.noMorningClasses && period === 1) continue;
      if (constraints.lunchBreakFree && period === 5) continue;
      if (constraints.noEveningClasses && period >= 12) continue;
      available += 1;
    }
  }
  return available;
}

const RELAXABLE_FLAG_BY_ID = {
  NO_MORNING_CLASSES: 'noMorningClasses',
  LUNCH_BREAK_FREE: 'lunchBreakFree',
  NO_EVENING_CLASSES: 'noEveningClasses',
};

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
  // 只有 chat 這條路要求模型附上理解回講；其他呼叫端（REST、測試）沒有這個義務。
  requireInterpretation = false,
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

  // (3) 學分區間本身自相矛盾。目前 `constraintService.js` 只是把兩個值直通，
  // 排課引擎也沒有互相比對，因此「最少 20 但最多 15」會一路排到底。
  const { minCredits, maxCredits, maxCoursesPerDay } = constraints;
  if (Number.isFinite(minCredits) && Number.isFinite(maxCredits) && minCredits > maxCredits) {
    questions.push({
      id: 'confirm-credit-range',
      type: 'contradiction',
      prompt: `你說最少要 ${minCredits} 學分、最多只能 ${maxCredits} 學分，這兩個條件無法同時成立。`
        + '請確認學分範圍。',
      courseIds: [],
      constraintIds: ['CREDIT_FLOOR', 'CREDIT_CEILING'],
    });
  }

  // (4) 負數或零的上限。
  for (const [label, value, id] of [
    ['學分下限', minCredits, 'CREDIT_FLOOR'],
    ['學分上限', maxCredits, 'CREDIT_CEILING'],
  ]) {
    if (Number.isFinite(value) && value < 0) {
      questions.push({
        id: 'confirm-credit-range',
        type: 'contradiction',
        prompt: `${label}不能是負數（目前是 ${value}），請確認正確的數字。`,
        courseIds: [],
        constraintIds: [id],
      });
    }
  }
  if (Number.isFinite(maxCoursesPerDay) && maxCoursesPerDay <= 0) {
    questions.push({
      id: 'confirm-daily-cap',
      type: 'contradiction',
      prompt: `每天最多 ${maxCoursesPerDay} 門課代表一門都不能排，請確認這個上限。`,
      courseIds: [],
      constraintIds: ['DAILY_COURSE_CAP'],
    });
  }

  // (5) 指定必修彼此衝堂——使用者自己指名的兩門課本來就撞在一起。
  const mustTake = (constraints.mustTakeCourseIds ?? [])
    .map(id => [Number(id), courseById.get(Number(id))])
    .filter(([, course]) => Boolean(course));

  for (let i = 0; i < mustTake.length; i += 1) {
    for (let j = i + 1; j < mustTake.length; j += 1) {
      const [idA, courseA] = mustTake[i];
      const [idB, courseB] = mustTake[j];
      if (!coursesOverlap(courseA, courseB)) continue;

      questions.push({
        id: 'confirm-required-course-conflict',
        type: 'course-priority',
        prompt: `你指定一定要修的「${courseA.name}」和「${courseB.name}」上課時間互相衝突，`
          + '沒辦法同時排進同一份課表，請確認要保留哪一門。',
        courseIds: [idA, idB],
        constraintIds: ['TIME_CONFLICT'],
      });
    }
  }

  // (6) 指定必修的學分總和已經超過學分上限。
  if (Number.isFinite(maxCredits) && mustTake.length > 0) {
    const total = mustTake.reduce((sum, [, course]) => sum + (Number(course.credits) || 0), 0);
    if (total > maxCredits) {
      questions.push({
        id: 'confirm-credit-range',
        type: 'contradiction',
        prompt: `你指定一定要修的課合計 ${total} 學分，已經超過你設的上限 ${maxCredits} 學分。`
          + '請確認要提高上限，還是拿掉其中幾門。',
        courseIds: mustTake.map(([id]) => id),
        constraintIds: ['CREDIT_CEILING'],
      });
    }
  }

  // (7) 指定必修不在本學期開課。
  for (const [id, course] of mustTake) {
    if (isActiveTermCourse(course)) continue;
    questions.push({
      id: 'confirm-course-term',
      type: 'missing-data',
      prompt: `你指定一定要修的「${course.name}」不是本學期開的課，沒辦法排進這學期的課表。`
        + '請確認是不是要換一門，或改排下學期。',
      courseIds: [id],
      constraintIds: ['OFF_TERM'],
    });
  }

  // (8) 已選課程撞到自己設定的封鎖時段。
  for (const rawId of constraints.selectedCourseIds ?? []) {
    const course = courseById.get(Number(rawId));
    if (!course) continue;
    if (!courseIntersectsBlockedPeriods(course, constraints.blockedPeriods)) continue;

    questions.push({
      id: 'confirm-selected-course-conflict',
      type: 'course-priority',
      prompt: `你已選的「${course.name}」上課時間落在你設定的不能上課時段裡，`
        + '請確認要退掉這門課，還是放寬那個時段。',
      courseIds: [Number(rawId)],
      constraintIds: ['BLOCKED_PERIODS'],
    });
  }

  // (9) 時段偏好合起來把可用節次清空。
  if (countAvailableSlots(constraints) === 0) {
    questions.push({
      id: 'confirm-time-preferences',
      type: 'contradiction',
      prompt: '你設定的不能上課時段與時段偏好合起來，已經沒有任何節次可以排課了。'
        + '請確認要放寬哪一項。',
      courseIds: [],
      constraintIds: ['BLOCKED_PERIODS'],
    });
  }

  // (10) 指名「絕對不可放寬」的偏好，但那個偏好根本沒有開。
  //
  // 這代表模型自己前後矛盾（例如列了 NO_MORNING_CLASSES 卻沒設 noMorningClasses），
  // 照著排下去會產生一份與使用者語意不符的課表。
  for (const id of constraints.nonNegotiablePreferenceIds ?? []) {
    const flag = RELAXABLE_FLAG_BY_ID[id];
    if (!flag || constraints[flag] === true) continue;

    questions.push({
      id: 'confirm-preference-strength',
      type: 'contradiction',
      prompt: `你把「${id}」列為絕對不可放寬，但這個偏好目前並沒有開啟。`
        + '請確認你是不是要啟用這個限制。',
      courseIds: [],
      constraintIds: [id],
    });
  }

  // (11) 理解回講與實際參數自相矛盾。
  //
  // 模型在回講裡說「絕對不排早八」，實際參數卻沒有把 noMorningClasses 打開，
  // 或沒有列進 nonNegotiablePreferenceIds——那份課表排出來就會與它自己剛剛
  // 對使用者說的話不符。這是模型前後矛盾，退回去讓它修正。
  // (12) 理解回講缺漏。
  //
  // schema 把四個子欄位列為 required，但 OpenAI 的 function calling 在非 strict
  // 模式下**不強制巢狀 required**——實測模型會送 `interpretation: {}` 過來。
  // 沒有回講就等於沒有這一層保護，因此由伺服器自己擋。
  const interpretation = constraints.interpretation ?? null;
  const REQUIRED_INTERPRETATION_FIELDS = ['nonNegotiable', 'flexible', 'creditGoal', 'notMentioned'];
  const missingFields = interpretation
    ? REQUIRED_INTERPRETATION_FIELDS.filter(field => interpretation[field] === undefined)
    : REQUIRED_INTERPRETATION_FIELDS;

  if (requireInterpretation && missingFields.length > 0) {
    questions.push({
      id: 'confirm-interpretation-missing',
      type: 'contradiction',
      prompt: `排課前必須先附上完整的 interpretation，目前缺少：${missingFields.join('、')}。`
        + '請把你對使用者需求的理解填齊再呼叫一次。',
      courseIds: [],
      constraintIds: [],
    });
  }

  if (interpretation) {
    const nonNegotiable = new Set(
      Array.isArray(interpretation.nonNegotiable) ? interpretation.nonNegotiable : []
    );
    const declared = new Set(constraints.nonNegotiablePreferenceIds ?? []);

    // 回講改用代號之後，這裡是**代號直接比對**，不再靠關鍵字猜——
    // 精準得多，也不會因為模型換一種寫法就漏判。
    for (const [constraintId, flag] of Object.entries(RELAXABLE_FLAG_BY_ID)) {
      if (!nonNegotiable.has(constraintId)) continue;
      if (constraints[flag] === true && declared.has(constraintId)) continue;

      questions.push({
        id: 'confirm-interpretation-mismatch',
        type: 'contradiction',
        prompt: `你在理解說明裡把「${constraintId}」列為絕對不可退讓，`
          + '但實際排課參數沒有把它設成硬性限制。請確認使用者的語氣到底是不是絕對的。',
        courseIds: [],
        constraintIds: [constraintId],
      });
    }
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
