// Roadmap #10 任務 1 spike：以真實候選池量測 HiGHS（MILP）基本模型。
//
// 只做量測，不接入正式排課：候選與 S₀ 由正式的 generateSchedule() 產生，
// 模型只含「班次＋課號」兩層變數、衝堂、學分、每日上限、固定課程、共同必修、同系列，
// 目標函數是 greedy 在同一狀態下的逐課分數。只執行 SELECT，不寫任何事件。
//
// 用法：node scripts/highsSpike.js [--markdown] [--runs 20]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

import { ACTIVE_TERM } from '../src/data/activeTerm.js';
import { DEMO_PERSONAS } from '../src/data/demoPersonas.js';
import { getAll } from '../src/db/database.js';
import { closePool, isMysqlConfigured } from '../src/db/mysql.js';
import { generateSchedule } from '../src/skills/scheduler.js';
import { validateScheduleAgainstConstraints } from '../src/skills/scheduleValidator.js';
import { buildScheduleConstraints } from '../src/services/constraintService.js';
import { getUserPreferences } from '../src/services/memoryService.js';
import { getHighsRuntime, solveLpText, SOLVE_STATUS } from '../src/skills/optimization/highsRuntime.js';
import { buildScheduleMip, decodeSelection } from '../src/skills/optimization/scheduleMipModel.js';
import {
  absentLearnedPreference,
  buildCandidates,
  CASE_IDS,
  deriveLearnedPreferenceReadOnly,
  identityFor,
  withoutAxisPreferences,
} from './lib/demoCaseLoader.js';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(scriptDir, '..', '.env'), quiet: true });
dotenv.config({ path: path.resolve(scriptDir, '..', '..', '.env'), quiet: true });

const reportPath = path.join(scriptDir, '..', 'test', 'reports', 'highs-spike-latest.json');
const argRuns = process.argv.indexOf('--runs');
const WARM_RUNS = argRuns > 0 ? Number(process.argv[argRuns + 1]) : 20;
const P95_BUDGET_MS = 200;

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

const round = value => (value == null ? null : Math.round(value * 100) / 100);
const mb = bytes => round(bytes / 1024 / 1024);

function validate(schedule, unscheduled, constraints, excludedCourses) {
  const result = validateScheduleAgainstConstraints(
    [...schedule, ...unscheduled],
    constraints,
    { excludedCourses }
  );
  return {
    valid: result.valid,
    violationCount: result.violations.length,
    constraintIds: [...new Set(result.violations.map(item => item.constraintId).filter(Boolean))],
  };
}

async function runCase({ caseId, prefs, learnedPreference, reviews, allCourses }) {
  const constraints = buildScheduleConstraints({}, prefs, { reviews, courseReviews: reviews, learnedPreference });
  const candidates = await buildCandidates(constraints, allCourses);
  const result = generateSchedule(candidates, constraints, { includeMipInputs: true });
  const inputs = result.mipInputs;
  if (!inputs) return { caseId, error: 'mipInputs 不存在（排課未成功，無法取得基準狀態）' };

  const s0 = inputs.basePlan;
  const fixedIds = new Set(inputs.fixedSchedule.map(course => Number(course.id)));
  const s0Fill = s0.schedule.filter(course => !fixedIds.has(Number(course.id)));
  const scoreById = new Map(inputs.competitive.map(entry => [Number(entry.course.id), entry.score]));

  const buildStartedAt = performance.now();
  const model = buildScheduleMip(inputs);
  const buildMs = performance.now() - buildStartedAt;

  const solves = [];
  for (let run = 0; run < WARM_RUNS; run += 1) {
    const memBefore = process.memoryUsage();
    const solved = await solveLpText(model.lpText, model.columnNames);
    const memAfter = process.memoryUsage();
    const selected = decodeSelection(model, solved.values);
    solves.push({
      ...solved,
      selected,
      signature: selected.map(section => Number(section.course.id)).sort((a, b) => a - b).join(','),
      heapDeltaMb: mb(memAfter.heapUsed - memBefore.heapUsed),
      rssDeltaMb: mb(memAfter.rss - memBefore.rss),
    });
  }

  // 變體：學分不少於 S₀（greedy 的語意是「在上限內排滿」，基本模型只保證下限）。
  // 用來比較同學分下 MILP 與 greedy 的品質，作為下一份設計的輸入。
  const parityModel = buildScheduleMip({ ...inputs, minCredits: Math.max(inputs.minCredits, s0.totalCredits) });
  const parityRuns = [];
  for (let run = 0; run < Math.min(WARM_RUNS, 5); run += 1) {
    parityRuns.push(await solveLpText(parityModel.lpText, parityModel.columnNames));
  }
  const paritySelected = decodeSelection(parityModel, parityRuns[0].values);
  const creditParity = {
    statuses: [...new Set(parityRuns.map(item => item.status))],
    p95Ms: round(percentile(parityRuns.map(item => item.runtimeMs), 95)),
    totalCredits: inputs.fixedCredits + paritySelected.reduce((sum, section) => sum + (section.course.credits || 0), 0),
    fillScore: round(paritySelected.filter(s => s.kind === 'competitive').reduce((sum, s) => sum + s.score, 0)),
    validator: validate(
      [...inputs.fixedSchedule, ...paritySelected.map(section => ({ ...section.course, scheduleState: 'selected' }))],
      inputs.fixedUnscheduled, constraints, s0.excludedCourses
    ),
    codeDiffVsS0: null,
  };

  const first = solves[0];
  const selectedCourses = first.selected.map(section => ({ ...section.course, scheduleState: 'selected' }));
  const milpSchedule = [...inputs.fixedSchedule, ...selectedCourses];
  const milpCredits = milpSchedule.reduce((sum, course) => sum + (course.credits || 0), 0);
  const milpScore = first.selected
    .filter(section => section.kind === 'competitive')
    .reduce((sum, section) => sum + section.score, 0);
  const s0Score = s0Fill.reduce((sum, course) => sum + (scoreById.get(Number(course.id)) ?? 0), 0);
  const codes = list => new Set(list.map(course => course.catalogCourseCode).filter(Boolean));
  const s0Codes = codes(s0Fill);
  const milpCodes = codes(selectedCourses);
  const runtimes = solves.map(item => item.runtimeMs);
  const parityCodes = codes(paritySelected.map(section => section.course));
  creditParity.codeDiffVsS0 = {
    removed: [...s0Codes].filter(code => !parityCodes.has(code)),
    added: [...parityCodes].filter(code => !s0Codes.has(code)),
  };

  return {
    caseId,
    candidatePoolSize: candidates.length,
    fixedCourses: inputs.fixedSchedule.length,
    fixedCredits: inputs.fixedCredits,
    creditBounds: [inputs.minCredits, inputs.maxCredits],
    maxCoursesPerDay: Number.isFinite(inputs.maxCoursesPerDay) ? inputs.maxCoursesPerDay : null,
    prefilter: model.prefilter,
    modelStats: { ...model.stats, buildMs: round(buildMs), lpTextKb: round(model.lpText.length / 1024) },
    statuses: [...new Set(solves.map(item => item.status))],
    allOptimal: solves.every(item => item.status === SOLVE_STATUS.OPTIMAL),
    mipGapMax: round(Math.max(...solves.map(item => item.mipGap ?? Infinity)) * 1e6) / 1e6,
    warmSolveMs: { p50: round(percentile(runtimes, 50)), p95: round(percentile(runtimes, 95)), max: round(Math.max(...runtimes)) },
    deterministic: new Set(solves.map(item => item.signature)).size === 1,
    memory: {
      maxHeapDeltaMb: Math.max(...solves.map(item => item.heapDeltaMb)),
      maxRssDeltaMb: Math.max(...solves.map(item => item.rssDeltaMb)),
    },
    validator: {
      milp: validate(milpSchedule, inputs.fixedUnscheduled, constraints, s0.excludedCourses),
      s0: validate(s0.schedule, s0.unscheduledCourses, constraints, s0.excludedCourses),
    },
    comparisonWithS0: {
      s0: { fillCourses: s0Fill.length, totalCredits: s0.totalCredits, fillScore: round(s0Score) },
      milp: { fillCourses: selectedCourses.length, totalCredits: milpCredits, fillScore: round(milpScore), objective: round(first.objective) },
      removedFromS0: [...s0Codes].filter(code => !milpCodes.has(code)),
      addedVsS0: [...milpCodes].filter(code => !s0Codes.has(code)),
    },
    creditParity,
  };
}

function printMarkdown(report) {
  report.parityRows = [];
  console.log('# Roadmap #10 HiGHS spike');
  console.log(`- Generated: ${report.generatedAt}；highs ${report.highsVersion}；Node ${process.version}`);
  console.log(`- WASM cold start: ${report.coldStartMs} ms；warm runs per case: ${report.warmRuns}`);
  console.log(`- Go/No-go: ${report.go ? 'GO' : 'NO-GO'}（${report.goReasons.join('；') || '全部通過'}）`);
  console.log('');
  console.log('| case | 班次變數 | 課號變數 | 限制 | nonzero | 狀態 | gap | p50 ms | p95 ms | 一致 | validator | S₀ 學分/分數 | MILP 學分/分數 | 課號差異 |');
  console.log('| --- | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: | :---: | :---: | ---: | ---: | ---: |');
  for (const row of report.cases) {
    if (row.error) { console.log(`| ${row.caseId} | ${row.error} |`); continue; }
    const cmp = row.comparisonWithS0;
    report.parityRows.push(`| ${row.caseId} | ${row.creditParity.statuses.join('/')} | ${row.creditParity.p95Ms} | ${row.creditParity.validator.valid ? '0 violation' : row.creditParity.validator.constraintIds.join(',')} | ${cmp.s0.totalCredits}/${cmp.s0.fillScore} | ${row.creditParity.totalCredits}/${row.creditParity.fillScore} | -${row.creditParity.codeDiffVsS0.removed.length}/+${row.creditParity.codeDiffVsS0.added.length} |`);
    console.log(`| ${row.caseId} | ${row.modelStats.sectionVars} | ${row.modelStats.courseVars} | ${row.modelStats.rows} | ${row.modelStats.nonzeros} | ${row.statuses.join('/')} | ${row.mipGapMax} | ${row.warmSolveMs.p50} | ${row.warmSolveMs.p95} | ${row.deterministic ? '✓' : '✗'} | ${row.validator.milp.valid ? '0 violation' : row.validator.milp.constraintIds.join(',')} | ${cmp.s0.totalCredits}/${cmp.s0.fillScore} | ${cmp.milp.totalCredits}/${cmp.milp.fillScore} | -${cmp.removedFromS0.length}/+${cmp.addedVsS0.length} |`);
  }
  console.log('');
  console.log('學分不少於 S₀ 的變體（同學分下比較品質）：');
  console.log('');
  console.log('| case | 狀態 | p95 ms | validator | S₀ 學分/分數 | MILP 學分/分數 | 課號差異 |');
  console.log('| --- | --- | ---: | :---: | ---: | ---: | ---: |');
  for (const line of report.parityRows) console.log(line);
}

async function main() {
  if (!isMysqlConfigured()) {
    throw new Error('HiGHS spike 必須連線目前 MySQL；未設定 DB_HOST、DB_USER 或 DB_NAME。');
  }
  const coldStartAt = performance.now();
  await getHighsRuntime();
  const coldStartMs = round(performance.now() - coldStartAt);

  const evaluationTime = new Date();
  const reviews = await getAll('reviews');
  const allCourses = await getAll('courses');
  const cases = [];
  for (let index = 0; index < DEMO_PERSONAS.length; index += 1) {
    const persona = DEMO_PERSONAS[index];
    const identity = identityFor(persona);
    const prefs = await getUserPreferences(identity);
    const learnedPreference = await deriveLearnedPreferenceReadOnly(identity, prefs, evaluationTime);
    cases.push(await runCase({
      caseId: CASE_IDS[index] || `persona-${index + 1}`, prefs, learnedPreference, reviews, allCourses,
    }));
    if (index === 0) {
      cases.push(await runCase({
        caseId: 'no-preference-control',
        prefs: withoutAxisPreferences(prefs),
        learnedPreference: absentLearnedPreference('control-disabled'),
        reviews,
        allCourses,
      }));
    }
  }

  const goReasons = [];
  for (const row of cases) {
    if (row.error) { goReasons.push(`${row.caseId}: ${row.error}`); continue; }
    if (!row.allOptimal) goReasons.push(`${row.caseId} 非全部 optimal（${row.statuses.join('/')}）`);
    if (!row.validator.milp.valid) goReasons.push(`${row.caseId} validator 違規 ${row.validator.milp.constraintIds.join(',')}`);
    if (row.warmSolveMs.p95 > P95_BUDGET_MS) goReasons.push(`${row.caseId} p95 ${row.warmSolveMs.p95} ms > ${P95_BUDGET_MS}`);
    if (!row.deterministic) goReasons.push(`${row.caseId} 重跑結果不一致`);
  }

  const highsPackage = JSON.parse(fs.readFileSync(path.join(scriptDir, '..', 'node_modules', 'highs', 'package.json'), 'utf8'));
  const report = {
    schemaVersion: 1,
    generatedAt: evaluationTime.toISOString(),
    dataSource: 'mysql-read-only',
    activeTerm: ACTIVE_TERM,
    highsVersion: highsPackage.version,
    coldStartMs,
    warmRuns: WARM_RUNS,
    p95BudgetMs: P95_BUDGET_MS,
    go: goReasons.length === 0,
    goReasons,
    cases,
  };
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  if (process.argv.includes('--markdown')) printMarkdown(report);
  else console.log(JSON.stringify({ go: report.go, goReasons, reportPath }, null, 2));
}

main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => closePool());
