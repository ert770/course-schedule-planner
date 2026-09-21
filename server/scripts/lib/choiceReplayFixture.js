// Roadmap #10 任務 3A-6：Choice Perceptron 的離線重播素材與評估。
//
// **這個模組只產生合成資料與計算指標，不碰 MySQL、不寫任何檔案。** 正式的學習
// 邏輯一律呼叫 `skills/preferenceLearning.js` 的匯出函式，這裡不複製一份。
//
// 為什麼是「種子化的產生器」而不是 checked-in 的 JSON fixture：四個 persona × 80 回合
// × 每回合 2～4 個方案的事件流，寫成 JSON 是數千行雜訊，改一個參數就要整份重產。
// 種子固定時這個產生器的輸出逐位元可重現，與 checked-in fixture 的可驗證性相同，
// 而且讀者可以直接看到「資料是怎麼造出來的」這件更重要的事。

import { PREFERENCE_AXES } from '../../src/skills/preferenceLearning.js';
// 直接引用正式常數：重播素材若自己寫死版本字串，正式版本升級時這裡會靜默漂移，
// 產生一批「看起來能學、實際上被跳過」的假資料。
import { PLAN_FEATURE_VERSION } from '../../src/data/interactionEventSchema.js';

export const PLAN_FEATURE_VERSION_FOR_REPLAY = PLAN_FEATURE_VERSION;

// mulberry32：小而確定的 PRNG。不用 Math.random()，否則重播不可重現。
function makeRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp01 = value => Math.min(1, Math.max(0, value));
const round3 = value => Math.round(value * 1000) / 1000;

// 四個 persona。`trueWeights` 是使用者真正的偏好（系統永遠看不到），
// `explicitProfile` 是他在介面上勾的東西——兩者刻意不一致，才測得出
// 「學到的權重能不能推翻顯式設定」。
export const REPLAY_PERSONAS = Object.freeze([
  {
    id: 'compact-seeker',
    description: '顯式勾了集中排課，行為也一致——最單純的情況',
    trueWeights: { interest: 0.2, compact: 1, easy: 0 },
    explicitProfile: { interest: 0, compact: 1, easy: 0 },
    noise: 0,
    easyAvailable: true,
  },
  {
    id: 'challenge-seeker',
    description: '顯式勾了涼課優先，實際每次都挑硬的——本輪決定的核心案例',
    trueWeights: { interest: 0.3, compact: 0, easy: -1 },
    explicitProfile: { interest: 0, compact: 0, easy: 1 },
    noise: 0,
    easyAvailable: true,
  },
  {
    id: 'noisy',
    description: '偏好明確但有 20% 隨機選擇，檢查權重會不會被雜訊帶走',
    trueWeights: { interest: 1, compact: 0.2, easy: 0 },
    explicitProfile: { interest: 0, compact: 0, easy: 0 },
    noise: 0.2,
    easyAvailable: true,
  },
  {
    id: 'null-easy',
    description: '候選課全無評價證據，easy 軸整批缺值——驗證遮罩不污染另外兩軸',
    trueWeights: { interest: 0.8, compact: 0.5, easy: 0 },
    explicitProfile: { interest: 0, compact: 0, easy: 0 },
    noise: 0,
    easyAvailable: false,
  },
]);

// 方案的 archetype 軸：對應 `planStrategies.js` 的 `personalized_<axis>`。
// v2 引擎的 `dominantAxes()` 就是靠「這一軸的 policy 權重嚴格大於其他方案」投票，
// 所以合成資料必須同時帶 policy 權重，否則等於不給 v2 學習的機會。
const ARCHETYPE_AXES = ['interest', 'compact', 'easy'];

function planPolicyWeights(archetypeAxis) {
  return Object.fromEntries(PREFERENCE_AXES.map(axis => [
    axis, axis === archetypeAxis ? 1.5 : 1,
  ]));
}

// 使用者的真實效用：論文的 `u*(x, y) = ⟨w*, φ(x, y)⟩`，缺值的軸不參與
// （與 `evaluatePreference()` 排除無證據軸的做法一致）。
export function trueUtility(trueWeights, feature) {
  return PREFERENCE_AXES.reduce((sum, axis) => {
    const value = feature[axis];
    return Number.isFinite(value) ? sum + (trueWeights[axis] ?? 0) * value : sum;
  }, 0);
}

// 系統排序方案時用的分數。這是 `scheduler.js` 的 `evaluatePreference()` 的公式：
// 取絕對值當權數、負權重把軸值翻面、無證據的軸連同權重一起排除。φ 完整時它是
// `⟨w, φ⟩` 的正仿射變換（排序一致），缺值時才會與點積分歧——那正是本系統與論文
// 模型的三處錯配之一。
export function systemScore(weights, feature) {
  let weightSum = 0;
  let total = 0;
  for (const axis of PREFERENCE_AXES) {
    const weight = weights[axis] ?? 0;
    const value = feature[axis];
    if (Math.abs(weight) === 0 || !Number.isFinite(value)) continue;
    weightSum += Math.abs(weight);
    total += (weight >= 0 ? value : 1 - value) * Math.abs(weight);
  }
  return weightSum === 0 ? 0 : total / weightSum;
}

// 預測：在這組 query set 裡，這組權重會把哪一個方案排第一。
// 同分時取索引較小者（與 `comparePlans()` 的穩定排序同一個立場）。
export function predictIndex(weights, features) {
  let bestIndex = 0;
  let bestScore = -Infinity;
  features.forEach((feature, index) => {
    const score = systemScore(weights, feature);
    if (score > bestScore + 1e-12) {
      bestScore = score;
      bestIndex = index;
    }
  });
  return bestIndex;
}

// 被選方案在這組權重下的名次（1 = 排第一）。accuracy 只看有沒有猜中，
// 名次則看「猜錯的時候錯得多遠」。
export function rankOfChoice(weights, features, chosenIndex) {
  const scores = features.map(feature => systemScore(weights, feature));
  const chosenScore = scores[chosenIndex];
  return 1 + scores.filter(score => score > chosenScore + 1e-12).length;
}

// 產生一位 persona 的一回合：k 個方案 ＋ 使用者的選擇。
function buildRound(persona, roundIndex, random) {
  const querySize = 2 + Math.floor(random() * 3); // 2～4，對應真實的方案切換列
  const features = [];
  for (let planIndex = 0; planIndex < querySize; planIndex += 1) {
    // 第 0 個是主推（綜合平衡），其餘各自放大一軸。
    const archetypeAxis = planIndex === 0 ? null : ARCHETYPE_AXES[(planIndex - 1) % ARCHETYPE_AXES.length];
    const feature = { planId: `r${roundIndex}:p${planIndex}`, variantId: `v${planIndex}`, archetypeAxis };
    for (const axis of PREFERENCE_AXES) {
      if (axis === 'easy' && !persona.easyAvailable) {
        feature[axis] = null;
        continue;
      }
      const base = 0.2 + random() * 0.4;
      feature[axis] = round3(clamp01(axis === archetypeAxis ? base + 0.35 : base));
    }
    features.push(feature);
  }

  const utilities = features.map(feature => trueUtility(persona.trueWeights, feature));
  let chosenIndex = utilities.indexOf(Math.max(...utilities));
  // 論文允許 noisy choice（reasonable user 只要求選擇機率是效用的單調變換）。
  if (persona.noise > 0 && random() < persona.noise) {
    chosenIndex = Math.floor(random() * features.length);
  }
  return { roundIndex, features, chosenIndex };
}

export function buildPersonaRounds(persona, { seed = 1, rounds = 80 } = {}) {
  const random = makeRandom(seed);
  return Array.from({ length: rounds }, (_, index) => buildRound(persona, index, random));
}

// 把一回合轉成真實事件流。曝光事件同時帶 `planFeatures`（CP 用）與
// `planPolicies`（v2 用），`plan_chosen` 與 `recommendation_accepted` 成對產生——
// 這正是 3A-3 之後線上會發生的事，兩個引擎因此讀的是同一次互動。
export function roundToEvents(round, { dayOffset = 0, term } = {}) {
  const requestId = `replay-${round.roundIndex}`;
  const timestamp = new Date(Date.UTC(2026, 0, 1 + dayOffset, 9, 0, 0)).toISOString();
  const chosen = round.features[round.chosenIndex];
  const planFeatures = round.features.map(feature => ({
    planId: feature.planId,
    variantId: feature.variantId,
    ...Object.fromEntries(PREFERENCE_AXES.map(axis => [axis, feature[axis]])),
  }));

  return [
    {
      eventType: 'recommendation_exposed',
      eventId: `${requestId}-exposure`,
      requestId,
      timestamp,
      term,
      plan: { planId: round.features[0].planId, variantId: round.features[0].variantId },
      exposureContext: {
        planFeatureVersion: PLAN_FEATURE_VERSION_FOR_REPLAY,
        displayedPlanIds: round.features.map(feature => feature.planId),
        planFeatures,
        planPolicies: round.features.map(feature => ({
          planId: feature.planId,
          variantId: feature.variantId,
          weights: planPolicyWeights(feature.archetypeAxis),
        })),
      },
    },
    {
      eventType: 'plan_chosen',
      eventId: `${requestId}-chosen`,
      requestId,
      timestamp,
      term,
      plan: { planId: chosen.planId, variantId: chosen.variantId },
    },
    {
      eventType: 'recommendation_accepted',
      eventId: `${requestId}-accepted`,
      requestId,
      timestamp,
      term,
      plan: { planId: chosen.planId, variantId: chosen.variantId },
      source: 'system_recommendation',
    },
  ];
}

export function splitRounds(rounds, { training = 40, validation = 20 } = {}) {
  return {
    training: rounds.slice(0, training),
    validation: rounds.slice(training, training + validation),
    test: rounds.slice(training + validation),
  };
}

// 在一組 query 上評估一組權重。`accuracy` 是猜中被選方案的比例，
// `meanRank` 是被選方案的平均名次。
export function evaluateWeights(weights, rounds) {
  if (rounds.length === 0) return { accuracy: null, meanRank: null, size: 0 };
  let hits = 0;
  let rankSum = 0;
  for (const round of rounds) {
    if (predictIndex(weights, round.features) === round.chosenIndex) hits += 1;
    rankSum += rankOfChoice(weights, round.features, round.chosenIndex);
  }
  return {
    accuracy: round3(hits / rounds.length),
    meanRank: round3(rankSum / rounds.length),
    size: rounds.length,
  };
}

// 「永遠選系統主推方案」的對照組：不需要權重，直接看第 0 個是不是被選的那個。
export function evaluateTrivial(rounds) {
  if (rounds.length === 0) return { accuracy: null, meanRank: null, size: 0 };
  const hits = rounds.filter(round => round.chosenIndex === 0).length;
  return { accuracy: round3(hits / rounds.length), meanRank: null, size: rounds.length };
}

export default {
  REPLAY_PERSONAS,
  buildPersonaRounds,
  roundToEvents,
  splitRounds,
  evaluateWeights,
  evaluateTrivial,
  predictIndex,
  rankOfChoice,
  systemScore,
  trueUtility,
};
