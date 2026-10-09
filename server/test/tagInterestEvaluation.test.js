import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assessRealEvaluationReadiness,
  computeRankingMetrics,
  courseCatalogCoverage,
  evaluateSyntheticTagInterestCases,
  explanationTagFaithfulness,
  splitChronologicalEvents,
  subcategoryDiversityAtK,
} from '../scripts/lib/tagInterestEvaluation.js';

const fixtureUrl = new URL('./fixtures/tagInterestEvaluationCases.json', import.meta.url);
const fixture = JSON.parse(readFileSync(fileURLToPath(fixtureUrl), 'utf8'));

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
