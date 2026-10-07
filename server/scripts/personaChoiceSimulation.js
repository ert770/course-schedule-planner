// Roadmap #10 任務 3B：讓語言模型扮演測試 Persona，對真實排課結果做方案選擇。
//
// **這是模擬資料，不是真實使用者的選擇。** 輸出只寫到 `server/simulation-runs/`
// （不進版控），不寫 MySQL 的互動事件表，所以不會與真實事件混在一起。3B 計畫 3.1 節
// 明定自動腳本產生的選擇不能算進正式啟用門檻；這份資料只用於測試帳號的模擬評估。
//
// 用法：
//   node scripts/personaChoiceSimulation.js --personas=9003,9002 --limit=5   # 小量試跑
//   node scripts/personaChoiceSimulation.js --limit=30                       # 全部 10 位
//   加上 --dry-run 只排課、不呼叫模型（用來看每位能產生幾道題）。
//
// 對資料庫只做 SELECT。會把 Persona 的設定與課程資訊送到 OpenAI（皆為測試人物與公開課程資料）。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(scriptDir, '..', '.env'), quiet: true });
dotenv.config({ path: path.resolve(scriptDir, '..', '..', '.env'), quiet: true });

const { ACTIVE_TERM } = await import('../src/data/activeTerm.js');
const { getAll } = await import('../src/db/database.js');
const { closePool, isMysqlConfigured } = await import('../src/db/mysql.js');
const { getUserPreferences } = await import('../src/services/memoryService.js');
const { annotateScheduleIdentifiers, buildExposureDraft } = await import('../src/services/scheduleService.js');
const { generateSchedule, setSchedulingHighsRuntime } = await import('../src/skills/scheduler.js');
const { getHighsRuntime } = await import('../src/skills/optimization/highsRuntime.js');
const { buildStudentScope } = await import('../src/skills/courseScope.js');
const {
  absentLearnedPreference, buildCandidates, buildCaseConstraints,
} = await import('./lib/demoCaseLoader.js');
const {
  PLAN_LABELS, SIMULATION_PERSONAS, SIMULATION_PROMPT_VERSION,
  buildChoicePrompt, buildScenarios, explicitDirection, parseChoice,
  querySignature, shuffled, v2ExplicitProfile,
} = await import('./lib/personaScenarios.js');

const args = process.argv.slice(2);
const argValue = name => args.find(arg => arg.startsWith(`--${name}=`))?.split('=')[1];
const dryRun = args.includes('--dry-run');
const limit = Number(argValue('limit') ?? 30);
const personaFilter = argValue('personas')?.split(',').map(Number);
const personas = SIMULATION_PERSONAS.filter(persona => !personaFilter || personaFilter.includes(persona.userId));
const MODEL = process.env.OPENAI_MODEL || 'gpt-5.6-luna';
const CALL_TIMEOUT_MS = 120000;
// 模擬回合的時間軸：每題間隔一天，只用來決定先後順序。
const BASE_TIME = Date.UTC(2026, 9, 1, 9, 0, 0);

function planPolicies(plans) {
  return plans.filter(plan => plan.generationPolicy).map(plan => ({
    planId: plan.planId, variantId: plan.variantId, ...plan.generationPolicy,
  }));
}

// 候選池由學生的 scope（系級、班級、修課紀錄）決定，與這次排課的偏好設定無關；
// 查一次約 3 秒，所以同一個 scope 只查一次。scope 真的不同時 key 也不同，不會誤用。
async function candidatesFor(constraints, allCourses, cache) {
  const key = JSON.stringify(buildStudentScope(constraints));
  if (!cache.pools.has(key)) cache.pools.set(key, await buildCandidates(constraints, allCourses));
  cache.size = cache.pools.get(key).length;
  // 排課引擎會在課程物件上附註欄位，每次給一份淺拷貝，避免上一題的註記帶到下一題。
  return cache.pools.get(key).map(course => ({ ...course }));
}

// 排出一個情境的方案。回傳 `{ skip }` 表示這個情境不能當一道比較題，並附原因。
function buildQuery({ persona, prefs, scenario, reviews, candidatesCache, allCourses, index }) {
  const constraints = buildCaseConstraints(scenario.input, prefs, {
    reviews, learnedPreference: absentLearnedPreference('simulation'),
  });
  return candidatesFor(constraints, allCourses, candidatesCache).then(candidates => {
    const requestId = `sim-${persona.userId}-${String(index).padStart(3, '0')}`;
    const result = annotateScheduleIdentifiers(generateSchedule(candidates, constraints, {}), requestId);
    const plans = result.plans ?? [];
    if (plans.length < 2) return { skip: 'single-plan' };
    const exposure = buildExposureDraft(result, requestId, { surface: 'simulation', trigger: 'simulation' });
    const features = exposure?.exposureContext?.planFeatures;
    if (!features) return { skip: 'incomplete-features' };
    return { requestId, plans, features, planPolicies: planPolicies(plans) };
  });
}

async function askModel(client, prompt) {
  const response = await client.responses.create({
    model: MODEL,
    instructions: prompt.system,
    input: [{ role: 'user', content: prompt.user }],
  }, { timeout: CALL_TIMEOUT_MS });
  return { text: response.output_text || '', model: response.model || MODEL };
}

async function main() {
  if (!isMysqlConfigured()) throw new Error('模擬需要連線 MySQL 讀取 Persona 與課程資料。');
  let client = null;
  if (!dryRun) {
    if (!process.env.OPENAI_API_KEY) throw new Error('未設定 OPENAI_API_KEY，無法呼叫模型；可加 --dry-run 只排課。');
    const { default: OpenAI } = await import('openai');
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }

  setSchedulingHighsRuntime(await getHighsRuntime());
  const reviews = await getAll('reviews');
  const allCourses = await getAll('courses');
  const rounds = [];
  const profiles = {};
  const summary = [];
  const transcript = ['# Persona 模擬選擇逐題紀錄', '', '> 模擬資料，不是真實使用者的選擇。', ''];

  for (const persona of personas) {
    const identity = { canonicalId: persona.studentId, numericId: String(persona.userId), studentId: persona.studentId };
    const prefs = await getUserPreferences(identity);
    profiles[persona.studentId] = { explicit: explicitDirection(prefs), v2Explicit: v2ExplicitProfile(prefs) };
    const scenarios = buildScenarios(prefs, { seed: persona.userId });
    const seen = new Set();
    const skipped = {};
    const candidatesCache = { size: 0, pools: new Map() };
    let usable = 0;
    let firstLabelChosen = 0;
    let invalid = 0;
    let tried = 0;

    for (const scenario of scenarios) {
      if (usable >= limit) break;
      tried += 1;
      const query = await buildQuery({
        persona, prefs, scenario, reviews, candidatesCache, allCourses, index: tried,
      });
      if (query.skip) {
        skipped[query.skip] = (skipped[query.skip] || 0) + 1;
        continue;
      }
      const signature = querySignature(query.plans);
      if (seen.has(signature)) {
        skipped['duplicate-query'] = (skipped['duplicate-query'] || 0) + 1;
        continue;
      }
      seen.add(signature);

      // 呈現順序與系統順序分開：features[0] 仍是系統主推，模型看到的順序另外打亂。
      const order = shuffled(query.plans.map((_, planIndex) => planIndex), persona.userId * 1000 + tried);
      const shown = order.map(planIndex => query.plans[planIndex]);
      const prompt = buildChoicePrompt({ prefs, scenario, plans: shown });
      const base = {
        simulated: true,
        subject: persona.studentId,
        scenarioId: scenario.scenarioId,
        scenarioNotes: scenario.notes,
        requestId: query.requestId,
        timestamp: new Date(BASE_TIME + usable * 86400000).toISOString(),
        term: { academicYear: ACTIVE_TERM.academicYear, semester: ACTIVE_TERM.semester },
        features: query.features,
        planPolicies: query.planPolicies,
        displayOrder: order,
        promptVersion: SIMULATION_PROMPT_VERSION,
      };

      if (dryRun) {
        usable += 1;
        rounds.push({ ...base, chosenIndex: null, reason: null, model: null });
        continue;
      }

      const answer = await askModel(client, prompt);
      const choice = parseChoice(answer.text, shown.length);
      if (!choice) {
        invalid += 1;
        skipped['invalid-answer'] = (skipped['invalid-answer'] || 0) + 1;
        continue;
      }
      usable += 1;
      if (choice.index === 0) firstLabelChosen += 1;
      const chosenIndex = order[choice.index];
      rounds.push({ ...base, chosenIndex, reason: choice.reason, model: answer.model });
      transcript.push(
        `## ${persona.userId} 第 ${usable} 題（${scenario.scenarioId}）`, '',
        '```text', prompt.user, '```', '',
        `**選擇：方案 ${PLAN_LABELS[choice.index]}**（系統方案 \`${query.plans[chosenIndex].variantId}\`，`
        + `${chosenIndex === 0 ? '是' : '不是'}系統主推）`, '',
        `理由：${choice.reason}`, '',
        `方案特徵（模型看不到）：${query.features.map(feature => (
          `${feature.variantId} 興趣 ${feature.interest?.toFixed(2)}／集中 ${feature.compact?.toFixed(2)}／輕鬆 ${feature.easy === null ? '無' : feature.easy.toFixed(2)}`
        )).join('；')}`, '',
      );
    }

    summary.push({
      userId: persona.userId,
      scenariosTried: tried,
      usableRounds: usable,
      candidatePool: candidatesCache.size,
      skipped,
      invalidAnswers: invalid,
      firstShownChosenRate: dryRun || usable === 0 ? null : Math.round((firstLabelChosen / usable) * 100) / 100,
      systemPrimaryChosenRate: dryRun || usable === 0 ? null : Math.round(
        (rounds.filter(round => round.subject === persona.studentId && round.chosenIndex === 0).length / usable) * 100
      ) / 100,
    });
  }

  const stamp = argValue('out') ?? new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = path.resolve(scriptDir, '..', 'simulation-runs', stamp);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'rounds.json'), JSON.stringify({
    simulated: true,
    generatedAt: new Date().toISOString(),
    model: dryRun ? null : MODEL,
    promptVersion: SIMULATION_PROMPT_VERSION,
    limit,
    dryRun,
    profiles,
    summary,
    rounds,
  }, null, 2));
  if (!dryRun) fs.writeFileSync(path.join(outDir, 'transcript.md'), transcript.join('\n'));
  console.log(JSON.stringify({ outDir, dryRun, summary }, null, 2));
}

try {
  await main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await closePool();
}
