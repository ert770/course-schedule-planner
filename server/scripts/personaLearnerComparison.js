// 實驗：「v2 ＋ 標籤興趣排序」對「Choice Perceptron ＋ 標籤興趣排序」，用 10 位測試 Persona。
//
// **這是離線實驗，全部是模擬資料。** 對資料庫只做 SELECT；標籤興趣檔、選擇紀錄與學到的權重
// 都只存在記憶體與 `server/simulation-runs/`（不進版控），不寫 Interaction_Events、
// Learned_Preference_Weights 或 Learned_Tag_Interests。線上預設不受影響。
//
// 三個步驟（--step 可單獨執行，後面的步驟讀前面的輸出）：
//   tags     每位 Persona 對一批非必修課表態（有興趣／沒興趣／想多了解），用正式的
//            computeTagInterestProfile() 算出標籤興趣檔。
//   choices  帶著標籤興趣檔跑正式排課，產生方案選擇題，由模型扮演 Persona 選（三票取過半數）。
//   compare  用選擇紀錄學出 v2 與 CP 的權重，各自帶著同一份標籤興趣檔排課；兩份主推課表不同時，
//            由模型扮演 Persona 選哪一份比較好（三票取過半數）。
//
// 用法：
//   node scripts/personaLearnerComparison.js --out=exp1 --step=tags --personas=9003,9002
//   node scripts/personaLearnerComparison.js --out=exp1            # 三步全跑、10 位

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
const { buildInterestExplorationCards } = await import('../src/services/interestExplorationService.js');
const { generateSchedule, setSchedulingHighsRuntime } = await import('../src/skills/scheduler.js');
const { validateScheduleAgainstConstraints } = await import('../src/skills/scheduleValidator.js');
const { getHighsRuntime } = await import('../src/skills/optimization/highsRuntime.js');
const { buildStudentScope } = await import('../src/skills/courseScope.js');
const { filterCategorizedCourses } = await import('../src/skills/courseQuery.js');
const { buildTagInterestContext } = await import('../src/skills/tagInterestRanking.js');
const { buildTagInterestSnapshot, computeTagInterestProfile } = await import('../src/skills/tagInterestLearning.js');
const {
  CHOICE_LEARNING_RATE_GRID, computeLearnedBoosts, learnChoicePerceptronWeights,
  learnPreferenceWeights, SUFFICIENCY_STATUS,
} = await import('../src/skills/preferenceLearning.js');
const { absentLearnedPreference, buildCandidates, buildCaseConstraints } = await import('./lib/demoCaseLoader.js');
const { roundToEvents } = await import('./lib/choiceEvaluation.js');
const { predictIndex } = await import('./lib/choiceReplayFixture.js');
const {
  PERIOD_LEGEND, PLAN_LABELS, SIMULATION_PERSONAS, SIMULATION_PROMPT_VERSION,
  buildChoicePrompt, buildScenarios, describePersona, explicitDirection, majorityChoice,
  parseChoice, querySignature, shuffled, v2ExplicitProfile,
} = await import('./lib/personaScenarios.js');

const args = process.argv.slice(2);
const argValue = name => args.find(arg => arg.startsWith(`--${name}=`))?.split('=')[1];
const outName = argValue('out');
if (!outName) { console.error('請指定 --out=<名稱>'); process.exit(1); }
const outDir = path.resolve(scriptDir, '..', 'simulation-runs', outName);
const step = argValue('step') ?? 'all';
const personaFilter = argValue('personas')?.split(',').map(Number);
const personas = SIMULATION_PERSONAS.filter(item => !personaFilter || personaFilter.includes(item.userId));
const CHOICE_LIMIT = Number(argValue('limit') ?? 30);
const CARD_LIMIT = Number(argValue('cards') ?? 24);
const COMPARE_LIMIT = Number(argValue('compare') ?? 12);
const VOTES = 3;
// 保守版 CP：--cp-rate 固定學習率（不給就照舊用留一法選）；--cp-guard 讓明確勾選的面向不被學成相反。
// --label 讓比較步驟的輸出另存一份，不蓋掉先前的結果。
const CP_RATE = argValue('cp-rate') ? Number(argValue('cp-rate')) : null;
const CP_GUARD = args.includes('--cp-guard');
const LABEL = argValue('label') ? `-${argValue('label')}` : '';
const MODEL = process.env.OPENAI_MODEL || 'gpt-5.6-luna';
const BASE_TIME = Date.UTC(2026, 9, 1, 9, 0, 0);
const term = { academicYear: ACTIVE_TERM.academicYear, semester: ACTIVE_TERM.semester };

const readJson = name => JSON.parse(fs.readFileSync(path.join(outDir, name), 'utf8'));
const writeJson = (name, data) => {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, name), JSON.stringify(data, null, 2));
};
const identityOf = persona => ({
  canonicalId: persona.studentId, numericId: String(persona.userId), studentId: persona.studentId,
});

let client = null;
async function ask(system, user) {
  if (!client) {
    if (!process.env.OPENAI_API_KEY) throw new Error('未設定 OPENAI_API_KEY。');
    const { default: OpenAI } = await import('openai');
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  const response = await client.responses.create({
    model: MODEL, instructions: system, input: [{ role: 'user', content: user }],
  }, { timeout: 120000 });
  return response.output_text || '';
}

// ── 步驟一：標籤興趣檔 ───────────────────────────────────────────────

const FEEDBACK_LABELS = { interested: '有興趣', not_interested: '沒興趣', learn_more: '想多了解' };

function parseFeedback(text, count) {
  const match = String(text ?? '').match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const answers = JSON.parse(match[0]).answers;
    if (!Array.isArray(answers) || answers.length !== count) return null;
    const valid = answers.every(item => Object.hasOwn(FEEDBACK_LABELS, item));
    return valid ? answers : null;
  } catch { return null; }
}

async function stepTags(allCourses) {
  const output = { simulated: true, model: MODEL, cardLimit: CARD_LIMIT, personas: {} };
  const transcript = ['# Persona 對課程主題的表態', '', '> 模擬資料，不是真實使用者的回饋。', ''];
  for (const persona of personas) {
    const prefs = await getUserPreferences(identityOf(persona));
    const scope = buildStudentScope(prefs);
    const eligible = filterCategorizedCourses(allCourses, {}, scope, { includeGeneralEducation: true, schedulingPool: true });
    // 與 App 的初始探索同一個選卡函式；App 一次給 8 張，這裡要 CARD_LIMIT 張以得到足夠的訊號。
    const cards = buildInterestExplorationCards(eligible, prefs, { limit: CARD_LIMIT });
    const bySection = new Map(eligible.map(course => [Number(course.sectionId ?? course.id), course]));
    const listing = cards.map((card, index) => (
      `${index + 1}. ${card.name}｜${card.category}｜${card.department ?? ''}｜主題：${card.tags.map(tag => tag.canonicalName).join('、')}`
    )).join('\n');
    const system = [
      '你要扮演一位大學生，看一批這學期可以選的課，逐門說你對它的主題有沒有興趣。',
      '完全依照這位學生的背景、個性與選課想法判斷。不要每一門都說有興趣；與你的方向無關的就說沒興趣。',
      `只回傳 JSON：{"answers":[...]}，陣列長度必須是 ${cards.length}，每一項只能是 "interested"、"not_interested" 或 "learn_more"。`,
    ].join('\n');
    const user = `${describePersona(prefs)}\n\n以下是 ${cards.length} 門課：\n${listing}`;

    const votes = [];
    for (let attempt = 0; attempt < VOTES; attempt += 1) votes.push(parseFeedback(await ask(system, user), cards.length));
    const valid = votes.filter(Boolean);
    const responses = cards.map((_, index) => {
      const counts = {};
      for (const vote of valid) counts[vote[index]] = (counts[vote[index]] || 0) + 1;
      const winner = Object.entries(counts).find(([, count]) => count * 2 > VOTES);
      return winner ? winner[0] : null; // 沒有過半就不採用這一張
    });

    const events = [];
    cards.forEach((card, index) => {
      const response = responses[index];
      if (!response) return;
      const course = bySection.get(card.sectionId);
      const event = {
        eventId: `tagsim-${persona.userId}-${index}`,
        eventType: 'interest_exploration_feedback',
        timestamp: new Date(BASE_TIME - 86400000 + index * 60000).toISOString(),
        term,
        course: { catalogCourseCode: card.courseCode, sectionId: card.sectionId },
        source: 'exploration',
        // App 裡表示「沒興趣」時要勾選是哪幾個主題。模擬沒有問到這麼細，一律算在這張卡的全部主題上，
        // 所以負面訊號會比真實操作來得粗。
        interestFeedback: response === 'not_interested'
          ? { response, canonicalTagIds: card.tags.map(tag => tag.canonicalTagId) }
          : { response },
      };
      events.push({ ...event, tagInterestSnapshot: buildTagInterestSnapshot(event, course, scope) });
    });
    const profile = computeTagInterestProfile(events, prefs, { now: new Date(BASE_TIME), activeTerm: ACTIVE_TERM });
    const counts = responses.reduce((acc, item) => { acc[item ?? 'no-majority'] = (acc[item ?? 'no-majority'] || 0) + 1; return acc; }, {});
    output.personas[persona.studentId] = {
      cards: cards.length, validVotes: valid.length, responses: counts,
      evidenceTags: profile.tagInterests.filter(tag => tag.hasEvidence).length,
      profile,
    };
    transcript.push(`## ${persona.userId}`, '', ...cards.map((card, index) => (
      `- ${FEEDBACK_LABELS[responses[index]] ?? '（三票沒有過半）'}｜${card.name}｜${card.tags.map(tag => tag.canonicalName).join('、')}`
    )), '');
    console.log(persona.userId, 'cards', cards.length, JSON.stringify(counts), 'evidence tags', output.personas[persona.studentId].evidenceTags);
  }
  writeJson('tag-profiles.json', output);
  fs.writeFileSync(path.join(outDir, 'tag-transcript.md'), transcript.join('\n'));
}

// ── 共用：帶標籤興趣檔的排課 ──────────────────────────────────────────

function makeScheduler(reviews, allCourses) {
  const pools = new Map();
  return async function schedule({ prefs, input, learnedPreference, tagProfile, requestId }) {
    const constraints = buildCaseConstraints(input, prefs, { reviews, learnedPreference });
    const key = JSON.stringify(buildStudentScope(constraints));
    if (!pools.has(key)) pools.set(key, await buildCandidates(constraints, allCourses));
    const candidates = pools.get(key).map(course => ({ ...course }));
    const tagInterestContext = buildTagInterestContext({
      mode: 'active', profileSource: 'consented-learned', profile: tagProfile, candidates,
    });
    const result = annotateScheduleIdentifiers(
      generateSchedule(candidates, constraints, { tagInterestContext }), requestId
    );
    return { result, constraints };
  };
}

// ── 步驟二：方案選擇紀錄 ─────────────────────────────────────────────

async function stepChoices(schedule) {
  const tagData = readJson('tag-profiles.json');
  const rounds = [];
  const profiles = {};
  const summary = [];
  for (const persona of personas) {
    const prefs = await getUserPreferences(identityOf(persona));
    const tagProfile = tagData.personas[persona.studentId]?.profile ?? null;
    profiles[persona.studentId] = { explicit: explicitDirection(prefs), v2Explicit: v2ExplicitProfile(prefs) };
    const seen = new Set();
    const skipped = {};
    let usable = 0;
    let tried = 0;
    for (const scenario of buildScenarios(prefs, { seed: persona.userId })) {
      if (usable >= CHOICE_LIMIT) break;
      tried += 1;
      const requestId = `sim-${persona.userId}-${String(tried).padStart(3, '0')}`;
      const { result } = await schedule({
        prefs, input: scenario.input, learnedPreference: absentLearnedPreference('simulation'), tagProfile, requestId,
      });
      const plans = result.plans ?? [];
      const bump = reason => { skipped[reason] = (skipped[reason] || 0) + 1; };
      if (plans.length < 2) { bump('single-plan'); continue; }
      const features = buildExposureDraft(result, requestId, { surface: 'simulation', trigger: 'simulation' })
        ?.exposureContext?.planFeatures;
      if (!features) { bump('incomplete-features'); continue; }
      const signature = querySignature(plans);
      if (seen.has(signature)) { bump('duplicate-query'); continue; }
      seen.add(signature);

      const order = shuffled(plans.map((_, index) => index), persona.userId * 1000 + tried);
      const shown = order.map(index => plans[index]);
      const prompt = buildChoicePrompt({ prefs, scenario, plans: shown });
      const answers = await Promise.all(Array.from({ length: VOTES }, () => ask(prompt.system, prompt.user)));
      const decision = majorityChoice(answers.map(text => parseChoice(text, shown.length)), VOTES);
      if (!decision) { bump('no-majority'); continue; }
      usable += 1;
      rounds.push({
        simulated: true, subject: persona.studentId, scenarioId: scenario.scenarioId, requestId,
        timestamp: new Date(BASE_TIME + usable * 86400000).toISOString(), term, features,
        planPolicies: plans.filter(plan => plan.generationPolicy).map(plan => ({
          planId: plan.planId, variantId: plan.variantId, ...plan.generationPolicy,
        })),
        chosenIndex: order[decision.choice.index], reason: decision.choice.reason,
        promptVersion: SIMULATION_PROMPT_VERSION,
      });
    }
    summary.push({ userId: persona.userId, scenariosTried: tried, usableRounds: usable, skipped });
    console.log(persona.userId, 'tried', tried, 'usable', usable, JSON.stringify(skipped));
  }
  writeJson('rounds.json', { simulated: true, model: MODEL, promptVersion: SIMULATION_PROMPT_VERSION, profiles, summary, rounds });
}

// ── 步驟三：兩種學習器各自排課，再由 Persona 選 ────────────────────────

// CP 的學習率：在這位以外的所有人身上選（留一法），避免用自己的選擇調自己的參數。
function pickLearningRate(roundsBySubject, profiles, exclude) {
  let best = { rate: CHOICE_LEARNING_RATE_GRID[0], accuracy: -1 };
  for (const rate of CHOICE_LEARNING_RATE_GRID) {
    let hits = 0;
    let total = 0;
    for (const [subject, list] of roundsBySubject) {
      if (subject === exclude || list.length < 5) continue;
      const cut = Math.floor(list.length * 0.8);
      const weights = learnChoicePerceptronWeights(list.slice(0, cut).flatMap(roundToEvents), {
        explicitProfile: profiles[subject].explicit, learningRate: rate,
      }).weights;
      for (const round of list.slice(cut)) {
        total += 1;
        if (predictIndex(weights, round.features) === round.chosenIndex) hits += 1;
      }
    }
    const accuracy = total === 0 ? 0 : hits / total;
    if (accuracy > best.accuracy + 1e-9) best = { rate, accuracy };
  }
  return best;
}

function describePair(prefs, scenario, plans) {
  const situation = scenario.notes.length > 0
    ? `這一次排課你另外設定了：${scenario.notes.join('；')}。`
    : '這一次排課你沒有另外調整設定。';
  const base = buildChoicePrompt({ prefs, scenario, plans });
  return {
    system: [
      '你要扮演一位大學生。系統用兩種不同的方式各排出一份課表，請選出你這學期真的會用的那一份。',
      '請完全依照這位學生的處境、個性與選課想法來選，不要因為某一份排在前面就選它。',
      '兩份課表只差在「只有這個方案才有的課」，共同的課不能拿來當理由。',
      '下結論前，先核對你要引用的星期、節次與時間是否和課程資料寫的一致。',
      '只回傳 JSON：{"choice":"方案代號","reason":"用一兩句話說明為什麼，要講到兩份課表不同的課"}。',
    ].join('\n'),
    user: base.user.replace(/系統排出 \d+ 個方案。/, `${situation}\n以下是兩份課表。`).replace(`${situation}\n\n${PERIOD_LEGEND}`, PERIOD_LEGEND),
  };
}

async function stepCompare(schedule) {
  const tagData = readJson('tag-profiles.json');
  const choiceData = readJson('rounds.json');
  const roundsBySubject = new Map();
  for (const round of choiceData.rounds) {
    if (!roundsBySubject.has(round.subject)) roundsBySubject.set(round.subject, []);
    roundsBySubject.get(round.subject).push(round);
  }
  const report = { simulated: true, model: MODEL, cpRate: CP_RATE ?? 'leave-one-out', cpGuard: CP_GUARD, personas: [] };
  const transcript = ['# v2＋標籤 對 CP＋標籤：逐題紀錄', '', '> 模擬資料。', ''];

  for (const persona of personas) {
    const prefs = await getUserPreferences(identityOf(persona));
    const tagProfile = tagData.personas[persona.studentId]?.profile ?? null;
    const list = roundsBySubject.get(persona.studentId) ?? [];
    const profile = choiceData.profiles[persona.studentId];
    const events = list.flatMap(roundToEvents);

    const v2 = learnPreferenceWeights(events, { explicitProfile: profile.v2Explicit });
    const v2Sufficient = v2.sufficiency.status === SUFFICIENCY_STATUS.SUFFICIENT;
    const v2Learned = v2Sufficient
      ? { applied: true, reason: 'applied', boosts: computeLearnedBoosts(v2.weights, profile.v2Explicit), modelVersion: v2.modelVersion }
      : absentLearnedPreference('insufficient');
    const picked = CP_RATE !== null
      ? { rate: CP_RATE }
      : pickLearningRate(roundsBySubject, choiceData.profiles, persona.studentId);
    const cp = learnChoicePerceptronWeights(events, {
      explicitProfile: profile.explicit, learningRate: picked.rate, respectExplicitDirection: CP_GUARD,
    });
    const cpLearned = { applied: true, reason: 'applied', mode: 'signed', weights: cp.weights, modelVersion: cp.modelVersion };

    const row = {
      userId: persona.userId, choices: list.length, v2Status: v2.sufficiency.status,
      v2Boosts: v2Learned.boosts ?? null, cpWeights: cp.weights, cpLearningRate: picked.rate,
      scenarios: 0, identical: 0, v2Wins: 0, cpWins: 0, noMajority: 0, invalidPlans: 0, items: [],
    };
    // 比較題用與選擇紀錄不同的種子排序，並跳過兩邊排出同一份課表的情境。
    const scenarios = buildScenarios(prefs, { seed: persona.userId + 500000 });
    const seen = new Set();
    for (const scenario of scenarios) {
      if (row.v2Wins + row.cpWins + row.noMajority >= COMPARE_LIMIT || row.scenarios >= 80) break;
      row.scenarios += 1;
      const run = async (learnedPreference, tag) => {
        const { result, constraints } = await schedule({
          prefs, input: scenario.input, learnedPreference, tagProfile, requestId: `cmp-${persona.userId}-${row.scenarios}-${tag}`,
        });
        const plan = (result.plans ?? []).find(item => item.planId === result.recommendedPlanId) ?? result.plans?.[0] ?? null;
        const valid = plan ? validateScheduleAgainstConstraints(
          [...(plan.schedule || []), ...(plan.unscheduledCourses || [])], constraints,
          { excludedCourses: plan.excludedCourses || [] }
        ).valid : false;
        return { plan, valid };
      };
      const a = await run(v2Learned, 'v2');
      const b = await run(cpLearned, 'cp');
      if (!a.plan || !b.plan) continue;
      if (!a.valid || !b.valid) row.invalidPlans += 1;
      const signature = querySignature([a.plan, b.plan]);
      if (querySignature([a.plan]) === querySignature([b.plan])) { row.identical += 1; continue; }
      if (seen.has(signature)) continue;
      seen.add(signature);

      const flip = shuffled([0, 1], persona.userId * 77 + row.scenarios)[0] === 1;
      const shown = flip ? [b.plan, a.plan] : [a.plan, b.plan];
      const prompt = describePair(prefs, scenario, shown);
      const answers = await Promise.all(Array.from({ length: VOTES }, () => ask(prompt.system, prompt.user)));
      const decision = majorityChoice(answers.map(text => parseChoice(text, 2)), VOTES);
      const names = plan => plan.schedule.map(course => course.name);
      const onlyA = names(a.plan).filter(name => !names(b.plan).includes(name));
      const onlyB = names(b.plan).filter(name => !names(a.plan).includes(name));
      let winner = 'no-majority';
      if (decision) winner = (decision.choice.index === 0) !== flip ? 'v2' : 'cp';
      if (winner === 'v2') row.v2Wins += 1; else if (winner === 'cp') row.cpWins += 1; else row.noMajority += 1;
      row.items.push({
        scenarioId: scenario.scenarioId, winner, unanimous: decision?.unanimous ?? false,
        v2Only: onlyA, cpOnly: onlyB, v2Credits: a.plan.totalCredits, cpCredits: b.plan.totalCredits,
        v2Days: a.plan.planMetrics?.usedDays ?? null, cpDays: b.plan.planMetrics?.usedDays ?? null,
        v2TagScore: a.plan.planMetrics?.planTagScore ?? null, cpTagScore: b.plan.planMetrics?.planTagScore ?? null,
        reason: decision?.choice.reason ?? null,
      });
      transcript.push(
        `## ${persona.userId}（${scenario.scenarioId}）→ ${winner === 'v2' ? 'v2＋標籤' : winner === 'cp' ? 'CP＋標籤' : '三票沒有過半'}`, '',
        `- 情境：${scenario.notes.join('；') || '沒有另外設定'}`,
        `- v2＋標籤 才有的課：${onlyA.join('、') || '（無）'}（${a.plan.totalCredits} 學分）`,
        `- CP＋標籤 才有的課：${onlyB.join('、') || '（無）'}（${b.plan.totalCredits} 學分）`,
        `- 理由：${decision?.choice.reason ?? '—'}`, '',
      );
    }
    report.personas.push(row);
    console.log(persona.userId, 'choices', row.choices, 'v2', row.v2Status, 'cp', JSON.stringify(row.cpWeights), 'η', row.cpLearningRate,
      '| scenarios', row.scenarios, 'identical', row.identical, 'v2 wins', row.v2Wins, 'cp wins', row.cpWins, 'no-majority', row.noMajority, 'invalid', row.invalidPlans);
  }
  writeJson(`comparison${LABEL}.json`, report);
  fs.writeFileSync(path.join(outDir, `comparison-transcript${LABEL}.md`), transcript.join('\n'));
}

try {
  if (!isMysqlConfigured()) throw new Error('需要連線 MySQL 讀取 Persona 與課程資料。');
  setSchedulingHighsRuntime(await getHighsRuntime());
  const reviews = await getAll('reviews');
  const allCourses = await getAll('courses');
  const schedule = makeScheduler(reviews, allCourses);
  if (step === 'all' || step === 'tags') await stepTags(allCourses);
  if (step === 'all' || step === 'choices') await stepChoices(schedule);
  if (step === 'all' || step === 'compare') await stepCompare(schedule);
} catch (error) {
  console.error(error.stack || error.message);
  process.exitCode = 1;
} finally {
  await closePool();
}
