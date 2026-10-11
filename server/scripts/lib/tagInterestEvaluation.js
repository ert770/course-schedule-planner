import {
  TAG_INTEREST_MODEL_VERSION,
  buildTagInterestSnapshot,
  computeTagInterestProfile,
  scoreCourseTagInterest,
} from '../../src/skills/tagInterestLearning.js';
import { resolveInterestTag, resolveInterestTags } from '../../src/data/interestTagCatalog.js';
import {
  generateSchedule,
  matchesInterestKeyword,
  validateSchedule,
} from '../../src/skills/scheduler.js';
import {
  buildTagInterestContext,
  DEFAULT_TAG_INTEREST_COURSE_ALPHA,
} from '../../src/skills/tagInterestRanking.js';
import { computeLearnedBoosts, learnPreferenceWeights } from '../../src/skills/preferenceLearning.js';

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

function subcategoryIdsFor(candidate) {
  return [...new Set(resolveInterestTags(candidate.ragTags).tags
    .flatMap(tag => (tag.categoryPaths ?? []).map(path => path.subcategoryId))
    .filter(Boolean))];
}

function rankByTagProfile(profile, candidates) {
  return candidates.map(candidate => {
    const result = scoreCourseTagInterest(profile, candidate.ragTags);
    return {
      courseId: candidate.courseId,
      score: result.score,
      matchedTags: result.matchedTags,
    };
  }).sort((left, right) => {
    const leftScore = left.score ?? Number.NEGATIVE_INFINITY;
    const rightScore = right.score ?? Number.NEGATIVE_INFINITY;
    if (leftScore !== rightScore) return leftScore > rightScore ? -1 : 1;
    return left.courseId.localeCompare(right.courseId);
  });
}

function schedulerCourse(candidate, index) {
  const id = index + 8100;
  const dayOfWeek = (index % 5) + 1;
  const startPeriod = index >= 5 ? 7 : 3;
  return {
    id,
    courseId: candidate.courseId,
    sectionId: id,
    catalogCourseCode: `SYN-TAG-${String(index + 1).padStart(2, '0')}`,
    code: `SYN-TAG-${String(index + 1).padStart(2, '0')}`,
    name: candidate.name,
    department: '資訊四乙',
    instructor: '合成評估課程',
    credits: 3,
    dayOfWeek,
    startPeriod,
    endPeriod: startPeriod + 1,
    category: '一般選修',
    ragTag: candidate.ragTags,
    track: candidate.track ?? null,
    term: { isActiveTerm: true },
    eligibility: 'eligible',
    ...candidate.schedulerCourse,
  };
}

function v2ScheduleRanking(persona, candidates, events, { now, activeTerm } = {}) {
  const courses = candidates.map(schedulerCourse);
  const interests = Array.isArray(persona.v2Keywords) ? persona.v2Keywords : [];
  const explicitProfile = {
    interest: 0,
    compact: persona.preferences?.preferCompact ? 1 : 0,
    easy: 0,
  };
  const learnedWeights = learnPreferenceWeights(events, { explicitProfile, now, activeTerm });
  const learnedPreferenceApplied = learnedWeights.sufficiency.status === 'sufficient';
  const learnedPreference = {
    applied: learnedPreferenceApplied,
    reason: learnedPreferenceApplied ? 'applied' : 'insufficient',
    boosts: learnedPreferenceApplied
      ? computeLearnedBoosts(learnedWeights.weights, explicitProfile)
      : null,
    modelVersion: learnedWeights.modelVersion,
  };
  const result = generateSchedule(courses, {
    department: '資訊工程學系',
    gradeLevel: 4,
    className: '資訊四乙',
    minCredits: 9,
    maxCredits: 9,
    interests,
    learnedPreference,
    courseReviews: [],
    courseHistory: [],
  }, { planSet: 'primary-only', seed: 43, timeoutMs: 1000 });
  const primary = result.plans?.find(plan => plan.id === result.recommendedPlanId) ?? result.plans?.[0];
  const ordered = [...(primary?.schedule ?? []), ...(primary?.unscheduledCourses ?? [])]
    .map(course => candidates.find(item => item.courseId === course.courseId))
    .filter(Boolean);
  const orderedIds = ordered.map(course => course.courseId);
  const used = new Set(orderedIds);
  // Scheduler emits the selected course order. Append unselected candidates using its
  // exact existing keyword matcher so the fixed-size ranking metric has a full list.
  const remaining = candidates.filter(candidate => !used.has(candidate.courseId)).map(candidate => ({
    courseId: candidate.courseId,
    score: interests.length === 0 ? 0
      : interests.filter(keyword => matchesInterestKeyword({
        name: candidate.name,
        track: candidate.track,
        ragTag: candidate.ragTags,
      }, keyword)).length / interests.length,
  })).sort((left, right) => right.score - left.score || left.courseId.localeCompare(right.courseId));
  return {
    rankedCourseIds: [...orderedIds, ...remaining.map(item => item.courseId)],
    learning: {
      modelVersion: learnedWeights.modelVersion,
      sufficiencyStatus: learnedWeights.sufficiency.status,
      usableEventCount: learnedWeights.sufficiency.usableEventCount,
      requiredEventCount: learnedWeights.sufficiency.requiredEventCount,
      applied: learnedPreferenceApplied,
      boosts: learnedPreference.boosts,
    },
  };
}

function stage6ScheduleMode(persona, candidates, profile, events, mode, { now, activeTerm } = {}) {
  const courses = candidates.map(schedulerCourse);
  // Exercise a real hard-constraint boundary in the fixed synthetic candidate set:
  // these two distinct electives share one time slot in both modes.
  const conflictAnchor = courses.find(course => course.courseId === 'ai-foundations');
  const conflictCandidate = courses.find(course => course.courseId === 'database-course');
  if (conflictAnchor && conflictCandidate) {
    conflictCandidate.dayOfWeek = conflictAnchor.dayOfWeek;
    conflictCandidate.startPeriod = conflictAnchor.startPeriod;
    conflictCandidate.endPeriod = conflictAnchor.endPeriod;
  }
  const interests = Array.isArray(persona.v2Keywords) ? persona.v2Keywords : [];
  const explicitProfile = {
    interest: 0,
    compact: persona.preferences?.preferCompact ? 1 : 0,
    easy: 0,
  };
  const learnedWeights = learnPreferenceWeights(events, { explicitProfile, now, activeTerm });
  const learnedPreferenceApplied = learnedWeights.sufficiency.status === 'sufficient';
  const constraints = {
    department: '資訊工程學系',
    gradeLevel: 4,
    className: '資訊四乙',
    minCredits: 9,
    maxCredits: 9,
    interests,
    learnedPreference: {
      applied: learnedPreferenceApplied,
      reason: learnedPreferenceApplied ? 'applied' : 'insufficient',
      boosts: learnedPreferenceApplied
        ? computeLearnedBoosts(learnedWeights.weights, explicitProfile)
        : null,
      modelVersion: learnedWeights.modelVersion,
    },
    courseReviews: [],
    courseHistory: [],
  };
  const tagInterestContext = mode === 'active'
    ? buildTagInterestContext({
      mode,
      // The agreed Persona baseline assumes learning consent; cold-start personas still
      // use their explicit topic priors because their synthetic event lists are empty.
      profileSource: 'consented-learned',
      profile,
      candidates: courses,
    })
    : null;
  const result = generateSchedule(courses, constraints, {
    planSet: 'primary-only',
    seed: 43,
    timeoutMs: 1000,
    ...(tagInterestContext ? { tagInterestContext } : {}),
  });
  const primary = result.plans?.find(plan => plan.id === result.recommendedPlanId) ?? result.plans?.[0] ?? null;
  const planCourses = primary
    ? [...(primary.schedule ?? []), ...(primary.unscheduledCourses ?? [])]
    : [];
  const collisionCheck = validateSchedule(planCourses);
  const selectedCourseIds = planCourses
    .map(course => String(course.courseId ?? ''))
    .filter(Boolean)
    .sort();
  const relevantIds = new Set(persona.relevantCourseIds ?? []);
  const relevantSelectedCount = selectedCourseIds.filter(id => relevantIds.has(id)).length;
  const candidateByCourseId = new Map(candidates.map(candidate => [candidate.courseId, candidate]));
  const selectedForDiversity = selectedCourseIds.map(courseId => candidateByCourseId.get(courseId)).filter(Boolean);

  let reasonClaimCount = 0;
  let correctReasonCount = 0;
  let scoreBreakdownCheckCount = 0;
  let scoreBreakdownCorrectCount = 0;
  const tagEvidenceByCourse = planCourses.map(course => {
    const candidate = candidateByCourseId.get(course.courseId);
    const sectionId = String(course.sectionId ?? course.id ?? '').trim();
    const entry = tagInterestContext?.coursesBySectionId?.[sectionId] ?? null;
    const eligibleTagIds = candidate
      ? resolveInterestTags(candidate.ragTags).tags
        .filter(tag => tag.eligibility?.crossCourseMatchEligible === true)
        .map(tag => tag.canonicalTagId)
      : [];
    const matchedTagIds = (entry?.matchedTags ?? []).map(tag => tag.canonicalTagId);
    const integrity = explanationTagFaithfulness({
      courseTagIds: eligibleTagIds,
      reasonTagIds: matchedTagIds,
    });
    reasonClaimCount += integrity.claimCount;
    correctReasonCount += integrity.correctCount;

    const scoreBreakdown = course.recommendationReason?.scoreBreakdown ?? [];
    const actualTagDelta = scoreBreakdown.find(item => item.component === 'tagInterest')?.value ?? 0;
    const expectedTagDelta = Number.isFinite(entry?.score)
      ? 1000 * DEFAULT_TAG_INTEREST_COURSE_ALPHA * entry.score
      : 0;
    scoreBreakdownCheckCount += 1;
    if (near(actualTagDelta, expectedTagDelta)) scoreBreakdownCorrectCount += 1;

    return {
      courseId: course.courseId,
      courseTagScore: entry?.score ?? null,
      matchedTags: (entry?.matchedTags ?? []).map(tag => tag.canonicalName),
      expectedScoreBreakdownDelta: Number(expectedTagDelta.toFixed(6)),
      actualScoreBreakdownDelta: Number(actualTagDelta.toFixed(6)),
    };
  });
  const hardConstraintChecks = {
    schedulerSucceeded: Boolean(result.success && primary?.success),
    noTimeConflictsOrDuplicateCourses: collisionCheck.valid,
    minimumCreditsMet: Number(primary?.totalCredits ?? 0) >= constraints.minCredits,
    maximumCreditsMet: Number(primary?.totalCredits ?? 0) <= constraints.maxCredits,
  };
  const hardConstraintsValid = Object.values(hardConstraintChecks).every(Boolean);

  return {
    mode,
    profileSource: tagInterestContext?.profileSource ?? 'not-read',
    primaryPlanId: primary?.id ?? null,
    primaryPlanTitle: primary?.title ?? null,
    primaryPlanVariantId: primary?.variantId ?? null,
    hardConstraintsValid,
    hardConstraintChecks,
    totalCredits: primary?.totalCredits ?? 0,
    selectedCourseIds,
    relevantSelectedCount,
    relevancePrecision: selectedCourseIds.length > 0
      ? relevantSelectedCount / selectedCourseIds.length
      : null,
    relevanceRecall: relevantIds.size > 0 ? relevantSelectedCount / relevantIds.size : null,
    planTagScore: Object.hasOwn(primary ?? {}, 'planTagScore') ? primary.planTagScore : null,
    tagInterestCoverage: Object.hasOwn(primary ?? {}, 'tagInterestCoverage')
      ? primary.tagInterestCoverage
      : null,
    combinedPlanScore: Object.hasOwn(primary ?? {}, 'combinedPlanScore')
      ? primary.combinedPlanScore
      : null,
    subcategoryDiversity: subcategoryDiversityAtK(selectedForDiversity.map(candidate => ({
      courseId: candidate.courseId,
      subcategoryIds: subcategoryIdsFor(candidate),
    })), { k: selectedForDiversity.length }),
    reasonFaithfulness: {
      claimCount: reasonClaimCount,
      correctCount: correctReasonCount,
      accuracy: reasonClaimCount === 0 ? null : correctReasonCount / reasonClaimCount,
      scope: 'server-side matched tags must be eligible tags on the selected synthetic course; tag names are not exposed in the API',
    },
    scoreBreakdownFaithfulness: {
      checkCount: scoreBreakdownCheckCount,
      correctCount: scoreBreakdownCorrectCount,
      accuracy: scoreBreakdownCheckCount === 0 ? null : scoreBreakdownCorrectCount / scoreBreakdownCheckCount,
    },
    tagEvidenceByCourse,
  };
}

function compareStage6ScheduleModes(persona, candidates, profile, events, options = {}) {
  const off = stage6ScheduleMode(persona, candidates, profile, events, 'off', options);
  const active = stage6ScheduleMode(persona, candidates, profile, events, 'active', options);
  const offSelected = new Set(off.selectedCourseIds);
  const activeSelected = new Set(active.selectedCourseIds);
  const removedCourseIds = off.selectedCourseIds.filter(courseId => !activeSelected.has(courseId));
  const addedCourseIds = active.selectedCourseIds.filter(courseId => !offSelected.has(courseId));
  return {
    off,
    active,
    selectionChanged: removedCourseIds.length > 0 || addedCourseIds.length > 0,
    removedCourseIds,
    addedCourseIds,
    hardConstraintsPreserved: off.hardConstraintsValid && active.hardConstraintsValid,
  };
}

function summarizeStage6Mode(rows, mode) {
  const runs = rows.map(row => row.stage6Scheduler[mode]);
  const average = getter => averageMetric(runs, getter);
  const faithfulnessClaims = runs.reduce((sum, run) => sum + run.reasonFaithfulness.claimCount, 0);
  const faithfulnessCorrect = runs.reduce((sum, run) => sum + run.reasonFaithfulness.correctCount, 0);
  const breakdownChecks = runs.reduce((sum, run) => sum + run.scoreBreakdownFaithfulness.checkCount, 0);
  const breakdownCorrect = runs.reduce((sum, run) => sum + run.scoreBreakdownFaithfulness.correctCount, 0);
  return {
    mode,
    feasiblePersonaCount: runs.filter(run => run.hardConstraintsValid).length,
    meanRelevantSelectedCount: average(run => run.relevantSelectedCount),
    meanRelevancePrecision: average(run => run.relevancePrecision),
    meanRelevanceRecall: average(run => run.relevanceRecall),
    meanPlanTagScore: average(run => run.planTagScore),
    meanTagInterestCoverage: average(run => run.tagInterestCoverage),
    meanSubcategoryDiversity: average(run => run.subcategoryDiversity),
    reasonFaithfulness: {
      claimCount: faithfulnessClaims,
      correctCount: faithfulnessCorrect,
      accuracy: faithfulnessClaims === 0 ? null : faithfulnessCorrect / faithfulnessClaims,
    },
    scoreBreakdownFaithfulness: {
      checkCount: breakdownChecks,
      correctCount: breakdownCorrect,
      accuracy: breakdownChecks === 0 ? null : breakdownCorrect / breakdownChecks,
    },
  };
}

function stage6ScheduleSummary(personaResults) {
  const rows = personaResults;
  return {
    datasetType: 'synthetic_persona_ux',
    comparisonCount: 2,
    hardConstraintScenario: 'synthetic courses ai-foundations and database-course share one time slot in both modes',
    modelSummaries: {
      off: summarizeStage6Mode(rows, 'off'),
      active: summarizeStage6Mode(rows, 'active'),
    },
    changedSelectionCount: rows.filter(row => row.stage6Scheduler.selectionChanged).length,
    changedSelectionPersonaIds: rows
      .filter(row => row.stage6Scheduler.selectionChanged)
      .map(row => row.personaId),
    hardConstraintsPreservedCount: rows
      .filter(row => row.stage6Scheduler.hardConstraintsPreserved).length,
    disclaimer: '合成 Persona 的人工標註只用於檢查排序方向與硬條件，不代表真人準確率或線上成效。',
  };
}

function rankingMetricsFor(modelId, ranked, persona, candidates, k) {
  const relevance = Object.fromEntries(candidates.map(candidate => [
    candidate.courseId,
    (persona.relevantCourseIds ?? []).includes(candidate.courseId) ? 1 : 0,
  ]));
  const ranking = computeRankingMetrics({ rankedCourseIds: ranked.map(item => (
    typeof item === 'string' ? item : item.courseId
  )), relevanceByCourseId: relevance, k });
  const selected = ranked.slice(0, k).map(item => {
    const courseId = typeof item === 'string' ? item : item.courseId;
    return candidates.find(candidate => candidate.courseId === courseId);
  }).filter(Boolean);
  const allRecommended = ranked.slice(0, k).map(item => (
    typeof item === 'string' ? item : item.courseId
  ));
  const faithfulness = ranked.slice(0, k).reduce((summary, item) => {
    if (typeof item === 'string') return summary;
    const candidate = candidates.find(row => row.courseId === item.courseId);
    if (!candidate) return summary;
    const courseTagIds = resolveInterestTags(candidate.ragTags).tags
      .filter(tag => tag.eligibility?.crossCourseMatchEligible === true)
      .map(tag => tag.canonicalTagId);
    const row = explanationTagFaithfulness({
      courseTagIds,
      reasonTagIds: (item.matchedTags ?? []).map(tag => tag.canonicalTagId),
    });
    summary.claimCount += row.claimCount;
    summary.correctCount += row.correctCount;
    return summary;
  }, { claimCount: 0, correctCount: 0 });
  return {
    modelId,
    rankedCourseIds: ranked.slice(0, k).map(item => typeof item === 'string' ? item : item.courseId),
    topK: allRecommended,
    ranking,
    subcategoryDiversity: subcategoryDiversityAtK(selected.map(candidate => ({
      courseId: candidate.courseId,
      subcategoryIds: subcategoryIdsFor(candidate),
    })), { k }),
    reasonFaithfulness: {
      ...faithfulness,
      accuracy: faithfulness.claimCount === 0 ? null : faithfulness.correctCount / faithfulness.claimCount,
    },
  };
}

function averageMetric(rows, getter) {
  const values = rows.map(getter).filter(Number.isFinite);
  return values.length === 0 ? null : Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(6));
}

/** Compare three rag-tag profiles with the production v2 learner/scheduler on fixed personas. */
export function evaluatePersonaRankingComparisons(fixture, { k = 3, now = null, activeTerm = null } = {}) {
  if (fixture?.datasetType !== 'synthetic_persona_ux' || !Array.isArray(fixture.personas)
    || fixture.personas.length !== 10 || !Array.isArray(fixture.candidateCourses)) {
    throw new TypeError('Persona UX 評估 fixture 必須含 10 位 synthetic persona 與固定候選課');
  }
  const evaluationTime = now ?? fixture.evaluationTime ?? null;
  const term = activeTerm ?? fixture.activeTerm ?? null;
  const roleplayReferenceTime = evaluationTime == null
    ? Date.parse('2026-10-09T00:00:00.000Z')
    : new Date(evaluationTime).getTime();
  const modelIds = ['initial_topic_prior', 'behavior_tag_profile', 'hybrid_tag_interest_v1', 'current_v2_scheduler'];
  const personaResults = fixture.personas.map(persona => {
    const roleplayBrowseEvents = persona.roleplayBrowseAllCandidates
      ? fixture.candidateCourses.map((candidate, index) => ({
        eventType: 'course_viewed',
        courseCode: `SYN-ROLEPLAY-${persona.personaId}-${candidate.courseId}`,
        courseTags: candidate.ragTags,
        source: 'browse',
        term,
        timestamp: new Date(roleplayReferenceTime - ((fixture.candidateCourses.length - index) * 60000)).toISOString(),
      }))
      : [];
    const events = [...(persona.events ?? []), ...roleplayBrowseEvents]
      .map((event, index) => makeEvent(persona, event, index));
    const profiles = {
      initial_topic_prior: computeTagInterestProfile([], persona.preferences ?? {}, {
        now: evaluationTime, activeTerm: term,
      }),
      behavior_tag_profile: computeTagInterestProfile(events, {}, {
        now: evaluationTime, activeTerm: term,
      }),
      hybrid_tag_interest_v1: computeTagInterestProfile(events, persona.preferences ?? {}, {
        now: evaluationTime, activeTerm: term,
      }),
    };
    const v2Ranking = v2ScheduleRanking(persona, fixture.candidateCourses, events, {
      now: evaluationTime,
      activeTerm: term,
    });
    const stage6Scheduler = compareStage6ScheduleModes(
      persona,
      fixture.candidateCourses,
      profiles.hybrid_tag_interest_v1,
      events,
      { now: evaluationTime, activeTerm: term },
    );
    const rankings = {
      initial_topic_prior: rankByTagProfile(profiles.initial_topic_prior, fixture.candidateCourses),
      behavior_tag_profile: rankByTagProfile(profiles.behavior_tag_profile, fixture.candidateCourses),
      hybrid_tag_interest_v1: rankByTagProfile(profiles.hybrid_tag_interest_v1, fixture.candidateCourses),
      current_v2_scheduler: v2Ranking.rankedCourseIds,
    };
    return {
      personaId: persona.personaId,
      personaName: persona.personaName,
      intent: persona.intent,
      relevantCourseIds: [...(persona.relevantCourseIds ?? [])],
      models: Object.fromEntries(modelIds.map(modelId => [
        modelId,
        rankingMetricsFor(modelId, rankings[modelId], persona, fixture.candidateCourses, k),
      ])),
      tagProfiles: Object.fromEntries(Object.entries(profiles).map(([modelId, profile]) => [modelId, {
        categoryInterests: profile.categoryInterests,
        evidenceTagCount: profile.summary.evidenceTagCount,
        usableEventCount: profile.summary.usableEventCount,
      }])),
      v2Learning: v2Ranking.learning,
      stage6Scheduler,
    };
  });
  const modelSummaries = Object.fromEntries(modelIds.map(modelId => {
    const rows = personaResults.map(persona => persona.models[modelId]);
    const flattenedTopK = rows.flatMap(row => row.topK);
    return [modelId, {
      meanNdcgAtK: averageMetric(rows, row => row.ranking.ndcg),
      meanPrecisionAtK: averageMetric(rows, row => row.ranking.precision),
      meanRecallAtK: averageMetric(rows, row => row.ranking.recall),
      catalogCoverage: courseCatalogCoverage(flattenedTopK, fixture.candidateCourses.map(course => course.courseId)),
      meanSubcategoryDiversityAtK: averageMetric(rows, row => row.subcategoryDiversity),
      reasonFaithfulness: (() => {
        const claims = rows.reduce((sum, row) => sum + row.reasonFaithfulness.claimCount, 0);
        const correct = rows.reduce((sum, row) => sum + row.reasonFaithfulness.correctCount, 0);
        return { claimCount: claims, correctCount: correct, accuracy: claims === 0 ? null : correct / claims };
      })(),
    }];
  }));
  return {
    datasetType: 'synthetic_persona_ux',
    roleplayProtocol: fixture.roleplayProtocol ?? null,
    accuracyClaimAllowed: false,
    comparisonCount: modelIds.length,
    personaCount: personaResults.length,
    candidateCourseCount: fixture.candidateCourses.length,
    k,
    modelSummaries,
    stage6ScheduleComparison: stage6ScheduleSummary(personaResults),
    personaResults,
    limitations: [
      'Persona 標註由固定情境指定，用於檢查模型是否符合預期，不代表真人行為分布或線上推薦準確率。',
      'current_v2_scheduler 是既有排課器在相同候選集的輸出；標籤模型三組是固定候選課的 rag_tag 分數排序。',
      '此比較不做時間切分；真人事件到位後再另做時間先後評估。',
    ],
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
