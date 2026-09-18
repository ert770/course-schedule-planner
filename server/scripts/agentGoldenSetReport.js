// Roadmap #34：Agent 需求理解 eval 的離線成績單。
//
// 為什麼獨立成一個指令而不是塞進 `npm test`（比照 `bench:personalization`）：
// 多輪題目每輪都要打一次模型，成本是單輪題的數倍，而這把 API key 是共用的。
// `npm test` 保留 13 題單輪（開發者不能跳過）；成本最高的多輪與 preflight 題
// 在這裡跑。
//
// **這份成績單能證明什麼、不能證明什麼**：
//
//   能：同一台機器上，prompt／tool schema／模型換版前後，哪一題退步了。
//
//   不能：跨機器或跨人的比較。CI 依既有決定不跑 golden set（避免把 API key 放進
//   public repo 的 secret），所以沒有共享 baseline——這實際上是「某一台開發機跟
//   自己比」。不要把它讀成團隊層級的品質指標。
//
// 用法：
//   npm run eval:golden-set              寫檔並印摘要
//   npm run eval:golden-set -- --json    印完整 JSON 到 stdout
//   npm run eval:golden-set -- --no-write 不寫檔（只看結果）

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import OpenAI from 'openai';

import { buildSystemPrompt, getAgentTools } from '../src/services/promptService.js';
import { executeAgentTool, buildToolResultEnvelope, summarizeScheduleForModel } from '../src/services/agentService.js';
import { checkPreflightContradictions } from '../src/services/requirementPreflight.js';
import { summarizeGoldenSet } from '../src/services/goldenSetAssertions.js';
import { runCase, runMultiTurnCase } from '../src/services/goldenSetRunner.js';
import { sha256Hex } from '../src/utils/hash.js';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(scriptDir, '..', 'test', 'fixtures');
const reportPath = path.join(scriptDir, '..', 'test', 'reports', 'golden-set-latest.json');

const singleTurn = JSON.parse(fs.readFileSync(path.join(fixtureDir, 'agentGoldenSet.json'), 'utf8'));
const multiTurn = JSON.parse(fs.readFileSync(path.join(fixtureDir, 'agentGoldenSetMultiTurn.json'), 'utf8'));

if (!process.env.OPENAI_API_KEY) {
  console.error('需要 OPENAI_API_KEY（server/.env）。這是環境未設定，不是程式壞掉。');
  process.exit(1);
}
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0 });

// **不能用空 profile 建 scope。** `buildStudentScope({})` 會得到 `resolved: false`，
// preflight 的第 (1) 項就會無條件觸發「請提供你的系所與年級」——於是每一題都會
// 「該問就問」，但問的是系所年級，跟題目要測的矛盾完全無關。那會做出一個永遠
// 通過、實際上什麼都沒測到的 eval。
//
// 直接沿用 `test/requirementPreflight.test.js` 已在用的 DB-free 字面量。
const RESOLVED_SCOPE = { department: '資訊工程學系', grade: 3, resolved: true };

// 但有一題**需要**未解析的 scope：測「伺服器擋下之後模型有沒有回頭問」時，
// 情境必須是模型自己看不出來、只有伺服器查得到的缺資料。系所無法解析正是
// 這種——使用者說的話完全正常（「幫我排一份這學期的課表」），模型沒有理由
// 起疑，是伺服器比對 scope 後才知道必修判定其實是懸空的。
const UNRESOLVED_SCOPE = { department: null, grade: null, resolved: false };

let activeScope = RESOLVED_SCOPE;

// 排課真的被呼叫到時要看得出來。**不要用 throw**：`executeAgentTool` 的 catch
// 會把例外吞成一般的工具錯誤，於是「該澄清卻沒澄清」在模型眼裡變成一個普通的
// 工具失敗，測到的會是模型對錯誤的反應，而不是一個明確的失敗。
const SCHEDULER_SENTINEL = { __evalSentinel: 'generateSchedule 被呼叫了' };

let schedulerWasCalled = false;

async function toolResultFor(call) {
  // 走完整的 `executeAgentTool` 路徑，拿到**模型真正會看到的**回傳形狀
  // （含 clarification、solver.status、errorCode），而不是自己另外編一份。
  const result = await executeAgentTool(
    call.name,
    call.args ?? {},
    { identity: null, prefs: {}, studentScope: activeScope, turnId: 'eval-turn' },
    {
      // 這兩個一定要一起注入。路徑是 lookupCourses → preflight →
      // 沒觸發就直接 generateSchedule；只擋前者的話，「以為會澄清但其實沒有」
      // 的題目會真的去打資料庫排一次課。
      lookupCourses: async () => new Map(),
      generateSchedule: async () => {
        schedulerWasCalled = true;
        return SCHEDULER_SENTINEL;
      },
      preflight: checkPreflightContradictions,
    }
  );

  const projected = call.name === 'run_csp_scheduler' ? summarizeScheduleForModel(result) : result;
  return buildToolResultEnvelope(call.name, projected);
}

const startedAt = Date.now();
const singleResults = await Promise.all(singleTurn.cases.map(testCase => runCase(client, testCase)));
const multiResults = [];
for (const testCase of multiTurn.cases) {
  // 多輪題目彼此循序跑：每題內部本來就是連續多次呼叫，再並行下去容易撞
  // rate limit，而 429 會被當成「模型答錯」記進結果，比跑得慢更糟。
  schedulerWasCalled = false;
  activeScope = testCase.scope === 'unresolved' ? UNRESOLVED_SCOPE : RESOLVED_SCOPE;
  // eslint-disable-next-line no-await-in-loop
  const result = await runMultiTurnCase(client, testCase, toolResultFor);

  // **這題的前提沒成立就不能算通過。** `preflight-clarify` 測的是「被排課前
  // 檢查擋下之後，模型有沒有回頭問」；如果 preflight 根本沒觸發、排課真的被
  // 呼叫了，那第二輪測到的只是「模型對一個看不懂的回傳值有什麼反應」，
  // 跟要測的東西無關——實測踩過這個坑，題目綠燈但什麼都沒驗到。
  if (testCase.expectPreflight && schedulerWasCalled) {
    result.pass = false;
    result.failures = [
      ...(result.failures ?? []),
      '前提未成立：這題假設 preflight 會擋下排課，但 generateSchedule 實際被呼叫了'
        + '——代表送出的參數沒有觸發任何矛盾檢查，第二輪測到的不是「該問就問」。',
    ];
  }
  multiResults.push({ ...result, schedulerWasCalled });
}

const allResults = [...singleResults, ...multiResults];
const summary = summarizeGoldenSet(allResults);
const resolvedModels = [...new Set(allResults.map(r => r.model).filter(Boolean))];

const report = {
  generatedAt: new Date().toISOString(),
  durationMs: Date.now() - startedAt,
  // 記 API 解析後的真實 model id，不是 `OPENAI_MODEL` 那個別名——別名隨時可能
  // 被 provider 指到新快照，記別名的成績單無法比較。
  model: {
    requested: process.env.OPENAI_MODEL || 'gpt-5.6-luna',
    resolved: resolvedModels.length === 1 ? resolvedModels[0] : resolvedModels,
  },
  // **必須含 tools。** roadmap #24 影響最大的那次改動（allowRelaxation、
  // nonNegotiablePreferenceIds）完全在 tool schema 裡，一個字都沒改 system
  // prompt——只 hash prompt 的話那次改動不會讓 hash 移動一格。
  versions: {
    promptAndTools: sha256Hex({ systemPrompt: buildSystemPrompt({}), tools: getAgentTools() }),
    // 題庫自己也要 hash：沒有它就分不清「模型變壞」與「題目變難」。
    singleTurnFixture: sha256Hex(singleTurn),
    multiTurnFixture: sha256Hex(multiTurn),
  },
  totals: {
    total: summary.total,
    passed: summary.passed,
    failed: summary.failed,
    // pass@1 才是會動的那個數字。pass@N 因為重試幾乎永遠是 100%，
    // prompt 改壞了也看不出來——只報 pass@N 的回歸報告等於沒有回歸報告。
    passRate: summary.passRate,
    firstTryPassRate: summary.firstTryPassRate,
  },
  cases: allResults.map(result => ({
    id: result.id,
    pass: result.pass,
    attempts: result.attempts,
    firstTry: result.pass && result.attempts === 1,
    failures: result.failures,
    ...(result.turns ? { turns: result.turns.map(t => ({ turn: t.turn, pass: t.pass, tool: t.tool })) } : {}),
    ...(result.schedulerWasCalled !== undefined ? { schedulerWasCalled: result.schedulerWasCalled } : {}),
  })),
};

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`\ngolden set eval：${report.totals.passed}/${report.totals.total} 通過`);
  console.log(`  pass@1 ${Math.round(report.totals.firstTryPassRate * 100)}%`
    + `、pass@3 ${Math.round(report.totals.passRate * 100)}%`);
  console.log(`  model（解析後）：${JSON.stringify(report.model.resolved)}`);
  console.log(`  prompt+tools hash：${report.versions.promptAndTools.slice(0, 16)}`);
  for (const item of report.cases.filter(c => !c.pass)) {
    console.log(`    ✗ ${item.id} → ${item.failures.join('；')}`);
  }
}

if (!process.argv.includes('--no-write')) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`\n已寫入 ${path.relative(process.cwd(), reportPath)}（進版控，用 git diff 看退步）`);
}

process.exit(report.totals.failed === 0 ? 0 : 1);
