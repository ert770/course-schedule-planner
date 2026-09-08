import { PREFERENCE_AXES } from './scoringPolicy.js';

// 最多嘗試五個可重現方案，並以使用者有表達的偏好軸為中心。
// strategy 是搜尋設定，不能只看名稱就反推出使用者接受方案的原因。
export function buildPlanStrategies(policy) {
  const make = (id, title, description, scoringPolicy, stopWhen = 'no-credit-progress') => ({
    id, title, description, scoringPolicy, stopWhen,
  });
  const strategies = [make('personalized', '個人化綜合方案',
    '依照你的整體偏好挑選課程，並優先安排必修與重補修。', policy)];
  const labels = { interest: '更重視興趣', compact: '更集中排課',
    easy: policy.weights.easy < 0 ? '更重視挑戰' : '更重視輕鬆' };
  for (const axis of PREFERENCE_AXES) {
    if (policy.weights[axis] === 0) continue;
    strategies.push(make(`personalized_${axis}`, labels[axis],
      `保留你的偏好方向，提高「${labels[axis]}」的相對重要程度，供你比較取捨。`, {
        ...policy, weights: { ...policy.weights, [axis]: policy.weights[axis] * 1.5 },
      }));
  }
  strategies.push(make('personalized_credits', '較多學分方案',
    '保留你的偏好方向，提高學分的排序比重，在上限內嘗試不同組合。',
    { ...policy, creditCoefficient: 3 }, 'candidate-exhausted'));
  return strategies;
}
