// docs/TEST_PLAN.md「排課邏輯測試」S1-S17、M1-M4、W1-W3、U1-U4 的可執行版本。
//
// 這些案例原本只是文件上的人工項目，改動 scheduler.js 時沒有任何機制阻止回歸。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  generateSchedule,
  validateSchedule,
  checkConflict,
} from '../src/skills/scheduler.js';
import { validateScheduleAgainstConstraints } from '../src/skills/scheduleValidator.js';
import { CONSTRAINTS } from '../src/data/constraintSchema.js';
import { buildScheduleConstraints } from '../src/services/constraintService.js';
import {
  makeCourse,
  makeMultiBlockCourse,
  makeUnscheduledCourse,
  makeReview,
  makeEasyReview,
  makeToughReview,
} from './fixtures.js';

describe('S1-S2 衝堂與關注課程', () => {
  test('S1 兩門加選課同天同時段判定衝堂', () => {
    const a = makeCourse(1, { dayOfWeek: 1, startPeriod: 3, endPeriod: 4 });
    const b = makeCourse(2, { dayOfWeek: 1, startPeriod: 4, endPeriod: 5 });

    assert.equal(checkConflict(a, b), true);
    assert.equal(validateSchedule([a, b]).valid, false);
  });

  test('S1 同天但節次錯開不判定衝堂', () => {
    const a = makeCourse(1, { dayOfWeek: 1, startPeriod: 3, endPeriod: 4 });
    const b = makeCourse(2, { dayOfWeek: 1, startPeriod: 5, endPeriod: 6 });

    assert.equal(checkConflict(a, b), false);
  });

  test('S2 兩門關注課同天同時段不判定衝堂', () => {
    const a = { ...makeCourse(1), scheduleState: 'watching' };
    const b = { ...makeCourse(2), scheduleState: 'watching' };

    assert.equal(validateSchedule([a, b]).valid, true);
  });

  test('S16 候選課程全為關注狀態時視為合法結果', () => {
    const result = generateSchedule([makeCourse(1), makeCourse(2)], {
      watchingCourseIds: [1, 2],
      minCredits: 0,
    });

    assert.equal(result.success, true);
    assert.equal(result.watchOnly, true);
    assert.equal(result.watchedCourses.length, 2);
    assert.equal(result.schedule.length, 0);
    assert.match(result.message, /關注課程/);
  });

  test('S17 指定必修排不進去時仍完整回傳關注課程', () => {
    const blocked = makeCourse(1, { startPeriod: 1, endPeriod: 2 });
    const watched = makeCourse(2, { dayOfWeek: 3 });

    const result = generateSchedule([blocked, watched], {
      noMorningClasses: true,
      mustTakeCourseIds: [1],
      watchingCourseIds: [2],
    });

    assert.equal(result.success, false);
    assert.equal(result.watchedCourses.length, 1);
  });
});

describe('S3-S4 必修與重補修優先', () => {
  test('S3 必修與選修衝堂時保留必修', () => {
    const required = makeCourse(1, { category: '必修' });
    const elective = makeCourse(2, { category: '選修' });

    const result = generateSchedule([elective, required], {
      department: '資訊工程學系',
      gradeLevel: 3,
      className: '資訊三甲',
      minCredits: 0,
      maxCredits: 9,
    });

    assert.ok(result.schedule.some(course => course.id === 1));
    assert.ok(!result.schedule.some(course => course.id === 2));
  });

  test('S4 重補修課程優先排入', () => {
    const retake = makeCourse(1, {
      name: '計算機結構學',
      catalogCourseCode: 'IECS3003',
      category: '選修',
      dayOfWeek: 2,
    });
    const other = makeCourse(2, { category: '選修', dayOfWeek: 2 });

    const result = generateSchedule([other, retake], {
      courseHistory: [{
        academicYear: 113,
        semester: 2,
        courseCode: 'IECS3003',
        courseName: '計算機結構學',
        passed: false,
        requirementType: '必修',
      }],
      minCredits: 0,
      maxCredits: 3,
    });

    assert.equal(result.schedule.length, 1);
    assert.equal(result.schedule[0].id, 1);
  });
});

describe('#13B 資格待確認課程', () => {
  const pendingCourse = makeCourse(901, {
    name: '共同國文',
    department: '國文綜合班',
    category: '選修',
  });
  const student = {
    department: '資訊工程學系',
    gradeLevel: 3,
    className: '資訊三甲',
    minCredits: 0,
    maxCredits: 9,
  };

  test('未明確指定時保守排除並附上原因', () => {
    const result = generateSchedule([pendingCourse], student);

    assert.equal(result.schedule.length, 0);
    assert.ok(result.excludedCourses.some(item => (
      item.course.id === pendingCourse.id
      && item.reason.includes('正式適用對象規則尚未確認')
    )));
    assert.ok(result.warnings.some(warning => warning.includes('資格待確認')));
  });

  test('使用者明確指定時保留課程，但仍顯示資格待確認', () => {
    const result = generateSchedule([pendingCourse], {
      ...student,
      mustTakeCourseIds: [pendingCourse.id],
    });

    assert.ok(result.schedule.some(course => course.id === pendingCourse.id));
    assert.ok(result.warnings.some(warning => (
      warning.includes('資格待確認') && warning.includes('共同國文')
    )));
  });
});

describe('#20 active term 過濾（繞過 courseQuery、直接查詢的候選）', () => {
  test('系統自撿的非本學期候選被排除，並附上開課學期原因', () => {
    const offTerm = makeCourse(601, {
      name: '舊學期選修',
      department: '資訊三甲',
      category: '選修',
      year: 113,
      semester: '上學期',
    });
    const onTerm = makeCourse(602, {
      name: '本學期選修',
      department: '資訊三甲',
      category: '選修',
      year: 114,
      semester: '下學期',
      dayOfWeek: 2,
    });

    const result = generateSchedule([offTerm, onTerm], { minCredits: 0, maxCredits: 9 });

    assert.ok(!result.schedule.some(course => course.id === 601));
    assert.ok(result.excludedCourses.some(item => (
      item.course.id === 601 && item.reason.includes('113學年上學期開課')
    )));
    assert.ok(result.warnings.some(warning => warning.includes('非本學期')));
  });

  test('使用者明確指定非本學期課程時保留並警告，不靜默排除', () => {
    const offTerm = makeCourse(603, {
      name: '舊學期選修',
      department: '資訊三甲',
      category: '選修',
      year: 113,
      semester: '上學期',
      dayOfWeek: 2,
    });

    const result = generateSchedule([offTerm], {
      minCredits: 0,
      maxCredits: 9,
      mustTakeCourseIds: [offTerm.id],
    });

    assert.ok(result.schedule.some(course => course.id === 603));
    assert.ok(result.warnings.some(warning => (
      warning.includes('你指定的課程中有') && warning.includes('非本學期開課')
    )));
  });

  test('#19 重補修 union 遇到非本學期 section 時，仍正確提醒下學期重修，不被靜默滿足', () => {
    // 唯一對得上這個不及格必修課號的 section 是舊學期資料。若不做 active term
    // 過濾，這門課會被誤當成「本學期已開課」而靜默滿足重補修，
    // 壓下原本該出現的「本學期沒有開課」警告——這正是本測試要釘住的行為。
    const offTermRetake = makeCourse(604, {
      name: '高等演算法',
      catalogCourseCode: 'IECS3999',
      category: '選修',
      year: 113,
      semester: '上學期',
    });

    const result = generateSchedule([offTermRetake], {
      courseHistory: [{
        academicYear: 113,
        semester: 1,
        courseCode: 'IECS3999',
        courseName: '高等演算法',
        passed: false,
        requirementType: '必修',
      }],
      minCredits: 0,
    });

    assert.ok(!result.schedule.some(course => course.id === 604));
    assert.ok(result.warnings.some(warning => (
      warning === 'IECS3999 高等演算法本學期沒有開課，請下學期記得重修。'
    )));
  });
});

describe('P1-P2 課程類別優先度', () => {
  test('P1 一般選修使用選修優先度，不會落到未知類別的預設值', () => {
    const generalElective = makeCourse(1, { category: '一般選修' });
    const unknownCategory = makeCourse(2, { category: '未分類' });

    const result = generateSchedule([unknownCategory, generalElective], {
      minCredits: 0,
      maxCredits: 3,
    });

    assert.deepEqual(result.schedule.map(course => course.id), [1]);
  });

  test('P2 非系所班級的必修降為一般選修優先度', () => {
    const generalElective = makeCourse(1, { category: '一般選修' });
    const commonRequired = makeCourse(2, {
      category: '必修',
      department: '共同科目',
    });

    const result = generateSchedule([generalElective, commonRequired], {
      department: '資訊工程學系',
      gradeLevel: 3,
      className: '資訊三甲',
      minCredits: 0,
      maxCredits: 3,
    });

    assert.deepEqual(result.schedule.map(course => course.id), [1]);
  });
});

describe('H4-H8 已修課程依課號排除', () => {
  const passedHistory = [{ courseCode: 'IECS3002', passed: true }];

  test('H4 已修課號的所有班次都被排除，並逐班次附上原因', () => {
    const sections = [
      makeCourse(101, {
        name: '計算機演算法',
        catalogCourseCode: 'IECS3002',
        department: '資訊三甲',
        dayOfWeek: 2,
      }),
      makeCourse(202, {
        name: '計算機演算法',
        catalogCourseCode: 'IECS3002',
        department: '資訊三乙',
        dayOfWeek: 3,
      }),
    ];

    const result = generateSchedule(sections, {
      courseHistory: passedHistory,
      minCredits: 0,
      maxCredits: 9,
    });

    assert.equal(result.schedule.length, 0);
    assert.deepEqual(
      result.excludedCourses.map(item => item.course.id).sort((a, b) => a - b),
      [101, 202]
    );
    assert.ok(result.excludedCourses.every(
      item => item.reason === '已修過並通過（課號 IECS3002）'
    ));
  });

  test('H5 同一課號換成不同 section id 仍會被排除', () => {
    const currentSection = makeCourse(999, {
      name: '計算機演算法',
      catalogCourseCode: 'IECS3002',
    });

    const result = generateSchedule([currentSection], {
      courseHistory: passedHistory,
      minCredits: 0,
    });

    assert.ok(!result.schedule.some(course => course.id === 999));
    assert.ok(result.excludedCourses.some(item => item.course.id === 999));
  });

  test('H6 passed: false 的必修不被排除，且由 courseHistory 自動排入', () => {
    const retake = makeCourse(303, {
      name: '計算機演算法',
      catalogCourseCode: 'IECS3002',
    });

    const result = generateSchedule([retake], {
      courseHistory: [{
        academicYear: 113,
        semester: 1,
        courseCode: 'IECS3002',
        courseName: '計算機演算法',
        passed: false,
        requirementType: '必修',
      }],
      minCredits: 0,
      maxCredits: 3,
    });

    assert.ok(result.schedule.some(course => course.id === 303));
    assert.ok(!result.excludedCourses.some(item => item.reason.includes('已修過並通過')));
  });

  test('H6 同一重補修課有多個班次時最多排一班，任一班排入後不發失敗 warning', () => {
    const sections = [
      makeCourse(303, { name: '人工智慧導論', catalogCourseCode: 'IECS3059', dayOfWeek: 2 }),
      makeCourse(304, { name: '人工智慧導論', catalogCourseCode: 'IECS3059', dayOfWeek: 3 }),
      makeCourse(305, { name: '人工智慧導論', catalogCourseCode: 'IECS3059', dayOfWeek: 4 }),
    ];
    const result = generateSchedule(sections, {
      courseHistory: [{
        academicYear: 113,
        semester: 1,
        courseCode: 'IECS3059',
        courseName: '人工智慧導論',
        passed: false,
        requirementType: '必修',
      }],
      minCredits: 0,
      maxCredits: 3,
    });

    assert.equal(result.schedule.filter(course => course.catalogCourseCode === 'IECS3059').length, 1);
    assert.ok(!result.warnings.some(warning => warning.includes('未能排入')));
  });

  test('H6 本學期沒有開不及格必修時提醒下學期重修', () => {
    const result = generateSchedule([makeCourse(1)], {
      courseHistory: [{
        academicYear: 113,
        semester: 1,
        courseCode: 'IECS3999',
        courseName: '高等演算法',
        passed: false,
        requirementType: '必修',
      }],
      minCredits: 0,
    });

    assert.ok(result.warnings.some(warning => (
      warning === 'IECS3999 高等演算法本學期沒有開課，請下學期記得重修。'
    )));
  });

  test('H6 本學期必修優先於不及格必修重修', () => {
    const currentRequired = makeCourse(1, {
      name: '本學期必修',
      catalogCourseCode: 'IECS4001',
      category: '必修',
      department: '資訊三甲',
      dayOfWeek: 2,
    });
    const retake = makeCourse(2, {
      name: '舊必修重修',
      catalogCourseCode: 'IECS2001',
      category: '選修',
      department: '資訊二甲',
      dayOfWeek: 2,
    });

    const result = generateSchedule([retake, currentRequired], {
      department: '資訊工程學系',
      gradeLevel: 3,
      className: '資訊三甲',
      courseHistory: [{
        academicYear: 112,
        semester: 1,
        courseCode: 'IECS2001',
        courseName: '舊必修重修',
        passed: false,
        requirementType: '必修',
      }],
      minCredits: 0,
      maxCredits: 3,
    });

    assert.deepEqual(result.schedule.map(course => course.id), [1]);
  });

  test('H7 缺少 catalogCourseCode 時不以課名 fallback 誤判為已修', () => {
    const missingCode = makeCourse(404, {
      name: '計算機演算法',
      catalogCourseCode: undefined,
    });

    const result = generateSchedule([missingCode], {
      courseHistory: passedHistory,
      minCredits: 0,
    });

    assert.ok(result.schedule.some(course => course.id === 404));
    assert.ok(!result.excludedCourses.some(item => item.reason.includes('已修過並通過')));
  });

  test('H8 課號精確比對，不做 trim 或大小寫正規化', () => {
    const currentSection = makeCourse(505, {
      name: '計算機演算法',
      catalogCourseCode: 'IECS3002',
    });

    const result = generateSchedule([currentSection], {
      courseHistory: [{ courseCode: ' iecs3002 ', passed: true }],
      minCredits: 0,
    });

    assert.ok(result.schedule.some(course => course.id === 505));
    assert.ok(!result.excludedCourses.some(item => item.reason.includes('已修過並通過')));
  });
});

describe('S5-S6 核心選修路徑', () => {
  // 修課路徑資料來自 113 課程地圖（`server/src/data/csCurriculum.js`）。
  const csScope = { department: '資訊工程學系', gradeLevel: 3, minCredits: 0 };

  test('S5 資工系選修依必選修科目表解析成核心選修，並帶出修課路徑', () => {
    const course = makeCourse(1, {
      name: '人工智慧導論',
      catalogCourseCode: 'IECS3059',
      department: '資訊三合',
      category: '選修',
    });

    const result = generateSchedule([course], csScope);
    const placed = result.schedule.find(item => item.id === 1);

    assert.equal(placed.category, '核心選修');
    assert.equal(placed.sourceCategory, '選修');
    assert.equal(placed.track, '技術應用類');
  });

  test('S5 同名的他系課程不得被當成資工系核心選修', () => {
    // 資料庫中「網路程式設計」只有通訊工程學系的 COME3016，
    // 只比對課名會把他系課程誤判成資工系核心選修。它是系外選修，
    // 且因課名與本系科目表重複而不得認列。
    const course = makeCourse(2, {
      name: '網路程式設計',
      catalogCourseCode: 'COME3016',
      department: '通訊三合',
      category: '選修',
    });

    const result = generateSchedule([course], csScope);

    assert.ok(!result.schedule.some(item => item.id === 2), '不得排入');
    assert.ok(
      result.excludedCourses.some(item => item.reason.includes('與本系')),
      JSON.stringify(result.excludedCourses)
    );
  });

  test('S5 他系且與本系不重複的選修解析為系外選修', () => {
    const course = makeCourse(3, {
      name: '個體經濟學',
      catalogCourseCode: 'ECON2001',
      department: '經濟二甲',
      category: '選修',
    });

    const result = generateSchedule([course], csScope);
    const placed = result.schedule.find(item => item.id === 3);

    assert.equal(placed.category, '系外選修');
    assert.equal(placed.track, null);
  });

  test('S6 候選課程中沒有該路徑的課程時回報警告而非靜默通過', () => {
    const result = generateSchedule([makeCourse(1)], {
      preferredTrack: '技術應用類',
      minCredits: 0,
    });

    assert.ok(
      result.warnings.some(warning => warning.includes('技術應用類')),
      result.warnings.join(' | ')
    );
  });
});

describe('S7-S10 硬性限制', () => {
  test('S7 不上早八時排除第一節開始的課程', () => {
    const early = makeCourse(1, { startPeriod: 1, endPeriod: 2 });
    const later = makeCourse(2, { startPeriod: 6, endPeriod: 7 });

    const result = generateSchedule([early, later], { noMorningClasses: true, minCredits: 0 });

    assert.ok(!result.schedule.some(course => course.id === 1));
    assert.ok(result.schedule.some(course => course.id === 2));
    assert.ok(result.excludedCourses.some(item => item.reason.includes('早八')));
  });

  test('S8 週一空堂時週一不排正式加選課', () => {
    const monday = makeCourse(1, { dayOfWeek: 1 });
    const tuesday = makeCourse(2, { dayOfWeek: 2 });
    const constraints = { ...buildScheduleConstraints({ mondayFree: true }, {}), minCredits: 0 };

    const result = generateSchedule([monday, tuesday], constraints);

    assert.ok(!result.schedule.some(course => course.dayOfWeek === 1));
    assert.ok(result.schedule.some(course => course.id === 2));
  });

  test('S9 學分低於最低門檻時回傳警告', () => {
    const result = generateSchedule([makeCourse(1)], { minCredits: 15, maxCredits: 22 });

    assert.ok(result.warnings.some(warning => warning.includes('低於最低目標')));
  });

  test('S10 指定必要課程無法排入時回傳失敗原因', () => {
    const result = generateSchedule([makeCourse(1, { startPeriod: 1, endPeriod: 2 })], {
      noMorningClasses: true,
      mustTakeCourseIds: [1],
    });

    assert.equal(result.success, false);
    assert.ok(result.message.length > 0);
  });
});

describe('S13-S14 偏好符合度決定主推方案', () => {
  // 讓選修填充階段有足夠空間，否則必修就會塞滿學分上限，看不出 variant 差異。
  function makeCandidates() {
    return [
      makeCourse(1, { name: '網路安全概論', dayOfWeek: 1, startPeriod: 2, endPeriod: 3, credits: 3 }),
      makeCourse(2, { name: '網路程式設計', dayOfWeek: 1, startPeriod: 6, endPeriod: 7, credits: 3 }),
      makeCourse(3, { name: '文學賞析', dayOfWeek: 2, startPeriod: 2, endPeriod: 3, credits: 3 }),
      makeCourse(4, { name: '音樂欣賞', dayOfWeek: 3, startPeriod: 2, endPeriod: 3, credits: 3 }),
      makeCourse(5, { name: '體育', dayOfWeek: 4, startPeriod: 2, endPeriod: 3, credits: 3 }),
    ];
  }

  test('S13 表達興趣偏好時，興趣方案成為 plans[0]', () => {
    const result = generateSchedule(makeCandidates(), {
      preferredKeywords: ['網路'],
      minCredits: 0,
      maxCredits: 22,
    });

    assert.equal(result.hasExpressedPreference, true);
    assert.ok(result.plans[0].preferenceScore > 0, '主推方案應有偏好分數');
    // 每個方案都必須帶偏好分數，才能彼此比較
    for (const plan of result.plans) {
      assert.equal(typeof plan.preferenceScore, 'number');
    }
    // plans 依偏好符合度排序（同分才比學分）
    for (let i = 1; i < result.plans.length; i += 1) {
      assert.ok(result.plans[i - 1].preferenceScore >= result.plans[i].preferenceScore - 0.001);
    }
  });

  test('S14 未表達任何軟性偏好時回報 hasExpressedPreference 為 false 並警告', () => {
    const result = generateSchedule(makeCandidates(), { minCredits: 0, maxCredits: 22 });

    assert.equal(result.hasExpressedPreference, false);
    assert.ok(result.warnings.some(warning => warning.includes('個人化程度有限')));
  });
});

describe('M1-M4 多時段課程', () => {
  const multi = makeMultiBlockCourse(1, [
    { dayOfWeek: 4, startPeriod: 1, endPeriod: 4 },
    { dayOfWeek: 4, startPeriod: 6, endPeriod: 9 },
    { dayOfWeek: 5, startPeriod: 1, endPeriod: 4 },
  ]);

  test('M1 與第二個以後的時段重疊時判定衝堂', () => {
    // 真實案例：建築設計(二) (四)01-04 (四)06-09 (五)01-04 vs 循環經濟 (四)06-07
    const other = makeMultiBlockCourse(2, [{ dayOfWeek: 4, startPeriod: 6, endPeriod: 7 }]);

    assert.equal(checkConflict(multi, other), true);
    // 只比第一段會漏判，這是修復前的行為
    assert.equal(multi.dayOfWeek === other.dayOfWeek
      && !(multi.endPeriod < other.startPeriod || other.endPeriod < multi.startPeriod), false);
  });

  test('M2 與任一時段皆不重疊時不判定衝堂', () => {
    const other = makeMultiBlockCourse(2, [{ dayOfWeek: 3, startPeriod: 2, endPeriod: 3 }]);

    assert.equal(checkConflict(multi, other), false);
  });

  test('M3 封鎖時段命中非第一段時排除課程', () => {
    const result = generateSchedule([multi], {
      blockedPeriods: [{ day: 5, period: 2 }],
      minCredits: 0,
    });

    assert.equal(result.schedule.length, 0);
    assert.ok(result.excludedCourses.some(item => item.reason.includes('封鎖')));
  });

  test('M4 單日課程數上限對每一天分別計算', () => {
    const courses = [
      multi,
      makeCourse(2, { dayOfWeek: 5, startPeriod: 6, endPeriod: 7 }),
      makeCourse(3, { dayOfWeek: 5, startPeriod: 8, endPeriod: 9 }),
    ];

    const result = generateSchedule(courses, { minCredits: 0, maxCoursesPerDay: 2, maxCredits: 22 });
    const fridayCount = result.schedule.filter(course => {
      const blocks = course.timeBlocks || [{ dayOfWeek: course.dayOfWeek }];
      return blocks.some(block => block.dayOfWeek === 5);
    }).length;

    assert.ok(fridayCount <= 2, `週五課程數 ${fridayCount} 應不超過 2`);
  });
});

describe('W1-W2 週末課程', () => {
  test('W1 週六課程可被排入', () => {
    const result = generateSchedule(
      [makeCourse(1, { dayOfWeek: 6, startPeriod: 2, endPeriod: 3 })],
      { minCredits: 0 }
    );

    assert.equal(result.schedule.length, 1);
    assert.equal(result.schedule[0].dayOfWeek, 6);
  });

  test('W2 週日課程可被排入', () => {
    const result = generateSchedule(
      [makeCourse(1, { dayOfWeek: 7, startPeriod: 2, endPeriod: 3 })],
      { minCredits: 0 }
    );

    assert.equal(result.schedule.length, 1);
    assert.equal(result.schedule[0].dayOfWeek, 7);
  });

  test('W2 週六與週日課程互不衝堂', () => {
    const saturday = makeCourse(1, { dayOfWeek: 6, startPeriod: 2, endPeriod: 3 });
    const sunday = makeCourse(2, { dayOfWeek: 7, startPeriod: 2, endPeriod: 3 });

    assert.equal(checkConflict(saturday, sunday), false);
  });
});

describe('U1-U4 尚未排定時間的課程', () => {
  test('U1 貪婪填充不會加入無時間課程', () => {
    const result = generateSchedule(
      [makeCourse(1), makeUnscheduledCourse(2), makeUnscheduledCourse(3)],
      { minCredits: 0, maxCredits: 22 }
    );

    assert.equal(result.unscheduledCourses.length, 0);
    assert.ok(!result.schedule.some(course => [2, 3].includes(course.id)));
  });

  test('U2 被指定為必要課程的無時間課程仍會排入並發出警告', () => {
    const result = generateSchedule([makeCourse(1), makeUnscheduledCourse(2)], {
      mustTakeCourseIds: [2],
      minCredits: 0,
    });

    assert.equal(result.unscheduledCourses.length, 1);
    assert.equal(result.unscheduledCourses[0].id, 2);
    assert.ok(result.warnings.some(warning => warning.includes('尚未排定上課時間')));
  });

  test('U3 courseCount 含無時間課程，訊息說明門數組成', () => {
    const result = generateSchedule([makeCourse(1), makeUnscheduledCourse(2)], {
      mustTakeCourseIds: [2],
      minCredits: 0,
    });

    assert.equal(
      result.courseCount,
      result.schedule.length + result.unscheduledCourses.length
    );
    assert.match(result.message, /時間未定/);
  });

  test('U4 大量 0 學分課程不會讓貪婪迴圈跑到候選清單耗盡', () => {
    const zeroCredit = Array.from({ length: 50 }, (_, i) => makeCourse(100 + i, {
      credits: 0,
      dayOfWeek: (i % 5) + 1,
      startPeriod: (i % 10) + 1,
      endPeriod: (i % 10) + 1,
    }));

    const result = generateSchedule([makeCourse(1, { credits: 3 }), ...zeroCredit], {
      minCredits: 3,
      maxCredits: 22,
    });

    assert.ok(result.schedule.length < 20, `排出 ${result.schedule.length} 門，應提前中止`);
  });

  test('U1 schedule 內每門課都佔用實際時段', () => {
    const result = generateSchedule(
      [makeCourse(1), makeUnscheduledCourse(2)],
      { mustTakeCourseIds: [2], minCredits: 0 }
    );

    for (const course of result.schedule) {
      const hasBlocks = Array.isArray(course.timeBlocks) && course.timeBlocks.length > 0;
      const hasLegacyTime = course.dayOfWeek != null && course.startPeriod != null;
      assert.ok(hasBlocks || hasLegacyTime, `${course.name} 應有排定時間`);
    }
  });
});

// B1-B5：一門課只能選一個班次。
//
// `Courses.course_id` 是「班級 + 課程」的組合（`CE07131-28010` 與 `CE07133-28010`
// 是同一門課的不同班次），真正的課號在 `catalogCourseCode`（兩者皆為 `IECS3002`）。
// 排課引擎原本把每個 section 當成獨立課程，實測課表出現兩門計算機演算法。
describe('B1-B5 同一門課只能選一個班次', () => {
  const section = (id, overrides = {}) => makeCourse(id, {
    catalogCourseCode: 'IECS3002',
    name: '計算機演算法',
    ...overrides,
  });

  test('B1 同課號不同班次不會同時排入，即使時段不衝突', () => {
    const result = generateSchedule([
      section(1, { instructor: '許芳榮', department: '資訊三甲', dayOfWeek: 2, startPeriod: 9, endPeriod: 9 }),
      section(2, { instructor: '黃秀芬', department: '資訊三丙', dayOfWeek: 3, startPeriod: 8, endPeriod: 9 }),
    ], { minCredits: 0, maxCredits: 22 });

    assert.equal(result.schedule.length, 1);
    assert.ok(
      result.excludedCourses.some(item => item.reason.includes('其他班次')),
      result.excludedCourses.map(item => item.reason).join(' | ')
    );
  });

  test('B2 第一個班次違反硬性限制時改排另一個班次', () => {
    const result = generateSchedule([
      section(1, { instructor: '許芳榮', dayOfWeek: 2, startPeriod: 1, endPeriod: 2 }),
      section(2, { instructor: '黃秀芬', dayOfWeek: 3, startPeriod: 8, endPeriod: 9 }),
    ], { noMorningClasses: true, minCredits: 0, maxCredits: 22 });

    assert.deepEqual(result.schedule.map(course => course.id), [2]);
  });

  test('B3 正課與實習是不同課號，不得被當成同一門課的兩個班次', () => {
    // `MATH1005P` 實習搭配 `MATH1005` 正課，本來就該一起修（#15）。
    // 實習為 0 學分，不會被貪婪填充主動加入（U1），因此明確指定兩者。
    const result = generateSchedule([
      makeCourse(1, { catalogCourseCode: 'MATH1005', name: '微積分(一)', dayOfWeek: 1, startPeriod: 2, endPeriod: 3 }),
      makeCourse(2, { catalogCourseCode: 'MATH1005P', name: '微積分(一)實習', credits: 0, dayOfWeek: 4, startPeriod: 5, endPeriod: 5 }),
    ], { mustTakeCourseIds: [1, 2], minCredits: 0, maxCredits: 22 });

    assert.equal(result.schedule.length, 2);
    assert.ok(
      !result.excludedCourses.some(item => item.reason.includes('其他班次')),
      '正課與實習不是同一門課的兩個班次'
    );
  });

  test('B4 validateSchedule 對重複班次回報不合法', () => {
    const result = validateSchedule([
      section(1, { instructor: '許芳榮', dayOfWeek: 2, startPeriod: 9, endPeriod: 9 }),
      section(2, { instructor: '黃秀芬', dayOfWeek: 3, startPeriod: 8, endPeriod: 9 }),
    ]);

    assert.equal(result.valid, false);
    assert.equal(result.duplicates.length, 1);
    assert.equal(result.conflicts.length, 0, '時段沒有重疊，不該報成衝堂');
  });

  test('B5 沒有 catalogCourseCode 時以課程名稱視為同一門課', () => {
    const result = generateSchedule([
      makeCourse(1, { name: '體育(二)', dayOfWeek: 2, startPeriod: 3, endPeriod: 3 }),
      makeCourse(2, { name: '體育(二)', dayOfWeek: 4, startPeriod: 3, endPeriod: 3 }),
    ], { minCredits: 0, maxCredits: 22 });

    assert.equal(result.schedule.length, 1);
  });
});

describe('Y1-Y12 共同必修：正課與實習一併排入（Roadmap #15）', () => {
  test('Y1 正課與實習皆可排入時，兩者一併排入課表', () => {
    const result = generateSchedule([
      makeCourse(1, { catalogCourseCode: 'STAT1002', name: '統計學(二)', dayOfWeek: 1, startPeriod: 2, endPeriod: 3 }),
      makeCourse(2, { catalogCourseCode: 'STAT1002P', name: '統計學(二)實習', credits: 0, dayOfWeek: 3, startPeriod: 5, endPeriod: 5 }),
    ], { mustTakeCourseIds: [1, 2], minCredits: 0, maxCredits: 22 });

    const scheduledIds = result.schedule.map(c => c.id);
    assert.ok(scheduledIds.includes(1) && scheduledIds.includes(2));
  });

  test('Y2 貪婪填充中，實習因衝堂無法排入時，正課也一併不排入', () => {
    // blocker 學分刻意設高，讓它在貪婪填充的評分排序中優先於 regular
    // 被排入，之後嘗試排入 regular+internship 這組時，internship 才會
    // 真的跟已排入的 blocker 衝堂。
    const blocker = makeCourse(3, {
      catalogCourseCode: 'IECS1001', name: '衝堂用課程', credits: 10, dayOfWeek: 2, startPeriod: 4, endPeriod: 4,
    });
    const regular = makeCourse(1, {
      catalogCourseCode: 'STAT1002', name: '統計學(二)', credits: 1, dayOfWeek: 1, startPeriod: 2, endPeriod: 3,
    });
    const internship = makeCourse(2, {
      catalogCourseCode: 'STAT1002P', name: '統計學(二)實習', credits: 0, dayOfWeek: 2, startPeriod: 4, endPeriod: 4,
    });

    const result = generateSchedule([blocker, regular, internship], { minCredits: 0, maxCredits: 22 });

    const scheduledIds = result.schedule.map(c => c.id);
    assert.ok(scheduledIds.includes(3));
    assert.ok(!scheduledIds.includes(1) && !scheduledIds.includes(2));
    assert.ok(result.excludedCourses.some(
      item => item.course.id === 1 && item.constraintId === 'COREQUISITE_PAIR_INCOMPLETE'
    ));
    assert.ok(result.excludedCourses.some(
      item => item.course.id === 2 && item.constraintId === 'COREQUISITE_PAIR_INCOMPLETE'
    ));
  });

  test('Y3 貪婪填充中，正課因衝堂無法排入時，實習也一併不排入', () => {
    const blocker = makeCourse(3, {
      catalogCourseCode: 'IECS1001', name: '衝堂用課程', credits: 10, dayOfWeek: 1, startPeriod: 2, endPeriod: 3,
    });
    const regular = makeCourse(1, {
      catalogCourseCode: 'STAT1002', name: '統計學(二)', credits: 1, dayOfWeek: 1, startPeriod: 2, endPeriod: 3,
    });
    const internship = makeCourse(2, {
      catalogCourseCode: 'STAT1002P', name: '統計學(二)實習', credits: 0, dayOfWeek: 3, startPeriod: 5, endPeriod: 5,
    });

    const result = generateSchedule([blocker, regular, internship], { minCredits: 0, maxCredits: 22 });

    const scheduledIds = result.schedule.map(c => c.id);
    assert.ok(scheduledIds.includes(3));
    assert.ok(!scheduledIds.includes(1) && !scheduledIds.includes(2));
  });

  test('Y4 必修排入迴圈只指定正課為必修時，仍一併帶入實習', () => {
    const regular = makeCourse(1, { catalogCourseCode: 'ACCT1012', name: '會計學(二)', dayOfWeek: 1, startPeriod: 2, endPeriod: 4 });
    const internship = makeCourse(2, {
      catalogCourseCode: 'ACCT1012P', name: '會計學(二)實習', credits: 0, dayOfWeek: 4, startPeriod: 6, endPeriod: 6,
    });

    const result = generateSchedule([regular, internship], { mustTakeCourseIds: [1], minCredits: 0, maxCredits: 22 });

    assert.equal(result.success, true);
    assert.deepEqual(result.schedule.map(c => c.id).sort(), [1, 2]);
  });

  test('Y5 必修正課的實習因非本學期被排除時，明確以共修不完整原因失敗', () => {
    // 實習確實存在於候選輸入（annotateCorequisite 因此能標記出配對），
    // 但因非本學期被 prepareCandidates() 的 term gate 排除，不在 eligible
    // 裡——這才是「找得到搭檔、但搭檔排不進來」的真實情境，跟「候選裡
    // 根本沒有這門實習」（Y8 的例外情境）是不同的失敗原因。
    const regular = makeCourse(1, {
      catalogCourseCode: 'ACCT1012', name: '會計學(二)', dayOfWeek: 1, startPeriod: 2, endPeriod: 4,
      year: 114, semester: '下學期',
    });
    const internship = makeCourse(2, {
      catalogCourseCode: 'ACCT1012P', name: '會計學(二)實習', credits: 0, dayOfWeek: 4, startPeriod: 6, endPeriod: 6,
      year: 113, semester: '上學期',
    });

    const result = generateSchedule([regular, internship], { mustTakeCourseIds: [1], minCredits: 0, maxCredits: 22 });

    assert.equal(result.success, false);
    // generateSchedule() 失敗時回應物件沒有頂層 failures 欄位——plan.failures
    // 併進 warnings 陣列回傳（見 scheduler.js 的失敗路徑），斷言要用 warnings。
    assert.ok(result.warnings.some(w => w.includes('找不到對應實習')));
    assert.ok(!result.warnings.some(w => w.includes('衝堂')), '失敗原因應為共修不完整，不是誤判成一般硬性限制');
  });

  test('Y6 貪婪填充選中有實習的正課時，兩者一併排入，實習不會單獨出現', () => {
    const regular = makeCourse(1, { catalogCourseCode: 'FINA2034', name: '財務管理', dayOfWeek: 1, startPeriod: 2, endPeriod: 4 });
    const internship = makeCourse(2, {
      catalogCourseCode: 'FINA2034P', name: '財務管理實習', credits: 0, dayOfWeek: 4, startPeriod: 6, endPeriod: 6,
    });

    const result = generateSchedule([regular, internship], { minCredits: 0, maxCredits: 22 });

    const scheduledIds = result.schedule.map(c => c.id);
    assert.ok(scheduledIds.includes(1) && scheduledIds.includes(2));
  });

  test('Y7 貪婪填充中，正課因學分上限無法排入時，實習不會單獨排入', () => {
    const regular = makeCourse(1, {
      catalogCourseCode: 'FINA2034', name: '財務管理', credits: 3, dayOfWeek: 1, startPeriod: 2, endPeriod: 4,
    });
    const internship = makeCourse(2, {
      catalogCourseCode: 'FINA2034P', name: '財務管理實習', credits: 0, dayOfWeek: 4, startPeriod: 6, endPeriod: 6,
    });

    // maxCredits 設為 0，讓正課本身在貪婪填充階段就過不了學分上限檢查。
    const result = generateSchedule([regular, internship], { minCredits: 0, maxCredits: 0 });

    const scheduledIds = result.schedule.map(c => c.id);
    assert.ok(!scheduledIds.includes(1));
    assert.ok(!scheduledIds.includes(2), '實習不應在正課排不進去的情況下單獨排入');
  });

  test('Y8 P 後綴但找不到正課的例外課程，視為一般課程正常排入並附警告', () => {
    const orphan = makeCourse(1, {
      catalogCourseCode: 'BUS1121P', name: '統籌科目實習(二)', credits: 0, dayOfWeek: 1, startPeriod: 2, endPeriod: 2,
    });

    const result = generateSchedule([orphan], { mustTakeCourseIds: [1], minCredits: 0, maxCredits: 22 });

    assert.deepEqual(result.schedule.map(c => c.id), [1]);
    assert.ok(result.warnings.some(w => w.includes('找不到對應正課')));
  });

  test('Y9 實習學分非 0 時，配對後學分正確加總，不做任何學分歸零', () => {
    const regular = makeCourse(1, { catalogCourseCode: 'LAND2012', name: '測量平差', credits: 2, dayOfWeek: 1, startPeriod: 2, endPeriod: 3 });
    const internship = makeCourse(2, {
      catalogCourseCode: 'LAND2012P', name: '測量平差實習', credits: 1, dayOfWeek: 3, startPeriod: 5, endPeriod: 5,
    });

    const result = generateSchedule([regular, internship], { mustTakeCourseIds: [1, 2], minCredits: 0, maxCredits: 22 });

    assert.equal(result.schedule.length, 2);
    assert.equal(result.totalCredits, 3);
  });

  test('Y10 多個候選實習班次時，前面班次衝堂失敗不會污染後面班次的成功排入（Codex adversarial review 修正）', () => {
    // 迴歸測試：修正前，`.some()` 逐一嘗試候選實習班次時，第一個失敗的
    // 嘗試會直接寫入 excludedCourses／failures，即使第二個班次後來成功
    // 排入，那則失敗訊息仍會殘留，讓最終驗證器把整組誤判成不完整。
    const blocker = makeCourse(3, {
      catalogCourseCode: 'IECS1001', name: '衝堂用必修課', dayOfWeek: 2, startPeriod: 4, endPeriod: 4,
    });
    const regular = makeCourse(1, {
      catalogCourseCode: 'STAT1002', name: '統計學(二)', dayOfWeek: 1, startPeriod: 2, endPeriod: 3,
    });
    // 兩個班次課號相同（同一門實習開兩班），第一個班次時段故意與 blocker
    // 衝堂，第二個班次時段是空的。
    const internshipConflict = makeCourse(2, {
      catalogCourseCode: 'STAT1002P', name: '統計學(二)實習-甲班', credits: 0, dayOfWeek: 2, startPeriod: 4, endPeriod: 4,
    });
    const internshipOk = makeCourse(4, {
      catalogCourseCode: 'STAT1002P', name: '統計學(二)實習-乙班', credits: 0, dayOfWeek: 3, startPeriod: 5, endPeriod: 5,
    });

    const result = generateSchedule(
      [blocker, regular, internshipConflict, internshipOk],
      { mustTakeCourseIds: [3, 1], minCredits: 0, maxCredits: 22 }
    );

    assert.equal(result.success, true);
    const scheduledIds = result.schedule.map(c => c.id).sort((a, b) => a - b);
    assert.deepEqual(scheduledIds, [1, 3, 4]);
    assert.ok(!result.excludedCourses.some(item => item.constraintId === 'COREQUISITE_PAIR_INCOMPLETE'),
      '第二個班次成功排入後，不應殘留任何一個班次的共修不完整排除紀錄');
    assert.ok(!result.warnings.some(w => w.includes('皆不排入')),
      '第二個班次成功排入後，不應殘留失敗訊息');
  });

  test('Y11 重修必修正課帶共同必修時，重補修迴圈一併排入對應實習（Codex adversarial review 修正）', () => {
    // 迴歸測試：修正前，不及格必修重補修迴圈直接呼叫 addCourseToPlan()，
    // 只排入重修的正課；對應實習因「不得單獨排入」規則被貪婪填充排除，
    // 排出「有正課沒實習」的不合法課表，被內部驗證器攔下來變成整批失敗。
    const regular = makeCourse(1, {
      catalogCourseCode: 'STAT1002', name: '統計學(二)', dayOfWeek: 1, startPeriod: 2, endPeriod: 3,
    });
    const internship = makeCourse(2, {
      catalogCourseCode: 'STAT1002P', name: '統計學(二)實習', credits: 0, dayOfWeek: 3, startPeriod: 5, endPeriod: 5,
    });

    const result = generateSchedule([regular, internship], {
      courseHistory: [{
        academicYear: 113,
        semester: 1,
        courseCode: 'STAT1002',
        courseName: '統計學(二)',
        passed: false,
        requirementType: '必修',
      }],
      minCredits: 0,
      maxCredits: 22,
    });

    assert.equal(result.success, true);
    const scheduledIds = result.schedule.map(c => c.id).sort((a, b) => a - b);
    assert.deepEqual(scheduledIds, [1, 2]);
  });

  test('Y12 重修必修正課的實習衝堂排不進去時，重修正課也一併不排入', () => {
    const blocker = makeCourse(3, {
      catalogCourseCode: 'IECS1001', name: '衝堂用課程', dayOfWeek: 3, startPeriod: 5, endPeriod: 5,
    });
    const regular = makeCourse(1, {
      catalogCourseCode: 'STAT1002', name: '統計學(二)', dayOfWeek: 1, startPeriod: 2, endPeriod: 3,
    });
    const internship = makeCourse(2, {
      catalogCourseCode: 'STAT1002P', name: '統計學(二)實習', credits: 0, dayOfWeek: 3, startPeriod: 5, endPeriod: 5,
    });

    const result = generateSchedule([blocker, regular, internship], {
      mustTakeCourseIds: [3],
      courseHistory: [{
        academicYear: 113,
        semester: 1,
        courseCode: 'STAT1002',
        courseName: '統計學(二)',
        passed: false,
        requirementType: '必修',
      }],
      minCredits: 0,
      maxCredits: 22,
    });

    const scheduledIds = result.schedule.map(c => c.id);
    assert.ok(scheduledIds.includes(3));
    assert.ok(!scheduledIds.includes(1) && !scheduledIds.includes(2),
      '重修正課的實習排不進去時，重修正課不應單獨排入');
  });
});

// C1-C6：學分上下限依校規（docs/COURSE_SELECTION_RULES.md）。
//
// 先前寫死下限 15、上限 22、每日最多 4 門課，三個數字都沒有出處。
// 校規為上限 25、下限 12（四年級 9），超修申請後 30；每日課程數校方無規定。
describe('C1-C6 學分上下限與每日課程數', () => {
  const manyCourses = (count) => Array.from({ length: count }, (_, i) => makeCourse(i + 1, {
    credits: 3,
    dayOfWeek: (i % 5) + 1,
    startPeriod: (i % 10) + 1,
    endPeriod: (i % 10) + 1,
  }));

  test('C1 未指定時上限為 25 學分', () => {
    const result = generateSchedule(manyCourses(20), { minCredits: 0 });

    assert.ok(result.totalCredits <= 25, `排出 ${result.totalCredits} 學分，超過上限 25`);
    assert.ok(result.totalCredits > 22, `排出 ${result.totalCredits} 學分，仍停在舊上限 22`);
  });

  test('C2 未指定時下限為 12 學分', () => {
    const result = generateSchedule(manyCourses(2), {});

    assert.ok(
      result.warnings.some(w => w.includes('低於最低目標 12')),
      result.warnings.join(' | ')
    );
  });

  test('C3 四年級下限為 9 學分', () => {
    const result = generateSchedule(manyCourses(3), { gradeLevel: 4 });

    assert.equal(result.totalCredits, 9);
    assert.ok(
      !result.warnings.some(w => w.includes('低於最低目標')),
      '四年級 9 學分已達下限，不應警告'
    );
  });

  test('C4 超修須明確開啟，開啟後上限為 30 學分', () => {
    const withoutOverload = generateSchedule(manyCourses(20), { minCredits: 0 });
    const withOverload = generateSchedule(manyCourses(20), { minCredits: 0, allowCreditOverload: true });

    assert.ok(withoutOverload.totalCredits <= 25);
    assert.ok(
      withOverload.totalCredits > withoutOverload.totalCredits,
      `超修 ${withOverload.totalCredits} 應多於未超修 ${withoutOverload.totalCredits}`
    );
    assert.ok(withOverload.totalCredits <= 30, `排出 ${withOverload.totalCredits} 學分，超過超修上限 30`);
  });

  test('C5 每日課程數預設不限制', () => {
    // 同一天 6 門不衝堂的課，舊版預設每日 4 門會擋掉兩門。
    const sameDay = Array.from({ length: 6 }, (_, i) => makeCourse(i + 1, {
      credits: 1,
      dayOfWeek: 1,
      startPeriod: i + 1,
      endPeriod: i + 1,
    }));

    const result = generateSchedule(sameDay, { minCredits: 0 });

    assert.equal(result.schedule.length, 6);
    assert.ok(
      !result.excludedCourses.some(item => item.reason.includes('每日')),
      result.excludedCourses.map(item => item.reason).join(' | ')
    );
  });

  test('C6 呼叫端仍可自行指定每日課程數上限', () => {
    const sameDay = Array.from({ length: 6 }, (_, i) => makeCourse(i + 1, {
      credits: 1,
      dayOfWeek: 1,
      startPeriod: i + 1,
      endPeriod: i + 1,
    }));

    const result = generateSchedule(sameDay, { minCredits: 0, maxCoursesPerDay: 3 });

    assert.equal(result.schedule.length, 3);
  });
});

describe('V20-V28 評價驅動的涼度評分', () => {
  // 兩門課同天同時段，只能擇一排入，用來觀察 easy_score 方案的選擇差異。
  function makeConflictingPair() {
    return [
      makeCourse(1, {
        name: '課X', dayOfWeek: 1, startPeriod: 3, endPeriod: 4, credits: 3,
      }),
      makeCourse(2, {
        name: '課Y', dayOfWeek: 1, startPeriod: 3, endPeriod: 4, credits: 3,
      }),
    ];
  }

  // 三門不進入候選、只用來讓母體先驗落在中間值的背景課評價。
  // 若只有兩門候選課各帶一則評價，先驗會剛好等於其中一門課，測不出
  // 「中性分」與「實際分數」的差異。
  function makeBackgroundReviews() {
    return [90, 91, 92].map(id => makeReview({
      id, courseId: id, reviewCount: 5, sweetness: 3, coolness: 3, workload: 3, overall: 3,
    }));
  }

  test('V20 A/B：帶評價 vs 不帶評價，easy_score 方案的選擇不同，且不帶評價時 breakdown.easy 為 null', () => {
    const withReviews = generateSchedule(makeConflictingPair(), {
      minCredits: 0,
      maxCredits: 3,
      courseReviews: [makeToughReview(1), makeEasyReview(2)],
    });
    const withoutReviews = generateSchedule(makeConflictingPair(), { minCredits: 0, maxCredits: 3 });

    const easyPlanWith = withReviews.plans.find(plan => plan.id === 'easy_score');
    assert.ok(easyPlanWith, '評價證據讓 easy_score 方案與其他方案產出不同課表，不會被 uniquePlans 去重掉');
    assert.equal(easyPlanWith.schedule[0].id, 2, '有評價時應選涼課 Y');

    // 沒有評價時，easy_score 與其他方案對這兩門課的評分完全相同（中性分為常數），
    // `uniquePlans()` 會把它們去重成同一份課表——這正是 roadmap #10「五方案塌縮」
    // 的具體例證，本次改動只解除「有評價資料時」的塌縮，不是全部塌縮成因。
    assert.equal(withoutReviews.plans.length, 1);
    assert.equal(withoutReviews.plans[0].schedule[0].id, 1, '沒有評價時中性分相同，維持候選原始順序');
    assert.equal(withoutReviews.plans[0].preferenceBreakdown.easy, null, '沒有評價時 easy 軸應為 null，不是 0');
  });

  test('V21 有評價且很硬 vs 完全沒評價，優先排入沒評價那門，證明無評價未被當成 0', () => {
    const courseReviews = [makeToughReview(1), ...makeBackgroundReviews()];

    const result = generateSchedule(makeConflictingPair(), {
      minCredits: 0,
      maxCredits: 3,
      courseReviews,
    });
    const easyPlan = result.plans.find(plan => plan.id === 'easy_score');

    assert.equal(easyPlan.schedule[0].id, 2, '沒有評價的課應優先於有評價但很硬的課');
  });

  test('V22 描述含「涼」字但無評價，不因關鍵字取得涼課加分（釘住關鍵字誤判的修復）', () => {
    const misleadingCourse = makeCourse(1, {
      name: '課X',
      dayOfWeek: 1,
      startPeriod: 3,
      endPeriod: 4,
      credits: 3,
      description: '教室很涼，冷氣很強',
    });
    const genuinelyEasyCourse = makeCourse(2, {
      name: '課Y', dayOfWeek: 1, startPeriod: 3, endPeriod: 4, credits: 3, description: '',
    });
    const courseReviews = [makeEasyReview(2), ...makeBackgroundReviews()];

    const result = generateSchedule([misleadingCourse, genuinelyEasyCourse], {
      minCredits: 0,
      maxCredits: 3,
      courseReviews,
    });
    const easyPlan = result.plans.find(plan => plan.id === 'easy_score');

    assert.equal(
      easyPlan.schedule[0].id,
      2,
      '真正有涼課評價的課應勝出，而不是描述含「涼」字但沒有評價的課'
    );
  });

  test('V23 涼課偏好但候選全無評價：breakdown.easy 為 null、覆蓋率 0、發出警告', () => {
    const candidates = [
      makeCourse(1, {
        name: '課A', dayOfWeek: 1, startPeriod: 2, endPeriod: 3, credits: 3,
      }),
      makeCourse(2, {
        name: '課B', dayOfWeek: 2, startPeriod: 2, endPeriod: 3, credits: 3,
      }),
    ];
    // 有評價資料存在，但都不是這兩門候選課——覆蓋率仍應為 0。
    const courseReviews = makeBackgroundReviews();

    const result = generateSchedule(candidates, {
      minCredits: 0,
      maxCredits: 22,
      preferEasyCourses: true,
      courseReviews,
    });

    assert.equal(result.hasExpressedPreference, true);
    assert.equal(result.plans[0].preferenceBreakdown.easy, null);
    assert.equal(result.plans[0].reviewCoverage.ratio, 0);
    assert.ok(result.warnings.some(w => w.includes('涼課偏好') && w.includes('沒有課程評價')));
  });

  test('V24 涼課偏好搭配集中排課偏好，候選全無評價時 preferenceScore 只由 compact 決定', () => {
    const candidates = [
      makeCourse(1, {
        name: '課A', dayOfWeek: 1, startPeriod: 2, endPeriod: 3, credits: 3,
      }),
      makeCourse(2, {
        name: '課B', dayOfWeek: 1, startPeriod: 6, endPeriod: 7, credits: 3,
      }),
    ];
    const courseReviews = makeBackgroundReviews();

    const result = generateSchedule(candidates, {
      minCredits: 0,
      maxCredits: 22,
      preferEasyCourses: true,
      preferCompact: true,
      courseReviews,
    });

    const primary = result.plans[0];
    assert.equal(primary.preferenceBreakdown.easy, null);
    assert.ok(primary.preferenceScore > 0, 'compact 軸應仍能貢獻分數，不被 null 的 easy 軸拖累成 0');
    assert.equal(
      primary.preferenceScore,
      primary.preferenceBreakdown.compact,
      'easy 軸被排除後，分數應完全等於 compact 軸的值'
    );
  });

  test('V25 完全不帶 courseReviews：reviewDataLoaded 為 false 且發出警告，不影響既有排序邏輯', () => {
    const candidates = [
      makeCourse(1, {
        name: '網路安全概論', dayOfWeek: 1, startPeriod: 2, endPeriod: 3, credits: 3,
      }),
      makeCourse(2, {
        name: '網路程式設計', dayOfWeek: 1, startPeriod: 6, endPeriod: 7, credits: 3,
      }),
      makeCourse(3, {
        name: '文學賞析', dayOfWeek: 2, startPeriod: 2, endPeriod: 3, credits: 3,
      }),
    ];

    const result = generateSchedule(candidates, {
      preferredKeywords: ['網路'],
      minCredits: 0,
      maxCredits: 22,
    });

    assert.equal(result.reviewDataLoaded, false);
    assert.ok(result.warnings.some(w => w.includes('沒有取得任何課程評價資料')));
    // 沒有評價資料不影響既有的興趣偏好排序邏輯：興趣方案仍應成為主推方案，
    // 與 S13 建立的既有行為一致——這正是「排序結果與改動前逐項相同」的證據。
    assert.equal(result.hasExpressedPreference, true);
    assert.ok(result.plans[0].preferenceScore > 0);
  });

  test('V26 4 則全高分 vs 8 則中高分：收縮後差距小於未收縮差距的一半', () => {
    const courseA = makeCourse(1, {
      name: '課A', dayOfWeek: 1, startPeriod: 2, endPeriod: 3, credits: 3,
    });
    const courseB = makeCourse(2, {
      name: '課B', dayOfWeek: 2, startPeriod: 2, endPeriod: 3, credits: 3,
    });
    const courseReviews = [
      // raw easiness = mean([5,5,6-1=5,5]) = 5
      makeReview({
        id: 1, courseId: 1, reviewCount: 4, sweetness: 5, coolness: 5, workload: 1, overall: 5,
      }),
      // raw easiness = mean([4,5,6-2=4,5]) = 4.5
      makeReview({
        id: 2, courseId: 2, reviewCount: 8, sweetness: 4, coolness: 5, workload: 2, overall: 5,
      }),
      ...makeBackgroundReviews(),
    ];

    const result = generateSchedule([courseA, courseB], {
      minCredits: 0,
      maxCredits: 22,
      courseReviews,
    });

    const a = result.schedule.find(course => course.id === 1);
    const b = result.schedule.find(course => course.id === 2);
    const rawGap = a.reviewEvidence.easiness - b.reviewEvidence.easiness;
    const adjustedGap = a.reviewEvidence.adjustedEasiness - b.reviewEvidence.adjustedEasiness;

    assert.ok(rawGap > 0, '未收縮差距應為正（A 原始分數較高）');
    assert.ok(Math.abs(adjustedGap) < rawGap / 2, '收縮後差距應小於未收縮差距的一半');
  });

  test('V27 schedule 內每門課都有 reviewEvidence 鍵，無評價時為 null 而非 undefined', () => {
    const candidates = [
      makeCourse(1, {
        name: '課A', dayOfWeek: 1, startPeriod: 2, endPeriod: 3, credits: 3,
      }),
      makeCourse(2, {
        name: '課B', dayOfWeek: 2, startPeriod: 2, endPeriod: 3, credits: 3,
      }),
    ];
    const courseReviews = [makeEasyReview(1)];

    const result = generateSchedule(candidates, {
      minCredits: 0,
      maxCredits: 22,
      courseReviews,
    });

    for (const course of result.schedule) {
      assert.ok('reviewEvidence' in course);
    }
    const withEvidence = result.schedule.find(course => course.id === 1);
    const withoutEvidence = result.schedule.find(course => course.id === 2);
    assert.notEqual(withEvidence.reviewEvidence, null);
    assert.equal(withoutEvidence.reviewEvidence, null);
    assert.notEqual(withoutEvidence.reviewEvidence, undefined);
  });

  test('V28 有評價的課因 eligibility 為 unknown 被排除時，警告會統計這種情況', () => {
    const pendingCourse = makeCourse(901, {
      name: '共同國文', department: '國文綜合班', category: '選修',
    });
    const courseReviews = [makeEasyReview(901)];

    const result = generateSchedule([pendingCourse], {
      department: '資訊工程學系',
      gradeLevel: 3,
      className: '資訊三甲',
      minCredits: 0,
      maxCredits: 9,
      courseReviews,
    });

    assert.equal(result.schedule.length, 0);
    assert.ok(result.warnings.some(warning => (
      warning.includes('有課程評價')
      && warning.includes('資格待確認')
      && warning.includes('#13C')
    )));
  });
});

describe('N1-N15 內容偏好從硬過濾改成軟懲罰', () => {
  test('N1 noMidterm 命中關鍵字的課不再被硬性排除', () => {
    const course = makeCourse(1, { description: '本課程有期中考與期末考試' });

    const result = generateSchedule([course], { noMidterm: true, minCredits: 0 });

    assert.ok(result.schedule.some(c => c.id === 1));
    assert.equal(result.excludedCourses.some(item => item.course.id === 1), false);
    assert.ok(!result.warnings.some(w => w.includes('不符合免期中考偏好')));
  });

  test('N2 weightDaily（未命中即排除類）候選池全不含關鍵字時仍能排課成功', () => {
    const candidates = Array.from({ length: 5 }, (_, i) => makeCourse(i + 1, {
      dayOfWeek: (i % 5) + 1, startPeriod: 2, endPeriod: 3, description: '一般課程介紹',
    }));

    const result = generateSchedule(candidates, { weightDaily: true, minCredits: 0 });

    assert.equal(result.success, true);
    assert.ok(result.schedule.length > 0);
  });

  test('N3 全部 8 個內容偏好旗標開啟，未命中的課不再被排除', () => {
    const course = makeCourse(1, { description: '一般課程介紹，無特殊字樣' });
    const constraints = {
      noMidterm: true,
      noGroupReport: true,
      discussion: true,
      weightDaily: true,
      practicalExam: true,
      finalReport: true,
      englishTaught: true,
      learnMore: true,
      minCredits: 0,
    };

    const result = generateSchedule([course], constraints);

    assert.ok(result.schedule.some(c => c.id === 1));
    assert.equal(result.excludedCourses.length, 0);
  });

  test('N4 必修或明確指定課程不再因內容偏好被誤判失敗', () => {
    const course = makeCourse(1, { description: '一般課程介紹' });

    const result = generateSchedule([course], {
      noMidterm: true, mustTakeCourseIds: [1], minCredits: 0,
    });

    assert.equal(result.success, true);
    assert.ok(result.schedule.some(c => c.id === 1));
  });

  test('N5 noMidterm 命中的課分數較低，同時段衝突時排序較後', () => {
    const hit = makeCourse(1, { dayOfWeek: 1, startPeriod: 3, endPeriod: 4, description: '有期中考' });
    const clean = makeCourse(2, { dayOfWeek: 1, startPeriod: 3, endPeriod: 4, description: '無特殊考試安排' });

    const result = generateSchedule([hit, clean], { noMidterm: true, minCredits: 0, maxCredits: 3 });

    assert.ok(result.schedule.some(c => c.id === 2));
    assert.equal(result.schedule.some(c => c.id === 1), false);
  });

  test('N6 practicalExam 命中的課排序較前', () => {
    const hit = makeCourse(1, { dayOfWeek: 1, startPeriod: 3, endPeriod: 4, description: '本課程包含實作練習' });
    const miss = makeCourse(2, { dayOfWeek: 1, startPeriod: 3, endPeriod: 4, description: '純講授課程' });

    const result = generateSchedule([hit, miss], { practicalExam: true, minCredits: 0, maxCredits: 3 });

    assert.ok(result.schedule.some(c => c.id === 1));
    assert.equal(result.schedule.some(c => c.id === 2), false);
  });

  test('N7 內容偏好加總不蓋過類別優先度：同時段衝突時核心選修優先於命中多個內容偏好的通識課', () => {
    // 核心選修(1) vs 通識(3)：類別優先度差距 2 級 = 240 分。
    // 通識課命中 discussion+practicalExam 兩項 = +80 分，遠不足以扭轉 240 分的差距。
    const generalEd = makeCourse(1, {
      dayOfWeek: 1, startPeriod: 3, endPeriod: 4, category: '通識', description: '本課程採討論與實作方式進行',
    });
    const coreElective = makeCourse(2, {
      dayOfWeek: 1, startPeriod: 3, endPeriod: 4, category: '核心選修', description: '一般講授課程',
    });

    const result = generateSchedule([generalEd, coreElective], {
      discussion: true, practicalExam: true, minCredits: 0, maxCredits: 3,
    });

    assert.ok(result.schedule.some(c => c.id === 2));
    assert.equal(result.schedule.some(c => c.id === 1), false);
  });

  test('N8 noEveningClasses 維持硬性排除（既有行為的回歸測試，先前無測試釘住）', () => {
    const evening = makeCourse(1, { startPeriod: 12, endPeriod: 13 });

    const result = generateSchedule([evening], { noEveningClasses: true, minCredits: 0 });

    assert.equal(result.schedule.some(c => c.id === 1), false);
    assert.ok(result.excludedCourses.some(item => item.reason.includes('晚課')));
  });

  test('N9 lunchBreakFree 維持硬性排除（既有行為的回歸測試，先前無測試釘住）', () => {
    const lunch = makeCourse(1, { startPeriod: 4, endPeriod: 6 }); // 涵蓋第 5 節（午休）

    const result = generateSchedule([lunch], { lunchBreakFree: true, minCredits: 0 });

    assert.equal(result.schedule.some(c => c.id === 1), false);
    assert.ok(result.excludedCourses.some(item => item.reason.includes('午休')));
  });

  test('N10 訊號可靠度警告：命中率低於 5% 時觸發', () => {
    const candidates = [
      makeCourse(1, { dayOfWeek: 1, description: '有期中考評量' }),
      ...Array.from({ length: 20 }, (_, i) => makeCourse(i + 2, {
        dayOfWeek: (i % 5) + 1, description: '一般課程',
      })),
    ];

    const result = generateSchedule(candidates, { noMidterm: true, minCredits: 0 });

    assert.ok(result.warnings.some(w => w.includes('免期中考') && w.includes('訊號極弱')));
  });

  test('N11 訊號可靠度警告：命中率高於 95% 時觸發', () => {
    const candidates = [
      makeCourse(1, { dayOfWeek: 1, description: '一般課程，無特殊字樣' }),
      ...Array.from({ length: 20 }, (_, i) => makeCourse(i + 2, {
        dayOfWeek: (i % 5) + 1, description: '本課程強調實作與應用',
      })),
    ];

    const result = generateSchedule(candidates, { learnMore: true, minCredits: 0 });

    assert.ok(result.warnings.some(w => w.includes('學到較多內容') && w.includes('無法有效區分課程')));
  });

  test('N12 訊號可靠度警告：命中率介於門檻之間時不觸發', () => {
    const candidates = [
      ...Array.from({ length: 5 }, (_, i) => makeCourse(i + 1, {
        dayOfWeek: (i % 5) + 1, description: '課堂討論與互動',
      })),
      ...Array.from({ length: 5 }, (_, i) => makeCourse(i + 6, {
        dayOfWeek: (i % 5) + 1, description: '一般講授課程',
      })),
    ];

    const result = generateSchedule(candidates, { discussion: true, minCredits: 0 });

    assert.equal(
      result.warnings.some(w => w.includes('討論課') && (w.includes('訊號極弱') || w.includes('無法有效區分課程'))),
      false
    );
  });

  test('N13 訊號可靠度警告在多方案聯集後只出現一次', () => {
    const candidates = [
      makeCourse(1, { dayOfWeek: 1, description: '有期中考評量' }),
      ...Array.from({ length: 20 }, (_, i) => makeCourse(i + 2, {
        dayOfWeek: (i % 5) + 1, description: '一般課程',
      })),
    ];

    const result = generateSchedule(candidates, { noMidterm: true, minCredits: 0 });

    const matches = result.warnings.filter(w => w.includes('免期中考') && w.includes('訊號極弱'));
    assert.equal(matches.length, 1);
  });

  test('N14 未設定任何內容偏好時，排序與改動前一致（不受課程描述影響）', () => {
    const hit = makeCourse(1, { dayOfWeek: 1, startPeriod: 3, endPeriod: 4, description: '有期中考' });
    const clean = makeCourse(2, { dayOfWeek: 1, startPeriod: 3, endPeriod: 4, description: '無特殊考試安排' });

    const result = generateSchedule([hit, clean], { minCredits: 0, maxCredits: 3 });

    // 沒有設定 noMidterm，兩門課的內容偏好分數皆為 0，維持候選原始順序（穩定排序）。
    assert.ok(result.schedule.some(c => c.id === 1));
    assert.equal(result.schedule.some(c => c.id === 2), false);
    assert.equal(
      result.warnings.some(w => w.includes('訊號極弱') || w.includes('無法有效區分課程')),
      false
    );
  });

  test('N15 englishTaught 的 language 欄位判定路徑（不只靠關鍵字）', () => {
    const englishCourse = makeCourse(1, {
      dayOfWeek: 1, startPeriod: 3, endPeriod: 4, description: '一般課程介紹', language: 'English',
    });
    const other = makeCourse(2, {
      dayOfWeek: 1, startPeriod: 3, endPeriod: 4, description: '一般課程介紹',
    });

    const result = generateSchedule([englishCourse, other], {
      englishTaught: true, minCredits: 0, maxCredits: 3,
    });

    assert.ok(result.schedule.some(c => c.id === 1));
    assert.equal(result.schedule.some(c => c.id === 2), false);
  });
});

describe('X1-X16 Roadmap #21（X15-X16 為 #24 的強度區分）：hard/soft constraint schema、獨立 validator、放寬階梯、conflict set', () => {
  test('X1 allowRelaxation:false（預設）：因時段偏好排不出課表時行為與改動前一致', () => {
    const course = makeCourse(1, { startPeriod: 1, endPeriod: 2 });
    const result = generateSchedule([course], { noMorningClasses: true, minCredits: 0 });

    assert.equal(result.success, false);
    assert.equal(result.relaxedConstraints, undefined);
    assert.ok(result.conflictSet.some(v => v.constraintId === 'NO_MORNING_CLASSES'));
  });

  test('X2 allowRelaxation:true 且指定 timePreferencePriority：依使用者順序逐步放寬並成功排課', () => {
    const course = makeCourse(1, { startPeriod: 1, endPeriod: 2 });
    const result = generateSchedule([course], {
      noMorningClasses: true,
      minCredits: 0,
      allowRelaxation: true,
      // 刻意把與此情境無關的 LUNCH_BREAK_FREE 排在使用者順序的第一位，
      // 用來證明階梯真的依使用者指定順序逐步嘗試，不是巧合對上預設順序。
      timePreferencePriority: ['LUNCH_BREAK_FREE', 'NO_MORNING_CLASSES', 'NO_EVENING_CLASSES'],
    });

    assert.equal(result.success, true);
    assert.ok(result.schedule.some(c => c.id === 1));
    assert.deepEqual(
      result.relaxedConstraints.map(r => r.constraintId),
      ['LUNCH_BREAK_FREE', 'NO_MORNING_CLASSES']
    );
    assert.ok(result.warnings.some(w => w.includes('不排早八')));
  });

  // Roadmap #24：「絕對不上早八」與「必要時可早八」的差別。
  // `constraintSchema.js` 的分類完全沒動——那是「這個限制本質上可不可以放寬」；
  // 這裡處理的是「這一次使用者允不允許」。
  test('X15 nonNegotiablePreferenceIds 指名的偏好，即使允許放寬也不會被放寬', () => {
    const course = makeCourse(1, { startPeriod: 1, endPeriod: 2 });
    const result = generateSchedule([course], {
      noMorningClasses: true,
      minCredits: 0,
      allowRelaxation: true,
      // 排在使用者順序第一位，證明擋下來的是 nonNegotiable 而不是順序沒輪到。
      timePreferencePriority: ['NO_MORNING_CLASSES', 'LUNCH_BREAK_FREE', 'NO_EVENING_CLASSES'],
      nonNegotiablePreferenceIds: ['NO_MORNING_CLASSES'],
    });

    assert.ok(
      !(result.relaxedConstraints || []).some(r => r.constraintId === 'NO_MORNING_CLASSES'),
      '使用者說絕對不行的偏好不得被自動放寬'
    );
    assert.ok(!result.schedule.some(c => c.id === 1), '早八的課仍不該被排進來');
  });

  // 對照：同樣的情境沒有 nonNegotiablePreferenceIds 就會放寬（等同 X2 的行為），
  // 用來證明 X4 擋下來的確實是新加的過濾，而不是這個情境本來就排不出來。
  test('X16 未指名時同一情境仍會放寬（與 X15 的對照組）', () => {
    const course = makeCourse(1, { startPeriod: 1, endPeriod: 2 });
    const result = generateSchedule([course], {
      noMorningClasses: true,
      minCredits: 0,
      allowRelaxation: true,
      timePreferencePriority: ['NO_MORNING_CLASSES', 'LUNCH_BREAK_FREE', 'NO_EVENING_CLASSES'],
    });

    assert.ok(
      result.relaxedConstraints.some(r => r.constraintId === 'NO_MORNING_CLASSES'),
      '沒有指名時應照既有行為放寬'
    );
    assert.ok(result.schedule.some(c => c.id === 1));
  });

  test('X3 allowRelaxation:true 但無解原因是 blockedPeriods：放寬階梯不生效，仍然失敗', () => {
    const course = makeCourse(1, { dayOfWeek: 1, startPeriod: 3, endPeriod: 4 });
    const result = generateSchedule([course], {
      blockedPeriods: [{ day: 1, period: 3 }],
      minCredits: 0,
      allowRelaxation: true,
      timePreferencePriority: ['NO_MORNING_CLASSES', 'LUNCH_BREAK_FREE', 'NO_EVENING_CLASSES'],
    });

    assert.equal(result.success, false);
    assert.equal(result.relaxedConstraints, undefined);
  });

  test('X4 conflictSet 具備 constraintId／relaxable／courses／reason，relaxable 標記正確', () => {
    const morningCourse = makeCourse(1, { startPeriod: 1, endPeriod: 2 });
    const blockedCourse = makeCourse(2, { dayOfWeek: 1, startPeriod: 3, endPeriod: 4 });

    const result = generateSchedule([morningCourse, blockedCourse], {
      noMorningClasses: true,
      blockedPeriods: [{ day: 1, period: 3 }],
      minCredits: 0,
    });

    assert.equal(result.success, false);
    const morningEntry = result.conflictSet.find(v => v.constraintId === 'NO_MORNING_CLASSES');
    const blockedEntry = result.conflictSet.find(v => v.constraintId === 'BLOCKED_PERIODS');
    assert.ok(morningEntry);
    assert.ok(blockedEntry);
    assert.equal(morningEntry.relaxable, true);
    assert.equal(blockedEntry.relaxable, false);
    assert.ok(Array.isArray(morningEntry.courses) && morningEntry.courses.length > 0);
    assert.ok(typeof morningEntry.reason === 'string' && morningEntry.reason.length > 0);
  });

  test('X5 成功方案通過內部自我檢查（validateScheduleAgainstConstraints）', () => {
    const course = makeCourse(1);
    const result = generateSchedule([course], { minCredits: 0 });

    assert.equal(result.success, true);
    const check = validateScheduleAgainstConstraints(result.schedule, {});
    assert.equal(check.valid, true);
    assert.deepEqual(check.violations, []);
  });

  test('X6 validateScheduleAgainstConstraints 偵測衝堂，不需要 constraints 參數', () => {
    const a = makeCourse(1, { dayOfWeek: 2, startPeriod: 3, endPeriod: 4 });
    const b = makeCourse(2, { dayOfWeek: 2, startPeriod: 3, endPeriod: 4 });

    const check = validateScheduleAgainstConstraints([a, b]);
    assert.equal(check.valid, false);
    assert.ok(check.violations.some(v => v.constraintId === 'TIME_CONFLICT'));
  });

  test('X7 CREDIT_CEILING：帶 maxCredits 時偵測超額，省略時採用預設值且不出錯', () => {
    const a = makeCourse(1, { credits: 20, dayOfWeek: 1 });
    const b = makeCourse(2, { credits: 10, dayOfWeek: 2 });

    const overLimit = validateScheduleAgainstConstraints([a, b], { maxCredits: 25 });
    assert.ok(overLimit.violations.some(v => v.constraintId === 'CREDIT_CEILING'));

    const withinDefault = validateScheduleAgainstConstraints([makeCourse(3, { credits: 3 })], {});
    assert.ok(!withinDefault.violations.some(v => v.constraintId === 'CREDIT_CEILING'));
  });

  test('X8 unchecked 永遠包含 PREREQUISITE 與 COREQUISITE', () => {
    const check = validateScheduleAgainstConstraints([], {});
    assert.ok(check.unchecked.includes('PREREQUISITE'));
    assert.ok(check.unchecked.includes('COREQUISITE'));
  });

  test('X9 舊版 validateSchedule() 回傳形狀維持不變（回歸釘住）', () => {
    const result = validateSchedule([makeCourse(1)]);
    assert.deepEqual(Object.keys(result).sort(), [
      'conflicts', 'duplicates', 'graduationCredits', 'nonGraduationCredits', 'totalCredits', 'valid',
    ]);
  });

  test('X10 每日上限 bug 修復：必排課因每日上限排不進去時正確回報失敗原因', () => {
    const first = makeCourse(1, { dayOfWeek: 1, startPeriod: 1, endPeriod: 1, credits: 1 });
    const second = makeCourse(2, { dayOfWeek: 1, startPeriod: 5, endPeriod: 5, credits: 1 });

    const result = generateSchedule([first, second], {
      minCredits: 0,
      maxCoursesPerDay: 1,
      mustTakeCourseIds: [1, 2],
    });

    assert.equal(result.success, false);
    assert.ok(result.message.includes('超過每日'));
  });

  test('X11 CONSTRAINTS 表完整性：每個條目都有定義必要欄位，且沒有重複 id', () => {
    const ids = new Set();
    for (const [key, def] of Object.entries(CONSTRAINTS)) {
      assert.equal(def.id, key, `${key} 的 id 欄位應與 key 一致`);
      assert.ok(!ids.has(def.id), `${def.id} 重複`);
      ids.add(def.id);
      for (const field of [
        'category', 'relaxable', 'weight', 'source', 'confidence', 'enforced', 'exemptForRequiredCourses',
      ]) {
        assert.ok(field in def, `${key} 缺少欄位 ${field}`);
      }
    }
  });

  test('X12 正式必修無條件豁免時段偏好：仍被排入，並附上必修優先的揭露警告', () => {
    const required = makeCourse(1, { category: '必修', startPeriod: 1, endPeriod: 2 });

    const result = generateSchedule([required], {
      department: '資訊工程學系',
      gradeLevel: 3,
      className: '資訊三甲',
      noMorningClasses: true,
      minCredits: 0,
    });

    assert.equal(result.success, true);
    assert.ok(result.schedule.some(c => c.id === 1));
    assert.ok(result.warnings.some(w => w.includes('必修優先') && w.includes('不排早八')));
  });

  test('X13 必修豁免不適用於 BLOCKED_PERIODS：仍會被排除', () => {
    const required = makeCourse(1, { category: '必修', dayOfWeek: 1, startPeriod: 3, endPeriod: 4 });

    const result = generateSchedule([required], {
      department: '資訊工程學系',
      gradeLevel: 3,
      className: '資訊三甲',
      blockedPeriods: [{ day: 1, period: 3 }],
      minCredits: 0,
    });

    assert.equal(result.success, false);
    assert.ok(result.conflictSet.some(v => v.constraintId === 'BLOCKED_PERIODS'));
  });

  test('X14 mustTakeCourseIds（非正式必修）仍受時段偏好排除，行為與 S10 一致', () => {
    const course = makeCourse(1, { startPeriod: 1, endPeriod: 2 });

    const result = generateSchedule([course], {
      noMorningClasses: true,
      mustTakeCourseIds: [1],
      minCredits: 0,
    });

    assert.equal(result.success, false);
    assert.ok(result.message.length > 0);
  });
});

describe('Z1-Z7 Roadmap #22：bounded backtracking repair、fallback 與澄清', () => {
  function greedyTrapCourses() {
    return [
      makeCourse(901, {
        name: '高優先單課', catalogCourseCode: 'TRAP-A', category: '核心選修',
        dayOfWeek: 1, startPeriod: 1, endPeriod: 4,
      }),
      makeCourse(902, {
        name: '可組合課程一', catalogCourseCode: 'TRAP-B',
        dayOfWeek: 1, startPeriod: 1, endPeriod: 2,
      }),
      makeCourse(903, {
        name: '可組合課程二', catalogCourseCode: 'TRAP-C',
        dayOfWeek: 1, startPeriod: 3, endPeriod: 4,
      }),
    ];
  }

  test('Z1 greedy trap：baseline 只有 3 學分，repair 撤銷後找到 6 學分合法解', () => {
    const constraints = { minCredits: 6, maxCredits: 6 };
    const greedy = generateSchedule(greedyTrapCourses(), constraints, { solverMode: 'greedy' });
    const repaired = generateSchedule(greedyTrapCourses(), constraints);

    assert.equal(greedy.totalCredits, 3);
    assert.equal(greedy.solver.repairAttempted, false);
    assert.equal(repaired.success, true);
    assert.equal(repaired.totalCredits, 6);
    assert.deepEqual(repaired.schedule.map(course => course.id).sort(), [902, 903]);
    assert.equal(repaired.solver.status, 'solved');
    assert.equal(repaired.solver.resultSource, 'repair');
    assert.equal(repaired.solver.improved, true);
    assert.equal(
      validateScheduleAgainstConstraints(repaired.schedule, constraints).valid,
      true
    );
  });

  test('Z2 真正無解：完整搜尋後回傳 infeasible、草稿與可驗證衝突', () => {
    const first = makeCourse(911, { catalogCourseCode: 'REQ-A' });
    const second = makeCourse(912, { catalogCourseCode: 'REQ-B' });
    const result = generateSchedule([first, second], {
      mustTakeCourseIds: [911, 912], minCredits: 6, maxCredits: 6,
    });

    assert.equal(result.success, false);
    assert.equal(result.solver.status, 'infeasible');
    assert.equal(result.solver.optimizationComplete, true);
    assert.equal(result.isDraft, true);
    assert.equal(result.schedule.length, 0);
    assert.equal(result.draftSchedule.length, 1);
    assert.ok(result.conflictSet.some(item => item.constraintId === 'TIME_CONFLICT'));
    assert.ok(result.unmetRequirements.some(item => item.type === 'required-course'));
    assert.equal(result.clarification.required, true);
  });

  test('Z3 timeout 有合法 baseline：回傳已驗證 fallback，不把部分搜尋結果冒充正式課表', () => {
    const result = generateSchedule(
      [makeCourse(921, { catalogCourseCode: 'LOW-CREDIT' })],
      { minCredits: 6, maxCredits: 6 },
      { maxNodes: 1 }
    );

    assert.equal(result.success, true);
    assert.equal(result.totalCredits, 3);
    assert.equal(result.solver.status, 'timeout');
    assert.equal(result.solver.resultSource, 'greedy');
    assert.equal(result.solver.fallbackUsed, true);
    assert.equal(result.isDraft, false);
    assert.deepEqual(result.draftSchedule, []);
    assert.ok(result.unmetRequirements.some(item => item.type === 'credit-floor'));
  });

  test('Z4 timeout 無合法完整解：正式 schedule 為空，最佳部分組合只放 draftSchedule', () => {
    const first = makeCourse(931, { catalogCourseCode: 'TIMEOUT-A' });
    const second = makeCourse(932, { catalogCourseCode: 'TIMEOUT-B' });
    const result = generateSchedule(
      [first, second],
      { mustTakeCourseIds: [931, 932], minCredits: 6, maxCredits: 6 },
      { maxNodes: 2 }
    );

    assert.equal(result.success, false);
    assert.equal(result.solver.status, 'timeout');
    assert.deepEqual(result.schedule, []);
    assert.equal(result.isDraft, true);
    assert.equal(result.draftSchedule.length, 1);
    assert.equal(validateSchedule(result.draftSchedule).valid, true);
    assert.equal(result.clarification.reason, 'timeout');
  });

  test('Z5 缺少必要課程資料時回傳 data-insufficient，不誤報 infeasible', () => {
    const result = generateSchedule(
      [makeCourse(941, { catalogCourseCode: 'AVAILABLE' })],
      { mustTakeCourseIds: [999999], minCredits: 3, maxCredits: 6 }
    );

    assert.equal(result.success, false);
    assert.equal(result.solver.status, 'data-insufficient');
    assert.equal(result.clarification.reason, 'data-insufficient');
    assert.ok(result.unmetRequirements.some(item => (
      item.type === 'required-course' && item.courseIds.includes(999999)
    )));
  });

  test('Z6 相同 seed 與輸入可重現相同課程、狀態及探索統計', () => {
    const options = { seed: 42 };
    const constraints = { minCredits: 6, maxCredits: 6 };
    const first = generateSchedule(greedyTrapCourses(), constraints, options);
    const second = generateSchedule(greedyTrapCourses(), constraints, options);

    assert.deepEqual(first.schedule.map(course => course.id), second.schedule.map(course => course.id));
    assert.equal(first.solver.status, second.solver.status);
    assert.equal(first.solver.nodesVisited, second.solver.nodesVisited);
    assert.equal(first.solver.prunedNodes, second.solver.prunedNodes);
  });

  test('Z7 repair 的正課與實習決策維持原子性', () => {
    const blocker = makeCourse(951, {
      name: '高優先單課', catalogCourseCode: 'PAIR-BLOCK', category: '核心選修',
      credits: 3, dayOfWeek: 1, startPeriod: 1, endPeriod: 4,
    });
    const regular = makeCourse(952, {
      name: '配對正課', catalogCourseCode: 'PAIR100', credits: 3,
      dayOfWeek: 1, startPeriod: 1, endPeriod: 2,
    });
    const internship = makeCourse(953, {
      name: '配對實習', catalogCourseCode: 'PAIR100P', credits: 1,
      dayOfWeek: 1, startPeriod: 3, endPeriod: 4,
    });
    const filler = makeCourse(954, {
      name: '補足學分', catalogCourseCode: 'PAIR-FILL', credits: 2,
      dayOfWeek: 2, startPeriod: 3, endPeriod: 4,
    });
    const result = generateSchedule(
      [blocker, regular, internship, filler],
      { minCredits: 6, maxCredits: 6 }
    );

    assert.equal(result.success, true);
    assert.equal(result.solver.resultSource, 'repair');
    assert.equal(result.schedule.some(course => course.id === 952), true);
    assert.equal(result.schedule.some(course => course.id === 953), true);
  });
});

// Roadmap #10：修復多方案塌縮。
//
// 改動前用真實 MySQL 與 demo 帳號量測到的基準：小池（16 門可競爭）去重後只有
// **1** 個方案，大池（227 門）也只有 **3** 個。原因是五個 variant 共用同一組
// 基礎分，各自只加一點小分——類別項每差一級 120 分，而 variant 專屬項只有
// 25～40 分（`max_credits` 的 2→3 學分只差 25），主題訊號被完全蓋過。
describe('P10 Roadmap #10：方案分化、涼度來源與誠實邊界', () => {
  const at = (id, day, start, overrides = {}) => makeCourse(id, {
    dayOfWeek: day, startPeriod: start, endPeriod: start + 1, ...overrides,
  });

  // 每天兩個時段、共 10 門課，學分與屬性各異，讓五個取向有分化空間。
  function widePool(startId = 100) {
    const courses = [];
    let id = startId;
    for (let day = 1; day <= 5; day += 1) {
      for (const start of [3, 7]) {
        id += 1;
        courses.push(at(id, day, start, {
          category: id % 3 === 0 ? '核心選修' : '一般選修',
          credits: id % 4 === 0 ? 2 : 3,
          description: id % 2 === 0
            ? '課堂討論與互動參與為主'
            : '需要實作專題與實驗，並深入應用',
        }));
      }
    }
    return courses;
  }

  describe('P10-1 必修的絕對優先不得被權重表破壞', () => {
    // 本次最高回歸風險：類別分變成 variant 可調之後，一門「替代涼度極高」的
    // 一般選修可能壓過必修。必修先排是規則，不是偏好。
    const required = at(1, 1, 3, { category: '必修', description: '實作專題與實驗' });
    const veryEasyElective = at(2, 1, 3, {
      category: '一般選修', credits: 1,
      description: '課堂討論與互動參與為主，重視平時參與',
    });

    // 必修的判定需要學生範圍，否則 A 類必修會因「系所年級資料不足」被保守排除
    // （比照 S3 的寫法）。`makeCourse` 預設 department 為 `資訊三甲`。
    const scope = { department: '資訊工程學系', gradeLevel: 3, className: '資訊三甲' };

    test('P10-1 五個 variant 都先排必修，不排與它衝堂的超涼選修', () => {
      const result = generateSchedule([required, veryEasyElective], {
        ...scope, minCredits: 0, maxCredits: 25,
      });

      for (const plan of result.plans) {
        assert.equal(
          plan.schedule.some(course => course.id === 1), true,
          `${plan.id} 應排入必修`
        );
        assert.equal(
          plan.schedule.some(course => course.id === 2), false,
          `${plan.id} 不得為了涼度捨棄必修`
        );
      }
    });

    // 學分只夠一門課時，必修必須贏過替代涼度極高的選修。
    //
    // 刻意**不**斷言 `plan.schedule` 的陣列順序：實測（含改動前對照）該陣列
    // 本來就不是依優先度排列，必修可能出現在選修之後。斷言陣列位置會釘住一個
    // 從來不成立的實作細節，而不是「必修優先」這條真正的規則。
    test('P10-1 學分只夠一門時，五個 variant 都選必修而不是超涼選修', () => {
      const result = generateSchedule(
        [veryEasyElective, at(3, 2, 3, { category: '必修', credits: 3 })],
        { ...scope, minCredits: 0, maxCredits: 3 }
      );

      for (const plan of result.plans) {
        assert.equal(
          plan.schedule.some(course => course.id === 3), true,
          `${plan.id} 應在有限學分下選必修`
        );
      }
    });
  });

  describe('P10-2 候選池夠大時方案之間真的不同', () => {
    test('P10-2 至少產生 3 種內容不同的方案（改動前同樣輸入只有 1 種）', () => {
      const result = generateSchedule(widePool(), { minCredits: 0, maxCredits: 12 });

      assert.ok(
        result.plans.length >= 3,
        `方案數應 >= 3，實際 ${result.plans.length}：${result.plans.map(p => p.id).join(',')}`
      );
    });

    test('P10-2 各方案的課程集合兩兩不同', () => {
      const result = generateSchedule(widePool(), { minCredits: 0, maxCredits: 12 });
      const keys = result.plans.map(
        p => p.schedule.map(c => c.id).sort((a, b) => a - b).join(',')
      );

      assert.equal(new Set(keys).size, keys.length, '方案不得有重複的課程集合');
    });

    test('P10-2 interest 方案會把命中興趣關鍵字的課排進去', () => {
      const pool = widePool();
      pool.push(at(999, 1, 5, { category: '一般選修', description: '資訊安全與網路防禦' }));

      const result = generateSchedule(pool, {
        minCredits: 0, maxCredits: 12, interests: ['資訊安全'],
      });
      const interestPlan = result.plans.find(p => p.id === 'interest');

      assert.ok(interestPlan, 'interest 方案應該存在且與其他方案不同');
      assert.equal(
        interestPlan.schedule.some(c => c.id === 999), true,
        'interest 方案應排入命中關鍵字的課'
      );
    });
  });

  describe('P10-3 方案數不足時要說明原因', () => {
    test('P10-3 方案被合併時指出取向名稱與可競爭課程數', () => {
      const result = generateSchedule(
        [at(1, 1, 3, { category: '一般選修' }), at(2, 2, 3, { category: '一般選修' })],
        { minCredits: 0, maxCredits: 25 }
      );

      const warning = result.warnings.find(w => w.includes('已合併'));
      assert.ok(warning, '方案被合併時必須有說明');
      assert.match(warning, /可競爭的課程僅 2 門/);
    });

    test('P10-3 已勾集中排課時額外說明該方案為何不會不同', () => {
      const result = generateSchedule(
        [at(1, 1, 3, { category: '一般選修' }), at(2, 1, 5, { category: '一般選修' })],
        { minCredits: 0, maxCredits: 25, preferCompact: true }
      );

      const warning = result.warnings.find(w => w.includes('已合併')) || '';
      if (warning.includes('集中排課')) {
        assert.match(warning, /你已設定「盡量集中排課」/);
      }
    });

    test('P10-3 沒有方案被合併時不得出現合併說明', () => {
      const result = generateSchedule(widePool(300), { minCredits: 0, maxCredits: 12 });

      if (result.plans.length === 5) {
        assert.equal(result.warnings.some(w => w.includes('已合併')), false);
      }
    });
  });

  describe('P10-4 涼度來源要誠實標記', () => {
    test('P10-4 有評價的課標記為 reviews', () => {
      // `courseReviews` 走 constraints，與 V20 的用法一致。
      const result = generateSchedule(
        [at(1, 1, 3, { category: '一般選修' })],
        { minCredits: 0, maxCredits: 25, courseReviews: [makeEasyReview(1)] }
      );

      assert.equal(result.plans[0].schedule.find(c => c.id === 1).easinessSource, 'reviews');
    });

    test('P10-4 沒有評價但有課程描述時標記為 proxy', () => {
      const result = generateSchedule(
        [at(1, 1, 3, { category: '一般選修', description: '課堂討論與互動參與' })],
        { minCredits: 0, maxCredits: 25 }
      );

      assert.equal(result.plans[0].schedule.find(c => c.id === 1).easinessSource, 'proxy');
    });

    test('P10-4 兩者皆無時標記為 none，不硬給分數', () => {
      const result = generateSchedule(
        [at(1, 1, 3, { category: '一般選修', description: '' })],
        { minCredits: 0, maxCredits: 25 }
      );

      assert.equal(result.plans[0].schedule.find(c => c.id === 1).easinessSource, 'none');
    });
  });

  describe('P10-5 替代訊號不得污染對使用者的涼度宣稱', () => {
    // 本次最重要的誠實邊界：替代訊號只影響**排序**，不得讓系統宣稱「這份課表很涼」
    // ——那個宣稱只能由真實評價支撐（#4 的 ADR-006／ADR-008）。
    test('P10-5 全部只有 proxy 來源時 reviewCoverage 仍為 0', () => {
      const result = generateSchedule(
        [
          at(1, 1, 3, { category: '一般選修', description: '課堂討論與互動' }),
          at(2, 2, 3, { category: '一般選修', description: '實作專題與實驗' }),
        ],
        { minCredits: 0, maxCredits: 25 }
      );

      assert.equal(result.plans[0].reviewCoverage.rated, 0, '替代訊號不得算成有評價');
      assert.equal(result.plans[0].reviewCoverage.ratio, 0);
    });

    test('P10-5 全部只有 proxy 來源時方案層 easy 不得冒出數字', () => {
      const result = generateSchedule(
        [at(1, 1, 3, { category: '一般選修', description: '課堂討論與互動' })],
        { minCredits: 0, maxCredits: 25, preferEasyCourses: true }
      );

      const easy = result.plans[0].preferenceBreakdown?.easy;
      assert.ok(
        easy === null || easy === undefined || easy === 0,
        `方案層涼度只能由真實評價推得，實際為 ${easy}`
      );
    });
  });
});

describe('P10-6 interests 不再從偏好標籤回填（Roadmap #10）', () => {
  // 改動前是 `prefs.interests ?? prefs.preferenceTags`，而 `prefs.interests`
  // 這個欄位不存在，因此永遠退回偏好標籤——「#不排早八」這種**排課偏好**
  // 被當成**興趣主題**拿去比對課名與課程介紹，實測 demo 帳號 0/16 命中。
  test('P10-6 只有偏好標籤時 interests 為空，不把標籤當興趣', () => {
    const merged = buildScheduleConstraints({}, {
      preferenceTags: ['#不排早八', '#全英授課', '#盡量集中排課'],
    });

    assert.deepEqual(merged.interests, []);
  });

  test('P10-6 真正的興趣關鍵字仍然照常帶入', () => {
    const merged = buildScheduleConstraints({}, { interests: ['資訊安全', '網路'] });

    assert.deepEqual(merged.interests, ['資訊安全', '網路']);
  });

  test('P10-6 request 帶的 interests 優先於已儲存偏好', () => {
    const merged = buildScheduleConstraints(
      { interests: ['人工智慧'] }, { interests: ['資訊安全'] }
    );

    assert.deepEqual(merged.interests, ['人工智慧']);
  });
});
