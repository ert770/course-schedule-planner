import test from 'node:test';
import assert from 'node:assert/strict';

import { checkMilpPlan } from '../src/skills/optimization/milpPlanChecks.js';

const course = (id, code, extra = {}) => ({
  id, catalogCourseCode: code, name: code, credits: 3,
  timeBlocks: [{ dayOfWeek: id, startPeriod: 1, endPeriod: 2 }], ...extra,
});

function inputs(overrides = {}) {
  return {
    minCredits: 3, maxCredits: 9, maxCoursesPerDay: 2,
    fixedSchedule: [course(1, 'FIX')], fixedUnscheduled: [], explicitIds: [],
    competitive: [
      { course: course(2, 'A'), seriesKey: '系列' },
      { course: course(3, 'B'), seriesKey: '系列' },
    ],
    internships: [], basePlan: { totalCredits: 6 }, ...overrides,
  };
}

test('milpPlanChecks：合法方案同時通過學分對齊與固定班次', () => {
  assert.equal(checkMilpPlan([course(1, 'FIX'), course(2, 'A')], inputs()).valid, true);
});

test('milpPlanChecks：逐項攔下固定班次、重複課號、系列與每日上限', () => {
  const duplicateA = course(4, 'A', { timeBlocks: [{ dayOfWeek: 2, startPeriod: 3, endPeriod: 4 }] });
  const sameDay = course(5, 'C', { timeBlocks: [{ dayOfWeek: 2, startPeriod: 5, endPeriod: 6 }] });
  const result = checkMilpPlan(
    [course(2, 'A'), duplicateA, course(3, 'B'), sameDay],
    inputs({ maxCoursesPerDay: 2 }),
    { creditTarget: 15 }
  );
  const ids = new Set(result.violations.map(item => item.constraintId));
  assert.ok(ids.has('FIXED_SECTION_COVERAGE'));
  assert.ok(ids.has('ONE_SECTION_PER_COURSE'));
  assert.ok(ids.has('COURSE_SERIES'));
  assert.ok(ids.has('DAILY_COURSE_CAP'));
  assert.ok(ids.has('CREDIT_PARITY'));
});

test('milpPlanChecks：共同必修缺任一側都會失敗', () => {
  const regular = course(2, 'R', { corequisiteRole: 'regular', corequisiteCode: 'P' });
  const result = checkMilpPlan([course(1, 'FIX'), regular], inputs({ competitive: [] }));
  assert.ok(result.violations.some(item => item.constraintId === 'COREQUISITE'));
});

test('milpPlanChecks：跨年級與系外門數必須和 S₀ 的階層配額一致', () => {
  const crossYear = course(2, 'CROSS');
  const outside = course(3, 'OUTSIDE');
  const scopedInputs = inputs({
    competitive: [
      { course: crossYear, courseKey: 'code:CROSS', scoreComponents: { crossYearElective: -2500 } },
      { course: outside, courseKey: 'code:OUTSIDE', scoreComponents: { outsideOwnDepartment: -5000 } },
    ],
  });
  const pass = checkMilpPlan(
    [course(1, 'FIX'), crossYear, outside],
    scopedInputs,
    { hierarchyTargets: { 'cross-year': 1, outside: 1 } }
  );
  assert.equal(pass.valid, true);
  assert.deepEqual(pass.hierarchyCounts, { 'cross-year': 1, outside: 1 });

  const fail = checkMilpPlan(
    [course(1, 'FIX'), outside],
    scopedInputs,
    { hierarchyTargets: { 'cross-year': 1, outside: 1 } }
  );
  assert.ok(fail.violations.some(item => item.constraintId === 'HIERARCHY_PARITY'));
});
