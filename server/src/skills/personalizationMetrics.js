// Roadmap #36：個人化量測工具。
//
// 這個模組只整理既有 generateSchedule() 的輸出，不參與排課決策；所有偏好
// 符合度仍重用 scheduler.js 的正式公式，避免量測另外發明一把尺。

import { buildPreferenceProfile, evaluatePreference } from './scheduler.js';
import { validateScheduleAgainstConstraints } from './scheduleValidator.js';

function courseId(course) {
  return String(course?.id ?? course?.sectionId ?? course?.catalogCourseCode ?? '');
}

function planCourses(plan) {
  return [ ...(plan?.schedule ?? []), ...(plan?.unscheduledCourses ?? []) ];
}

function orderedIds(plan) {
  return planCourses(plan).map(courseId).filter(Boolean);
}

function round(value, digits = 6) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function metricFromPlan(plan, key, fallback = null) {
  return plan?.planMetrics?.[key] ?? fallback;
}

function reviewCoverage(plan) {
  return plan?.reviewCoverage
    ?? plan?.planMetrics?.reviewCoverage
    ?? { rated: 0, total: planCourses(plan).length, ratio: 0 };
}

/** Evaluate a plan with the supplied user's actual preference profile. */
export function utilityUnderProfile(plan, evaluationConstraints = {}) {
  const profile = buildPreferenceProfile(evaluationConstraints);
  const evaluation = evaluatePreference(plan, evaluationConstraints, profile);
  return {
    score: evaluation.score,
    breakdown: evaluation.breakdown,
    profile,
  };
}

/** Summarize one generateSchedule() call with reproducible, comparable fields. */
export function summarizeRun(result, {
  label = null,
  evaluationConstraints = {},
  constraints = {},
} = {}) {
  const plans = Array.isArray(result?.plans) ? result.plans : [];
  const primary = plans[0] ?? null;
  const primaryUtility = primary ? utilityUnderProfile(primary, evaluationConstraints) : {
    score: 0, breakdown: { interest: 0, compact: 0, easy: null }, profile: buildPreferenceProfile(evaluationConstraints),
  };
  const planSafety = plans.map(plan => ({
    planId: plan.planId ?? null,
    variantId: plan.id ?? null,
    check: validateScheduleAgainstConstraints(planCourses(plan), constraints),
  }));
  const requiredIds = new Set([
    ...(constraints.mustTakeCourseIds ?? []),
    ...(constraints.selectedCourseIds ?? []),
  ].map(Number));
  const scheduledIds = new Set(planCourses(primary).map(course => Number(course.id)));
  const requiredCovered = requiredIds.size === 0
    ? null
    : [...requiredIds].every(id => scheduledIds.has(id));

  return {
    label,
    success: Boolean(result?.success),
    solverStatus: result?.solver?.status ?? null,
    totalCredits: primary?.totalCredits ?? result?.totalCredits ?? 0,
    graduationCredits: primary?.graduationCredits ?? result?.graduationCredits ?? 0,
    scheduledCourseCount: primary?.schedule?.length ?? 0,
    courseCount: primary ? planCourses(primary).length : 0,
    usedDays: metricFromPlan(primary, 'usedDays', null),
    morningCourses: metricFromPlan(primary, 'morningCourses', null),
    gapPeriods: metricFromPlan(primary, 'gapPeriods', null),
    preferenceScore: round(primaryUtility.score),
    preferenceBreakdown: primaryUtility.breakdown,
    evaluationProfile: primaryUtility.profile,
    reviewCoverage: reviewCoverage(primary),
    planDiversity: result?.planDiversity ?? null,
    plans,
    planSafety,
    allPlansSafe: planSafety.every(item => item.check.valid),
    requiredCovered,
    primaryPlan: primary,
  };
}

function rankMap(plan) {
  return new Map(orderedIds(plan).map((id, index) => [id, index + 1]));
}

function kendallTau(baseIds, variantIds) {
  const variantRank = new Map(variantIds.map((id, index) => [id, index]));
  const common = baseIds.filter(id => variantRank.has(id));
  if (common.length < 2) return common.length === 0 ? null : 1;
  let concordant = 0;
  let discordant = 0;
  for (let i = 0; i < common.length; i += 1) {
    for (let j = i + 1; j < common.length; j += 1) {
      if (variantRank.get(common[i]) < variantRank.get(common[j])) concordant += 1;
      else discordant += 1;
    }
  }
  const pairs = concordant + discordant;
  return pairs === 0 ? 1 : (concordant - discordant) / pairs;
}

/** Compare course membership and order between two plans. */
export function rankingChange(basePlan, variantPlan, { topK = 3 } = {}) {
  const baseIds = orderedIds(basePlan);
  const variantIds = orderedIds(variantPlan);
  const baseSet = new Set(baseIds);
  const variantSet = new Set(variantIds);
  const intersection = [...baseSet].filter(id => variantSet.has(id)).length;
  const union = new Set([...baseIds, ...variantIds]).size;
  const k = Math.min(topK, baseIds.length, variantIds.length);
  const topBase = new Set(baseIds.slice(0, k));
  const topVariant = new Set(variantIds.slice(0, k));
  const topIntersection = [...topBase].filter(id => topVariant.has(id)).length;
  const rankBase = rankMap(basePlan);
  const rankVariant = rankMap(variantPlan);
  const rankShifts = [...baseSet]
    .filter(id => variantSet.has(id))
    .map(id => ({ id, from: rankBase.get(id), to: rankVariant.get(id), delta: rankVariant.get(id) - rankBase.get(id) }));

  return {
    baseCount: baseIds.length,
    variantCount: variantIds.length,
    sharedCount: intersection,
    jaccardSimilarity: union === 0 ? 1 : round(intersection / union),
    jaccardDistance: union === 0 ? 0 : round(1 - intersection / union),
    topK: k,
    topKOverlap: k === 0 ? 1 : round(topIntersection / k),
    kendallTau: kendallTau(baseIds, variantIds),
    rankShifts,
    changed: baseIds.length !== variantIds.length || baseIds.some((id, index) => id !== variantIds[index]),
  };
}

export function compareRuns(baseSummary, variantSummary) {
  return {
    baseLabel: baseSummary?.label ?? null,
    variantLabel: variantSummary?.label ?? null,
    utilityDelta: round((variantSummary?.preferenceScore ?? 0) - (baseSummary?.preferenceScore ?? 0)),
    preferenceBreakdownDelta: Object.fromEntries(['interest', 'compact', 'easy'].map(axis => {
      const left = baseSummary?.preferenceBreakdown?.[axis];
      const right = variantSummary?.preferenceBreakdown?.[axis];
      return [axis, left === null || right === null || left === undefined || right === undefined
        ? null : round(right - left)];
    })),
    totalCreditsDelta: (variantSummary?.totalCredits ?? 0) - (baseSummary?.totalCredits ?? 0),
    usedDaysDelta: baseSummary?.usedDays == null || variantSummary?.usedDays == null
      ? null : variantSummary.usedDays - baseSummary.usedDays,
    morningCoursesDelta: baseSummary?.morningCourses == null || variantSummary?.morningCourses == null
      ? null : variantSummary.morningCourses - baseSummary.morningCourses,
    reviewCoverageDelta: round(
      (variantSummary?.reviewCoverage?.ratio ?? 0) - (baseSummary?.reviewCoverage?.ratio ?? 0)
    ),
    ranking: rankingChange(baseSummary?.primaryPlan, variantSummary?.primaryPlan),
    safetyRegression: {
      baseSafe: Boolean(baseSummary?.allPlansSafe),
      variantSafe: Boolean(variantSummary?.allPlansSafe),
      requiredCoveragePreserved: baseSummary?.requiredCovered !== true || variantSummary?.requiredCovered === true,
    },
  };
}

export function checkDirection(expectation, comparison) {
  const metric = expectation?.metric ?? 'utilityDelta';
  const value = comparison?.[metric];
  const min = expectation?.min ?? 0;
  const direction = expectation?.direction ?? 'positive';
  const pass = Number.isFinite(value) && (direction === 'negative' ? value <= -min : value >= min);
  return {
    pass,
    metric,
    value,
    expected: { direction, min },
    failure: pass ? null : `${metric} 應${direction === 'negative' ? '小於等於' : '大於等於'} ${-min || min}，實際為 ${value}`,
  };
}

export function assertNoSafetyRegression(baseSummary, variantSummary) {
  const comparison = compareRuns(baseSummary, variantSummary);
  if (!baseSummary?.allPlansSafe) throw new Error('baseline 含有未通過硬性限制的方案');
  if (!variantSummary?.allPlansSafe) throw new Error('variant 含有未通過硬性限制的方案');
  if (!comparison.safetyRegression.requiredCoveragePreserved) {
    throw new Error('variant 未保留 baseline 已涵蓋的必修／必排課程');
  }
  return true;
}

export function summarizeExperiment(rows = []) {
  const passed = rows.filter(row => row?.pass === true).length;
  return {
    total: rows.length,
    passed,
    failed: rows.length - passed,
    passRate: rows.length === 0 ? 1 : passed / rows.length,
    rows,
  };
}

export default {
  utilityUnderProfile,
  summarizeRun,
  rankingChange,
  compareRuns,
  checkDirection,
  assertNoSafetyRegression,
  summarizeExperiment,
};
