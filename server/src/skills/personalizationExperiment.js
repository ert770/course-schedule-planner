// Roadmap #36：離線 persona 實驗展開器。
//
// 這裡只組合固定 fixture、真正的學習管線與 generateSchedule()；不連 MySQL，
// 也不在 production route 裡加入量測專用參數。

import { ALL_FLAGS } from '../data/preferenceTags.js';
import { ACTIVE_TERM } from '../data/activeTerm.js';
import {
  buildDemoPersonaEvents,
} from '../data/demoPersonas.js';
import {
  computeLearnedBoosts,
  learnPreferenceWeights,
} from './preferenceLearning.js';
import { generateSchedule } from './scheduler.js';
import {
  assertNoSafetyRegression,
  checkDirection,
  compareRuns,
  summarizeExperiment,
  summarizeRun,
} from './personalizationMetrics.js';

const PERSONALIZATION_ARRAY_FIELDS = ['interests', 'preferredKeywords', 'preferredTrack'];

export function stripPersonalization(constraints = {}) {
  const stripped = { ...constraints };
  for (const flag of ALL_FLAGS) delete stripped[flag];
  for (const field of PERSONALIZATION_ARRAY_FIELDS) delete stripped[field];
  delete stripped.learnedPreference;
  return stripped;
}

function explicitProfileFromConstraints(constraints) {
  return {
    interest: (constraints.interests?.length || constraints.preferredKeywords?.length || constraints.preferredTrack) ? 1 : 0,
    compact: constraints.preferCompact ? 1 : 0,
    // 學習模型的 easy 權重是強度；方向仍由顯式標籤在 scheduler 決定。
    easy: 0,
  };
}

export function learnPersona(persona, caseDefinition) {
  const eventRefs = caseDefinition.candidateCourses.map(course => ({
    catalogCourseCode: course.catalogCourseCode ?? course.code ?? `DEMO${course.id}`,
    sectionId: course.id,
  }));
  const events = buildDemoPersonaEvents({
    ...persona,
    name: persona.id,
    historyFileName: `${persona.id}.json`,
  }, eventRefs, {
    count: persona.eventCount ?? 50,
    referenceTime: caseDefinition.clock?.now,
  });
  const explicitProfile = explicitProfileFromConstraints(caseDefinition.baseConstraints);
  const learned = learnPreferenceWeights(events, {
    explicitProfile,
    now: caseDefinition.clock?.now ?? null,
    activeTerm: caseDefinition.clock?.activeTerm ?? ACTIVE_TERM,
  });
  const applied = learned.sufficiency.status === 'sufficient';
  return {
    ...learned,
    applied,
    reason: applied ? 'sufficient' : 'insufficient',
    boosts: computeLearnedBoosts(learned.weights, explicitProfile),
    events,
  };
}

function withFixtureData(caseDefinition, constraints) {
  return {
    ...constraints,
    courseReviews: caseDefinition.reviews ?? [],
  };
}

export function buildConditions(caseDefinition, persona) {
  const source = withFixtureData(caseDefinition, caseDefinition.baseConstraints ?? {});
  const stripped = stripPersonalization(source);
  const carrierFlag = caseDefinition.carrierFlag ?? 'preferCompact';
  const carrier = { [carrierFlag]: true };
  const learning = learnPersona(persona, caseDefinition);
  const b0 = { ...stripped, ...carrier };
  const b1 = {
    ...source,
    learnedPreference: {
      applied: false,
      reason: 'disabled-for-baseline',
      boosts: { interest: 0, compact: 0, easy: 0 },
      modelVersion: learning.modelVersion,
    },
  };
  const p = {
    ...source,
    learnedPreference: {
      applied: learning.applied,
      reason: learning.reason,
      boosts: learning.boosts,
      modelVersion: learning.modelVersion,
      computedAt: learning.decay?.appliedAt ?? null,
    },
  };
  return { B0: b0, B1: b1, P: p, learning };
}

export function runPersonalizationCase(caseDefinition, persona, {
  assertSafety = true,
} = {}) {
  const conditions = buildConditions(caseDefinition, persona);
  const evaluationConstraints = withFixtureData(caseDefinition, caseDefinition.baseConstraints ?? {});
  const runs = Object.fromEntries(['B0', 'B1', 'P'].map(label => {
    const constraints = conditions[label];
    const result = generateSchedule(caseDefinition.candidateCourses, constraints, {
      seed: constraints.seed,
      timeoutMs: constraints.timeoutMs,
    });
    return [label, summarizeRun(result, {
      label,
      evaluationConstraints,
      constraints,
    })];
  }));
  if (assertSafety) {
    assertNoSafetyRegression(runs.B0, runs.B1);
    assertNoSafetyRegression(runs.B1, runs.P);
  }
  return {
    caseId: caseDefinition.id,
    personaId: persona.id,
    learning: {
      applied: conditions.learning.applied,
      sufficiency: conditions.learning.sufficiency,
      boosts: conditions.learning.boosts,
    },
    runs,
    comparisons: {
      B0_to_B1: compareRuns(runs.B0, runs.B1),
      B1_to_P: compareRuns(runs.B1, runs.P),
    },
  };
}

const AXIS_DEFINITIONS = Object.freeze([
  { id: 'interest', on: { interests: ['資訊安全'] }, expectation: 'positive' },
  { id: 'compact', on: { preferCompact: true }, expectation: 'positive' },
  { id: 'easy', on: { preferEasyCourses: true }, expectation: 'positive' },
  { id: 'avoid-time', on: { noMorningClasses: true }, expectation: 'negative' },
  { id: 'review-priority', on: { _reviews: 'on' }, expectation: 'positive' },
]);

export function buildAxisConditions(caseDefinition, axisId) {
  const axis = AXIS_DEFINITIONS.find(item => item.id === axisId);
  if (!axis) throw new Error(`未知 preference sensitivity 軸：${axisId}`);
  const source = withFixtureData(caseDefinition, caseDefinition.baseConstraints ?? {});
  const stripped = stripPersonalization(source);
  let carrierFlag = caseDefinition.carrierFlag ?? 'preferCompact';
  const sweptFlags = Object.keys(axis.on).filter(flag => flag !== '_reviews');
  if (sweptFlags.includes(carrierFlag)) {
    carrierFlag = carrierFlag === 'preferCompact' ? 'preferChallengingCourses' : 'preferCompact';
  }
  const base = { ...stripped, [carrierFlag]: true };
  delete base._reviews;
  const off = { ...base };
  const on = { ...base, ...axis.on };
  if (axisId === 'interest') {
    delete off.interests;
    delete off.preferredKeywords;
    delete off.preferredTrack;
  }
  if (axisId === 'easy') {
    delete off.preferEasyCourses;
    delete off.preferChallengingCourses;
  }
  if (axisId === 'review-priority') {
    delete off.courseReviews;
    on.courseReviews = caseDefinition.reviews ?? [];
  }
  if (axisId === 'avoid-time') {
    delete off.noMorningClasses;
  }
  return { off, on, expectation: axis.expectation };
}

export function runAxisSweep(caseDefinition, axisId) {
  const { off, on, expectation } = buildAxisConditions(caseDefinition, axisId);
  const evaluationConstraints = withFixtureData(caseDefinition, caseDefinition.baseConstraints ?? {});
  const summarize = (label, constraints) => summarizeRun(
    generateSchedule(caseDefinition.candidateCourses, constraints, {
      seed: caseDefinition.baseConstraints?.seed,
      timeoutMs: caseDefinition.baseConstraints?.timeoutMs,
    }), { label, evaluationConstraints, constraints }
  );
  const offSummary = summarize('off', off);
  const onSummary = summarize('on', on);
  const comparison = compareRuns(offSummary, onSummary);
  return {
    axis: axisId,
    expectation,
    off: offSummary,
    on: onSummary,
    comparison,
    directionCheck: checkDirection({ direction: expectation, min: 0 }, comparison),
  };
}

export function runExperimentSuite(caseDefinitions, { assertSafety = true } = {}) {
  const rows = [];
  const details = [];
  for (const caseDefinition of caseDefinitions) {
    for (const persona of caseDefinition.personas ?? []) {
      const detail = runPersonalizationCase(caseDefinition, persona, { assertSafety });
      details.push(detail);
      rows.push({
        id: `${caseDefinition.id}:${persona.id}:B1-to-P`,
        pass: detail.runs.B1.allPlansSafe && detail.runs.P.allPlansSafe,
        baselineUtilityDelta: detail.comparisons.B0_to_B1.utilityDelta,
        utilityDelta: detail.comparisons.B1_to_P.utilityDelta,
        rankingChanged: detail.comparisons.B1_to_P.ranking.changed,
        learnedApplied: detail.learning.applied,
        planEvidence: Object.fromEntries(['B0', 'B1', 'P'].map(label => [label, {
          categoryCoefficient: detail.runs[label].primaryPlan?.generationPolicy?.categoryCoefficient ?? null,
          requestedVariants: detail.runs[label].planDiversity?.requestedVariants ?? null,
          distinctPlans: detail.runs[label].planDiversity?.distinctPlans ?? null,
        }])),
      });
    }
  }
  return { ...summarizeExperiment(rows), details };
}

export { AXIS_DEFINITIONS };

export default {
  stripPersonalization,
  learnPersona,
  buildConditions,
  runPersonalizationCase,
  buildAxisConditions,
  runAxisSweep,
  runExperimentSuite,
  AXIS_DEFINITIONS,
};
