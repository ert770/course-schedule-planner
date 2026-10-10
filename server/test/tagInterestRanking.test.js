import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTagInterestContext,
  DEFAULT_TAG_INTEREST_COURSE_ALPHA,
  resolveTagInterestRankingMode,
  scoreCandidateWithTagInterest,
} from '../src/skills/tagInterestRanking.js';
import {
  interestTagAliases,
  interestTagCatalog,
  resolveInterestTags,
} from '../src/data/interestTagCatalog.js';

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

describe('tag-interest request context', () => {
  const eligibleTag = interestTagCatalog.canonicalTags.find(tag => (
    tag.eligibility?.crossCourseMatchEligible === true
    && tag.categoryAssignments?.some(assignment => assignment.sourceRows?.[0]?.rawTag)
  ));
  const rawTag = eligibleTag.categoryAssignments
    .flatMap(assignment => assignment.sourceRows ?? [])
    .find(source => source.rawTag)?.rawTag;

  test('builds section-keyed scores from canonical eligible tags and includes versions/source', () => {
    const profile = {
      modelVersion: 'rag-tag-interest-v1',
      catalogVersion: 'catalog-test',
      eligibilityVersion: 'eligibility-test',
      tagInterests: [{
        canonicalTagId: eligibleTag.id,
        canonicalName: eligibleTag.name,
        score: 0.8,
        prior: 0,
        hasEvidence: true,
      }],
    };
    const context = buildTagInterestContext({
      mode: 'shadow',
      profileSource: 'consented-learned',
      profile,
      candidates: [
        { id: 101, ragTag: [rawTag, rawTag] },
        { sectionId: 102, ragTag: ['unmapped-test-tag'] },
        { ragTag: [rawTag] },
      ],
    });

    assert.equal(context.mode, 'shadow');
    assert.equal(context.profileSource, 'consented-learned');
    assert.equal(context.modelVersion, 'rag-tag-interest-v1');
    assert.equal(context.catalogVersion, 'catalog-test');
    assert.equal(context.eligibilityVersion, 'eligibility-test');
    assert.equal(context.coursesBySectionId['101'].score, 0.8);
    assert.equal(context.coursesBySectionId['101'].eligibleTagCount, 1);
    assert.equal(context.coursesBySectionId['101'].evidenceTagCount, 1);
    assert.equal(context.coursesBySectionId['102'].score, null);
    assert.equal(context.coursesBySectionId['102'].reason, 'no_cross_course_match_tags');
    assert.deepEqual(Object.keys(context.coursesBySectionId), ['101', '102']);
  });

  test('marks eligible tags without profile evidence as neutral rather than negative', () => {
    const context = buildTagInterestContext({
      profileSource: 'explicit-prior',
      profile: { tagInterests: [] },
      candidates: [{ id: 201, ragTag: [rawTag] }],
    });

    assert.equal(context.coursesBySectionId['201'].score, 0);
    assert.equal(context.coursesBySectionId['201'].reason, 'no_user_signal');
  });

  test('approved aliases collapse to one canonical tag before averaging', () => {
    const aliasEntry = Object.keys(interestTagAliases.aliases).map(alias => ({
      alias,
      tag: resolveInterestTags([alias]).tags[0],
    })).find(item => item.tag?.eligibility?.crossCourseMatchEligible === true);
    assert.ok(aliasEntry, 'fixture catalog should contain an approved cross-course alias');

    const profile = {
      tagInterests: [{
        canonicalTagId: aliasEntry.tag.canonicalTagId,
        canonicalName: aliasEntry.tag.canonicalName,
        score: -0.4,
        prior: 0,
        hasEvidence: true,
      }],
    };
    const context = buildTagInterestContext({
      profileSource: 'consented-learned',
      profile,
      candidates: [{
        id: 202,
        ragTag: [aliasEntry.alias, aliasEntry.tag.canonicalName],
      }],
    });

    assert.equal(context.coursesBySectionId['202'].eligibleTagCount, 1);
    assert.equal(context.coursesBySectionId['202'].score, -0.4);
  });

  test('single-course-only labels do not create cross-course scores', () => {
    const singleCourseTag = interestTagCatalog.canonicalTags.find(tag => (
      tag.eligibility?.crossCourseMatchEligible === false
      && tag.categoryAssignments?.some(assignment => assignment.sourceRows?.[0]?.rawTag)
    ));
    assert.ok(singleCourseTag, 'fixture catalog should contain single-course-only tags');
    const singleRawTag = singleCourseTag.categoryAssignments
      .flatMap(assignment => assignment.sourceRows ?? [])
      .find(source => source.rawTag)?.rawTag;
    const context = buildTagInterestContext({
      profileSource: 'explicit-prior',
      profile: { tagInterests: [] },
      candidates: [{ id: 203, ragTag: [singleRawTag] }],
    });

    assert.equal(context.coursesBySectionId['203'].score, null);
    assert.equal(context.coursesBySectionId['203'].eligibleTagCount, 0);
    assert.equal(context.coursesBySectionId['203'].reason, 'no_cross_course_match_tags');
  });

  test('returns unavailable scores when profile loading failed', () => {
    const context = buildTagInterestContext({
      profileSource: 'unavailable',
      profile: null,
      candidates: [{ id: 301, ragTag: [rawTag] }],
    });

    assert.equal(context.profileSource, 'unavailable');
    assert.equal(context.coursesBySectionId['301'].score, null);
    assert.equal(context.coursesBySectionId['301'].reason, 'profile_unavailable');
  });

  test('off is the default and shadow/active are explicit modes', () => {
    assert.equal(resolveTagInterestRankingMode(), 'off');
    assert.equal(resolveTagInterestRankingMode('shadow'), 'shadow');
    assert.equal(resolveTagInterestRankingMode('active'), 'active');
    const context = buildTagInterestContext({ mode: 'off', profile: { tagInterests: [] } });
    assert.deepEqual(context.coursesBySectionId, {});
  });

  test('active builds the same server-owned per-section tag scores as shadow', () => {
    const context = buildTagInterestContext({
      mode: 'active',
      profileSource: 'consented-learned',
      profile: {
        tagInterests: [{
          canonicalTagId: eligibleTag.id,
          canonicalName: eligibleTag.name,
          score: 0.6,
          prior: 0,
          hasEvidence: true,
        }],
      },
      candidates: [{ id: 204, ragTag: [rawTag] }],
    });

    assert.equal(context.mode, 'active');
    assert.equal(context.coursesBySectionId['204'].score, 0.6);
  });
});
