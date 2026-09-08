import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertNoSafetyRegression,
  checkDirection,
  compareRuns,
  rankingChange,
  summarizeExperiment,
  summarizeRun,
  utilityUnderProfile,
} from '../src/skills/personalizationMetrics.js';
import { makeCourse, makeEasyReview, makeToughReview } from './fixtures.js';

function plan(ids, overrides = {}) {
  return {
    id: 'personalized',
    schedule: ids.map(id => makeCourse(id, {
      dayOfWeek: id,
      description: id % 2 ? '資訊安全實作' : '一般課程',
    })),
    unscheduledCourses: [],
    ...overrides,
  };
}

test('PN1 rankingChange reports membership, top-K and Kendall changes', () => {
  const base = plan([1, 2, 3]);
  const same = plan([1, 2, 3]);
  const changed = plan([3, 2, 4]);

  assert.equal(rankingChange(base, same).jaccardSimilarity, 1);
  assert.equal(rankingChange(base, same).kendallTau, 1);
  const comparison = rankingChange(base, changed, { topK: 2 });
  assert.equal(comparison.changed, true);
  assert.equal(comparison.jaccardSimilarity, 0.5);
  assert.equal(comparison.topKOverlap, 0.5);
  assert.equal(comparison.kendallTau, -1);
});

test('PN2 utilityUnderProfile uses scheduler preference evaluation', () => {
  const easy = makeCourse(1, { description: '資訊安全與網路防禦' });
  const result = utilityUnderProfile({
    schedule: [easy],
    preferenceBreakdown: { interest: 1, compact: 1, easy: 1 },
  }, {
    interests: ['資訊安全'],
    preferCompact: true,
  });

  assert.deepEqual(result.profile, { interest: 1, compact: 1, easy: 0 });
  assert.equal(result.breakdown.interest, 1);
  assert.equal(result.breakdown.compact, 1);
});

test('PN3 summarizeRun and compareRuns preserve safety and review metrics', () => {
  const courses = [makeCourse(1), makeCourse(2, { dayOfWeek: 2 })];
  const result = {
    success: true,
    plans: [{
      ...plan([1, 2]),
      schedule: courses,
      planMetrics: { usedDays: 2, morningCourses: 2, gapPeriods: 0 },
      reviewCoverage: { rated: 2, total: 2, ratio: 1 },
    }],
    planDiversity: { requestedVariants: 1, distinctPlans: 1 },
  };
  const base = summarizeRun(result, { label: 'B0', constraints: { minCredits: 0, maxCredits: 6 } });
  const variant = summarizeRun({ ...result, plans: [{ ...result.plans[0], schedule: [courses[0]], planMetrics: { usedDays: 1, morningCourses: 1, gapPeriods: 0 } }] }, {
    label: 'P', constraints: { minCredits: 0, maxCredits: 6 },
  });
  assert.equal(base.reviewCoverage.ratio, 1);
  assert.equal(base.allPlansSafe, true);
  assert.equal(compareRuns(base, variant).usedDaysDelta, -1);
  assert.doesNotThrow(() => assertNoSafetyRegression(base, variant));
});

test('PN4 direction checks and safety assertions fail loudly', () => {
  assert.equal(checkDirection({ direction: 'positive', min: 0.1 }, { utilityDelta: 0.2 }).pass, true);
  assert.equal(checkDirection({ direction: 'negative', min: 0.1 }, { utilityDelta: -0.2 }).pass, true);
  assert.equal(checkDirection({ direction: 'positive', min: 0.1 }, { utilityDelta: 0 }).pass, false);
  assert.throws(() => assertNoSafetyRegression(
    { allPlansSafe: true, requiredCovered: null },
    { allPlansSafe: false, requiredCovered: null },
  ), /未通過硬性限制/);
});

test('PN5 review evidence is included in the same evaluation ruler', () => {
  const easyCourse = makeCourse(1, { reviewEvidence: makeEasyReview(1) });
  const toughCourse = makeCourse(2, { dayOfWeek: 2, reviewEvidence: makeToughReview(2) });
  const constraints = {
    preferEasyCourses: true,
    courseReviews: [makeEasyReview(1), makeToughReview(2)],
  };
  const easyScore = utilityUnderProfile({ schedule: [easyCourse] }, constraints).score;
  const toughScore = utilityUnderProfile({ schedule: [toughCourse] }, constraints).score;
  assert.ok(Number.isFinite(easyScore));
  assert.ok(Number.isFinite(toughScore));
});

test('PN6 rankingChange handles empty and one-course boundaries', () => {
  assert.equal(rankingChange(plan([]), plan([])).jaccardSimilarity, 1);
  assert.equal(rankingChange(plan([]), plan([1])).kendallTau, null);
  assert.equal(rankingChange(plan([1]), plan([1])).topKOverlap, 1);
});

test('PN7 summarizeRun handles an empty solver result without inventing utility', () => {
  const summary = summarizeRun({ success: false, plans: [] }, { label: 'empty' });
  assert.equal(summary.success, false);
  assert.equal(summary.preferenceScore, 0);
  assert.equal(summary.allPlansSafe, true);
});

test('PN8 summarizeExperiment reports pass rate without changing row evidence', () => {
  const rows = [{ id: 'a', pass: true }, { id: 'b', pass: false }];
  assert.deepEqual(summarizeExperiment(rows), {
    total: 2, passed: 1, failed: 1, passRate: 0.5, rows,
  });
});
