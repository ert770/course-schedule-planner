import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AXIS_DEFINITIONS,
  buildAxisConditions,
  buildConditions,
  runAxisSweep,
  runExperimentSuite,
  runPersonalizationCase,
} from '../src/skills/personalizationExperiment.js';
import { buildCounterfactuals } from '../src/skills/planComparison.js';
import { generateSchedule } from '../src/skills/scheduler.js';

const fixturePath = path.join(process.cwd(), 'test', 'fixtures', 'personalizationCases.json');
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const widePool = fixture.cases[0];

test('PB0 fixture has a wide enough candidate pool for comparison', () => {
  const result = runPersonalizationCase(widePool, widePool.personas[0]);
  assert.equal(widePool.candidateCourses.length, 12);
  assert.ok(result.runs.B1.planDiversity.distinctPlans >= 2);
  assert.equal(result.runs.B1.planDiversity.competablePoolSize, 12);
});

test('PB1/PB2 B0, B1 and P keep hard constraints and a fixed candidate set', () => {
  const { B0, B1, P } = buildConditions(widePool, widePool.personas[0]);
  for (const condition of [B0, B1, P]) {
    assert.equal(condition.seed, widePool.baseConstraints.seed);
    assert.equal(condition.timeoutMs, widePool.baseConstraints.timeoutMs);
    assert.equal(condition.className, widePool.baseConstraints.className);
    assert.deepEqual(condition.courseReviews, widePool.reviews);
  }
  assert.equal(B0.interests, undefined);
  assert.equal(B0.preferChallengingCourses, undefined);
  assert.equal(B1.learnedPreference.applied, false);
  assert.equal(P.learnedPreference.applied, true);
});

test('PB3/PB4 learned weights are reproducible and cold start is disabled', () => {
  const persona = widePool.personas[1];
  const first = runPersonalizationCase(widePool, persona);
  const second = runPersonalizationCase(widePool, persona);
  assert.deepEqual(first.learning.boosts, second.learning.boosts);
  assert.deepEqual(first.runs.P.primaryPlan.schedule.map(course => course.id), second.runs.P.primaryPlan.schedule.map(course => course.id));

  const cold = runPersonalizationCase(widePool, widePool.personas[2]);
  assert.equal(cold.learning.applied, false);
  assert.deepEqual(
    cold.runs.B1.primaryPlan.schedule.map(course => course.id),
    cold.runs.P.primaryPlan.schedule.map(course => course.id),
  );
});

test('PB12 cold-start keeps P exactly equal to B1', () => {
  const result = runPersonalizationCase(widePool, widePool.personas[2]);
  assert.equal(result.learning.applied, false);
  assert.deepEqual(
    result.runs.B1.primaryPlan.schedule.map(course => course.id),
    result.runs.P.primaryPlan.schedule.map(course => course.id),
  );
  assert.equal(result.comparisons.B1_to_P.utilityDelta, 0);
});

test('PB5 same-ruler comparisons expose utility and safety deltas', () => {
  const result = runPersonalizationCase(widePool, widePool.personas[1]);
  assert.deepEqual(result.runs.B1.evaluationProfile, result.runs.P.evaluationProfile);
  assert.equal(result.runs.B1.allPlansSafe, true);
  assert.equal(result.runs.P.allPlansSafe, true);
  assert.ok(Number.isFinite(result.comparisons.B1_to_P.utilityDelta));
});

test('PB6/PB7 persona suite reports all safety checks', () => {
  const suite = runExperimentSuite(fixture.cases);
  assert.equal(suite.total, 3);
  assert.equal(suite.failed, 0);
  for (const detail of suite.details) {
    assert.equal(detail.runs.B0.allPlansSafe, true);
    assert.equal(detail.runs.B1.allPlansSafe, true);
    assert.equal(detail.runs.P.allPlansSafe, true);
  }
});

test('PB8-PB10 preference sensitivity sweeps are fixed-pool and measurable', () => {
  assert.deepEqual(AXIS_DEFINITIONS.map(axis => axis.id), [
    'interest', 'compact', 'easy', 'avoid-time', 'review-priority',
  ]);
  for (const axis of AXIS_DEFINITIONS) {
    const conditions = buildAxisConditions(widePool, axis.id);
    const sweep = runAxisSweep(widePool, axis.id);
    assert.equal(conditions.off.seed, widePool.baseConstraints.seed);
    assert.equal(conditions.on.seed, widePool.baseConstraints.seed);
    assert.equal(sweep.off.allPlansSafe, true);
    assert.equal(sweep.on.allPlansSafe, true);
    assert.ok(sweep.off.planDiversity.competablePoolSize >= 10);
    assert.ok(Number.isFinite(sweep.comparison.utilityDelta));
  }
});

test('PB11 compact sweep agrees with buildCounterfactuals on the same carrier', () => {
  const sweep = runAxisSweep(widePool, 'compact');
  const constraints = {
    ...widePool.baseConstraints,
    interests: undefined,
    preferredKeywords: undefined,
    preferredTrack: undefined,
    preferCompact: true,
    preferChallengingCourses: true,
    courseReviews: widePool.reviews,
  };
  const counterfactual = buildCounterfactuals(widePool.candidateCourses, constraints, {
    preferences: [{ preferenceId: 'preferCompact', label: '盡量集中排課' }],
  });
  const compact = counterfactual.counterfactuals[0];
  const expectedOn = generateSchedule(widePool.candidateCourses, constraints).plans[0];
  const expectedOff = generateSchedule(widePool.candidateCourses, { ...constraints, preferCompact: false }).plans[0];
  assert.deepEqual(sweep.on.primaryPlan.schedule.map(course => course.id), expectedOn.schedule.map(course => course.id));
  assert.deepEqual(sweep.off.primaryPlan.schedule.map(course => course.id), expectedOff.schedule.map(course => course.id));
  if (compact.status === 'changed') {
    assert.equal(sweep.comparison.ranking.changed, true);
  } else {
    assert.equal(sweep.comparison.ranking.changed, false);
  }
});

test('PB12 review-priority sweep keeps the course pool but changes evidence coverage', () => {
  const sweep = runAxisSweep(widePool, 'review-priority');
  assert.equal(sweep.off.reviewCoverage.ratio, 0);
  assert.equal(sweep.on.reviewCoverage.ratio, 1);
  assert.equal(sweep.off.planDiversity.competablePoolSize, sweep.on.planDiversity.competablePoolSize);
});
