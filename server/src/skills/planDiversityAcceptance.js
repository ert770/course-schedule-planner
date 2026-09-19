import { SELECTION_REASONS } from './recommendationReason.js';

export const PLAN_RETENTION_THRESHOLD = 0.75;
export const PLAN_SIMILARITY_THRESHOLD = 0.75;

const FIXED_SELECTION_REASONS = new Set([
  SELECTION_REASONS.REQUIRED_COURSE,
  SELECTION_REASONS.RETAKE_REQUIRED,
  SELECTION_REASONS.USER_SPECIFIED,
]);

function normalizeCourseCode(course) {
  const catalogCourseCode = String(course?.catalogCourseCode ?? '').trim();
  if (catalogCourseCode) return catalogCourseCode;
  const fallbackId = course?.sectionId ?? course?.id;
  return fallbackId == null ? null : `section:${fallbackId}`;
}

function allPlanCourses(plan) {
  return [
    ...(Array.isArray(plan?.schedule) ? plan.schedule : []),
    ...(Array.isArray(plan?.unscheduledCourses) ? plan.unscheduledCourses : []),
  ];
}

export function isFixedCourse(course) {
  const reason = course?.recommendationReason;
  return Boolean(
    course?.formallyRequired
    || reason?.requiredRules?.formallyRequired
    || FIXED_SELECTION_REASONS.has(reason?.selectedBecause)
  );
}

export function collectCompetitiveCourseCodes(plan) {
  return new Set(
    allPlanCourses(plan)
      .filter(course => !isFixedCourse(course))
      .map(normalizeCourseCode)
      .filter(Boolean)
  );
}

export function jaccardSimilarity(leftInput, rightInput) {
  const left = leftInput instanceof Set ? leftInput : new Set(leftInput || []);
  const right = rightInput instanceof Set ? rightInput : new Set(rightInput || []);
  const union = new Set([...left, ...right]);
  if (union.size === 0) return 1;

  let intersectionSize = 0;
  for (const value of left) {
    if (right.has(value)) intersectionSize += 1;
  }
  return intersectionSize / union.size;
}

export function median(values = []) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function round(value) {
  return Number.isFinite(value) ? Number(value.toFixed(4)) : null;
}

function pairwiseComparisons(plans) {
  const prepared = plans.map(plan => ({
    planId: plan?.planId ?? plan?.id ?? null,
    codes: collectCompetitiveCourseCodes(plan),
  }));
  const pairs = [];

  for (let leftIndex = 0; leftIndex < prepared.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < prepared.length; rightIndex += 1) {
      const left = prepared[leftIndex];
      const right = prepared[rightIndex];
      const shared = [...left.codes].filter(code => right.codes.has(code)).length;
      const differenceCount = new Set([
        ...[...left.codes].filter(code => !right.codes.has(code)),
        ...[...right.codes].filter(code => !left.codes.has(code)),
      ]).size;
      pairs.push({
        leftPlanId: left.planId,
        rightPlanId: right.planId,
        leftCompetitiveCourseCount: left.codes.size,
        rightCompetitiveCourseCount: right.codes.size,
        sharedCourseCount: shared,
        differenceCount,
        jaccardSimilarity: round(jaccardSimilarity(left.codes, right.codes)),
      });
    }
  }
  return { prepared, pairs };
}

export function evaluatePlanDiversityAcceptance(result = {}, {
  retentionThreshold = PLAN_RETENTION_THRESHOLD,
  similarityThreshold = PLAN_SIMILARITY_THRESHOLD,
  safetyPassed = true,
} = {}) {
  const plans = Array.isArray(result.plans) ? result.plans : [];
  const requestedVariants = Number(result.planDiversity?.requestedVariants ?? plans.length) || 0;
  const reportedDistinctPlans = Number(result.planDiversity?.distinctPlans ?? plans.length) || 0;
  const hasExpressedPreference = Boolean(result.hasExpressedPreference);
  const requiredDistinctPlans = Math.min(
    requestedVariants,
    hasExpressedPreference ? 3 : 2
  );
  const requiredByRetention = Math.ceil(requestedVariants * retentionThreshold);
  const retentionRate = requestedVariants === 0 ? 0 : reportedDistinctPlans / requestedVariants;
  const { prepared, pairs } = pairwiseComparisons(plans);
  const medianSimilarity = median(pairs.map(pair => pair.jaccardSimilarity));
  const meaningfulKeys = new Set(prepared.map(({ codes }) => [...codes].sort().join('\u0000')));

  const criteria = {
    enoughDistinctPlans: reportedDistinctPlans >= requiredDistinctPlans,
    retentionRate: reportedDistinctPlans >= requiredByRetention,
    medianSimilarity: medianSimilarity !== null && medianSimilarity <= similarityThreshold,
    actualCourseDifference: pairs.length > 0 && pairs.every(pair => pair.differenceCount >= 1),
    safety: Boolean(safetyPassed),
  };

  return {
    pass: Object.values(criteria).every(Boolean),
    hasExpressedPreference,
    requestedVariants,
    reportedDistinctPlans,
    meaningfulDistinctPlans: meaningfulKeys.size,
    requiredDistinctPlans,
    requiredByRetention,
    retentionThreshold,
    retentionRate: round(retentionRate),
    similarityThreshold,
    medianJaccardSimilarity: round(medianSimilarity),
    criteria,
    pairs,
  };
}

export default {
  PLAN_RETENTION_THRESHOLD,
  PLAN_SIMILARITY_THRESHOLD,
  isFixedCourse,
  collectCompetitiveCourseCodes,
  jaccardSimilarity,
  median,
  evaluatePlanDiversityAcceptance,
};
