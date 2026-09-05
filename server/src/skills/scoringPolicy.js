// Roadmap #7：排課生成與推薦理由共用同一份版本化、有限範圍的評分規則。
export const SCORING_POLICY_VERSION = 'personalized-scoring-v1';
export const PREFERENCE_AXES = Object.freeze(['interest', 'compact', 'easy']);
export const PREFERENCE_SCALE = 240;

const clamp = (value, min, max) => Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : 0;
const list = value => !value ? [] : Array.isArray(value) ? value : [value];

export function resolveScoringPolicy(constraints = {}) {
  const easy = Boolean(constraints.preferEasyCourses ?? constraints.preferEasy);
  const challenge = Boolean(constraints.preferChallengingCourses);
  const directions = {
    interest: [...list(constraints.preferredKeywords), ...list(constraints.interests), constraints.preferredTrack]
      .filter(Boolean).length > 0 ? 1 : 0,
    compact: constraints.preferCompact ? 1 : 0,
    easy: easy === challenge ? 0 : easy ? 1 : -1,
  };
  const learned = constraints.learnedPreference;
  const weights = Object.fromEntries(PREFERENCE_AXES.map(axis => [axis,
    directions[axis] * (1 + (learned?.applied === true ? clamp(Number(learned.boosts?.[axis]), 0, 1) : 0)),
  ]));
  return {
    version: SCORING_POLICY_VERSION,
    weights,
    categoryCoefficient: Object.values(weights).some(Boolean) ? 0.35 : 1,
    creditCoefficient: 1,
    source: {
      learnedApplied: learned?.applied === true,
      reason: learned?.reason ?? 'absent',
      modelVersion: learned?.modelVersion ?? null,
    },
  };
}

// 興趣、涼度先正規化到固定量尺；集中度則是加入一門課後的有限增量訊號。
// 缺少難易度證據時沿用既有母體先驗，不把「沒有資料」冒充成評價。
export function normalizeCourseFeatures({ interestHits = 0, interestCount = 0,
  easiness = null, neutralEasiness = 50, easyMax = 100, overlappingDays = 0, courseDays = 0 } = {}) {
  return {
    interest: interestCount > 0 ? clamp(interestHits / interestCount, 0, 1) : 0,
    easy: clamp((easiness ?? neutralEasiness) / easyMax, 0, 1) - 0.5,
    compact: courseDays > 0
      ? (overlappingDays > 0 ? clamp(overlappingDays / courseDays, 0, 1) : -1 / 6) : 0,
  };
}

export function computePreferenceComponents(features, policy) {
  return Object.fromEntries(PREFERENCE_AXES.map(axis => [axis,
    features[axis] * policy.weights[axis] * PREFERENCE_SCALE,
  ]));
}
