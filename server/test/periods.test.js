// D2：`User_Profiles.avoid_time` 存的是時間字串（例如 ["08:00"]），
// 但排課引擎的 hardConstraintReason() 只認 `{ day, period }`。
// 先前原樣傳遞，`bp.day` 為 undefined 導致比對永遠跳過，
// 使用者設定的避開時段完全不生效且沒有任何錯誤或警告。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  toMinutes,
  findPeriodByTime,
  normalizeBlockedPeriods,
  PERIOD_TIMES,
  DAYS_PER_WEEK,
} from '../src/utils/periods.js';
import { generateSchedule } from '../src/skills/scheduler.js';
import { buildScheduleConstraints } from '../src/services/constraintService.js';
import { makeCourse } from './fixtures.js';

describe('時間字串解析', () => {
  test('解析 HH:MM', () => {
    assert.equal(toMinutes('08:10'), 490);
    assert.equal(toMinutes('00:00'), 0);
    assert.equal(toMinutes('23:59'), 1439);
  });

  test('容忍全形冒號與空白', () => {
    assert.equal(toMinutes(' 09：10 '), 550);
  });

  test('無效輸入回傳 null', () => {
    for (const value of ['', '8', 'abc', '25:00', '10:99', null, undefined, 830]) {
      assert.equal(toMinutes(value), null, `${JSON.stringify(value)} 應為 null`);
    }
  });
});

describe('時間對應節次', () => {
  test('08:00 對應第 1 節（早八）', () => {
    // 第 1 節 08:10 開始，使用者說「避開八點」指的就是早八
    assert.equal(findPeriodByTime('08:00'), 1);
  });

  test('落在節次區間內時取該節', () => {
    assert.equal(findPeriodByTime('09:30'), 2);
    assert.equal(findPeriodByTime('12:30'), 5);
  });

  test('落在兩節之間時取下一節', () => {
    // 第 5 節 13:00 結束，第 6 節 13:10 開始
    assert.equal(findPeriodByTime('13:05'), 6);
  });

  test('節次開始與結束時間本身', () => {
    assert.equal(findPeriodByTime('08:10'), 1);
    assert.equal(findPeriodByTime('09:00'), 1);
    assert.equal(findPeriodByTime('22:10'), 14);
  });

  test('超出最後一節時回傳 null', () => {
    assert.equal(findPeriodByTime('23:00'), null);
  });

  test('每一節的開始時間都能對應回自己', () => {
    for (const entry of PERIOD_TIMES) {
      assert.equal(findPeriodByTime(entry.start), entry.period, `第 ${entry.period} 節`);
    }
  });
});

describe('封鎖時段正規化', () => {
  test('時間字串展開為每天的該節次', () => {
    const result = normalizeBlockedPeriods(['08:00']);

    assert.equal(result.length, DAYS_PER_WEEK);
    assert.ok(result.every(item => item.period === 1));
    assert.deepEqual(
      result.map(item => item.day).sort((a, b) => a - b),
      [1, 2, 3, 4, 5, 6, 7]
    );
  });

  test('已是 { day, period } 的項目原樣保留', () => {
    const result = normalizeBlockedPeriods([{ day: 3, period: 5 }]);

    assert.deepEqual(result, [{ day: 3, period: 5 }]);
  });

  test('兩種格式可混用', () => {
    const result = normalizeBlockedPeriods([{ day: 3, period: 5 }, '08:00']);

    assert.equal(result.length, 1 + DAYS_PER_WEEK);
    assert.ok(result.some(item => item.day === 3 && item.period === 5));
  });

  test('重複項目去重', () => {
    const result = normalizeBlockedPeriods(['08:00', '08:05', { day: 1, period: 1 }]);

    // 08:00 與 08:05 都落在第 1 節，{day:1,period:1} 也已包含
    assert.equal(result.length, DAYS_PER_WEEK);
  });

  test('無法解析的項目被丟棄並回報，不得靜默忽略', () => {
    const invalid = [];
    const result = normalizeBlockedPeriods(
      ['不是時間', '23:59', { day: 99, period: 1 }, { period: 3 }, null],
      entry => invalid.push(entry)
    );

    assert.equal(result.length, 0);
    assert.equal(invalid.length, 5);
  });

  test('非陣列輸入回傳空陣列', () => {
    assert.deepEqual(normalizeBlockedPeriods(null), []);
    assert.deepEqual(normalizeBlockedPeriods('08:00'), []);
    assert.deepEqual(normalizeBlockedPeriods(undefined), []);
  });
});

describe('D2 端到端：時間字串形式的封鎖時段實際生效', () => {
  test('已儲存偏好為 ["08:00"] 時，第 1 節的課會被排除', () => {
    const constraints = buildScheduleConstraints({}, { blockedPeriods: ['08:00'] });
    const firstPeriod = makeCourse(1, { dayOfWeek: 2, startPeriod: 1, endPeriod: 2 });
    const later = makeCourse(2, { dayOfWeek: 2, startPeriod: 6, endPeriod: 7 });

    const result = generateSchedule([firstPeriod, later], { ...constraints, minCredits: 0 });

    assert.ok(!result.schedule.some(course => course.id === 1), '第 1 節的課應被排除');
    assert.ok(result.schedule.some(course => course.id === 2), '其他時段的課應保留');
    assert.ok(result.excludedCourses.some(item => item.reason.includes('封鎖')));
  });

  test('直接把時間字串送進排課引擎也會生效，不倚賴呼叫端先轉換', () => {
    // generateSchedule 自己正規化封鎖時段。若改為要求呼叫端負責，
    // 每新增一條呼叫路徑就多一次踩 D2 這個坑的機會。
    const firstPeriod = makeCourse(1, { dayOfWeek: 2, startPeriod: 1, endPeriod: 2 });
    const later = makeCourse(2, { dayOfWeek: 2, startPeriod: 6, endPeriod: 7 });

    const result = generateSchedule([firstPeriod, later], {
      blockedPeriods: ['08:00'],
      minCredits: 0,
    });

    assert.ok(!result.schedule.some(course => course.id === 1), '第 1 節的課應被排除');
    assert.ok(result.schedule.some(course => course.id === 2));
  });

  test('混用時間字串與物件格式仍正確', () => {
    const firstPeriod = makeCourse(1, { dayOfWeek: 2, startPeriod: 1, endPeriod: 2 });
    const wednesday = makeCourse(2, { dayOfWeek: 3, startPeriod: 6, endPeriod: 7 });
    const safe = makeCourse(3, { dayOfWeek: 4, startPeriod: 6, endPeriod: 7 });

    const result = generateSchedule([firstPeriod, wednesday, safe], {
      blockedPeriods: ['08:00', { day: 3, period: 6 }],
      minCredits: 0,
    });

    assert.deepEqual(result.schedule.map(course => course.id), [3]);
  });

  test('request 送時間字串時也會被正規化', () => {
    const constraints = buildScheduleConstraints({ blockedPeriods: ['08:00'] }, {});

    assert.equal(constraints.blockedPeriods.length, DAYS_PER_WEEK);
    assert.ok(constraints.blockedPeriods.every(item => item.period === 1));
  });

  test('mondayFree 與時間字串封鎖可併存', () => {
    const constraints = buildScheduleConstraints(
      { mondayFree: true },
      { blockedPeriods: ['08:00'] }
    );

    const monday = constraints.blockedPeriods.filter(item => item.day === 1);
    assert.equal(monday.length, 14, '週一整天封鎖');
    // 其餘六天各有第 1 節被封鎖
    const otherDaysPeriod1 = constraints.blockedPeriods.filter(
      item => item.day !== 1 && item.period === 1
    );
    assert.equal(otherDaysPeriod1.length, 6);
  });
});
