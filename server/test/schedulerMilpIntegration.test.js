import test from 'node:test';
import assert from 'node:assert/strict';

import { makeCourse } from './fixtures.js';
import { getHighsRuntime } from '../src/skills/optimization/highsRuntime.js';
import { generateSchedule } from '../src/skills/scheduler.js';

function pool() {
  return Array.from({ length: 8 }, (_, index) => makeCourse(index + 1, {
    name: index < 2 ? `一般課程${index + 1}` : `人工智慧專題${index + 1}`,
    catalogCourseCode: `MILP${index + 1}`,
    category: '一般選修',
    credits: 3,
    dayOfWeek: (index % 4) + 1,
    startPeriod: index < 4 ? 2 : 6,
    endPeriod: index < 4 ? 3 : 7,
  }));
}

test('正式接線：S₀ 與 primary-only 相同，推薦識別與排序一致', async () => {
  const courses = pool();
  const constraints = {
    minCredits: 6,
    maxCredits: 6,
    interests: ['人工智慧'],
  };
  const baseline = generateSchedule(courses, constraints, { planSet: 'primary-only' });
  const result = generateSchedule(courses, constraints, {
    highsRuntime: await getHighsRuntime(),
    diverseSolverOptions: { totalBudgetMs: 1000, candidatesPerAxis: 1, minQualityScale: 10_000 },
  });

  const s0 = result.plans.find(plan => plan.id === 'personalized');
  assert.deepEqual(
    s0.schedule.map(course => course.id),
    baseline.plans[0].schedule.map(course => course.id)
  );
  assert.equal(result.recommendedPlanId, result.plans[0].id);
  assert.deepEqual(result.displayOrder, result.plans.map(plan => plan.id));
  assert.ok(result.plans.length >= 2, '應至少保留 S₀ 與一個 MILP 主軸方案');
  for (const plan of result.plans.filter(plan => plan.id !== 'personalized')) {
    assert.ok(plan.comparisonToBaseline.replacementDistance >= 2);
    assert.ok(plan.comparisonToBaseline.qualityRetention >= 0.87);
    assert.equal(plan.milpChecks.model.valid, true);
    assert.equal(plan.milpChecks.validator.valid, true);
  }
});

test('正式接線：未注入 solver 時只回 S₀ 並揭露原因', () => {
  const result = generateSchedule(pool(), { minCredits: 6, maxCredits: 6, interests: ['人工智慧'] });
  assert.equal(result.plans.length, 1);
  assert.equal(result.planDiversity.solver.status, 'solver-unavailable');
  assert.ok(result.warnings.some(message => message.includes('求解器尚未就緒')));
});
