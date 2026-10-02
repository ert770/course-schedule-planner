import { EASY_DIRECTION } from './scoringPolicy.js';

export const PLAN_ARCHETYPES = Object.freeze({
  BALANCED: 'balanced',
  EASY: 'easy',
  CHALLENGE: 'challenge',
  INTEREST: 'interest',
  COMPACT: 'compact',
});

// S₀ 永遠沿用現行 greedy 與使用者自己的 policy；替代方案由 MILP 主軸產生。
export function buildPlanStrategies(policy) {
  return [{
    id: 'personalized',
    archetype: PLAN_ARCHETYPES.BALANCED,
    title: '個人化綜合方案',
    description: '依照你的整體偏好挑選課程，並優先安排必修與重補修。',
    scoringPolicy: { ...policy, archetype: PLAN_ARCHETYPES.BALANCED },
    stopWhen: 'no-credit-progress',
  }];
}

export function buildDiverseArchetypes(easyDirection = EASY_DIRECTION.NONE) {
  const challenge = easyDirection === EASY_DIRECTION.CHALLENGE;
  return [
    {
      archetype: challenge ? PLAN_ARCHETYPES.CHALLENGE : PLAN_ARCHETYPES.EASY,
      id: challenge ? 'personalized_challenge' : 'personalized_easy',
      title: challenge ? '挑戰導向方案' : '輕鬆導向方案',
      description: challenge
        ? '在維持學分與品質下限下，提高有評價的挑戰課程比例。'
        : '在維持學分與品質下限下，提高有評價的輕鬆課程比例。',
    },
    {
      archetype: PLAN_ARCHETYPES.INTEREST,
      id: 'personalized_interest',
      title: '興趣導向方案',
      description: '在維持學分與品質下限下，提高興趣主題的涵蓋率。',
    },
    {
      archetype: PLAN_ARCHETYPES.COMPACT,
      id: 'personalized_compact',
      title: '集中排課方案',
      description: '在維持學分與品質下限下，減少每週需要到校的天數。',
    },
  ];
}
