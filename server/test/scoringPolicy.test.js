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

// roadmap #10 任務 3B：Choice Perceptron 的帶號權重。只有離線實驗會送出這個模式。
test('#10-3B signed mode uses learned weights directly, clamps to ±2, and can reverse the explicit direction', () => {
  const policy = resolveScoringPolicy({
    preferEasyCourses: true, preferCompact: true,
    learnedPreference: { applied: true, mode: 'signed', weights: { interest: 0.5, compact: -1.2, easy: -9 } },
  });
  // 顯式勾了集中與輕鬆，學到的卻是相反方向：帶號模式照學到的用。
  assert.deepEqual(policy.weights, { interest: 0.5, compact: -1.2, easy: -2 });
  assert.equal(policy.source.mode, 'signed');
  assert.equal(policy.categoryCoefficient, 0.35);
});

test('#10-3B signed mode is ignored unless applied, and never changes the v2 branch', () => {
  const input = { preferCompact: true, preferEasyCourses: true };
  const baseline = resolveScoringPolicy(input);
  // 沒有 applied：退回顯式偏好。
  assert.deepEqual(resolveScoringPolicy({
    ...input, learnedPreference: { applied: false, mode: 'signed', weights: { interest: 2, compact: -2, easy: -2 } },
  }).weights, baseline.weights);
  // v2（boosts）不帶 mode：結果與原本逐位元相同，也不會多出 mode 欄位。
  const v2 = resolveScoringPolicy({ ...input, learnedPreference: { applied: true, boosts: { compact: 0.5, easy: 1 } } });
  assert.deepEqual(v2.weights, { interest: 0, compact: 1.5, easy: 2 });
  assert.equal(Object.hasOwn(v2.source, 'mode'), false);
  // 帶號模式缺 weights：不套用帶號分支。
  assert.deepEqual(resolveScoringPolicy({ ...input, learnedPreference: { applied: true, mode: 'signed' } }).weights, baseline.weights);
  // 非數值的權重視為 0。
  assert.equal(resolveScoringPolicy({
    learnedPreference: { applied: true, mode: 'signed', weights: { interest: 'x', compact: 1, easy: null } },
  }).weights.interest, 0);
});
