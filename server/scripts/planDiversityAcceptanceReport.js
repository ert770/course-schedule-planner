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
  PLAN_RETENTION_THRESHOLD,
  PLAN_SIMILARITY_THRESHOLD,
} from '../src/skills/planDiversityAcceptance.js';
import { generateSchedule } from '../src/skills/scheduler.js';
import { validateScheduleAgainstConstraints } from '../src/skills/scheduleValidator.js';
import { sha256Hex } from '../src/utils/hash.js';
import { buildScheduleConstraints } from '../src/services/constraintService.js';
import { getUserPreferences } from '../src/services/memoryService.js';
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

async function runCase({ caseId, identity, prefs, learnedPreference, reviews, allCourses }) {
  const constraints = buildScheduleConstraints({}, prefs, { reviews, courseReviews: reviews, learnedPreference });
  const candidates = await buildCandidates(constraints, allCourses);
  const result = generateSchedule(candidates, constraints, { includePlanDiagnostics: true });
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
    generationDiagnostics: result.generationDiagnostics ?? null,
    ...acceptance,
  };
}

function printMarkdown(report) {
  console.log('# Roadmap #10 plan diversity acceptance');
  console.log(`- Generated: ${report.generatedAt}`);
  console.log(`- Result: ${report.pass ? 'PASS' : 'FAIL'}`);
  console.log(`- Thresholds: retention ≥ ${report.thresholds.retentionRate}; median Jaccard ≤ ${report.thresholds.medianJaccardSimilarity}`);
  console.log('');
  console.log('| case | requested | distinct | meaningful | retention | median Jaccard | actual difference | safety | result |');
  console.log('| --- | ---: | ---: | ---: | ---: | ---: | :---: | :---: | :---: |');
  for (const row of report.cases) {
    console.log(`| ${row.caseId} | ${row.requestedVariants} | ${row.reportedDistinctPlans} | ${row.meaningfulDistinctPlans} | ${row.retentionRate} | ${row.medianJaccardSimilarity ?? '—'} | ${row.criteria.actualCourseDifference ? 'pass' : 'FAIL'} | ${row.criteria.safety ? 'pass' : 'FAIL'} | ${row.pass ? 'PASS' : 'FAIL'} |`);
  }
}

async function main() {
  if (!isMysqlConfigured()) {
    throw new Error('Roadmap #10 驗收必須連線目前 MySQL；未設定 DB_HOST、DB_USER 或 DB_NAME。');
  }

  const evaluationTime = new Date();
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

  const summaryCases = cases.map(({ generationDiagnostics, ...summary }) => summary);
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
    thresholds: {
      retentionRate: PLAN_RETENTION_THRESHOLD,
      medianJaccardSimilarity: PLAN_SIMILARITY_THRESHOLD,
      preferredPersonaMinimumDistinctPlans: 3,
      noPreferenceMinimumDistinctPlans: 2,
      minimumPairwiseCompetitiveCourseDifference: 1,
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
