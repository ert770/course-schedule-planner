import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveScoringPolicy } from '../src/skills/scoringPolicy.js';
import { buildDiverseArchetypes, buildPlanStrategies } from '../src/skills/planStrategies.js';

test('#7 strategies are deterministic, preserve directions and do not mutate the original', () => {
  const policy = resolveScoringPolicy({ interests: ['安全'], preferCompact: true,
    preferChallengingCourses: true, learnedPreference: { applied: true, boosts: { easy: 1 } } });
  const snapshot = structuredClone(policy);
  const strategies = buildPlanStrategies(policy);
  assert.deepEqual(strategies, buildPlanStrategies(policy));
  assert.deepEqual(policy, snapshot);
  assert.equal(strategies.length, 1);
  for (const strategy of strategies) {
    for (const axis of ['interest', 'compact', 'easy']) {
      assert.equal(Math.sign(strategy.scoringPolicy.weights[axis]), Math.sign(policy.weights[axis]));
      assert.ok(Math.abs(strategy.scoringPolicy.weights[axis]) <= 3);
    }
  }
});

test('#7 cold start does not invent interests, difficulty direction or compact preference', () => {
  const strategies = buildPlanStrategies(resolveScoringPolicy());
  assert.equal(strategies.length, 1);
  for (const strategy of strategies) assert.deepEqual(strategy.scoringPolicy.weights, { interest: 0, compact: 0, easy: 0 });
  assert.equal(strategies[0].stopWhen, 'no-credit-progress');
});

test('#10 MILP 主軸固定為難度、興趣與集中，挑戰偏好只翻轉難度方向', () => {
  assert.deepEqual(buildDiverseArchetypes().map(item => item.archetype), ['easy', 'interest', 'compact']);
  assert.deepEqual(
    buildDiverseArchetypes('challenge').map(item => item.archetype),
    ['challenge', 'interest', 'compact']
  );
});
