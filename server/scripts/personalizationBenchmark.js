// Roadmap #36 offline benchmark. It uses only the checked-in fixture and the
// production scheduler, so running it never writes to MySQL or user profiles.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { AXIS_DEFINITIONS, runAxisSweep, runExperimentSuite } from '../src/skills/personalizationExperiment.js';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(scriptDir, '..', 'test', 'fixtures', 'personalizationCases.json');
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const suite = runExperimentSuite(fixture.cases);
const sweeps = fixture.cases.flatMap(caseDefinition => AXIS_DEFINITIONS.map(axis => ({
  caseId: caseDefinition.id,
  ...runAxisSweep(caseDefinition, axis.id),
})));

const report = {
  generatedAt: new Date().toISOString(),
  fixture: path.relative(process.cwd(), fixturePath),
  suite: {
    total: suite.total,
    passed: suite.passed,
    failed: suite.failed,
    passRate: suite.passRate,
    rows: suite.rows,
  },
  sensitivity: sweeps.map(sweep => ({
    caseId: sweep.caseId,
    axis: sweep.axis,
    expectation: sweep.expectation,
    utilityDelta: sweep.comparison.utilityDelta,
    rankingChanged: sweep.comparison.ranking.changed,
    jaccardDistance: sweep.comparison.ranking.jaccardDistance,
    reviewCoverageDelta: sweep.comparison.reviewCoverageDelta,
    directionCheck: sweep.directionCheck,
    evidence: {
      offCategoryCoefficient: sweep.off.primaryPlan?.generationPolicy?.categoryCoefficient ?? null,
      onCategoryCoefficient: sweep.on.primaryPlan?.generationPolicy?.categoryCoefficient ?? null,
      offRequestedVariants: sweep.off.planDiversity?.requestedVariants ?? null,
      onRequestedVariants: sweep.on.planDiversity?.requestedVariants ?? null,
      offDistinctPlans: sweep.off.planDiversity?.distinctPlans ?? null,
      onDistinctPlans: sweep.on.planDiversity?.distinctPlans ?? null,
    },
    allPlansSafe: sweep.off.allPlansSafe && sweep.on.allPlansSafe,
  })),
};

if (process.argv.includes('--markdown')) {
  console.log('# Personalization baseline benchmark');
  console.log(`- Fixture: \`${report.fixture}\``);
  console.log(`- Persona B1→P: ${report.suite.passed}/${report.suite.total} safety rows passed`);
  console.log('');
  console.log('| axis | utility Δ | ranking changed | Jaccard distance | review coverage Δ | expected direction | safety |');
  console.log('| --- | ---: | :---: | ---: | ---: | :---: | :---: |');
  for (const row of report.sensitivity) {
    console.log(`| ${row.axis} | ${row.utilityDelta ?? '—'} | ${row.rankingChanged ? 'yes' : 'no'} | ${row.jaccardDistance ?? '—'} | ${row.reviewCoverageDelta ?? '—'} | ${row.directionCheck.pass ? 'pass' : 'observe'} | ${row.allPlansSafe ? 'pass' : 'FAIL'} |`);
  }
} else {
  console.log(JSON.stringify(report, null, 2));
}
