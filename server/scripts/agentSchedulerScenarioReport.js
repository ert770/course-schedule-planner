// AI Agent 聊天排課情境報告（唯讀，2026-11-22 課程主題問答接管線第 4 段起使用）。
//
// Agent 的 run_csp_scheduler 與 REST 走同一條路：generateForUser(identity, { constraints: 工具參數 }, { prefs })
// （見 services/agentService.js）。這裡不經過語言模型，直接把「Agent 會送的參數」送進同一個函式：
//   - 20 個聊天關鍵字（interests 與 preferredKeywords 兩種參數都測）；
//   - run_csp_scheduler 工具 schema（services/promptService.js 的 SCHEDULER_PARAMETERS）其餘每個參數至少一個情境。
// 不帶 surface／trigger，不寫曝光事件；不改任何帳號的偏好。
//
// 用法（在 server/ 底下）：node scripts/agentSchedulerScenarioReport.js --out=<path.json> [--accounts=A,B,C]
// 改動前後各跑一次，再比較兩份 JSON。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(scriptDir, '..', '.env'), quiet: true });
dotenv.config({ path: path.join(scriptDir, '..', '..', '.env'), quiet: true });

const { getAll } = await import('../src/db/database.js');
const { resolveIdentityFrom } = await import('../src/services/identityService.js');
const { getUserPreferences } = await import('../src/services/memoryService.js');
const { generateForUser } = await import('../src/services/scheduleService.js');
const { getHighsRuntime } = await import('../src/skills/optimization/highsRuntime.js');
const { setSchedulingHighsRuntime, matchesInterestKeyword } = await import('../src/skills/scheduler.js');

const arg = name => process.argv.find(item => item.startsWith(`--${name}=`))?.slice(name.length + 3);
const outPath = arg('out');
const accounts = (arg('accounts') ?? 'D1249697,D0009003,D0009002').split(',');

try {
  setSchedulingHighsRuntime(await getHighsRuntime());
} catch (error) {
  console.warn(`HiGHS 載入失敗：${error.message}`);
}

export const CHAT_KEYWORDS = [
  '資訊安全', '人工智慧', '機器學習', '雲端', '前端', '網頁設計', '資料庫', '大數據', '行銷', '管理',
  '金融', '日語', '英語', '心理', '歷史', '設計', '遊戲', '區塊鏈', '物聯網', '法律',
];

const isRequired = course => course.category === '必修' || course.type === '必修';
const round = value => (Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null);
const blocksOf = course => (Array.isArray(course.timeBlocks) && course.timeBlocks.length
  ? course.timeBlocks
  : course.dayOfWeek ? [{ dayOfWeek: course.dayOfWeek, startPeriod: course.startPeriod, endPeriod: course.endPeriod }] : []);
const instructorOf = course => course.instructor ?? course.teacher ?? null;

function summarize(result, scenario) {
  const plans = Array.isArray(result.plans) ? result.plans : [];
  const primary = plans.find(plan => plan.id === result.recommendedPlanId) ?? plans[0] ?? { schedule: [] };
  const schedule = primary.schedule ?? [];
  const electives = schedule.filter(course => !isRequired(course));
  const allElectives = [...new Map(plans.flatMap(plan => plan.schedule ?? []).filter(course => !isRequired(course))
    .map(course => [course.id, course])).values()];
  const keywords = [...(scenario.constraints.interests ?? []), ...(scenario.constraints.preferredKeywords ?? [])];
  const keywordHit = list => (keywords.length && list.length
    ? round(list.filter(course => keywords.some(keyword => matchesInterestKeyword(course, keyword))).length / list.length)
    : null);
  const inPrimary = id => schedule.some(course => Number(course.id) === Number(id));
  const c = scenario.constraints;
  return {
    success: result.success === true,
    planIds: plans.map(plan => String(plan.id).split(':').pop()),
    totalCredits: result.totalCredits ?? null,
    unmetRequirements: Array.isArray(result.unmetRequirements) ? result.unmetRequirements.length : null,
    warnings: Array.isArray(result.warnings) ? result.warnings.length : null,
    preferenceInterest: round(result.preferenceProfile?.interest ?? 0),
    tradeoffs: schedule.reduce((sum, course) => sum + (course.recommendationReason?.tradeoffs?.length ?? 0), 0),
    keywordHitPrimary: keywordHit(electives),
    keywordHitAllPlans: keywordHit(allElectives),
    mondayCourses: schedule.filter(course => blocksOf(course).some(block => Number(block.dayOfWeek) === 1)).length,
    blockedHits: (c.blockedPeriods ?? []).reduce((sum, slot) => sum + schedule.filter(course => blocksOf(course)
      .some(block => Number(block.dayOfWeek) === slot.day
        && slot.period >= Number(block.startPeriod) && slot.period <= Number(block.endPeriod ?? block.startPeriod))).length, 0),
    avoidedInstructorCourses: (c.avoidInstructors ?? []).length
      ? schedule.filter(course => c.avoidInstructors.includes(instructorOf(course))).length : null,
    mustTakeIncluded: (c.mustTakeCourseIds ?? []).length ? c.mustTakeCourseIds.every(inPrimary) : null,
    selectedIncluded: (c.selectedCourseIds ?? []).length ? c.selectedCourseIds.every(inPrimary) : null,
    watchedReported: (c.watchingCourseIds ?? []).length
      ? (result.watchedCourses ?? []).length > 0 : null,
    fingerprint: plans.map(plan => (plan.schedule ?? []).map(course => course.id).sort((a, b) => a - b).join(',')),
  };
}

function buildScenarios(base) {
  const primary = base.plans?.find(plan => plan.id === base.recommendedPlanId) ?? base.plans?.[0] ?? { schedule: [] };
  const electives = (primary.schedule ?? []).filter(course => !isRequired(course));
  const others = (base.plans ?? []).flatMap(plan => plan.schedule ?? [])
    .filter(course => !isRequired(course) && !electives.some(item => item.id === course.id));
  const pickA = electives[0];
  const pickB = others[0] ?? electives[1] ?? electives[0];
  const scenarios = [
    ...CHAT_KEYWORDS.map((keyword, index) => ({
      id: `kw:${keyword}`,
      constraints: index % 2 === 0 ? { interests: [keyword] } : { preferredKeywords: [keyword] },
    })),
    { id: 'kw:multi', constraints: { interests: ['資訊安全', '雲端', '行銷'] } },
    { id: 'minCredits', constraints: { minCredits: 15 } },
    { id: 'maxCredits', constraints: { maxCredits: 16 } },
    { id: 'allowCreditOverload', constraints: { allowCreditOverload: true, maxCredits: 28 } },
    { id: 'department+gradeLevel', constraints: { department: base.__prefs.department, gradeLevel: base.__prefs.gradeLevel } },
    { id: 'blockedPeriods', constraints: { blockedPeriods: [{ day: 2, period: 3 }, { day: 4, period: 6 }] } },
    { id: 'mondayFree', constraints: { mondayFree: true } },
    { id: 'noMorningClasses', constraints: { noMorningClasses: true } },
    { id: 'noEveningClasses', constraints: { noEveningClasses: true } },
    { id: 'lunchBreakFree', constraints: { lunchBreakFree: true } },
    { id: 'mustTakeCourseIds', constraints: pickB ? { mustTakeCourseIds: [pickB.id] } : {} },
    { id: 'avoidInstructors', constraints: pickA && instructorOf(pickA) ? { avoidInstructors: [instructorOf(pickA)] } : {} },
    { id: 'selectedCourseIds', constraints: pickA ? { selectedCourseIds: [pickA.id] } : {} },
    { id: 'watchingCourseIds', constraints: pickB ? { watchingCourseIds: [pickB.id] } : {} },
    { id: 'courseStates', constraints: pickA ? { courseStates: { [pickA.id]: '加選' } } : {} },
    { id: 'preferCompact', constraints: { preferCompact: true } },
    { id: 'maxCoursesPerDay', constraints: { maxCoursesPerDay: 2 } },
    { id: 'noMidterm', constraints: { noMidterm: true } },
    { id: 'noGroupReport', constraints: { noGroupReport: true } },
    { id: 'discussion', constraints: { discussion: true } },
    { id: 'learnMore', constraints: { learnMore: true } },
    { id: 'weightDaily', constraints: { weightDaily: true } },
    { id: 'practicalExam', constraints: { practicalExam: true } },
    { id: 'finalReport', constraints: { finalReport: true } },
    { id: 'englishTaught', constraints: { englishTaught: true } },
    { id: 'preferredTrack', constraints: { preferredTrack: '網路安全類' } },
    { id: 'preferEasyCourses', constraints: { preferEasyCourses: true } },
    { id: 'preferChallengingCourses', constraints: { preferChallengingCourses: true } },
    { id: 'digitalCreditsNeeded', constraints: { digitalCreditsNeeded: true } },
    { id: 'allowRelaxation', constraints: { allowRelaxation: true, noMorningClasses: true, lunchBreakFree: true, mondayFree: true } },
    { id: 'nonNegotiablePreferenceIds', constraints: {
      allowRelaxation: true, noMorningClasses: true, lunchBreakFree: true, nonNegotiablePreferenceIds: ['NO_MORNING_CLASSES'],
    } },
    { id: 'combo:keyword+time+easy', constraints: { interests: ['資訊安全'], noMorningClasses: true, preferEasyCourses: true } },
  ];
  return scenarios;
}

const users = await getAll('users');
const rows = [];
for (const account of accounts) {
  const identity = resolveIdentityFrom(users, account);
  if (!identity?.canonicalId || identity.reason) {
    rows.push({ account, error: identity?.reason ?? 'unresolved' });
    continue;
  }
  const prefs = await getUserPreferences(identity);
  const base = await generateForUser(identity, {}, { prefs });
  base.__prefs = prefs;
  const scenarios = buildScenarios(base);
  rows.push({ account, scenario: 'baseline', ...summarize(base, { constraints: {} }) });
  for (const scenario of scenarios) {
    const started = Date.now();
    try {
      const result = await generateForUser(identity, { constraints: scenario.constraints }, { prefs });
      rows.push({ account, scenario: scenario.id, constraints: scenario.constraints, ms: Date.now() - started,
        ...summarize(result, scenario) });
    } catch (error) {
      rows.push({ account, scenario: scenario.id, constraints: scenario.constraints, error: error.message });
    }
  }
  console.error(`${account}: ${scenarios.length} scenarios done`);
}

const report = { generatedAt: new Date().toISOString(), accounts, keywords: CHAT_KEYWORDS, rows };
const text = `${JSON.stringify(report, null, 2)}\n`;
if (outPath) fs.writeFileSync(outPath, text, 'utf8');
else process.stdout.write(text);
process.exit(0);
