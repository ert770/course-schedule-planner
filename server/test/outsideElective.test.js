// 系外選修認列條件（資工系）與通識共同必修不計畢業學分。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { isOutsideElective, evaluateOutsideElective } from '../src/skills/outsideElective.js';
import { buildStudentScope } from '../src/skills/courseScope.js';
import {
  countsTowardGraduation,
  getNonGraduationCategory,
  sumGraduationCredits,
} from '../src/data/generalEducation.js';
import { generateSchedule, validateSchedule } from '../src/skills/scheduler.js';
import { makeCourse } from './fixtures.js';

const csScope = buildStudentScope({ department: '資訊工程學系', gradeLevel: 3 });

const elective = (overrides) => ({
  name: '課程',
  category: '選修',
  department: '經濟二甲',
  subid3: 'ECON2001',
  ...overrides,
});

describe('系外選修範圍', () => {
  test('他系所班級的選修才是系外選修', () => {
    assert.equal(isOutsideElective(elective(), csScope), true);
    assert.equal(isOutsideElective(elective({ department: '資訊二合' }), csScope), false);
  });

  test('本系課號的課即使開在他系班級底下也不是系外選修', () => {
    // 密碼學 IECS3052 掛在 `資通安全學程`。
    assert.equal(
      isOutsideElective(elective({ subid3: 'IECS3052', department: '應數三合' }), csScope),
      false
    );
  });

  test('通識、共同科目、學院綜合班、學分學程都不是系外選修', () => {
    // 這幾類不屬於任何系所，若當成系外選修會被認列條件過濾掉。
    for (const department of ['人文藝術與社會經典教育', '國文綜合班', '資電學院綜合班', '資通安全學程']) {
      assert.equal(isOutsideElective(elective({ department }), csScope), false, department);
    }
  });

  test('必修不是系外選修', () => {
    assert.equal(isOutsideElective(elective({ category: '必修' }), csScope), false);
  });

  test('學生範圍未判定時不做系外選修判定', () => {
    assert.equal(isOutsideElective(elective(), buildStudentScope({})), false);
  });
});

describe('系外選修認列條件', () => {
  test('進修部開設課程不認列', () => {
    const result = evaluateOutsideElective(
      elective({ department: '商學進修二學位學程甲班', subid3: 'BADM2001' }),
      csScope
    );

    assert.equal(result.eligible, false);
    assert.ok(result.reasons.some(reason => reason.includes('進修部')), result.reasons.join());
  });

  test('課程內容與本系重複不認列', () => {
    const result = evaluateOutsideElective(
      elective({ name: '密碼學', department: '應數三合', subid3: 'MATH3069' }),
      csScope
    );

    assert.equal(result.eligible, false);
    assert.ok(result.reasons.some(reason => reason.includes('與本系')), result.reasons.join());
  });

  test('大一概論性課程不認列', () => {
    const result = evaluateOutsideElective(
      elective({ name: '經濟學概論', department: '經濟一甲', subid3: 'ECON1001' }),
      csScope
    );

    assert.equal(result.eligible, false);
    assert.ok(result.reasons.some(reason => reason.includes('概論')), result.reasons.join());
  });

  test('非大一的導論課不因課名被誤殺', () => {
    // 「導論」在資工系是三年級選修的常見課名，單看課名會誤判。
    const result = evaluateOutsideElective(
      elective({ name: '地質學導論', department: '土木三甲', subid3: 'CIVE3001' }),
      csScope
    );

    assert.equal(result.eligible, true);
  });

  test('難度無法機械判定，大一層級課程只警告不排除', () => {
    const result = evaluateOutsideElective(
      elective({ name: '會計學', department: '會計一甲', subid3: 'ACCT1001' }),
      csScope
    );

    assert.equal(result.eligible, true);
    assert.deepEqual(result.warnings, [{ type: 'difficulty', name: '會計學' }]);
  });

  test('難度提醒在排課結果中彙整成一行，不是每門課一條', () => {
    const courses = Array.from({ length: 12 }, (_, index) => makeCourse(index + 1, {
      name: `他系課程${index + 1}`,
      department: '會計一甲',
      subid3: `ACCT100${index}`,
      dayOfWeek: (index % 7) + 1,
    }));

    const result = generateSchedule(courses, {
      department: '資訊工程學系',
      gradeLevel: 3,
      minCredits: 0,
      maxCredits: 99,
      maxCoursesPerDay: 99,
    });

    const difficultyWarnings = result.warnings.filter(warning => warning.includes('難度'));
    assert.equal(difficultyWarnings.length, 1);
    assert.ok(difficultyWarnings[0].includes('12 門'), difficultyWarnings[0]);
  });

  test('通過條件者仍須向系辦確認', () => {
    const result = evaluateOutsideElective(elective(), csScope);

    assert.equal(result.eligible, true);
    assert.equal(result.needsOfficeConfirmation, true);
  });

  test('非資工系學生不套用這組條件', () => {
    const otherScope = buildStudentScope({ department: '會計學系', gradeLevel: 3 });
    const result = evaluateOutsideElective(elective({ department: '資訊二合' }), otherScope);

    assert.equal(result.checked, false);
  });
});

describe('系外選修條件在排課中生效', () => {
  const base = { department: '資訊工程學系', gradeLevel: 3, minCredits: 0, maxCredits: 99, maxCoursesPerDay: 99 };

  test('不認列的系外選修不進課表，並附上原因', () => {
    const courses = [
      makeCourse(1, { name: '密碼學', department: '應數三合', subid3: 'MATH3069', dayOfWeek: 1 }),
      makeCourse(2, { name: '個體經濟學', department: '經濟二甲', subid3: 'ECON2001', dayOfWeek: 2 }),
    ];

    const result = generateSchedule(courses, base);
    const ids = result.schedule.map(course => course.id);

    assert.deepEqual(ids, [2]);
    assert.ok(result.excludedCourses.some(item => item.reason.includes('與本系')));
  });

  test('使用者明確指定的課程不得被靜默剔除，改標記為不計入畢業學分', () => {
    // 這條規則講的是「能不能計入畢業學分」，不是「能不能修」。
    // 把使用者親手勾的課刪掉，畫面上只會少一門課，沒有任何線索。
    const courses = [
      makeCourse(1, { name: '密碼學', department: '應數三合', subid3: 'MATH3069', dayOfWeek: 1, credits: 3 }),
      makeCourse(2, { name: '個體經濟學', department: '經濟二甲', subid3: 'ECON2001', dayOfWeek: 2, credits: 3 }),
    ];

    const result = generateSchedule(courses, { ...base, explicitCourseIds: [1, 2] });
    const placed = result.schedule.find(course => course.id === 1);

    assert.ok(placed, '使用者指定的課程必須排入');
    assert.equal(placed.countsTowardGraduation, false);
    assert.equal(placed.nonGraduationCategory, '系外選修未認列');
    assert.equal(placed.outsideElectiveRecognized, false);

    assert.equal(result.totalCredits, 6);
    assert.equal(result.graduationCredits, 3);
    assert.ok(
      result.warnings.some(warning => warning.includes('自行決定是否移除')),
      result.warnings.join(' | ')
    );
    // 警告直接顯示在畫面上，不得夾帶 markdown 語法。
    assert.ok(
      result.warnings.every(warning => !warning.includes('**')),
      result.warnings.join(' | ')
    );
  });

  test('A/B：同一門課，系統自撿時剔除、使用者指定時保留', () => {
    const courses = [
      makeCourse(1, { name: '密碼學', department: '應數三合', subid3: 'MATH3069', dayOfWeek: 1, credits: 3 }),
    ];

    const auto = generateSchedule(courses, base);
    const explicit = generateSchedule(courses, { ...base, explicitCourseIds: [1] });

    assert.equal(auto.schedule.length, 0);
    assert.equal(explicit.schedule.length, 1);
    assert.equal(explicit.graduationCredits, 0);
    assert.equal(explicit.totalCredits, 3);
  });

  test('selectedCourseIds 與 mustTakeCourseIds 同樣算明確指定', () => {
    const courses = [
      makeCourse(1, { name: '密碼學', department: '應數三合', subid3: 'MATH3069', dayOfWeek: 1 }),
    ];

    for (const key of ['selectedCourseIds', 'mustTakeCourseIds', 'retakeCourseIds']) {
      const result = generateSchedule(courses, { ...base, [key]: [1] });
      assert.equal(result.schedule.length, 1, key);
    }
  });

  test('A/B：同一批課程換成他系學生就不會被過濾', () => {
    const courses = [
      makeCourse(1, { name: '密碼學', department: '應數三合', subid3: 'MATH3069', dayOfWeek: 1 }),
    ];

    const asCs = generateSchedule(courses, base);
    const asAccounting = generateSchedule(courses, { ...base, department: '會計學系' });

    assert.equal(asCs.schedule.length, 0);
    assert.equal(asAccounting.schedule.length, 1);
  });
});

describe('通識共同必修不計入畢業學分', () => {
  test('軍訓國防科技、體育、班級活動不計入', () => {
    assert.equal(getNonGraduationCategory({ name: '國防科技' }), '軍訓國防');
    assert.equal(getNonGraduationCategory({ name: '體育(二)' }), '體育');
    assert.equal(getNonGraduationCategory({ name: '體育－羽球' }), '體育');
    assert.equal(getNonGraduationCategory({ name: '班級活動' }), '班級活動');
  });

  test('一般課程計入', () => {
    for (const name of ['計算機演算法', '國防政策', '全民國防']) {
      assert.equal(countsTowardGraduation({ name }), true, name);
    }
  });

  test('sumGraduationCredits 只加總計入畢業的學分', () => {
    const courses = [
      { name: '計算機演算法', credits: 3 },
      { name: '體育(二)', credits: 1 },
      { name: '班級活動', credits: 0 },
    ];

    assert.equal(sumGraduationCredits(courses), 3);
  });

  test('排課結果分開回報學期學分與畢業學分', () => {
    const courses = [
      makeCourse(1, { name: '計算機演算法', credits: 3, dayOfWeek: 1 }),
      makeCourse(2, { name: '體育(二)', credits: 1, dayOfWeek: 2 }),
      makeCourse(3, { name: '國防科技', credits: 1, dayOfWeek: 3 }),
    ];

    const result = generateSchedule(courses, { minCredits: 0, maxCredits: 99, maxCoursesPerDay: 99 });

    assert.equal(result.totalCredits, 5);
    assert.equal(result.graduationCredits, 3);
    assert.equal(result.nonGraduationCredits, 2);
    assert.ok(
      result.warnings.some(warning => warning.includes('不計入畢業學分')),
      result.warnings.join(' | ')
    );
  });

  test('排入課表的每門課都標記是否計入畢業學分', () => {
    const courses = [makeCourse(1, { name: '體育(二)', credits: 1 })];
    const result = generateSchedule(courses, { minCredits: 0 });

    assert.equal(result.schedule[0].countsTowardGraduation, false);
    assert.equal(result.schedule[0].nonGraduationCategory, '體育');
  });

  test('validateSchedule 同樣分開回報', () => {
    const result = validateSchedule([
      { id: 1, name: '計算機演算法', credits: 3 },
      { id: 2, name: '體育(二)', credits: 1 },
    ]);

    assert.equal(result.totalCredits, 4);
    assert.equal(result.graduationCredits, 3);
    assert.equal(result.nonGraduationCredits, 1);
  });
});
