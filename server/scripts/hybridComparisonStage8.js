// 協同過濾構想階段 8／roadmap #32：比較非個人化、content-based（s_tag、s_vec）、協同過濾（s_cf）與 hybrid。
// **只讀**：對資料庫只做 SELECT；不寫任何表。輸出到 `server/simulation-runs/<out>/`（不進版控）。
//
// 2026-10-15 使用者決定：沒有真人樣本，先用 10 位 Persona（模擬帳號）代替。
// 結果只驗證管線與方向，不作為對真人啟用 CF 的依據，也不校準任何門檻。
//
// 切分（避免用到未來的互動）：
//   - 每位 Persona 的「結果事件」= 權重 ≥ 0.5 的課程事件（自願加選、收藏、接受推薦、高分評價…），
//     不含歷史修課回饋與探索問卷。依時間排序，最後 30%（至少 1 門）當測試。
//   - 切點 = 第一個測試事件的時間。**所有人**（含協同過濾的其他 Persona）都只用切點之前的事件；
//     歷史修課都發生在本學期以前，一律算訓練資料。
//   - 候選池 = 本人非必修排課候選 ∪ 測試課，扣掉訓練期間已選的課與已修過的課。
//
// 方法（分數相同時取平均名次）：
//   popularity   非個人化：訓練期間有多少位 Persona 選過這門課
//   tag          s_tag（rag-tag-interest-v1）
//   vec          s_vec（使用者標籤向量 × 標籤相近表）
//   cf           s_cf（item-item，只用切點前資料重建共現表）
//   hybrid       0.6 s_tag + 0.2 s_vec + 0.1 s_cf（構想 5.1 的 α；沒有分數的項以 0 計）
//   hybridNoCf   0.6 s_tag + 0.2 s_vec（構想 4.6 的退場比較：加 CF 有沒有變差）
// 指標：命中前 10／前 20、倒數名次（MRR）、百分位；分數涵蓋率、前 10 名系所多樣性、目錄涵蓋率。
// 與 hybrid 的差異以使用者為單位做成對 bootstrap（固定亂數種子，可重現）。
//
// 用法：node scripts/hybridComparisonStage8.js --out=hybrid-comparison-stage8

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(scriptDir, '..', '.env'), quiet: true });
dotenv.config({ path: path.resolve(scriptDir, '..', '..', '.env'), quiet: true });

const { ACTIVE_TERM } = await import('../src/data/activeTerm.js');
const { PRIVACY_RETENTION } = await import('../src/data/privacyPolicy.js');
const { PERSONA_USER_IDS } = await import('../src/data/simulatedAccounts.js');
const { getPassedNonRequiredAttempts, getLatestAttemptsByCourseCode } = await import('../src/data/courseHistory.js');
const { getAll } = await import('../src/db/database.js');
const { closePool, isMysqlConfigured } = await import('../src/db/mysql.js');
const { getUserPreferences } = await import('../src/services/memoryService.js');
const { getInteractionEventsForExport, hasPersonalizationConsent } = await import('../src/services/interactionEventService.js');
const { deriveSubjectId, listCollaborativeContributors } = await import('../src/services/privacyService.js');
const { resolveIdentityFrom } = await import('../src/services/identityService.js');
const { getTagSimilarity } = await import('../src/services/userTagVectorService.js');
const { buildStudentScope } = await import('../src/skills/courseScope.js');
const { filterCategorizedCourses } = await import('../src/skills/courseQuery.js');
const { CATEGORY_REQUIRED } = await import('../src/skills/courseCategory.js');
const { collectWeightedTagInterestEvents, computeTagInterestProfile, scoreCourseTagInterest } = await import('../src/skills/tagInterestLearning.js');
const { buildCourseTagVectors } = await import('../src/skills/tagVectorSpace.js');
const { buildUserTagVector, scoreCoursesForUser } = await import('../src/skills/userTagVector.js');
const { buildCourseNeighbors, buildUserCourseSignals, scoreCoursesWithCf, CF_DEFAULTS } = await import('../src/skills/itemItemCf.js');
const { resolveInterestAlphas } = await import('../src/skills/interestAlphas.js');
const { bootstrapDiff, rankOf, splitOutcomes, topK } = await import('./lib/hybridComparison.js');

const args = process.argv.slice(2);
const outName = args.find(arg => arg.startsWith('--out='))?.split('=')[1];
if (!outName) { console.error('請指定 --out=<名稱>'); process.exit(1); }
const outDir = path.resolve(scriptDir, '..', 'simulation-runs', outName);

const MIN_USERS_FOR_VERDICT = 15; // 與構想 4.6 的真人門檻相同；Persona 只有 10 位，必定「無法判定」
const METHODS = ['popularity', 'tag', 'vec', 'cf', 'hybrid', 'hybridNoCf'];

const code = value => String(value ?? '').trim().toUpperCase();
const round = (value, digits = 3) => (value === null || value === undefined || Number.isNaN(value) ? null : Number(value.toFixed(digits)));
const mean = values => (values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : null);
const timeOf = event => Date.parse(event?.timestamp ?? '');

async function loadPersonas() {
  const users = await getAll('users');
  const contributors = await listCollaborativeContributors();
  const now = Date.now();
  const retentionMs = PRIVACY_RETENTION.interactionEventDays * 86400000;
  const personas = [];
  for (const id of PERSONA_USER_IDS) {
    const identity = resolveIdentityFrom(users, id);
    if (!identity.found) continue;
    const consented = await hasPersonalizationConsent(identity);
    const prefs = await getUserPreferences(identity);
    const events = consented
      ? (await getInteractionEventsForExport(identity)).filter(event => now - timeOf(event) <= retentionMs)
      : [];
    personas.push({
      label: `P${id}`,
      identity,
      prefs,
      events,
      consented,
      collaborative: contributors.has(deriveSubjectId(identity.canonicalId)),
    });
  }
  return personas;
}

const eventsBefore = (events, cutoff) => events.filter(event => timeOf(event) < cutoff);

function evaluatePersona(target, personas, { allCourses, index, similarity, alphas }) {
  if (!target.consented) return { label: target.label, skipped: 'no_personalization_consent' };
  const split = splitOutcomes(target.events, { activeTerm: ACTIVE_TERM });
  if (!split) return { label: target.label, skipped: 'no_outcome_events' };
  const scope = buildStudentScope(target.prefs);
  if (!scope.resolved) return { label: target.label, skipped: 'student_scope_unavailable' };

  const trainEvents = eventsBefore(target.events, split.cutoff);
  const signalsOf = persona => buildUserCourseSignals({
    courseHistory: persona.prefs?.courseHistory ?? [],
    events: eventsBefore(persona.events, split.cutoff),
    now: new Date(split.cutoff).toISOString(),
    activeTerm: ACTIVE_TERM,
  });
  const trainSignals = signalsOf(target);

  // 協同過濾：只用同意協同學習的 Persona、只用切點前的資料。
  const cfContributors = personas.filter(p => p.collaborative && p.consented).map(p => ({ signals: signalsOf(p), simulated: true }));
  const { neighbors, stats: cfStats } = buildCourseNeighbors(cfContributors);
  const popularity = new Map();
  for (const contributor of cfContributors) {
    for (const [c, value] of contributor.signals) if (value >= CF_DEFAULTS.positiveThreshold) popularity.set(c, (popularity.get(c) ?? 0) + 1);
  }

  const taken = new Set([
    ...[...trainSignals].filter(([, v]) => v >= CF_DEFAULTS.positiveThreshold).map(([c]) => c),
    ...getPassedNonRequiredAttempts(target.prefs?.courseHistory ?? []).map(entry => code(entry.courseCode)),
    ...[...getLatestAttemptsByCourseCode(target.prefs?.courseHistory ?? []).values()].filter(e => e?.passed).map(e => code(e.courseCode)),
  ]);
  const testCodes = split.testCodes.filter(c => !taken.has(c));
  if (testCodes.length === 0) return { label: target.label, skipped: 'test_courses_already_taken' };
  const basePool = filterCategorizedCourses(allCourses, {}, scope, { includeGeneralEducation: true, schedulingPool: true })
    .filter(course => course.category !== CATEGORY_REQUIRED && course.type !== CATEGORY_REQUIRED)
    .map(course => code(course.catalogCourseCode));
  const pool = [...new Set([...basePool, ...testCodes])].filter(c => c && (!taken.has(c) || testCodes.includes(c)));

  const ragByCode = new Map(allCourses.map(course => [code(course.catalogCourseCode), course.ragTag]));
  const deptByCode = new Map(allCourses.map(course => [code(course.catalogCourseCode), course.department]));
  const profile = computeTagInterestProfile(trainEvents, target.prefs, { now: new Date(split.cutoff), activeTerm: ACTIVE_TERM });
  const user = buildUserTagVector({
    courseHistory: target.prefs?.courseHistory ?? [], events: trainEvents, prefs: target.prefs, index,
    activeTerm: ACTIVE_TERM, now: new Date(split.cutoff).toISOString(),
  });
  const vecScores = scoreCoursesForUser(user, index, pool, { similarity });
  const cfScores = scoreCoursesWithCf(trainSignals, neighbors, pool);
  const raw = {
    popularity: new Map(pool.map(c => [c, popularity.get(c) ?? 0])),
    tag: new Map(pool.map(c => {
      const scored = scoreCourseTagInterest(profile, ragByCode.get(c));
      return [c, scored.evidenceTagCount > 0 ? scored.score : null];
    })),
    vec: new Map(pool.map(c => [c, vecScores.get(c)?.score ?? null])),
    cf: new Map(pool.map(c => [c, cfScores.get(c)?.score ?? null])),
  };
  const s = (method, c) => raw[method].get(c) ?? 0;
  raw.hybrid = new Map(pool.map(c => [c, alphas.tag * s('tag', c) + alphas.vec * s('vec', c) + alphas.cf * s('cf', c)]));
  raw.hybridNoCf = new Map(pool.map(c => [c, alphas.tag * s('tag', c) + alphas.vec * s('vec', c)]));

  const perMethod = {};
  for (const method of METHODS) {
    const scoreFn = c => raw[method].get(c) ?? 0;
    const ranks = testCodes.map(c => rankOf(c, pool, scoreFn));
    const top10 = topK(pool, scoreFn, 10);
    perMethod[method] = {
      hit10: mean(ranks.map(r => (r <= 10 ? 1 : 0))),
      hit20: mean(ranks.map(r => (r <= 20 ? 1 : 0))),
      mrr: mean(ranks.map(r => 1 / r)),
      percentile: mean(ranks.map(r => 1 - (r - 1) / Math.max(1, pool.length - 1))),
      coverage: [...raw[method].values()].filter(v => v !== null && v !== 0).length / pool.length,
      top10Departments: new Set(top10.map(c => deptByCode.get(c))).size / Math.max(1, top10.length),
      top10,
    };
  }
  const trainChosen = [...trainSignals.values()].filter(v => v >= CF_DEFAULTS.positiveThreshold).length;
  return {
    label: target.label,
    cutoff: new Date(split.cutoff).toISOString(),
    outcomes: split.outcomeCount,
    testCourses: testCodes.length,
    trainChosen,
    group: trainChosen < 3 ? 'cold' : 'active',
    pool: pool.length,
    cfTable: { contributors: cfStats.usedContributors, keptPairs: cfStats.keptPairs },
    testHasCfScore: testCodes.filter(c => raw.cf.get(c) !== null).length,
    perMethod,
  };
}

function summarize(results) {
  const scored = results.filter(item => !item.skipped);
  const byMethod = {};
  for (const method of METHODS) {
    const pick = key => scored.map(item => item.perMethod[method][key]);
    byMethod[method] = Object.fromEntries(['hit10', 'hit20', 'mrr', 'percentile', 'coverage', 'top10Departments']
      .map(key => [key, round(mean(pick(key)))]));
    byMethod[method].catalogCoverageTop10 = new Set(scored.flatMap(item => item.perMethod[method].top10)).size;
  }
  const comparisons = {};
  for (const other of METHODS.filter(m => m !== 'hybrid')) {
    comparisons[`hybrid−${other}`] = Object.fromEntries(['mrr', 'percentile', 'hit10'].map(key => [
      key, bootstrapDiff(scored.map(item => item.perMethod.hybrid[key] - item.perMethod[other][key])),
    ]));
  }
  const groups = {};
  for (const group of ['cold', 'active']) {
    const members = scored.filter(item => item.group === group);
    groups[group] = {
      users: members.length,
      mrr: Object.fromEntries(METHODS.map(m => [m, round(mean(members.map(item => item.perMethod[m].mrr)))])),
    };
  }
  const exitCheck = comparisons['hybrid−hybridNoCf'].mrr;
  return {
    users: scored.length,
    skipped: results.filter(item => item.skipped).map(item => ({ label: item.label, reason: item.skipped })),
    testCourses: scored.reduce((sum, item) => sum + item.testCourses, 0),
    testCoursesWithCfScore: scored.reduce((sum, item) => sum + item.testHasCfScore, 0),
    byMethod,
    comparisons,
    groups,
    verdict: scored.length < MIN_USERS_FOR_VERDICT
      ? `無法判定：只有 ${scored.length} 位使用者（且全為模擬 Persona），低於 ${MIN_USERS_FOR_VERDICT} 位`
      : '依 comparisons 的信賴區間判讀',
    exitCondition: exitCheck.ci95 && exitCheck.ci95[1] < 0
      ? '加入 CF 後 MRR 明顯變差：依構想 4.6 應退回 shadow'
      : '沒有證據顯示加入 CF 會變差（不代表有效）',
  };
}

async function main() {
  if (!isMysqlConfigured()) throw new Error('未設定 MySQL（DB_*），無法量測。');
  const allCourses = await getAll('courses');
  const context = {
    allCourses,
    index: buildCourseTagVectors(allCourses),
    similarity: getTagSimilarity(),
    alphas: resolveInterestAlphas(),
  };
  const personas = await loadPersonas();
  const results = personas.map(target => evaluatePersona(target, personas, context));
  const output = {
    generatedAt: new Date().toISOString(),
    readOnly: true,
    simulated: true,
    note: '全部為測試 Persona（模擬帳號）；只驗證管線與方向，不作為對真人啟用 CF 的依據。',
    term: ACTIVE_TERM,
    settings: { testFraction: 0.3, bootstrapRounds: 2000, alphas: context.alphas, cf: CF_DEFAULTS },
    personas: personas.map(p => ({ label: p.label, consented: p.consented, collaborative: p.collaborative, events: p.events.length })),
    results,
    summary: summarize(results),
  };
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'result.json'), JSON.stringify(output, null, 2));
  const { results: _omit, ...brief } = output;
  console.log(JSON.stringify({
    ...brief,
    results: results.map(({ perMethod, ...rest }) => ({
      ...rest,
      mrr: perMethod ? Object.fromEntries(METHODS.map(m => [m, round(perMethod[m].mrr)])) : undefined,
    })),
  }, null, 2));
}

try {
  await main();
} finally {
  await closePool();
}
