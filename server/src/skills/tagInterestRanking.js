import {
  TAG_INTEREST_MODEL_VERSION,
  scoreCourseTagInterest,
} from './tagInterestLearning.js';

export const DEFAULT_TAG_INTEREST_COURSE_ALPHA = 0.6;

const ADDITIVE_SCORE_FIELDS = Object.freeze([
  'creditScore',
  'textPreferenceMatchScore',
  'legacyInterestKeywordScore',
  'compactPreferenceScore',
  'easePreferenceScore',
]);

function requireFiniteNumber(name, value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${name} 必須是有限數字`);
  }
  return value;
}

function requireRange(name, value, min, max) {
  const number = requireFiniteNumber(name, value);
  if (number < min || number > max) {
    throw new RangeError(`${name} 必須介於 ${min}～${max}`);
  }
  return number;
}

/**
 * Stage 6 currently supports a no-op `shadow` data path only. `active` is
 * deliberately treated as `off` until candidate-pool scoring is integrated.
 */
export function resolveTagInterestRankingMode(value = 'off') {
  return String(value ?? '').trim().toLowerCase() === 'shadow' ? 'shadow' : 'off';
}

/** Build a server-owned per-section score map for one schedule request. */
export function buildTagInterestContext({
  mode = 'shadow',
  profileSource = 'unavailable',
  profile = null,
  candidates = [],
} = {}) {
  const resolvedMode = resolveTagInterestRankingMode(mode);
  const allowedSources = new Set(['consented-learned', 'explicit-prior', 'unavailable']);
  let resolvedSource = allowedSources.has(profileSource) ? profileSource : 'unavailable';
  if (!profile || !Array.isArray(profile.tagInterests)) resolvedSource = 'unavailable';

  const coursesBySectionId = {};
  if (resolvedMode === 'shadow') {
    for (const course of Array.isArray(candidates) ? candidates : []) {
      const sectionId = String(course?.sectionId ?? course?.id ?? '').trim();
      if (!sectionId || Object.hasOwn(coursesBySectionId, sectionId)) continue;

      const scored = scoreCourseTagInterest(profile ?? { tagInterests: [] }, course?.ragTag ?? []);
      const unavailable = resolvedSource === 'unavailable';
      const reason = scored.eligibleTagCount === 0
        ? scored.reason
        : unavailable
          ? 'profile_unavailable'
          : scored.evidenceTagCount === 0
            ? 'no_user_signal'
            : 'scored';

      coursesBySectionId[sectionId] = {
        score: unavailable ? null : scored.score,
        eligibleTagCount: scored.eligibleTagCount,
        evidenceTagCount: unavailable ? 0 : scored.evidenceTagCount,
        matchedTags: unavailable ? [] : scored.matchedTags,
        reason,
      };
    }
  }

  return {
    mode: resolvedMode,
    modelVersion: profile && resolvedSource !== 'unavailable'
      ? profile.modelVersion ?? TAG_INTEREST_MODEL_VERSION
      : TAG_INTEREST_MODEL_VERSION,
    catalogVersion: resolvedSource === 'unavailable' ? null : profile.catalogVersion ?? null,
    eligibilityVersion: resolvedSource === 'unavailable' ? null : profile.eligibilityVersion ?? null,
    profileSource: resolvedSource,
    coursesBySectionId,
  };
}

/**
 * 計算同一候選池內的單課分數。
 *
 * 標籤興趣只乘在非負的池內基礎分；學分、文字偏好、舊興趣關鍵字、
 * 集中與難易分數維持獨立加總，避免把結構性優先規則一起乘進去。
 */
export function scoreCandidateWithTagInterest({
  poolBaseScore,
  courseTagScore = null,
  alphaCourse = DEFAULT_TAG_INTEREST_COURSE_ALPHA,
  creditScore = 0,
  textPreferenceMatchScore = 0,
  legacyInterestKeywordScore = 0,
  compactPreferenceScore = 0,
  easePreferenceScore = 0,
} = {}) {
  const baseScore = requireFiniteNumber('poolBaseScore', poolBaseScore);
  if (baseScore < 0) {
    throw new RangeError('poolBaseScore 不得小於 0');
  }

  const alpha = requireRange('alphaCourse', alphaCourse, 0, 1);
  const tagScore = courseTagScore === null
    ? null
    : requireRange('courseTagScore', courseTagScore, -1, 1);

  const additiveScores = {
    creditScore: requireFiniteNumber('creditScore', creditScore),
    textPreferenceMatchScore: requireFiniteNumber('textPreferenceMatchScore', textPreferenceMatchScore),
    legacyInterestKeywordScore: requireFiniteNumber('legacyInterestKeywordScore', legacyInterestKeywordScore),
    compactPreferenceScore: requireFiniteNumber('compactPreferenceScore', compactPreferenceScore),
    easePreferenceScore: requireFiniteNumber('easePreferenceScore', easePreferenceScore),
  };

  const courseTagMultiplier = tagScore === null ? 1 : 1 + alpha * tagScore;
  const tagAdjustedBaseScore = baseScore * courseTagMultiplier;
  const candidateScore = tagAdjustedBaseScore
    + ADDITIVE_SCORE_FIELDS.reduce((sum, field) => sum + additiveScores[field], 0);

  return {
    poolBaseScore: baseScore,
    courseTagScore: tagScore,
    alphaCourse: alpha,
    courseTagMultiplier,
    tagAdjustedBaseScore,
    ...additiveScores,
    candidateScore,
  };
}

export default {
  DEFAULT_TAG_INTEREST_COURSE_ALPHA,
  resolveTagInterestRankingMode,
  buildTagInterestContext,
  scoreCandidateWithTagInterest,
};
