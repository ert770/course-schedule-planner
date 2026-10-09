// Roadmap #10 任務 3B-0：多使用者 Choice Perceptron 評估的執行入口。
//
// 兩種輸入，評估邏輯相同（`lib/choiceEvaluation.js`）：
//   --rounds=<path>   讀 `personaChoiceSimulation.js` 產生的 rounds.json（模擬資料）
//   --real-data       唯讀查詢 MySQL，把指定帳號的真實事件依 requestId 重建成回合
//                     （搭配 --subjects=D1249697,D1249196）
//
// 不寫 MySQL。報告裡的使用者一律用本次執行的代碼（P01、P02…），不輸出 subject_id。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { evaluateChoiceRounds, GO_THRESHOLDS, READINESS } from './lib/choiceEvaluation.js';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const argValue = name => args.find(arg => arg.startsWith(`--${name}=`))?.split('=').slice(1).join('=');

// 把真實事件流重建成回合：一筆可學的 `plan_chosen` ＋ 同一個 requestId 的曝光＝一回合。
// 判定「可不可學」的條件與 `learnChoicePerceptronWeights()` 的 `resolveChoiceQuery()` 相同。
export function roundsFromEvents(events, subject) {
  const exposures = new Map();
  for (const event of events) {
    if (event.eventType === 'recommendation_exposed' && event.requestId) exposures.set(event.requestId, event);
  }
  const rounds = [];
  for (const event of events) {
    if (event.eventType !== 'plan_chosen') continue;
    const context = exposures.get(event.requestId)?.exposureContext;
    const features = context?.planFeatures ?? [];
    const displayed = context?.displayedPlanIds ?? [];
    if (displayed.length < 2 || features.length !== displayed.length) continue;
    const chosenIndex = features.findIndex(feature => feature.planId === event.plan?.planId);
    if (chosenIndex < 0) continue;
    rounds.push({
      subject,
      requestId: event.requestId,
      timestamp: event.timestamp,
      term: event.term,
      features,
      planPolicies: context.planPolicies ?? [],
      chosenIndex,
    });
  }
  return rounds;
}

async function loadRealRounds(subjects) {
  const dotenv = (await import('dotenv')).default;
  dotenv.config({ path: path.resolve(scriptDir, '..', '.env'), quiet: true });
  dotenv.config({ path: path.resolve(scriptDir, '..', '..', '.env'), quiet: true });
  const { getInteractionEventsForExport } = await import('../src/services/interactionEventService.js');
  const { getUserPreferences } = await import('../src/services/memoryService.js');
  const { explicitDirection, v2ExplicitProfile } = await import('./lib/personaScenarios.js');
  const { closePool } = await import('../src/db/mysql.js');
  const users = JSON.parse(fs.readFileSync(path.resolve(scriptDir, '..', 'data', 'users.json'), 'utf8'));
  try {
    const rounds = [];
    const profiles = {};
    for (const studentId of subjects) {
      const account = users.find(user => String(user.studentId) === studentId);
      if (!account) throw new Error(`帳號清單沒有學號 ${studentId}`);
      const identity = { canonicalId: studentId, numericId: String(account.id), studentId };
      const events = await getInteractionEventsForExport(identity);
      const prefs = await getUserPreferences(identity);
      profiles[studentId] = { explicit: explicitDirection(prefs), v2Explicit: v2ExplicitProfile(prefs) };
      rounds.push(...roundsFromEvents(events, studentId));
    }
    return { rounds, profiles, simulated: false };
  } finally {
    await closePool();
  }
}

function loadSimulatedRounds(file) {
  const data = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  return {
    rounds: data.rounds.filter(round => Number.isInteger(round.chosenIndex)),
    profiles: data.profiles ?? {},
    simulated: data.simulated === true,
    model: data.model ?? null,
    promptVersion: data.promptVersion ?? null,
  };
}

// subject → 本次執行的代碼。依 subject 排序後編號，同一份輸入每次得到同樣的代碼。
function anonymize(report, rounds) {
  const codes = new Map([...new Set(rounds.map(round => round.subject))].sort()
    .map((subject, index) => [subject, `P${String(index + 1).padStart(2, '0')}`]));
  return {
    ...report,
    perSubject: report.perSubject?.map(item => ({ ...item, subject: codes.get(item.subject) })),
  };
}

const fmt = value => (value === null || value === undefined ? '—' : String(value));
const mark = value => (value === null ? '無資料' : value ? '通過' : '未通過');

function printMarkdown(report, source) {
  console.log('# Choice Perceptron 多使用者評估（3B-0）');
  console.log('');
  console.log(`- 資料來源：${source.simulated ? `**模擬資料**（模型 ${fmt(source.model)}，提示 ${fmt(source.promptVersion)}）` : '真實事件（唯讀）'}`);
  console.log(`- 使用者 ${report.readiness.subjects} 位，其中 ${report.readiness.eligibleSubjects} 位達 ${READINESS.minChoicesPerSubject} 筆；總選擇 ${report.readiness.total}，test 合計 ${report.readiness.testTotal}`);
  console.log(`- **結論：${report.verdict}**`);
  if (report.verdict === 'no-data') {
    for (const reason of report.readiness.reasons) console.log(`  - ${reason}`);
    return;
  }
  console.log(`- 選出的 η：${report.learningRate}（只用 validation 選）`);
  console.log('');
  console.log('| 對照組 | test 準確率 | MRR |');
  console.log('| --- | ---: | ---: |');
  console.log(`| 永遠選主推 | ${fmt(report.accuracy.trivial)} | — |`);
  console.log(`| 只用顯式偏好 | ${fmt(report.accuracy.explicit)} | ${fmt(report.mrr.explicit)} |`);
  console.log(`| 現行 v2 | ${fmt(report.accuracy.v2)} | ${fmt(report.mrr.v2)} |`);
  console.log(`| Choice Perceptron | ${fmt(report.accuracy.cp)} | ${fmt(report.mrr.cp)} |`);
  console.log('');
  console.log('| 判定項目 | 門檻 | 實測 | 結果 |');
  console.log('| --- | --- | --- | --- |');
  console.log(`| 準確率高出 v2 | ≥ ${GO_THRESHOLDS.accuracyGain} | ${fmt(report.accuracyGain)} | ${mark(report.criteria.accuracyGain)} |`);
  console.log(`| 準確率差的 95% 信賴區間下界 | ≥ ${GO_THRESHOLDS.ciLowerBound} | [${fmt(report.bootstrap.lower)}, ${fmt(report.bootstrap.upper)}] | ${mark(report.criteria.ciLowerBound)} |`);
  console.log(`| MRR 不低於 v2 | CP ≥ v2 | ${fmt(report.mrr.cp)} vs ${fmt(report.mrr.v2)} | ${mark(report.criteria.mrr)} |`);
  console.log(`| 顯式偏好一致族群（${report.consistentGroup.subjects} 位）退步 | ≤ ${GO_THRESHOLDS.consistentGroupMaxDrop} | ${fmt(report.consistentGroup.accuracyDrop)} | ${mark(report.criteria.consistentGroup)} |`);
  console.log(`| 安全性、排課成功率、延遲 | — | — | 未評估（需先把 CP 接進排課） |`);
  console.log('');
  console.log(`穩定所需選擇次數：中位數 ${fmt(report.stability.median)}、P75 ${fmt(report.stability.p75)}、最大 ${fmt(report.stability.max)}；建議門檻 ${fmt(report.stability.choiceThreshold)}`);
  console.log('');
  console.log('| 使用者 | 訓練／驗證／測試 | 顯式方向（興趣／集中／輕鬆） | CP 權重 | 主推 | 顯式 | v2（充足度） | CP | 穩定點 |');
  console.log('| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |');
  const triple = weights => `${fmt(weights?.interest)}／${fmt(weights?.compact)}／${fmt(weights?.easy)}`;
  for (const item of report.perSubject) {
    console.log(`| ${item.subject} | ${item.counts.training}／${item.counts.validation}／${item.counts.test} | ${triple(item.explicitProfile)} | ${triple(item.cpWeights)} | ${fmt(item.accuracy.trivial)} | ${fmt(item.accuracy.explicit)} | ${fmt(item.accuracy.v2)}（${item.v2Sufficiency}） | ${fmt(item.accuracy.cp)} | ${fmt(item.stableFrom)} |`);
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const roundsFile = argValue('rounds');
  const source = roundsFile
    ? loadSimulatedRounds(roundsFile)
    : args.includes('--real-data')
      ? await loadRealRounds((argValue('subjects') ?? 'D1249697').split(','))
      : null;
  if (!source) {
    console.error('請指定 --rounds=<rounds.json> 或 --real-data [--subjects=學號,學號]');
    process.exit(1);
  }
  const report = anonymize(evaluateChoiceRounds(source.rounds, source.profiles), source.rounds);
  if (args.includes('--markdown')) printMarkdown(report, source);
  else console.log(JSON.stringify({ simulated: source.simulated, ...report }, null, 2));
}
