import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveScoringPolicy, normalizeCourseFeatures, computePreferenceComponents } from '../src/skills/scoringPolicy.js';

test('#7 user direction bounds learned strength and ignores inactive axes', () => {
  for (const boost of [-1, 0, 0.4, 1, 999, NaN]) {
    const policy = resolveScoringPolicy({ preferChallengingCourses: true,
      learnedPreference: { applied: true, boosts: { easy: boost, compact: 1 } } });
    assert.ok(policy.weights.easy <= -1 && policy.weights.easy >= -2);
    assert.equal(policy.weights.compact, 0);
  }
  assert.equal(resolveScoringPolicy({ preferEasyCourses: true, preferChallengingCourses: true }).weights.easy, 0);
});

test('#7 unavailable learning falls back exactly to explicit preferences', () => {
  const input = { interests: ['安全'], preferCompact: true, preferEasyCourses: true };
  const baseline = resolveScoringPolicy(input).weights;
  for (const reason of ['no-consent', 'absent', 'insufficient', 'stale-model-version', 'load-failed']) {
    assert.deepEqual(resolveScoringPolicy({ ...input,
      learnedPreference: { applied: false, reason, boosts: { interest: 1, compact: 1, easy: 1 } },
    }).weights, baseline);
  }
});

test('#7 features use bounded scales, unknown ease is neutral, challenge reverses evidence', () => {
  const neutral = normalizeCourseFeatures();
  assert.deepEqual(neutral, { interest: 0, compact: 0, easy: 0 });
  const features = normalizeCourseFeatures({ interestHits: 1, interestCount: 2,
    easiness: 80, overlappingDays: 1, courseDays: 2 });
  const easy = computePreferenceComponents(features, resolveScoringPolicy({ preferEasyCourses: true }));
  const challenge = computePreferenceComponents(features, resolveScoringPolicy({ preferChallengingCourses: true }));
  assert.ok(easy.easy > 0);
  assert.equal(easy.easy, -challenge.easy);
  assert.equal(features.interest, 0.5);
  assert.equal(features.compact, 0.5);
});
