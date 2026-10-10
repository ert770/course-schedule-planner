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
  scoreCandidateWithTagInterest,
};
