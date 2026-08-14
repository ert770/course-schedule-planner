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

import { generateSchedule } from '../skills/scheduler.js';
import { searchCoursesForSchedule } from '../skills/courseQuery.js';
import { getUserPreferences } from './memoryService.js';
import { buildScheduleConstraints } from './constraintService.js';
import { buildStudentScope } from '../skills/courseScope.js';
import { getAll } from '../db/database.js';
import { getFailedRequiredCourseCodes } from '../data/courseHistory.js';

const NO_CANDIDATES_RESULT = {
  success: false,
  schedule: [],
  totalCredits: 0,
  message: '找不到符合條件的課程，請調整篩選條件。',
};

/**
 * 為指定使用者產生課表。
 *
 * @param identity `resolveIdentity()` 的結果，不是原始 userId。
 * @param input    `{ courseIds, filters, constraints }`；三者皆可省略。
 *                 REST 從 body 取得，Chat 從模型的 tool 參數取得。
 * @param options  `{ prefs }` 已載入的 profile，避免同一次對話重複查詢。
 */
export async function generateForUser(identity, input = {}, options = {}) {
  const { courseIds = [], filters = {}, constraints = {} } = input;

  const prefs = options.prefs ?? await getUserPreferences(identity);

  const mergedConstraints = buildScheduleConstraints(
    {
      ...constraints,
      // `courseIds` 是使用者手動勾選的課。它決定候選池，但不會進入
      // `selectedCourseIds`，因此必須另外告訴排課引擎「這些是使用者指定的」，
      // 否則不符合系外選修認列條件的課會被當成系統自撿的候選而靜默剔除。
      explicitCourseIds: [...(constraints.explicitCourseIds || []), ...courseIds],
    },
    prefs
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
    return NO_CANDIDATES_RESULT;
  }

  return generateSchedule(candidates, mergedConstraints);
}

export default { generateForUser };
