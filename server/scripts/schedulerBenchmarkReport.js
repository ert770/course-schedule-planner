// Roadmap #35：排課引擎的離線 benchmark 成績單。
//
// 為什麼獨立成一個指令而不是塞進 `npm test`：`npm test` 的
// `schedulerBenchmark.test.js` 已經跑同一份題庫做正確性斷言（快、無條件執行，
// 排課是純本地運算沒有 #34 那種 API 成本考量）；這裡要另外產出的是**可比較的
// 統計數字**——可行率、逾時率、耗時分佈——這些不是「對或錯」的斷言，是每次
// 執行都可能小幅變動、需要跨版本比較的量測結果，混進 `npm test` 的輸出裡不
// 好讀，比照 `bench:personalization` 的做法分開。
//
// 這裡兩件事都做（`bench:personalization` 只印 stdout，roadmap #34 的
// `agentGoldenSetReport.js` 只寫檔）：因為驗收標準明講「Benchmark 可在固定
// 環境重現並產出比較報告」——比較報告需要能跨執行對照，所以要寫檔；同時保留
// stdout 的 `--markdown` 即時可讀輸出。
//
// **這份成績單能證明什麼、不能證明什麼**：能——同一台機器上，排課規則
// （`constraintSchema.js`）或 solver 預設值變動前後，哪一類情境的可行率／
// 逾時率／違規數退步了。不能——跨機器比較 runtime（受硬體影響）、或宣稱題庫
// 涵蓋了所有真實選課情境的分佈（題庫仍是手寫的合成資料）。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runSchedulerBenchmark } from '../src/skills/schedulerBenchmark.js';
import {
  DEFAULT_SOLVER_TIMEOUT_MS, DEFAULT_SOLVER_MAX_NODES, DEFAULT_SOLVER_SEED,
} from '../src/skills/scheduleSolver.js';
import { CONSTRAINTS } from '../src/data/constraintSchema.js';
import { sha256Hex } from '../src/utils/hash.js';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(scriptDir, '..', 'test', 'fixtures', 'schedulerBenchmarkCases.json');
const reportPath = path.join(scriptDir, '..', 'test', 'reports', 'scheduler-benchmark-latest.json');
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

const summary = runSchedulerBenchmark(fixture.cases);

function percentile(sortedValues, p) {
  if (sortedValues.length === 0) return null;
  const index = Math.min(sortedValues.length - 1, Math.floor(p * sortedValues.length));
  return sortedValues[index];
}

const runtimes = summary.rows.map(row => row.runtimeMs).sort((a, b) => a - b);
const feasibleLikeRows = summary.rows.filter(row => row.category === 'feasible' || row.category === 'greedy-trap');
const infeasibleLikeRows = summary.rows.filter(row => (
  row.category === 'infeasible' || row.category === 'data-insufficient'
));
const timedOutRows = summary.rows.filter(row => row.timedOut);
// 只看 feasible／greedy-trap 類——這是驗收標準一「成功方案 hard violation
// count 為 0」真正在講的東西。infeasible／data-insufficient 類 case 本來就
// 會因為排不出完整課表而觸發 REQUIRED_COURSE_COVERAGE 之類的違規，那是預期
// 行為不是警訊；混進來會讓這個欄位變成「永遠非空」的雜訊，稀釋掉它該示警的
// 真正訊號。
const hardViolationRows = feasibleLikeRows.filter(row => row.hardViolationCount > 0);

const report = {
  generatedAt: new Date().toISOString(),
  fixture: path.relative(process.cwd(), fixturePath),
  // 排課引擎真正的「行為版本」是它遵守的限制規則與 solver 預設值，不是原始碼
  // 逐行 diff——比照 roadmap #34 的「prompt+tools hash」思路：hash 的是決定
  // 行為的資料，不是實作細節。`stableStringify`（`src/utils/hash.js`）已經
  // 遞迴排序鍵，不用自己排序。
  versions: {
    constraintsAndSolverDefaults: sha256Hex({
      constraints: CONSTRAINTS,
      solverDefaults: { DEFAULT_SOLVER_TIMEOUT_MS, DEFAULT_SOLVER_MAX_NODES, DEFAULT_SOLVER_SEED },
    }),
    // 題庫自己也要 hash：沒有它分不清「引擎變壞」與「題目變難」。
    fixture: sha256Hex(fixture),
  },
  totals: {
    total: summary.total,
    passed: summary.passed,
    failed: summary.failed,
    feasibleSolutionRate: feasibleLikeRows.length === 0 ? null
      : feasibleLikeRows.filter(row => row.pass).length / feasibleLikeRows.length,
    infeasibleCorrectRate: infeasibleLikeRows.length === 0 ? null
      : infeasibleLikeRows.filter(row => row.pass).length / infeasibleLikeRows.length,
    timeoutRate: summary.total === 0 ? null : timedOutRows.length / summary.total,
    hardViolationCases: hardViolationRows.map(row => ({ id: row.id, violations: row.hardViolations })),
  },
  runtime: {
    minMs: runtimes[0] ?? null,
    maxMs: runtimes[runtimes.length - 1] ?? null,
    meanMs: runtimes.length === 0 ? null : runtimes.reduce((sum, v) => sum + v, 0) / runtimes.length,
    p95Ms: percentile(runtimes, 0.95),
  },
  rows: summary.rows,
};

if (process.argv.includes('--markdown')) {
  console.log('# Scheduler feasibility benchmark');
  console.log(`- Fixture: \`${report.fixture}\``);
  console.log(`- ${report.totals.passed}/${report.totals.total} cases passed`);
  console.log(`- Feasible-solution rate: ${report.totals.feasibleSolutionRate ?? '—'}`);
  console.log(`- Infeasible-correct rate: ${report.totals.infeasibleCorrectRate ?? '—'}`);
  console.log(`- Timeout rate: ${report.totals.timeoutRate ?? '—'}`);
  console.log(`- Runtime (ms): min ${report.runtime.minMs} / mean ${report.runtime.meanMs?.toFixed(1)} / p95 ${report.runtime.p95Ms} / max ${report.runtime.maxMs}`);
  console.log('');
  console.log('| case | category | pass | hard violations | runtime (ms) | solver status |');
  console.log('| --- | --- | :---: | ---: | ---: | --- |');
  for (const row of report.rows) {
    console.log(`| ${row.id} | ${row.category} | ${row.pass ? 'pass' : 'FAIL'} | ${row.hardViolationCount} | ${row.runtimeMs} | ${row.solverStatus} |`);
  }
} else {
  console.log(JSON.stringify(report, null, 2));
}

if (!process.argv.includes('--no-write')) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`\n已寫入 ${path.relative(process.cwd(), reportPath)}（進版控，用 git diff 看退步）`);
}

process.exit(report.totals.failed === 0 ? 0 : 1);
