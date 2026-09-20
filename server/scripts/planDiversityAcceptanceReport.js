// Roadmap #10：以目前 MySQL 課程、三位 demo persona 與正式排課器量測方案多樣性。
//
// 這支 runner 只執行 SELECT，刻意不呼叫 generateForUser()，避免 benchmark 被記成
// 真實推薦曝光；學習權重也直接由既有事件在記憶體重算，不寫回資料庫。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

import { ACTIVE_TERM } from '../src/data/activeTerm.js';
import { DEMO_PERSONAS } from '../src/data/demoPersonas.js';
import { getAll } from '../src/db/database.js';
import { closePool, isMysqlConfigured } from '../src/db/mysql.js';
import {
  evaluatePlanDiversityAcceptance,
  PLAN_QUALITY_RETENTION_THRESHOLD,
  PLAN_MINIMUM_REPLACEMENT_DISTANCE,
  PLAN_RETENTION_THRESHOLD,
  PLAN_SIMILARITY_THRESHOLD,
} from '../src/skills/planDiversityAcceptance.js';
import { generateSchedule, setSchedulingHighsRuntime } from '../src/skills/scheduler.js';
import { validateScheduleAgainstConstraints } from '../src/skills/scheduleValidator.js';
import { getHighsRuntime } from '../src/skills/optimization/highsRuntime.js';
import { BENCHMARK_DIVERSE_OPTIONS } from '../src/skills/optimization/diversePlanSolver.js';
import { sha256Hex } from '../src/utils/hash.js';
import { buildScheduleConstraints } from '../src/services/constraintService.js';
import { getUserPreferences } from '../src/services/memoryService.js';
import {
  absentLearnedPreference,
  buildCandidates,
  buildFixedCoursesControl,
  CASE_IDS,
  deriveLearnedPreferenceReadOnly,
  identityFor,
  withoutAxisPreferences,
} from './lib/demoCaseLoader.js';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(scriptDir, '..', '.env'), quiet: true });
dotenv.config({ path: path.resolve(scriptDir, '..', '..', '.env'), quiet: true });

const reportPath = path.join(
  scriptDir,
  '..',
  'test',
  'reports',
  'plan-diversity-acceptance-latest.json'
);
const diagnosticsReportPath = path.join(
  scriptDir,
  '..',
  'test',
  'reports',
  'plan-diversity-diagnostics-latest.json'
);

function validatePlans(plans, constraints) {
  return plans.map(plan => {
    const validation = validateScheduleAgainstConstraints(
      [...(plan.schedule || []), ...(plan.unscheduledCourses || [])],
      constraints,
      { excludedCourses: plan.excludedCourses || [] }
    );
    return {
      planId: plan.id,
      valid: validation.valid,
      violationCount: validation.violations.length,
      constraintIds: [...new Set(validation.violations.map(item => item.constraintId).filter(Boolean))],
    };
  });
}

async function runCase({ caseId, identity, input = {}, prefs, learnedPreference, reviews, allCourses }) {
  const constraints = buildScheduleConstraints(input, prefs, { reviews, courseReviews: reviews, learnedPreference });
  const candidates = await buildCandidates(constraints, allCourses);
  const generationStartedAt = performance.now();
  const axisMinGainArg = process.argv.find(arg => arg.startsWith('--axis-min-gain='));
  const axisMinGain = axisMinGainArg ? Number(axisMinGainArg.split('=')[1]) : undefined;
  // Benchmark 明確覆寫為 K=3，量的是完整候選池能產出什麼；線上預設是 K=1。
  const result = generateSchedule(candidates, constraints, {
    includePlanDiagnostics: true,
    diverseSolverOptions: BENCHMARK_DIVERSE_OPTIONS,
    ...(Number.isFinite(axisMinGain) ? { axisMinGain } : {}),
  });
  const generationMs = performance.now() - generationStartedAt;
  const safety = validatePlans(result.plans || [], constraints);
  const safetyPassed = safety.length > 0 && safety.every(item => item.valid);
  const acceptance = evaluatePlanDiversityAcceptance(result, { safetyPassed });

  return {
    caseId,
    candidatePoolSize: candidates.length,
    candidatePoolHash: sha256Hex(candidates.map(course => ({
      catalogCourseCode: course.catalogCourseCode ?? null,
      sectionId: course.id ?? course.sectionId ?? null,
    })).sort((left, right) => (
      String(left.catalogCourseCode).localeCompare(String(right.catalogCourseCode))
      || Number(left.sectionId) - Number(right.sectionId)
    ))),
    learnedPreference: {
      applied: learnedPreference.applied,
      reason: learnedPreference.reason,
      modelVersion: learnedPreference.modelVersion,
      sufficiencyStatus: learnedPreference.sufficiency?.status ?? null,
    },
    safety,
    generationMs: Number(generationMs.toFixed(2)),
    planDiversity: result.planDiversity ?? null,
    candidateMetrics: (result.plans || []).map(plan => ({
      planId: plan.id,
      totalCredits: plan.totalCredits,
      qualityRetention: plan.comparisonToBaseline?.qualityRetention ?? null,
      replacementDistance: plan.comparisonToBaseline?.replacementDistance ?? null,
      convergence: plan.milpSolver?.convergence ?? null,
      category: plan.milpSolver?.category ?? null,
    })),
    generationDiagnostics: result.generationDiagnostics ?? null,
    ...acceptance,
  };
}

function printMarkdown(report) {
  console.log('# Roadmap #10 plan diversity acceptance');
  console.log(`- Generated: ${report.generatedAt}`);
  console.log(`- Result: ${report.pass ? 'PASS' : 'FAIL'}`);
  console.log(`- Thresholds: plan retention ≥ ${report.thresholds.retentionRate}; quality retention ≥ ${report.thresholds.qualityRetention}; median Jaccard ≤ ${report.thresholds.medianJaccardSimilarity}; replacement distance ≥ ${report.thresholds.minimumReplacementDistance}`);
  console.log('');
  console.log('| case | requested | distinct | plan retention | min quality | median Jaccard | replace ≥2 | parity | checks | safety | result |');
  console.log('| --- | ---: | ---: | ---: | ---: | ---: | :---: | :---: | :---: | :---: | :---: |');
  for (const row of report.cases) {
    console.log(`| ${row.caseId} | ${row.requestedVariants} | ${row.reportedDistinctPlans} | ${row.retentionRate} | ${row.minimumQualityRetention ?? '—'} | ${row.medianJaccardSimilarity ?? '—'} | ${row.criteria.actualCourseDifference ? 'pass' : 'FAIL'} | ${row.criteria.creditParity ? 'pass' : 'FAIL'} | ${row.criteria.modelChecks ? 'pass' : 'FAIL'} | ${row.criteria.safety ? 'pass' : 'FAIL'} | ${row.pass ? 'PASS' : 'FAIL'} |`);
  }
}

async function main() {
  if (!isMysqlConfigured()) {
    throw new Error('Roadmap #10 驗收必須連線目前 MySQL；未設定 DB_HOST、DB_USER 或 DB_NAME。');
  }

  const evaluationTime = new Date();
  setSchedulingHighsRuntime(await getHighsRuntime());
  const reviews = await getAll('reviews');
  const allCourses = await getAll('courses');
  const cases = [];

  for (let index = 0; index < DEMO_PERSONAS.length; index += 1) {
    const persona = DEMO_PERSONAS[index];
    const identity = identityFor(persona);
    const prefs = await getUserPreferences(identity);
    const learnedPreference = await deriveLearnedPreferenceReadOnly(
      identity,
      prefs,
      evaluationTime
    );
    cases.push(await runCase({
      caseId: CASE_IDS[index] || `persona-${index + 1}`,
      identity,
      prefs,
      learnedPreference,
      reviews,
      allCourses,
    }));

    if (index === 0) {
      cases.push(await runCase({
        caseId: 'no-preference-control',
        identity,
        prefs: withoutAxisPreferences(prefs),
        learnedPreference: absentLearnedPreference('control-disabled'),
        reviews,
        allCourses,
      }));
    }
  }

  const fixedControl = buildFixedCoursesControl(allCourses);
  cases.push(await runCase({
    caseId: 'fixed-courses-control',
    identity: null,
    input: fixedControl.input,
    prefs: fixedControl.prefs,
    learnedPreference: absentLearnedPreference('control-disabled'),
    reviews,
    allCourses,
  }));

  const summaryCases = cases.map(({ generationDiagnostics, ...summary }) => summary);
  const reportAxisMinGainArg = process.argv.find(arg => arg.startsWith('--axis-min-gain='));
  const reportAxisMinGain = reportAxisMinGainArg ? Number(reportAxisMinGainArg.split('=')[1]) : undefined;
  const diagnosticsReport = {
    schemaVersion: 1,
    generatedAt: evaluationTime.toISOString(),
    dataSource: 'mysql-read-only',
    activeTerm: ACTIVE_TERM,
    cases: cases.map(row => ({
      caseId: row.caseId,
      candidatePoolSize: row.candidatePoolSize,
      candidatePoolHash: row.candidatePoolHash,
      requestedVariants: row.requestedVariants,
      reportedDistinctPlans: row.reportedDistinctPlans,
      generationDiagnostics: row.generationDiagnostics,
    })),
  };
  const report = {
    schemaVersion: 1,
    generatedAt: evaluationTime.toISOString(),
    dataSource: 'mysql-read-only',
    activeTerm: ACTIVE_TERM,
    // 線上預設是 DEFAULT_DIVERSE_OPTIONS（K=1、2.5 秒）；這份報告是 benchmark 設定，
    // 兩者分開記錄，看報告時才知道數字是在哪一組預算下量到的。
    solverOptions: {
      profile: 'benchmark',
      ...BENCHMARK_DIVERSE_OPTIONS,
      ...(Number.isFinite(reportAxisMinGain) ? { axisMinGain: reportAxisMinGain } : { axisMinGain: 0.02 }),
    },
    thresholds: {
      retentionRate: PLAN_RETENTION_THRESHOLD,
      qualityRetention: PLAN_QUALITY_RETENTION_THRESHOLD,
      medianJaccardSimilarity: PLAN_SIMILARITY_THRESHOLD,
      preferredPersonaMinimumDistinctPlans: 3,
      noPreferenceMinimumDistinctPlans: 2,
      minimumReplacementDistance: PLAN_MINIMUM_REPLACEMENT_DISTANCE,
    },
    pass: summaryCases.every(row => row.pass),
    cases: summaryCases,
  };

  if (process.argv.includes('--markdown')) printMarkdown(report);
  else console.log(JSON.stringify(report, null, 2));

  if (!process.argv.includes('--no-write')) {
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    fs.writeFileSync(
      diagnosticsReportPath,
      `${JSON.stringify(diagnosticsReport, null, 2)}\n`,
      'utf8'
    );
    console.log(`\n已寫入 ${path.relative(process.cwd(), reportPath)}`);
    console.log(`已寫入 ${path.relative(process.cwd(), diagnosticsReportPath)}`);
  }
  process.exitCode = report.pass ? 0 : 1;
}

try {
  await main();
} finally {
  await closePool();
}
