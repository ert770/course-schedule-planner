import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_TAG_INTEREST_COURSE_ALPHA,
  scoreCandidateWithTagInterest,
} from '../src/skills/tagInterestRanking.js';

function assertClose(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} should be close to ${expected}`);
}

describe('tag-interest candidate score', () => {
  test('uses alpha 0.6 and applies equal positive and negative percentages', () => {
    const positive = scoreCandidateWithTagInterest({
      poolBaseScore: 40,
      courseTagScore: 0.8,
    });
    const neutral = scoreCandidateWithTagInterest({
      poolBaseScore: 40,
      courseTagScore: 0,
    });
    const negative = scoreCandidateWithTagInterest({
      poolBaseScore: 40,
      courseTagScore: -0.8,
    });

    assert.equal(DEFAULT_TAG_INTEREST_COURSE_ALPHA, 0.6);
    assert.equal(positive.alphaCourse, 0.6);
    assert.equal(positive.courseTagMultiplier, 1.48);
    assert.equal(neutral.courseTagMultiplier, 1);
    assert.equal(negative.courseTagMultiplier, 0.52);
    assertClose(positive.candidateScore, 59.2);
    assert.equal(neutral.candidateScore, 40);
    assertClose(negative.candidateScore, 20.8);
    assertClose(positive.courseTagMultiplier + negative.courseTagMultiplier, 2);
  });

  test('adds each non-tag score component once after adjusting the pool base score', () => {
    const result = scoreCandidateWithTagInterest({
      poolBaseScore: 40,
      courseTagScore: 0.8,
      creditScore: 1,
      textPreferenceMatchScore: 2,
      legacyInterestKeywordScore: 3,
      compactPreferenceScore: 4,
      easePreferenceScore: 5,
    });

    assertClose(result.tagAdjustedBaseScore, 59.2);
    assert.equal(result.creditScore, 1);
    assert.equal(result.textPreferenceMatchScore, 2);
    assert.equal(result.legacyInterestKeywordScore, 3);
    assert.equal(result.compactPreferenceScore, 4);
    assert.equal(result.easePreferenceScore, 5);
    assertClose(result.candidateScore, 74.2);
  });

  test('treats null and zero tag scores as neutral multipliers', () => {
    const withoutEligibleTags = scoreCandidateWithTagInterest({
      poolBaseScore: 25,
      courseTagScore: null,
    });
    const noUserSignal = scoreCandidateWithTagInterest({
      poolBaseScore: 25,
      courseTagScore: 0,
    });

    assert.equal(withoutEligibleTags.courseTagScore, null);
    assert.equal(withoutEligibleTags.courseTagMultiplier, 1);
    assert.equal(noUserSignal.courseTagMultiplier, 1);
    assert.equal(withoutEligibleTags.candidateScore, 25);
    assert.equal(noUserSignal.candidateScore, 25);
  });

  test('supports disabled and boundary alpha settings without a negative multiplier', () => {
    const disabled = scoreCandidateWithTagInterest({
      poolBaseScore: 40,
      courseTagScore: 1,
      alphaCourse: 0,
    });
    const maxPositive = scoreCandidateWithTagInterest({
      poolBaseScore: 40,
      courseTagScore: 1,
      alphaCourse: 1,
    });
    const maxNegative = scoreCandidateWithTagInterest({
      poolBaseScore: 40,
      courseTagScore: -1,
      alphaCourse: 1,
    });

    assert.equal(disabled.courseTagMultiplier, 1);
    assert.equal(disabled.candidateScore, 40);
    assert.equal(maxPositive.courseTagMultiplier, 2);
    assert.equal(maxNegative.courseTagMultiplier, 0);
    assert.equal(maxNegative.candidateScore, 0);
  });

  test('rejects invalid base, tag, alpha, and additive scores', () => {
    assert.throws(() => scoreCandidateWithTagInterest({ poolBaseScore: -1 }), /不得小於/u);
    assert.throws(() => scoreCandidateWithTagInterest({ poolBaseScore: 1, courseTagScore: 1.1 }), /介於/u);
    assert.throws(() => scoreCandidateWithTagInterest({ poolBaseScore: 1, alphaCourse: 1.1 }), /介於/u);
    assert.throws(() => scoreCandidateWithTagInterest({ poolBaseScore: 1, creditScore: Number.NaN }), /有限數字/u);
  });
});
