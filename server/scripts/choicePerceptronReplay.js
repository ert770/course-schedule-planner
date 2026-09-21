// Roadmap #10 任務 3A-6：Choice Perceptron 的離線重播、校準與四方對照。
//
// 只用種子化的合成資料與正式的純函式（`skills/preferenceLearning.js`），
// **不寫 MySQL、不寫任何使用者資料**。`--real-data` 會額外唯讀查詢 demo 帳號的
// 互動事件，只為了誠實回報「真實可用的 plan_chosen 有幾筆」。
//
// **資料切成 training／validation／test 三份，用途不得互換**：
//   - training  ：累積權重
//   - validation：選 η 與建議的 choice 門檻
//   - test      ：參數固定後**只評估一次**，作為 go/no-go 的數字
// 用 test 調參再把同一組數字報成成績，會讓結果偏樂觀——這是這支腳本存在的主要理由。

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CHOICE_LEARNING_RATE_GRID,
  learnChoicePerceptronWeights,
  learnPreferenceWeights,
} from '../src/skills/preferenceLearning.js';
import {
  REPLAY_PERSONAS,
  buildPersonaRounds,
  evaluateTrivial,
  evaluateWeights,
  roundToEvents,
  splitRounds,
} from './lib/choiceReplayFixture.js';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const SEEDS = [1, 7, 42];
// training 設 60 是為了讓現行 v2 引擎有機會跨過它自己的 50 筆門檻——training 40 時
// 它永遠是 insufficient、退回顯式偏好，那樣的對照測到的是 v2 的退路而不是 v2 的學習。
const ROUNDS = 100;
const SPLIT = { training: 60, validation: 20, test: 20 };
const round3 = value => (value === null ? null : Math.round(value * 1000) / 1000);

function eventsFor(rounds, { term } = {}) {
  return rounds.flatMap((round, index) => roundToEvents(round, { dayOffset: index, term }));
}

// v2 引擎（現行正式引擎）。它讀的是 `recommendation_accepted` ＋ 曝光的 planPolicies，
// 與 CP 讀的 `plan_chosen` 來自同一次互動，所以兩者是公平對照。
function learnV2(rounds, persona) {
  const result = learnPreferenceWeights(eventsFor(rounds), {
    explicitProfile: persona.explicitProfile,
  });
  return { weights: result.weights, sufficiency: result.sufficiency.status };
}

function learnCP(rounds, persona, learningRate) {
  const result = learnChoicePerceptronWeights(eventsFor(rounds), {
    explicitProfile: persona.explicitProfile,
    learningRate,
  });
  return { weights: result.weights, choiceCount: result.sufficiency.choiceCount };
}

// 校準 η：只看 validation。平手時取較小的 η（更保守、推翻顯式設定需要更多次選擇）。
function calibrateLearningRate(datasets) {
  const rows = CHOICE_LEARNING_RATE_GRID.map(learningRate => {
    const scores = datasets.map(({ persona, split }) => (
      evaluateWeights(learnCP(split.training, persona, learningRate).weights, split.validation).accuracy
    ));
    const mean = scores.reduce((sum, value) => sum + value, 0) / scores.length;
    return { learningRate, validationAccuracy: round3(mean) };
  });
  const best = rows.reduce((winner, row) => (
    row.validationAccuracy > winner.validationAccuracy ? row : winner
  ), rows[0]);
  return { rows, learningRate: best.learningRate };
}

// 建議的 choice 門檻：從第幾次 choice 開始，validation 上的預測不再改變。
// 這不是「準確率最高的點」，而是「再多給資料也不會改變決策的點」——後者才是
// 「要幾次選擇才算學得夠」該回答的問題。
function calibrateChoiceCount(datasets, learningRate) {
  const perPersona = datasets.map(({ persona, split }) => {
    // 「再多給資料也不會改變結論」的操作型定義：從第 n 次起，validation 準確率
    // 與最終值的差距都在 0.05 以內。先前用「逐題預測完全一致」太嚴格——任何一題
    // 翻面就重算，結果永遠等於 training 長度，那不是資訊，是量錯了。
    const curve = [];
    for (let n = 1; n <= split.training.length; n += 1) {
      const { weights } = learnCP(split.training.slice(0, n), persona, learningRate);
      curve.push(evaluateWeights(weights, split.validation).accuracy);
    }
    const finalAccuracy = curve.at(-1);
    let stableFrom = curve.length;
    for (let n = curve.length - 1; n >= 0; n -= 1) {
      if (Math.abs(curve[n] - finalAccuracy) > 0.05) break;
      stableFrom = n + 1;
    }
    return { personaId: persona.id, stableFrom, finalValidationAccuracy: finalAccuracy };
  });
  // **只報最大值會被唯一一個沒收斂的 persona 綁架**，所以整個分布都回報：
  // 中位數代表「一般情況要幾次」，最大值代表「最壞情況」，兩者差很遠本身就是結論。
  const sorted = perPersona.map(row => row.stableFrom).sort((a, b) => a - b);
  const median = sorted.length % 2
    ? sorted[(sorted.length - 1) / 2]
    : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  return { perPersona, median, max: sorted.at(-1) };
}

function buildDatasets(seed) {
  return REPLAY_PERSONAS.map(persona => ({
    persona,
    split: splitRounds(buildPersonaRounds(persona, { seed, rounds: ROUNDS }), SPLIT),
  }));
}

// 四方對照，全部在**同一批 test query** 上預測；held-out 的選擇只當答案，
// 不回頭餵給任何模型。
function compareOnTest(datasets, learningRate) {
  return datasets.map(({ persona, split }) => {
    const v2 = learnV2(split.training, persona);
    const cp = learnCP(split.training, persona, learningRate);
    return {
      personaId: persona.id,
      description: persona.description,
      explicitProfile: persona.explicitProfile,
      trueWeights: persona.trueWeights,
      cpWeights: cp.weights,
      v2Weights: v2.weights,
      v2Sufficiency: v2.sufficiency,
      trivial: evaluateTrivial(split.test),
      explicitOnly: evaluateWeights(persona.explicitProfile, split.test),
      currentV2: evaluateWeights(v2.weights, split.test),
      choicePerceptron: evaluateWeights(cp.weights, split.test),
    };
  });
}

async function countRealChoiceEvents() {
  const dotenv = (await import('dotenv')).default;
  dotenv.config({ path: path.resolve(scriptDir, '..', '.env'), quiet: true });
  dotenv.config({ path: path.resolve(scriptDir, '..', '..', '.env'), quiet: true });
  const { getInteractionEventsForExport } = await import('../src/services/interactionEventService.js');
  const { closePool } = await import('../src/db/mysql.js');
  try {
    const identity = { canonicalId: 'D1249697', numericId: '1', studentId: 'D1249697' };
    const events = await getInteractionEventsForExport(identity);
    const chosen = events.filter(event => event.eventType === 'plan_chosen');
    const exposures = events.filter(event => (
      event.eventType === 'recommendation_exposed'
      && event.exposureContext?.planFeatureVersion
    ));
    return { total: events.length, planChosen: chosen.length, exposuresWithFeatures: exposures.length };
  } finally {
    await closePool();
  }
}

const seedReports = SEEDS.map(seed => {
  const datasets = buildDatasets(seed);
  const learningRateSweep = calibrateLearningRate(datasets);
  const choiceCount = calibrateChoiceCount(datasets, learningRateSweep.learningRate);
  return {
    seed,
    learningRate: learningRateSweep.learningRate,
    learningRateSweep: learningRateSweep.rows,
    choiceCountMedian: choiceCount.median,
    choiceCountMax: choiceCount.max,
    stability: choiceCount.perPersona,
    test: compareOnTest(datasets, learningRateSweep.learningRate),
  };
});

const realData = process.argv.includes('--real-data') ? await countRealChoiceEvents() : null;

const meanAccuracy = (reports, key) => round3(
  reports.flatMap(report => report.test.map(row => row[key].accuracy))
    .reduce((sum, value, _index, list) => sum + value / list.length, 0)
);

const summary = {
  generatedAt: new Date().toISOString(),
  rounds: ROUNDS,
  split: SPLIT,
  seeds: SEEDS,
  personas: REPLAY_PERSONAS.map(persona => persona.id),
  chosenLearningRates: seedReports.map(report => report.learningRate),
  choiceCountStability: {
    median: seedReports.map(report => report.choiceCountMedian),
    max: seedReports.map(report => report.choiceCountMax),
  },
  testAccuracy: {
    trivial: meanAccuracy(seedReports, 'trivial'),
    explicitOnly: meanAccuracy(seedReports, 'explicitOnly'),
    currentV2: meanAccuracy(seedReports, 'currentV2'),
    choicePerceptron: meanAccuracy(seedReports, 'choicePerceptron'),
  },
  realData,
};

if (process.argv.includes('--markdown')) {
  console.log('# Choice Perceptron 離線重播（3A-6）');
  console.log('');
  console.log(`- 合成資料：${REPLAY_PERSONAS.length} 個 persona × ${ROUNDS} 回合 × seed ${SEEDS.join('／')}`);
  console.log(`- 切分：training ${SPLIT.training}／validation ${SPLIT.validation}／test ${SPLIT.test}；η 與 choice 門檻只用 validation 選，test 只評估一次`);
  console.log(`- 選出的 η：${summary.chosenLearningRates.join('、')}；穩定所需 choice 次數（各 seed 的中位數／最大值）：${summary.choiceCountStability.median.join('、')} ／ ${summary.choiceCountStability.max.join('、')}`);
  console.log('');
  console.log('## test set 上的四方對照（accuracy = 猜中使用者所選方案的比例）');
  console.log('');
  console.log('| seed | persona | trivial | explicit-only | current-v2 (充足度) | choice-perceptron | CP 平均名次 |');
  console.log('| --- | --- | ---: | ---: | ---: | ---: | ---: |');
  for (const report of seedReports) {
    for (const row of report.test) {
      console.log(
        `| ${report.seed} | ${row.personaId} | ${row.trivial.accuracy} | ${row.explicitOnly.accuracy} `
        + `| ${row.currentV2.accuracy}（${row.v2Sufficiency}） | ${row.choicePerceptron.accuracy} | ${row.choicePerceptron.meanRank} |`
      );
    }
  }
  console.log('');
  console.log('## 平均');
  console.log('');
  console.log('| 對照組 | test accuracy |');
  console.log('| --- | ---: |');
  for (const [key, value] of Object.entries(summary.testAccuracy)) {
    console.log(`| ${key} | ${value} |`);
  }
  if (realData) {
    console.log('');
    console.log('## 真實資料 dry-run（唯讀）');
    console.log('');
    console.log(`- 事件總數：${realData.total}`);
    console.log(`- 可用的 \`plan_chosen\`：**${realData.planChosen}**`);
    console.log(`- 帶方案特徵的曝光：${realData.exposuresWithFeatures}`);
  }
} else {
  console.log(JSON.stringify({ summary, seedReports }, null, 2));
}
