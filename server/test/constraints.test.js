// docs/TEST_PLAN.md 的 S11、S12、S15，以及 docs/API_SPEC.md「限制條件合併語意」。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { buildScheduleConstraints } from '../src/services/constraintService.js';

describe('S11-S12 陣列型偏好的合併語意', () => {
  const saved = {
    preferredKeywords: ['網路', '資安'],
    blockedPeriods: [{ day: 3, period: 5 }],
    mustTakeCourses: [7],
  };

  test('S11 送空陣列時退回已儲存偏好，不得清空', () => {
    // 空陣列在 JavaScript 是 truthy，用 `||` 合併會把已儲存偏好整個蓋掉。
    // 前端每次都送出本地建的空 blockedPeriods，這曾讓使用者的封鎖時段被靜默丟棄。
    const merged = buildScheduleConstraints({
      preferredKeywords: [],
      blockedPeriods: [],
      mustTakeCourseIds: [],
    }, saved);

    assert.deepEqual(merged.preferredKeywords, ['網路', '資安']);
    assert.equal(merged.blockedPeriods.length, 1);
    assert.deepEqual(merged.mustTakeCourseIds, [7]);
  });

  test('S12 送非空陣列時覆蓋已儲存偏好', () => {
    const merged = buildScheduleConstraints({ preferredKeywords: ['AI'] }, saved);

    assert.deepEqual(merged.preferredKeywords, ['AI']);
  });

  test('兩邊都沒有時回傳空陣列而非 undefined', () => {
    const merged = buildScheduleConstraints({}, {});

    assert.deepEqual(merged.preferredKeywords, []);
    assert.deepEqual(merged.blockedPeriods, []);
  });
});

describe('修課歷史只由 profile 直通', () => {
  test('courseHistory 直接取自 prefs，不接受 request 覆蓋', () => {
    const savedHistory = [
      { courseCode: 'IECS3002', passed: true },
      { courseCode: 'IECS3003', passed: false },
    ];
    const requestHistory = [{ courseCode: 'FAKE0001', passed: true }];

    const merged = buildScheduleConstraints(
      { courseHistory: requestHistory },
      { courseHistory: savedHistory }
    );

    assert.strictEqual(merged.courseHistory, savedHistory);
    assert.notStrictEqual(merged.courseHistory, requestHistory);
  });

  test('prefs 未提供 courseHistory 時回傳空陣列', () => {
    const merged = buildScheduleConstraints(
      { courseHistory: [{ courseCode: 'FAKE0001', passed: true }] },
      {}
    );

    assert.deepEqual(merged.courseHistory, []);
  });
});

describe('布林型偏好的合併語意', () => {
  test('false 是有效值，會覆蓋已儲存偏好', () => {
    const merged = buildScheduleConstraints(
      { noMorningClasses: false },
      { noMorningClasses: true }
    );

    assert.equal(merged.noMorningClasses, false);
  });

  test('未提供時退回已儲存偏好', () => {
    const merged = buildScheduleConstraints({}, { noMorningClasses: true });

    assert.equal(merged.noMorningClasses, true);
  });
});

describe('S15 mondayFree 展開', () => {
  test('展開為週一第 1-14 節封鎖', () => {
    const merged = buildScheduleConstraints({ mondayFree: true }, {});
    const monday = merged.blockedPeriods.filter(item => item.day === 1);

    assert.equal(monday.length, 14);
  });

  test('與已儲存的封鎖時段合併而非取代', () => {
    const merged = buildScheduleConstraints(
      { mondayFree: true },
      { blockedPeriods: [{ day: 3, period: 5 }] }
    );

    assert.equal(merged.blockedPeriods.length, 15);
    assert.ok(merged.blockedPeriods.some(item => item.day === 3 && item.period === 5));
  });
});

describe('本次操作狀態不從已儲存偏好回填', () => {
  test('selectedCourseIds 與 watchingCourseIds 只取 request', () => {
    const merged = buildScheduleConstraints({}, {
      selectedCourseIds: [1, 2],
      watchingCourseIds: [3],
    });

    assert.deepEqual(merged.selectedCourseIds, []);
    assert.deepEqual(merged.watchingCourseIds, []);
  });
});
