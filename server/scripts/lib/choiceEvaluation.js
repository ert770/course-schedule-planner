// Roadmap #10 任務 3B-0：多使用者的 Choice Perceptron 離線評估。
//
// **純函式，不碰 MySQL、不寫檔、不取現在時間。** 輸入是一份「選擇回合」清單，來源可以是
// 模擬檔，也可以是從資料庫事件依 `requestId` 重建的回合——評估本身不在乎。
// 學習一律呼叫 `skills/preferenceLearning.js` 的正式函式，這裡不複製一份。
//
// 回合的形狀：
//   { subject, requestId, timestamp, chosenIndex,
//     features: [{ planId, variantId, interest, compact, easy }],   // 第 0 個是系統主推
//     planPolicies: [{ planId, variantId, weights }] }              // v2 引擎需要
//
// 每位使用者依時間切成 training／validation／test，用途不得互換：η 與 choice 門檻只看
// validation，test 在參數固定後只評估一次。

import {
  CHOICE_LEARNING_RATE_GRID,
  PREFERENCE_AXES,
  learnChoicePerceptronWeights,
  learnPreferenceWeights,
} from '../../src/skills/preferenceLearning.js';
import { PLAN_FEATURE_VERSION } from '../../src/data/interactionEventSchema.js';
import { predictIndex, rankOfChoice } from './choiceReplayFixture.js';

// 3B 計畫 3.1 節的資料 readiness 門檻。
export const READINESS = Object.freeze({
  minSubjects: 3,
  minChoicesPerSubject: 20,
  minTotalChoices: 100,
  minTestChoices: 20,
});

// 3B 計畫 3.3 節裡離線就量得到的四項。安全性、排課成功率、延遲要把 CP 接進排課才量得到。
export const GO_THRESHOLDS = Object.freeze({
  accuracyGain: 0.05,
  ciLowerBound: 0,
  consistentGroupMaxDrop: 0.05,
});
export const NOT_EVALUATED_OFFLINE = Object.freeze(['hardViolations', 'schedulingSuccessRate', 'latencyP95']);

export const SPLIT_RATIO = Object.freeze({ training: 0.6, validation: 0.2 });
// 「顯式偏好一致」的操作型定義：只用顯式偏好就能在 training＋validation 猜中至少這個比例。
// 用 test 以外的資料判定，避免拿答案來分組。
export const CONSISTENT_GROUP_ACCURACY = 0.6;
export const STABILITY_TOLERANCE = 0.05;
export const CHOICE_THRESHOLD_RANGE = Object.freeze({ min: 10, max: 60 });

const round3 = value => (value === null || !Number.isFinite(value) ? null : Math.round(value * 1000) / 1000);

// mulberry32，與 `choiceReplayFixture.js` 同一個產生器；bootstrap 必須可重現。
export function makeRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function groupBySubject(rounds = []) {
  const groups = new Map();
  for (const round of rounds) {
    if (!groups.has(round.subject)) groups.set(round.subject, []);
    groups.get(round.subject).push(round);
  }
  for (const list of groups.values()) {
    list.sort((left, right) => (
      String(left.timestamp).localeCompare(String(right.timestamp))
      || String(left.requestId).localeCompare(String(right.requestId))
    ));
  }
  return groups;
}

// 時間順序切分：前 60% training、中間 20% validation、其餘 test。不打亂——打亂等於把
// 未來的選擇餵回訓練。
export function splitChronological(sortedRounds) {
  const total = sortedRounds.length;
  const trainingEnd = Math.floor(total * SPLIT_RATIO.training);
  const validationEnd = trainingEnd + Math.floor(total * SPLIT_RATIO.validation);
  return {
    training: sortedRounds.slice(0, trainingEnd),
    validation: sortedRounds.slice(trainingEnd, validationEnd),
    test: sortedRounds.slice(validationEnd),
  };
}

// 把回合還原成正式事件流。曝光同時帶 `planFeatures`（CP 用）與 `planPolicies`（v2 用），
// `plan_chosen` 與 `recommendation_accepted` 成對——線上一次方案選擇就是這三筆。
export function roundToEvents(round) {
  const chosen = round.features[round.chosenIndex];
  const plan = { planId: chosen.planId, variantId: chosen.variantId };
  const base = { requestId: round.requestId, timestamp: round.timestamp, term: round.term };
  return [
    {
      ...base,
      eventType: 'recommendation_exposed',
      eventId: `${round.requestId}-exposure`,
      plan: { planId: round.features[0].planId, variantId: round.features[0].variantId },
      exposureContext: {
        planFeatureVersion: PLAN_FEATURE_VERSION,
        displayedPlanIds: round.features.map(feature => feature.planId),
        planFeatures: round.features.map(feature => ({
          planId: feature.planId,
          variantId: feature.variantId,
          ...Object.fromEntries(PREFERENCE_AXES.map(axis => [axis, feature[axis] ?? null])),
        })),
        planPolicies: round.planPolicies ?? [],
      },
    },
    { ...base, eventType: 'plan_chosen', eventId: `${round.requestId}-chosen`, plan },
    {
      ...base,
      eventType: 'recommendation_accepted',
      eventId: `${round.requestId}-accepted`,
      plan,
      source: 'system_recommendation',
    },
  ];
}

const eventsFor = rounds => rounds.flatMap(roundToEvents);

function learnCP(rounds, profile, learningRate) {
  return learnChoicePerceptronWeights(eventsFor(rounds), {
    explicitProfile: profile.explicit,
    learningRate,
  }).weights;
}

function learnV2(rounds, profile) {
  const result = learnPreferenceWeights(eventsFor(rounds), { explicitProfile: profile.v2Explicit });
  return { weights: result.weights, sufficiency: result.sufficiency.status };
}

// 一回合在一組權重下的結果。`hit` 與 `reciprocalRank` 逐回合保留，bootstrap 才能重抽。
function scoreRound(weights, round) {
  const hit = predictIndex(weights, round.features) === round.chosenIndex ? 1 : 0;
  return { hit, reciprocalRank: 1 / rankOfChoice(weights, round.features, round.chosenIndex) };
}

const mean = values => (values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length);

function accuracyOf(weights, rounds) {
  return mean(rounds.map(round => scoreRound(weights, round).hit));
}

export function percentile(sortedValues, fraction) {
  if (sortedValues.length === 0) return null;
  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.ceil(fraction * sortedValues.length) - 1));
  return sortedValues[index];
}

export function checkReadiness(groups) {
  const counts = [...groups.values()].map(list => list.length);
  const eligible = counts.filter(count => count >= READINESS.minChoicesPerSubject).length;
  const total = counts.reduce((sum, count) => sum + count, 0);
  const testTotal = [...groups.values()]
    .reduce((sum, list) => sum + splitChronological(list).test.length, 0);
  const reasons = [];
  if (eligible < READINESS.minSubjects) {
    reasons.push(`達到 ${READINESS.minChoicesPerSubject} 筆的使用者只有 ${eligible} 位（需要 ${READINESS.minSubjects}）`);
  }
  if (total < READINESS.minTotalChoices) reasons.push(`總選擇數 ${total}（需要 ${READINESS.minTotalChoices}）`);
  if (testTotal < READINESS.minTestChoices) reasons.push(`test 合計 ${testTotal} 筆（需要 ${READINESS.minTestChoices}）`);
  return { ready: reasons.length === 0, subjects: counts.length, eligibleSubjects: eligible, total, testTotal, reasons };
}

// 單一 η：跨所有使用者的 validation 回合一起算，平手取較小值（較保守）。
function calibrateLearningRate(datasets) {
  const rows = CHOICE_LEARNING_RATE_GRID.map(learningRate => {
    const hits = datasets.flatMap(({ profile, split }) => {
      const weights = learnCP(split.training, profile, learningRate);
      return split.validation.map(round => scoreRound(weights, round).hit);
    });
    return { learningRate, validationAccuracy: round3(mean(hits)), samples: hits.length };
  });
  const best = rows.reduce((winner, row) => (
    (row.validationAccuracy ?? -1) > (winner.validationAccuracy ?? -1) ? row : winner
  ), rows[0]);
  return { rows, learningRate: best.learningRate };
}

// 穩定點：從第幾次 choice 起，validation 準確率與最終值的差距都在容許範圍內。
function stabilityCurve({ profile, split }, learningRate) {
  if (split.validation.length === 0 || split.training.length === 0) return { stableFrom: null, curve: [] };
  const curve = [];
  for (let count = 1; count <= split.training.length; count += 1) {
    curve.push(round3(accuracyOf(learnCP(split.training.slice(0, count), profile, learningRate), split.validation)));
  }
  const final = curve.at(-1);
  let stableFrom = curve.length;
  for (let index = curve.length - 1; index >= 0; index -= 1) {
    if (Math.abs(curve[index] - final) > STABILITY_TOLERANCE) break;
    stableFrom = index + 1;
  }
  return { stableFrom, curve };
}

// 以使用者為群組的階層式 bootstrap：先重抽使用者，再在每位使用者內重抽回合。
// 只重抽回合會把同一個人的 20 題當成 20 個獨立樣本，信賴區間會假性變窄。
export function hierarchicalBootstrap(perSubject, { iterations = 2000, seed = 20261007 } = {}) {
  const subjects = perSubject.filter(item => item.length > 0);
  if (subjects.length === 0) return { lower: null, upper: null, iterations: 0 };
  const random = makeRandom(seed);
  const pick = list => list[Math.floor(random() * list.length)];
  const samples = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let sum = 0;
    let size = 0;
    for (let index = 0; index < subjects.length; index += 1) {
      const rounds = pick(subjects);
      for (let inner = 0; inner < rounds.length; inner += 1) {
        sum += pick(rounds);
        size += 1;
      }
    }
    samples.push(sum / size);
  }
  samples.sort((left, right) => left - right);
  return {
    lower: round3(samples[Math.floor(0.025 * (samples.length - 1))]),
    upper: round3(samples[Math.ceil(0.975 * (samples.length - 1))]),
    iterations,
  };
}

/**
 * @param rounds    選擇回合（見檔頭）。
 * @param profiles  `{ [subject]: { explicit, v2Explicit } }`。`explicit` 是使用者在介面上勾的方向
 *                  （CP 的起點與「只用顯式偏好」對照組），`v2Explicit` 是正式 v2 服務實際傳入的先驗。
 */
export function evaluateChoiceRounds(rounds, profiles = {}, options = {}) {
  const groups = groupBySubject(rounds);
  const readiness = checkReadiness(groups);
  const emptyProfile = { explicit: {}, v2Explicit: {} };
  // 依 subject 排序：結果（尤其 bootstrap）不該隨輸入的排列順序改變。
  const datasets = [...groups.entries()].sort(([left], [right]) => (
    String(left).localeCompare(String(right))
  )).map(([subject, list]) => ({
    subject,
    profile: { ...emptyProfile, ...(profiles[subject] ?? {}) },
    split: splitChronological(list),
  }));

  if (!readiness.ready) {
    return { verdict: 'no-data', readiness, notEvaluated: NOT_EVALUATED_OFFLINE };
  }

  const sweep = calibrateLearningRate(datasets);
  const learningRate = sweep.learningRate;

  const perSubject = datasets.map(dataset => {
    const { subject, profile, split } = dataset;
    const fit = [...split.training, ...split.validation];
    // test 之前的資料全部可用於最終模型；η 已固定，這裡不再調任何參數。
    const cpWeights = learnCP(fit, profile, learningRate);
    const v2 = learnV2(fit, profile);
    const outcomes = split.test.map(round => ({
      trivial: { hit: round.chosenIndex === 0 ? 1 : 0, reciprocalRank: null },
      explicit: scoreRound(profile.explicit, round),
      v2: scoreRound(v2.weights, round),
      cp: scoreRound(cpWeights, round),
    }));
    const stability = stabilityCurve(dataset, learningRate);
    return {
      subject,
      counts: { training: split.training.length, validation: split.validation.length, test: split.test.length },
      explicitProfile: profile.explicit,
      cpWeights,
      v2Weights: v2.weights,
      v2Sufficiency: v2.sufficiency,
      consistent: accuracyOf(profile.explicit, fit) >= CONSISTENT_GROUP_ACCURACY,
      stableFrom: stability.stableFrom,
      stabilityCurve: stability.curve,
      outcomes,
    };
  });

  const pooled = (key, field, subset = perSubject) => round3(mean(
    subset.flatMap(item => item.outcomes.map(outcome => outcome[key][field]))
  ));
  const methods = ['trivial', 'explicit', 'v2', 'cp'];
  const accuracy = Object.fromEntries(methods.map(key => [key, pooled(key, 'hit')]));
  const mrr = Object.fromEntries(['explicit', 'v2', 'cp'].map(key => [key, pooled(key, 'reciprocalRank')]));

  const diffs = perSubject.map(item => item.outcomes.map(outcome => outcome.cp.hit - outcome.v2.hit));
  const bootstrap = hierarchicalBootstrap(diffs, options.bootstrap);
  const accuracyGain = round3(accuracy.cp - accuracy.v2);

  const consistentGroup = perSubject.filter(item => item.consistent);
  const consistentDrop = consistentGroup.length === 0
    ? null
    : round3(pooled('v2', 'hit', consistentGroup) - pooled('cp', 'hit', consistentGroup));

  const stablePoints = perSubject.map(item => item.stableFrom).filter(Number.isFinite).sort((a, b) => a - b);
  const p75 = percentile(stablePoints, 0.75);
  const choiceThreshold = p75 === null
    ? null
    : Math.min(CHOICE_THRESHOLD_RANGE.max, Math.max(CHOICE_THRESHOLD_RANGE.min, Math.ceil(p75)));

  const criteria = {
    accuracyGain: accuracyGain >= GO_THRESHOLDS.accuracyGain,
    ciLowerBound: bootstrap.lower !== null && bootstrap.lower >= GO_THRESHOLDS.ciLowerBound,
    mrr: mrr.cp >= mrr.v2,
    // 沒有任何人落在一致族群時，這一項沒有資料可判，不能算通過也不能算失敗。
    consistentGroup: consistentDrop === null ? null : consistentDrop <= GO_THRESHOLDS.consistentGroupMaxDrop,
  };
  const decided = Object.values(criteria).filter(value => value !== null);
  let verdict = 'go';
  if (decided.some(value => value === false)) {
    // CP 明確比 v2 差才是 no-go；只是沒贏夠多、區間跨過 0，是分不出來。
    verdict = accuracyGain < 0 && bootstrap.upper !== null && bootstrap.upper < 0 ? 'no-go' : 'inconclusive';
  } else if (decided.length < Object.keys(criteria).length) {
    verdict = 'inconclusive';
  }

  return {
    verdict,
    readiness,
    learningRate,
    learningRateSweep: sweep.rows,
    accuracy,
    mrr,
    accuracyGain,
    bootstrap,
    consistentGroup: { subjects: consistentGroup.length, accuracyDrop: consistentDrop },
    stability: {
      median: percentile(stablePoints, 0.5),
      p75,
      max: stablePoints.at(-1) ?? null,
      choiceThreshold,
    },
    criteria,
    notEvaluated: NOT_EVALUATED_OFFLINE,
    perSubject: perSubject.map(item => ({
      subject: item.subject,
      counts: item.counts,
      explicitProfile: item.explicitProfile,
      cpWeights: item.cpWeights,
      v2Weights: item.v2Weights,
      v2Sufficiency: item.v2Sufficiency,
      consistent: item.consistent,
      stableFrom: item.stableFrom,
      stabilityCurve: item.stabilityCurve,
      accuracy: Object.fromEntries(methods.map(key => [
        key, round3(mean(item.outcomes.map(outcome => outcome[key].hit))),
      ])),
    })),
  };
}

export default { evaluateChoiceRounds, checkReadiness, splitChronological, hierarchicalBootstrap, roundToEvents };
