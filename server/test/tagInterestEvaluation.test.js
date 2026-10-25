import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assessRealEvaluationReadiness,
  computeRankingMetrics,
  courseCatalogCoverage,
  evaluatePersonaRankingComparisons,
  evaluateSyntheticTagInterestCases,
  explanationTagFaithfulness,
  splitChronologicalEvents,
  subcategoryDiversityAtK,
} from '../scripts/lib/tagInterestEvaluation.js';

const fixtureUrl = new URL('./fixtures/tagInterestEvaluationCases.json', import.meta.url);
const fixture = JSON.parse(readFileSync(fileURLToPath(fixtureUrl), 'utf8'));
const personaFixtureUrl = new URL('./fixtures/tagInterestPersonaUxCases.json', import.meta.url);
const personaFixture = JSON.parse(readFileSync(fileURLToPath(personaFixtureUrl), 'utf8'));

describe('rag-tag-interest-v1 evaluation harness', () => {
  test('synthetic persona scenarios pass without claiming recommendation accuracy', () => {
    const report = evaluateSyntheticTagInterestCases(fixture);
    assert.equal(report.datasetType, 'synthetic');
    assert.equal(report.accuracyClaimAllowed, false);
    assert.equal(report.scenarioCount, 9);
    assert.equal(report.passedScenarioCount, 9, JSON.stringify(report.scenarioResults, null, 2));
    assert.equal(report.failedScenarioCount, 0);
    assert.equal(report.reasonFaithfulness.accuracy, 1);
  });

  test('synthetic fixture rejects unmarked real data', () => {
    assert.throws(
      () => evaluateSyntheticTagInterestCases({ ...fixture, datasetType: 'real' }),
      /datasetType=synthetic/u,
    );
  });

  test('10 fixed persona UX cases compare three tag profiles with the current v2 scheduler', () => {
    const report = evaluatePersonaRankingComparisons(personaFixture);
    assert.equal(report.datasetType, 'synthetic_persona_ux');
    assert.equal(report.accuracyClaimAllowed, false);
    assert.equal(report.personaCount, 10);
    assert.equal(report.comparisonCount, 4);
    assert.equal(report.personaResults.every(persona => (
      persona.models.hybrid_tag_interest_v1.rankedCourseIds.length === report.k
      && persona.models.current_v2_scheduler.rankedCourseIds.length === report.k
    )), true);
    assert.equal(report.personaResults.filter(persona => persona.v2Learning.applied).length, 8);
    assert.equal(report.personaResults
      .filter(persona => ['P01', 'P08'].includes(persona.personaId))
      .every(persona => persona.v2Learning.applied === false && persona.v2Learning.usableEventCount === 0), true);
    assert.equal(report.personaResults
      .filter(persona => persona.v2Learning.applied)
      .every(persona => persona.v2Learning.usableEventCount >= persona.v2Learning.requiredEventCount), true);
    assert.match(report.roleplayProtocol, /合成課程卡/u);
    assert.equal(report.personaResults.every(persona => persona.models.hybrid_tag_interest_v1.subcategoryDiversity === 1), true);
    assert.deepEqual(Object.keys(report.modelSummaries), [
      'initial_topic_prior',
      'behavior_tag_profile',
      'hybrid_tag_interest_v1',
      'current_v2_scheduler',
    ]);
    const broadAi = report.personaResults.find(persona => persona.personaId === 'P08');
    assert.equal(broadAi.tagProfiles.initial_topic_prior.evidenceTagCount, 0);
    assert.equal(broadAi.tagProfiles.hybrid_tag_interest_v1.evidenceTagCount, 0);
    assert.ok(broadAi.models.current_v2_scheduler.topK.includes('ai-foundations'));
    assert.equal(
      report.personaResults.find(persona => persona.personaId === 'P02')
        .models.hybrid_tag_interest_v1.topK[0],
      'security-course',
    );
    assert.equal(
      report.personaResults.every(persona => persona.models.hybrid_tag_interest_v1.reasonFaithfulness.accuracy === 1
        || persona.models.hybrid_tag_interest_v1.reasonFaithfulness.accuracy === null),
      true,
    );
    assert.ok(report.modelSummaries.hybrid_tag_interest_v1.meanNdcgAtK >= 0);
    assert.equal(report.limitations.length, 3);
  });

  test('Stage 6 replays the production scheduler off/active with the same hard constraints', () => {
    const report = evaluatePersonaRankingComparisons(personaFixture);
    const comparison = report.stage6ScheduleComparison;
    assert.equal(comparison.datasetType, 'synthetic_persona_ux');
    assert.equal(comparison.comparisonCount, 2);
    assert.equal(comparison.hardConstraintsPreservedCount, 10);
    assert.ok(comparison.changedSelectionCount > 0);
    assert.equal(comparison.modelSummaries.off.feasiblePersonaCount, 10);
    assert.equal(comparison.modelSummaries.active.feasiblePersonaCount, 10);
    assert.equal(comparison.modelSummaries.off.meanPlanTagScore, null);
    assert.equal(comparison.modelSummaries.active.scoreBreakdownFaithfulness.accuracy, 1);
    assert.equal(comparison.modelSummaries.active.reasonFaithfulness.accuracy, 1);

    for (const persona of report.personaResults) {
      const { off, active, hardConstraintsPreserved } = persona.stage6Scheduler;
      assert.equal(hardConstraintsPreserved, true, persona.personaId);
      for (const run of [off, active]) {
        assert.equal(run.hardConstraintsValid, true, persona.personaId);
        assert.equal(run.totalCredits, 9, persona.personaId);
        assert.equal(run.hardConstraintChecks.noTimeConflictsOrDuplicateCourses, true, persona.personaId);
        assert.equal(run.hardConstraintChecks.minimumCreditsMet, true, persona.personaId);
        assert.equal(run.hardConstraintChecks.maximumCreditsMet, true, persona.personaId);
        assert.equal(run.selectedCourseIds.includes('ai-foundations')
          && run.selectedCourseIds.includes('database-course'), false, persona.personaId);
        assert.equal(run.scoreBreakdownFaithfulness.accuracy, 1, persona.personaId);
      }
      assert.equal(off.mode, 'off');
      assert.equal(off.planTagScore, null);
      assert.equal(off.tagInterestCoverage, null);
      assert.equal(active.mode, 'active');
      assert.equal(active.profileSource, 'consented-learned');
      assert.ok(active.planTagScore === null
        || (active.planTagScore >= -1 && active.planTagScore <= 1));
      assert.ok(active.tagInterestCoverage >= 0 && active.tagInterestCoverage <= 1);
      assert.ok(active.reasonFaithfulness.accuracy === null
        || active.reasonFaithfulness.accuracy === 1);
      assert.equal(active.reasonFaithfulness.correctCount, active.reasonFaithfulness.claimCount);
    }
  });

  test('persona comparison rejects fixtures without the explicit 10-person synthetic marker', () => {
    assert.throws(
      () => evaluatePersonaRankingComparisons({ ...personaFixture, datasetType: 'real' }),
      /10 位 synthetic persona/u,
    );
  });

  test('chronological split sorts by time and never trains on held-out events', () => {
    const split = splitChronologicalEvents([
      { eventId: 'later', timestamp: '2026-10-03T00:00:00.000Z' },
      { eventId: 'first', timestamp: '2026-10-01T00:00:00.000Z' },
      { eventId: 'middle', timestamp: '2026-10-02T00:00:00.000Z' },
    ], { testFraction: 1 / 3 });
    assert.equal(split.ready, true);
    assert.deepEqual(split.train.map(event => event.eventId), ['first', 'middle']);
    assert.deepEqual(split.test.map(event => event.eventId), ['later']);
    assert.equal(split.splitAt, '2026-10-03T00:00:00.000Z');
  });

  test('chronological split fails closed for too little or malformed data', () => {
    assert.equal(splitChronologicalEvents([]).reason, 'need_at_least_two_events');
    assert.equal(splitChronologicalEvents([
      { eventId: 'bad', timestamp: 'not-a-date' },
      { eventId: 'good', timestamp: '2026-10-01T00:00:00.000Z' },
    ]).reason, 'invalid_event_timestamp');
    assert.equal(splitChronologicalEvents([
      { eventId: 'a', timestamp: '2026-10-01T00:00:00.000Z' },
      { eventId: 'b', timestamp: '2026-10-01T00:00:00.000Z' },
    ]).reason, 'timestamps_not_separable');
    const tied = splitChronologicalEvents([
      { eventId: 'late-tie-b', timestamp: '2026-10-02T00:00:00.000Z' },
      { eventId: 'early', timestamp: '2026-10-01T00:00:00.000Z' },
      { eventId: 'late-tie-a', timestamp: '2026-10-02T00:00:00.000Z' },
    ], { testFraction: 1 / 3 });
    assert.equal(tied.ready, true);
    assert.deepEqual(tied.test.map(event => event.eventId), ['late-tie-a', 'late-tie-b']);
  });

  test('ranking metrics report NDCG, precision, and recall without inventing relevance', () => {
    const metrics = computeRankingMetrics({
      rankedCourseIds: ['a', 'b', 'c'],
      relevanceByCourseId: { a: 1, b: 0, c: 1 },
      k: 2,
    });
    assert.ok(Math.abs(metrics.ndcg - (1 / (1 + 1 / Math.log2(3)))) < 1e-12);
    assert.equal(metrics.precision, 0.5);
    assert.equal(metrics.recall, 0.5);
    assert.equal(metrics.hits, 1);
    assert.equal(metrics.relevantCount, 2);
    assert.equal(computeRankingMetrics({ rankedCourseIds: ['a'], relevanceByCourseId: {}, k: 1 }).ndcg, null);
    assert.equal(computeRankingMetrics({ rankedCourseIds: ['a'], relevanceByCourseId: null, k: 1 }).ndcg, null);
  });

  test('coverage, topic diversity, and explanation faithfulness use only provided candidate evidence', () => {
    assert.equal(courseCatalogCoverage(['a', 'a', 'outside'], ['a', 'b', 'c', 'd']), 0.25);
    assert.equal(courseCatalogCoverage(['a'], []), null);
    assert.equal(subcategoryDiversityAtK([
      { courseId: 'a', subcategoryIds: ['x'] },
      { courseId: 'b', subcategoryIds: ['y'] },
      { courseId: 'c', subcategoryIds: ['y'] },
    ], { k: 2 }), 1);
    assert.equal(subcategoryDiversityAtK([
      { courseId: 'a', subcategoryIds: ['x', 'y', 'z'] },
    ], { k: 1 }), 1);
    assert.deepEqual(explanationTagFaithfulness({
      courseTagIds: ['tag-a', 'tag-b'],
      reasonTagIds: ['tag-a', 'invented-tag'],
    }), { claimCount: 2, correctCount: 1, accuracy: 0.5 });
    assert.equal(explanationTagFaithfulness().accuracy, null);
  });

  test('real-data readiness distinguishes a temporal split from statistical power', () => {
    const ready = assessRealEvaluationReadiness({
      snapshotEventCount: 12,
      subjectCount: 2,
      rankingOutcomeCount: 4,
      subjectsWithTwoOutcomes: 2,
    });
    assert.equal(ready.readyForMultiSubjectSplit, true);
    assert.equal(ready.statisticalPower, 'not_assessed');
    assert.equal(ready.accuracyClaimAllowed, false);

    const notReady = assessRealEvaluationReadiness({
      snapshotEventCount: 30,
      subjectCount: 1,
      rankingOutcomeCount: 0,
      subjectsWithTwoOutcomes: 0,
    });
    assert.equal(notReady.readyForMultiSubjectSplit, false);
    assert.deepEqual(notReady.reasons, [
      'fewer_than_two_ranking_outcomes',
      'fewer_than_two_subjects_with_chronological_outcomes',
    ]);
  });
});
