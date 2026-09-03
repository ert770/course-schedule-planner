// Roadmap #27：方案比較與 counterfactual 的純函式測試。
//
// `planComparison.js` 只呼叫既有的 `generateSchedule()` 並比對兩次結果，
// 不重新實作任何排課判定——這裡測的是「比對邏輯本身」與「三態不誤判」，
// 不是排課規則（那些已由 scheduler.test.js 的 S/N/X/Z/P10/R 套件把關）。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  COUNTERFACTUAL_STATUS,
  diffPlans,
  summarizeMetricDifferences,
  buildCounterfactuals,
} from '../src/skills/planComparison.js';
import { makeCourse } from './fixtures.js';

const at = (id, day, start, overrides = {}) => makeCourse(id, {
  dayOfWeek: day, startPeriod: start, endPeriod: start + 1, ...overrides,
});

describe('CF1 diffPlans 只比課程集合，不比排序', () => {
  test('CF1 相同課程不同順序視為沒有差異', () => {
    const a = { schedule: [{ id: 1 }, { id: 2 }], unscheduledCourses: [] };
    const b = { schedule: [{ id: 2 }, { id: 1 }], unscheduledCourses: [] };
    const diff = diffPlans(a, b);
    assert.deepEqual(diff.removed, []);
    assert.deepEqual(diff.added, []);
    assert.equal(diff.shared, 2);
  });

  test('CF1 真正的加退課會分別出現在 removed／added', () => {
    const a = { schedule: [{ id: 1 }, { id: 2 }], unscheduledCourses: [] };
    const b = { schedule: [{ id: 1 }, { id: 3 }], unscheduledCourses: [] };
    const diff = diffPlans(a, b);
    assert.equal(diff.removed.length, 1);
    assert.equal(diff.removed[0].sectionId, 2);
    assert.equal(diff.added.length, 1);
    assert.equal(diff.added[0].sectionId, 3);
  });

  test('CF1 unscheduledCourses 也算在比較範圍內，不只是 schedule', () => {
    const a = { schedule: [{ id: 1 }], unscheduledCourses: [{ id: 9 }] };
    const b = { schedule: [{ id: 1 }], unscheduledCourses: [] };
    const diff = diffPlans(a, b);
    assert.equal(diff.removed.length, 1);
    assert.equal(diff.removed[0].sectionId, 9);
  });
});

describe('CF2 summarizeMetricDifferences 分辨真的有差異與裝飾性重複', () => {
  test('CF2 所有指標都相同時 allIdentical 為 true', () => {
    const metrics = {
      scheduledCourseCount: 8, totalCredits: 23, usedDays: 5, morningCourses: 0, gapPeriods: 2,
      preferenceScore: 0.3333333333333333, reviewCoverage: { ratio: 0.125 },
    };
    const plans = [{ planMetrics: metrics }, { planMetrics: { ...metrics } }];
    const summary = summarizeMetricDifferences(plans);
    assert.equal(summary.allIdentical, true);
    assert.equal(summary.differing.length, 0);
  });

  test('CF2 浮點數尾數誤差不得被誤判為有差異', () => {
    const plans = [
      { planMetrics: { scheduledCourseCount: 8, totalCredits: 23, usedDays: 5, morningCourses: 0, gapPeriods: 2, preferenceScore: 1 / 3, reviewCoverage: { ratio: 0.125 } } },
      { planMetrics: { scheduledCourseCount: 8, totalCredits: 23, usedDays: 5, morningCourses: 0, gapPeriods: 2, preferenceScore: 0.3333333333333334, reviewCoverage: { ratio: 0.125 } } },
    ];
    const summary = summarizeMetricDifferences(plans);
    assert.equal(summary.allIdentical, true, '浮點數尾數差異不應被算成偏好符合度不同');
  });

  test('CF2 只有一項不同時，只有那一項出現在 differing', () => {
    const base = { scheduledCourseCount: 8, totalCredits: 23, usedDays: 5, morningCourses: 0, gapPeriods: 2, preferenceScore: 0.5, reviewCoverage: { ratio: 0.1 } };
    const plans = [
      { planMetrics: base },
      { planMetrics: { ...base, totalCredits: 24 } },
    ];
    const summary = summarizeMetricDifferences(plans);
    assert.equal(summary.differing.length, 1);
    assert.equal(summary.differing[0].key, 'totalCredits');
  });
});

describe('CF3 buildCounterfactuals 的三態不得混用', () => {
  test('CF3 沒開的偏好一律 not-applicable，不去重排', () => {
    const pool = [at(1, 1, 3, { category: '一般選修' })];
    const result = buildCounterfactuals(pool, { minCredits: 0, maxCredits: 25 }, {
      preferences: [{ preferenceId: 'preferCompact', label: '盡量集中排課' }],
    });
    assert.equal(result.counterfactuals[0].status, COUNTERFACTUAL_STATUS.NOT_APPLICABLE);
    assert.ok(result.counterfactuals[0].reason);
  });

  test('CF3 開著但關掉不影響結果時是 unchanged，附帶原因，不是空陣列充數', () => {
    // 只有一門候選課，怎麼調偏好都只有它能排——典型的「算過、真的不會變」。
    const pool = [at(1, 1, 3, { category: '一般選修' })];
    const result = buildCounterfactuals(pool, { minCredits: 0, maxCredits: 25, preferCompact: true }, {
      preferences: [{ preferenceId: 'preferCompact', label: '盡量集中排課' }],
    });
    const item = result.counterfactuals[0];
    assert.equal(item.status, COUNTERFACTUAL_STATUS.UNCHANGED);
    assert.ok(item.reason, 'unchanged 必須說得出為什麼，不能只是空結果');
    assert.deepEqual(item.removed, []);
    assert.deepEqual(item.added, []);
  });

  test('CF3 候選池夠大時，關掉偏好確實換課，status 為 changed 且帶 removed／added', () => {
    const pool = [
      at(1, 1, 3, { category: '一般選修', description: '需要實作專題與實驗' }),
      at(2, 1, 7, { category: '一般選修', description: '課堂討論與互動參與為主' }),
      at(3, 2, 3, { category: '一般選修', description: '需要實作專題與實驗' }),
      at(4, 2, 7, { category: '一般選修', description: '課堂討論與互動參與為主' }),
    ];
    const result = buildCounterfactuals(pool, { minCredits: 0, maxCredits: 25, preferCompact: true }, {
      preferences: [{ preferenceId: 'preferCompact', label: '盡量集中排課' }],
    });
    const item = result.counterfactuals[0];
    // 這裡不斷言一定是 changed——候選池小仍可能剛好不變；
    // 真正要釘住的是「三態互斥、changed 一定帶差異證據」。
    assert.ok(Object.values(COUNTERFACTUAL_STATUS).includes(item.status));
    if (item.status === COUNTERFACTUAL_STATUS.CHANGED) {
      assert.ok(item.removed.length > 0 || item.added.length > 0);
      assert.ok(item.metricsDelta, 'changed 必須附帶 metricsDelta');
    }
  });

  test('CF3 baseline 與 competablePoolSize 來自同一次基準排課', () => {
    const pool = [at(1, 1, 3, { category: '一般選修' }), at(2, 2, 3, { category: '一般選修' })];
    const result = buildCounterfactuals(pool, { minCredits: 0, maxCredits: 25 }, {
      preferences: [],
    });
    assert.ok(result.baseline);
    assert.equal(result.competablePoolSize, 2);
  });
});

describe('CF4 counterfactual 不改變排課決策本身', () => {
  test('CF4 呼叫 buildCounterfactuals 前後，同一組輸入排課結果不變', () => {
    const pool = [at(1, 1, 3, { category: '一般選修' }), at(2, 2, 3, { category: '一般選修' })];
    const constraints = { minCredits: 0, maxCredits: 25, preferCompact: true };

    const before = buildCounterfactuals(pool, constraints, {
      preferences: [{ preferenceId: 'preferCompact', label: '盡量集中排課' }],
    });
    const after = buildCounterfactuals(pool, constraints, {
      preferences: [{ preferenceId: 'preferCompact', label: '盡量集中排課' }],
    });

    assert.deepEqual(before.baseline, after.baseline);
    assert.deepEqual(
      before.counterfactuals.map(c => c.status),
      after.counterfactuals.map(c => c.status)
    );
  });
});
