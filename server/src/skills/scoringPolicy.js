// Roadmap #7：排課生成與推薦理由共用同一份版本化、有限範圍的評分規則。
export const SCORING_POLICY_VERSION = 'personalized-scoring-v1';
export const PREFERENCE_AXES = Object.freeze(['interest', 'compact', 'easy']);
export const PREFERENCE_SCALE = 240;

const clamp = (value, min, max) => Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : 0;
const list = value => !value ? [] : Array.isArray(value) ? value : [value];

// roadmap #5B：難度**方向**。事件 schema 的 `feedbackReason` 只有 `workload`
// （太重），沒有任何欄位能表達「太簡單、我要更難」——方向因此永遠不從行為
// 推論，只能由使用者自己勾的兩個標籤決定（見 `data/preferenceTags.js`）。
//
// 兩個都勾是使用者自己的條件互相矛盾，這裡不猜哪一個才是真的：一律視為
// 未表態並在 `generateSchedule()` 的 warnings 說出來。刻意不在儲存層做
// 互斥（`preferenceTags.js` 沒有把兩個標籤設計成單選）——那會靜默丟掉
// 使用者真的存過的標籤，是「偏好靜默消失」那一類 bug，比顯示一句警告更糟。
//
// **只有這一份實作**：`scheduler.js` 的 warnings 判定與這裡的 `resolveScoringPolicy()`
// 都呼叫同一個函式，不是各自重寫一份「兩個都勾 = 0」的邏輯——那正是本專案自己反覆
// 記取過的「兩條路徑看起來一樣，其中一條之後默默漏掉一個條件」那種 bug。
export const EASY_DIRECTION = Object.freeze({
  EASY: 'easy', CHALLENGE: 'challenge', NONE: 'none', CONTRADICTORY: 'contradictory',
});

export function resolveEasyDirection(constraints) {
  const wantsEasy = Boolean(constraints.preferEasyCourses ?? constraints.preferEasy);
  const wantsChallenge = Boolean(constraints.preferChallengingCourses);
  if (wantsEasy && wantsChallenge) return { direction: 0, label: EASY_DIRECTION.CONTRADICTORY };
  if (wantsEasy) return { direction: 1, label: EASY_DIRECTION.EASY };
  if (wantsChallenge) return { direction: -1, label: EASY_DIRECTION.CHALLENGE };
  return { direction: 0, label: EASY_DIRECTION.NONE };
}

export function resolveScoringPolicy(constraints = {}) {
  const directions = {
    interest: [...list(constraints.preferredKeywords), ...list(constraints.interests), constraints.preferredTrack]
      .filter(Boolean).length > 0 ? 1 : 0,
    compact: constraints.preferCompact ? 1 : 0,
    easy: resolveEasyDirection(constraints).direction,
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
