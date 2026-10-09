import {
  TAG_INTEREST_MODEL_VERSION,
  buildTagInterestSnapshot,
  computeTagInterestProfile,
  scoreCourseTagInterest,
} from '../../src/skills/tagInterestLearning.js';
import { resolveInterestTag, resolveInterestTags } from '../../src/data/interestTagCatalog.js';

const SCORE_TOLERANCE = 0.000001;

function selectedTagIds(names = []) {
  return names.map(name => {
    const tag = resolveInterestTag(name);
    if (tag.status !== 'resolved') {
      throw new TypeError(`合成情境含有無法解析的標籤：${name}`);
    }
    return tag.canonicalTagId;
  });
}

function makeEvent(scenario, definition, index) {
  const courseCode = definition.courseCode ?? `SYN-${scenario.scenarioId}-${index + 1}`;
  const event = {
    eventId: `synthetic:${scenario.scenarioId}:${index + 1}`,
    eventType: definition.eventType,
    timestamp: definition.timestamp,
    term: definition.term ?? scenario.activeTerm,
    source: definition.source ?? 'exploration',
    course: { catalogCourseCode: courseCode, sectionId: index + 1 },
    ...(definition.rating === undefined ? {} : { rating: definition.rating }),
    ...(definition.feedbackReason ? { feedbackReason: definition.feedbackReason } : {}),
  };
  if (definition.response) {
    event.interestFeedback = {
      response: definition.response,
      canonicalTagIds: selectedTagIds(definition.selectedTags ?? []),
    };
  }

  const course = {
    catalogCourseCode: courseCode,
    sectionId: index + 1,
    category: definition.courseCategory ?? '選修',
    department: '資訊工程學系',
    ragTag: definition.courseTags ?? [],
  };
  const scope = definition.scopeResolved === false
    ? { resolved: false }
    : { resolved: true, department: '資訊工程學系', gradeLevel: 2, className: '資訊二甲' };
  const tagInterestSnapshot = buildTagInterestSnapshot(event, course, scope);
  return { ...event, tagInterestSnapshot };
}

function near(left, right) {
  return Number.isFinite(left)
    && Number.isFinite(right)
    && Math.abs(left - right) <= SCORE_TOLERANCE;
}

function sameStrings(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((value, index) => value === sortedRight[index]);
}

function candidateSummary(profile, candidate) {
  const score = scoreCourseTagInterest(profile, candidate.ragTags);
  const eligibleIds = new Set(resolveInterestTags(candidate.ragTags).tags
    .filter(tag => tag.eligibility?.crossCourseMatchEligible === true)
    .map(tag => tag.canonicalTagId));
  const matchedTagNames = score.matchedTags.map(tag => tag.canonicalName).sort();
  const reasonClaimCount = score.matchedTags.length;
  const correctReasonCount = score.matchedTags
    .filter(tag => eligibleIds.has(tag.canonicalTagId)).length;
  return {
    score: score.score,
    reason: score.reason,
    eligibleTagCount: score.eligibleTagCount,
    evidenceTagCount: score.evidenceTagCount,
    matchedTagNames,
    reasonClaimCount,
    correctReasonCount,
  };
}

function compareScenario(scenario) {
  const events = scenario.events.map((event, index) => makeEvent(scenario, event, index));
  const profile = computeTagInterestProfile(events, scenario.preferences ?? {}, {
    now: scenario.evaluationTime,
    activeTerm: scenario.activeTerm,
  });
  const actualTagScores = Object.fromEntries(profile.tagInterests
    .map(tag => [tag.canonicalName, tag.score])
    .sort(([left], [right]) => left.localeCompare(right, 'zh-Hant')));
  const actualTagEvidence = Object.fromEntries(profile.tagInterests.map(tag => [tag.canonicalName, {
    positiveEvidence: tag.positiveEvidence,
    negativeEvidence: tag.negativeEvidence,
    positiveEventCount: tag.positiveEventCount,
    negativeEventCount: tag.negativeEventCount,
  }]));
  const candidateResults = Object.fromEntries(scenario.candidateCourses.map(candidate => [
    candidate.courseId,
    candidateSummary(profile, candidate),
  ]));
  const expected = scenario.expected ?? {};
  const checks = [];
  const addCheck = (name, pass, expectedValue, actualValue) => checks.push({
    name,
    pass,
    expected: expectedValue,
    actual: actualValue,
  });

  if (expected.categoryIntentNames) {
    const names = profile.categoryInterests.map(item => item.name).sort();
    addCheck('category_intents', sameStrings(names, expected.categoryIntentNames), expected.categoryIntentNames, names);
  }
  if (expected.tagScores) {
    const expectedNames = Object.keys(expected.tagScores).sort();
    const actualNames = Object.keys(actualTagScores).sort();
    addCheck('tag_score_names', sameStrings(actualNames, expectedNames), expectedNames, actualNames);
    for (const [name, score] of Object.entries(expected.tagScores)) {
      addCheck(`tag_score:${name}`, near(actualTagScores[name], score), score, actualTagScores[name] ?? null);
    }
  }
  if (expected.tagEvidence) {
    for (const [name, values] of Object.entries(expected.tagEvidence)) {
      const actual = actualTagEvidence[name] ?? null;
      const pass = actual !== null
        && Object.entries(values).every(([key, value]) => near(actual[key], value));
      addCheck(`tag_evidence:${name}`, pass, values, actual);
    }
  }
  if (expected.usableEventCount !== undefined) {
    addCheck('usable_event_count', profile.summary.usableEventCount === expected.usableEventCount,
      expected.usableEventCount, profile.summary.usableEventCount);
  }
  if (expected.excludedEventCount !== undefined) {
    addCheck('excluded_event_count', profile.summary.excludedEventCount === expected.excludedEventCount,
      expected.excludedEventCount, profile.summary.excludedEventCount);
  }
  if (expected.snapshotTagCounts) {
    const counts = events.map(event => event.tagInterestSnapshot.tags.length);
    addCheck('snapshot_tag_counts', sameStrings(counts.map(String), expected.snapshotTagCounts.map(String)),
      expected.snapshotTagCounts, counts);
  }
  if (expected.snapshotRequiredStatuses) {
    const statuses = events.map(event => event.tagInterestSnapshot.requiredStatus);
    addCheck('snapshot_required_statuses', sameStrings(statuses, expected.snapshotRequiredStatuses),
      expected.snapshotRequiredStatuses, statuses);
  }
  if (expected.snapshotExclusionReasons) {
    const reasons = events.map(event => event.tagInterestSnapshot.exclusionReason);
    const pass = reasons.length === expected.snapshotExclusionReasons.length
      && reasons.every((reason, index) => reason === expected.snapshotExclusionReasons[index]);
    addCheck('snapshot_exclusion_reasons', pass, expected.snapshotExclusionReasons, reasons);
  }
  if (expected.candidateScores) {
    for (const [courseId, expectedResult] of Object.entries(expected.candidateScores)) {
      const actual = candidateResults[courseId];
      if (!actual) {
        addCheck(`candidate:${courseId}:exists`, false, expectedResult, null);
        continue;
      }
      if (Object.hasOwn(expectedResult, 'score')) {
        const scorePass = expectedResult.score === null
          ? actual.score === null
          : near(actual.score, expectedResult.score);
        addCheck(`candidate:${courseId}:score`, scorePass, expectedResult.score, actual.score);
      }
      for (const key of ['reason', 'eligibleTagCount', 'evidenceTagCount']) {
        if (Object.hasOwn(expectedResult, key)) {
          addCheck(`candidate:${courseId}:${key}`, actual[key] === expectedResult[key],
            expectedResult[key], actual[key]);
        }
      }
      if (expectedResult.matchedTagNames) {
        addCheck(`candidate:${courseId}:matched_tags`,
          sameStrings(actual.matchedTagNames, expectedResult.matchedTagNames),
          expectedResult.matchedTagNames, actual.matchedTagNames);
      }
    }
  }

  const reasonClaimCount = Object.values(candidateResults)
    .reduce((sum, result) => sum + result.reasonClaimCount, 0);
  const correctReasonCount = Object.values(candidateResults)
    .reduce((sum, result) => sum + result.correctReasonCount, 0);
  const reasonFaithfulness = reasonClaimCount === 0 ? null : correctReasonCount / reasonClaimCount;
  if (reasonFaithfulness !== null) {
    addCheck('reason_tags_belong_to_candidate', correctReasonCount === reasonClaimCount,
      reasonClaimCount, correctReasonCount);
  }

  return {
    scenarioId: scenario.scenarioId,
    description: scenario.description,
    passed: checks.every(check => check.pass),
    assertionCount: checks.length,
    failedChecks: checks.filter(check => !check.pass),
    modelVersion: profile.modelVersion,
    profileSummary: profile.summary,
    tagScores: actualTagScores,
    candidateScores: Object.fromEntries(Object.entries(candidateResults).map(([courseId, result]) => [courseId, {
      score: result.score,
      reason: result.reason,
      eligibleTagCount: result.eligibleTagCount,
      evidenceTagCount: result.evidenceTagCount,
      matchedTagNames: result.matchedTagNames,
    }])),
    reasonClaimCount,
    correctReasonCount,
    reasonFaithfulness,
  };
}

/** Evaluate only clearly labeled synthetic personas; this is not an accuracy estimate. */
export function evaluateSyntheticTagInterestCases(fixture) {
  if (fixture?.datasetType !== 'synthetic' || !Array.isArray(fixture.scenarios)) {
    throw new TypeError('rag-tag-interest evaluation fixture 必須標記 datasetType=synthetic');
  }
  const scenarioResults = fixture.scenarios.map(scenario => compareScenario({
    ...scenario,
    evaluationTime: scenario.evaluationTime ?? fixture.evaluationTime ?? null,
    activeTerm: scenario.activeTerm ?? fixture.activeTerm ?? null,
  }));
  const passedScenarioCount = scenarioResults.filter(result => result.passed).length;
  const reasonClaimCount = scenarioResults.reduce((sum, result) => sum + result.reasonClaimCount, 0);
  const correctReasonCount = scenarioResults.reduce((sum, result) => sum + result.correctReasonCount, 0);
  return {
    schemaVersion: 1,
    datasetType: 'synthetic',
    modelVersion: TAG_INTEREST_MODEL_VERSION,
    accuracyClaimAllowed: false,
    scenarioCount: scenarioResults.length,
    passedScenarioCount,
    failedScenarioCount: scenarioResults.length - passedScenarioCount,
    passed: passedScenarioCount === scenarioResults.length,
    reasonFaithfulness: {
      claimCount: reasonClaimCount,
      correctCount: correctReasonCount,
      accuracy: reasonClaimCount === 0 ? null : correctReasonCount / reasonClaimCount,
    },
    scenarioResults,
    disclaimer: '角色扮演／合成情境只驗證規則與資料流，不代表真人推薦準確率。',
  };
}

/** Chronological split with stable tie-breaking; unusable timestamps fail closed. */
export function splitChronologicalEvents(events, { testFraction = 0.2 } = {}) {
  if (!Number.isFinite(testFraction) || testFraction <= 0 || testFraction >= 1) {
    throw new RangeError('testFraction 必須介於 0 與 1 之間');
  }
  const rows = Array.isArray(events) ? [...events] : [];
  if (rows.some(event => !Number.isFinite(Date.parse(event?.timestamp ?? '')))) {
    return { ready: false, train: [], test: [], reason: 'invalid_event_timestamp' };
  }
  rows.sort((left, right) => (
    Date.parse(left.timestamp) - Date.parse(right.timestamp)
    || String(left.eventId ?? '').localeCompare(String(right.eventId ?? ''))
  ));
  if (rows.length < 2) {
    return { ready: false, train: [], test: rows, reason: 'need_at_least_two_events' };
  }
  const testCount = Math.max(1, Math.ceil(rows.length * testFraction));
  const splitCandidates = [];
  for (let index = 1; index < rows.length; index += 1) {
    if (Date.parse(rows[index - 1].timestamp) !== Date.parse(rows[index].timestamp)) {
      splitCandidates.push(index);
    }
  }
  if (splitCandidates.length === 0) {
    return { ready: false, train: [], test: rows, reason: 'timestamps_not_separable' };
  }
  const targetSplitAt = rows.length - testCount;
  const splitAt = splitCandidates.reduce((best, candidate) => {
    const candidateDistance = Math.abs(candidate - targetSplitAt);
    const bestDistance = Math.abs(best - targetSplitAt);
    return candidateDistance < bestDistance
      || (candidateDistance === bestDistance && candidate < best)
      ? candidate
      : best;
  });
  return {
    ready: true,
    train: rows.slice(0, splitAt),
    test: rows.slice(splitAt),
    splitAt: rows[splitAt].timestamp,
    reason: null,
  };
}

function relevanceValue(relevanceByCourseId, courseId) {
  const value = relevanceByCourseId instanceof Map
    ? relevanceByCourseId.get(courseId)
    : relevanceByCourseId?.[courseId];
  return Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
}

export function computeRankingMetrics({ rankedCourseIds = [], relevanceByCourseId = {}, k = 5 } = {}) {
  if (!Number.isInteger(k) || k < 1) throw new RangeError('k 必須是正整數');
  const relevance = relevanceByCourseId ?? {};
  const uniqueRanked = [...new Set(rankedCourseIds.map(String))];
  const relevanceEntries = relevance instanceof Map
    ? [...relevance.entries()]
    : Object.entries(relevance);
  const relevantValues = relevanceEntries
    .map(([, value]) => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0)
    .filter(value => value > 0);
  if (relevantValues.length === 0) {
    return { ndcg: null, precision: null, recall: null, hits: 0, relevantCount: 0, k };
  }
  const top = uniqueRanked.slice(0, k);
  const topRelevance = top.map(courseId => relevanceValue(relevance, courseId));
  const dcg = topRelevance.reduce((sum, relevance, index) => (
    sum + ((2 ** relevance) - 1) / Math.log2(index + 2)
  ), 0);
  const ideal = relevantValues.sort((left, right) => right - left).slice(0, k);
  const idcg = ideal.reduce((sum, relevance, index) => (
    sum + ((2 ** relevance) - 1) / Math.log2(index + 2)
  ), 0);
  const hits = topRelevance.filter(value => value > 0).length;
  return {
    ndcg: idcg === 0 ? null : dcg / idcg,
    precision: hits / k,
    recall: hits / relevantValues.length,
    hits,
    relevantCount: relevantValues.length,
    k,
  };
}

export function courseCatalogCoverage(recommendedCourseIds = [], candidateCourseIds = []) {
  const candidates = new Set(candidateCourseIds.map(String));
  if (candidates.size === 0) return null;
  const covered = new Set(recommendedCourseIds.map(String).filter(id => candidates.has(id)));
  return covered.size / candidates.size;
}

export function subcategoryDiversityAtK(rankedCourses = [], { k = 5 } = {}) {
  if (!Number.isInteger(k) || k < 1) throw new RangeError('k 必須是正整數');
  const top = rankedCourses.slice(0, k);
  if (top.length === 0) return null;
  const subcategories = new Set(top.flatMap(course => course.subcategoryIds ?? []).map(String));
  return Math.min(1, subcategories.size / top.length);
}

export function explanationTagFaithfulness({ courseTagIds = [], reasonTagIds = [] } = {}) {
  const courseTags = new Set(courseTagIds.map(String));
  const claims = [...new Set(reasonTagIds.map(String))];
  const correctCount = claims.filter(id => courseTags.has(id)).length;
  return {
    claimCount: claims.length,
    correctCount,
    accuracy: claims.length === 0 ? null : correctCount / claims.length,
  };
}

/**
 * This reports only whether a minimal multi-subject chronological split exists.
 * It does not establish statistical power or a user-visible quality claim.
 */
export function assessRealEvaluationReadiness(summary = {}) {
  const snapshotEventCount = Number(summary.snapshotEventCount ?? 0);
  const subjectCount = Number(summary.subjectCount ?? 0);
  const rankingOutcomeCount = Number(summary.rankingOutcomeCount ?? 0);
  const subjectsWithTwoOutcomes = Number(summary.subjectsWithTwoOutcomes ?? 0);
  const reasons = [];
  if (snapshotEventCount === 0) reasons.push('no_versioned_tag_events');
  if (rankingOutcomeCount < 2) reasons.push('fewer_than_two_ranking_outcomes');
  if (subjectsWithTwoOutcomes < 2) reasons.push('fewer_than_two_subjects_with_chronological_outcomes');
  return {
    readyForMultiSubjectSplit: reasons.length === 0,
    snapshotEventCount,
    subjectCount,
    rankingOutcomeCount,
    subjectsWithTwoOutcomes,
    reasons,
    statisticalPower: 'not_assessed',
    accuracyClaimAllowed: false,
  };
}
