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
import { buildScheduleConstraints } from '../src/services/constraintService.js';
import { makeCourse, makeMultiBlockCourse, makeUnscheduledCourse } from './fixtures.js';

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

    const result = generateSchedule([elective, required], { minCredits: 0, maxCredits: 9 });

    assert.ok(result.schedule.some(course => course.id === 1));
    assert.ok(!result.schedule.some(course => course.id === 2));
  });

  test('S4 重補修課程優先排入', () => {
    const retake = makeCourse(1, { dayOfWeek: 2 });
    const other = makeCourse(2, { dayOfWeek: 2 });

    const result = generateSchedule([other, retake], {
      retakeCourseIds: [1],
      minCredits: 0,
      maxCredits: 3,
    });

    assert.equal(result.schedule.length, 1);
    assert.equal(result.schedule[0].id, 1);
  });
});

describe('S5-S6 核心選修路徑', () => {
  // 課程資料目前沒有 track 欄位，三條修課路徑無法實作。
  // 這裡驗證的是「資料缺漏時必須明說」，而不是路徑排序本身。
  test('S5/S6 缺少 track 欄位時回報警告而非靜默通過', () => {
    const result = generateSchedule([makeCourse(1)], {
      preferredTrack: '技術應用類',
      minCredits: 0,
    });

    assert.ok(result.warnings.some(warning => warning.includes('track')));
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
