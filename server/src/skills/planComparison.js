import { generateSchedule } from './scheduler.js';

// Roadmap #27：方案比較與 counterfactual。
//
// 這個模組**只解釋既有結果，不參與任何排課判定**——與 #26 的
// `recommendationReason.js` 同一條原則。counterfactual 的作法是「改一個偏好旗標、
// 呼叫同一個 `generateSchedule()`、比對兩份結果」，不重新實作任何規則；
// 一旦這裡自己判斷「這門課應該會被換掉」，它就會與真正的排課邏輯分岔。

export const COUNTERFACTUAL_STATUS = Object.freeze({
  CHANGED: 'changed',
  UNCHANGED: 'unchanged',
  NOT_APPLICABLE: 'not-applicable',
});

// 可以被問「取消它會怎樣」的偏好。
//
// 只列**使用者能自己開關、而且會進入排序或過濾**的旗標。像 `maxCredits`
// 這種校規上限不在此列——它不是偏好，取消它不是使用者能做的選擇。
export const COUNTERFACTUAL_PREFERENCES = Object.freeze([
  { preferenceId: 'preferCompact', label: '盡量集中排課' },
  { preferenceId: 'noMorningClasses', label: '不排早八' },
  { preferenceId: 'lunchBreakFree', label: '午休務必空出' },
  { preferenceId: 'noEveningClasses', label: '不排晚課' },
  { preferenceId: 'noMidterm', label: '無期中考' },
  { preferenceId: 'practicalExam', label: '上機實作考試' },
  { preferenceId: 'finalReport', label: '期末報告為主' },
  { preferenceId: 'highUsualScore', label: '平時成績佔比高' },
  { preferenceId: 'noGroupWork', label: '無分組報告' },
  { preferenceId: 'highDiscussion', label: '高度課堂討論' },
  { preferenceId: 'englishTaught', label: '全英授課' },
  { preferenceId: 'learnMore', label: '學到較多內容' },
  { preferenceId: 'noRollCall', label: '不點名' },
]);

function courseIdentity(course) {
  return String(course.sectionId ?? course.id);
}

function describeCourse(course) {
  return {
    sectionId: course.sectionId ?? course.id ?? null,
    catalogCourseCode: course.catalogCourseCode ?? null,
    name: course.name ?? null,
    credits: course.credits ?? null,
  };
}

// 兩個方案的課程集合差異。**只比課程集合，不比排序**——`uniquePlans()` 判斷
// 「兩個方案是否相同」用的就是排序後的 id 集合，這裡跟它同一個標準，
// 否則會出現「去重說相同、比較表說不同」的矛盾。
export function diffPlans(basePlan, otherPlan) {
  const baseCourses = [...(basePlan?.schedule ?? []), ...(basePlan?.unscheduledCourses ?? [])];
  const otherCourses = [...(otherPlan?.schedule ?? []), ...(otherPlan?.unscheduledCourses ?? [])];

  const baseIds = new Set(baseCourses.map(courseIdentity));
  const otherIds = new Set(otherCourses.map(courseIdentity));

  return {
    removed: baseCourses.filter(course => !otherIds.has(courseIdentity(course))).map(describeCourse),
    added: otherCourses.filter(course => !baseIds.has(courseIdentity(course))).map(describeCourse),
    shared: baseCourses.filter(course => otherIds.has(courseIdentity(course))).length,
  };
}

// 比較表上「這幾項其實完全一樣」的判定。
//
// 存在的理由是誠實而不是方便：demo 帳號實測的 2 個方案在學分、天數、早八、
// 空堂、評價涵蓋率、偏好符合度上**每一項都相同**，只差 2 門課。把六個一樣的
// 數字排成一張表看起來很豐富，實際上什麼也沒告訴使用者。先算出「哪些項目
// 真的有差」，畫面才能把版面讓給真正的差異。
const COMPARABLE_METRICS = Object.freeze([
  { key: 'scheduledCourseCount', label: '課數' },
  { key: 'totalCredits', label: '學分' },
  { key: 'usedDays', label: '上課天數' },
  { key: 'morningCourses', label: '早八課' },
  { key: 'gapPeriods', label: '空堂節數' },
]);

export function summarizeMetricDifferences(plans = []) {
  const differing = [];
  const identical = [];

  for (const metric of COMPARABLE_METRICS) {
    const values = plans.map(plan => plan?.planMetrics?.[metric.key] ?? null);
    const distinct = new Set(values.map(value => JSON.stringify(value)));
    (distinct.size > 1 ? differing : identical).push({ ...metric, values });
  }

  // 偏好符合度與評價涵蓋率是浮點數，另外處理成固定精度再比，避免
  // 0.3333333333333333 與 0.33333333333333337 被當成「有差異」。
  const round = value => (typeof value === 'number' ? Number(value.toFixed(4)) : null);
  for (const metric of [
    { key: 'preferenceScore', label: '偏好符合度' },
    { key: 'reviewCoverageRatio', label: '評價涵蓋率' },
  ]) {
    const values = plans.map(plan => (metric.key === 'preferenceScore'
      ? round(plan?.planMetrics?.preferenceScore)
      : round(plan?.planMetrics?.reviewCoverage?.ratio)));
    const distinct = new Set(values.map(value => JSON.stringify(value)));
    (distinct.size > 1 ? differing : identical).push({ ...metric, values });
  }

  return { differing, identical, allIdentical: differing.length === 0 };
}

// counterfactual：關掉一項偏好，用**同一個排課引擎**重跑，比對主推方案。
//
// 基準也在這裡重跑一次，不接受呼叫端傳課表進來比對——那份課表可能來自更早的
// 一次請求、或是瀏覽器自己說的，兩邊輸入不同就不是 counterfactual 而是誤導。
export function buildCounterfactuals(candidateCourses, constraints, options = {}) {
  const preferences = options.preferences ?? COUNTERFACTUAL_PREFERENCES;
  const baseResult = generateSchedule(candidateCourses, constraints);
  const basePlan = baseResult.plans?.[0] ?? null;

  const results = preferences.map(preference => {
    if (!constraints[preference.preferenceId]) {
      return {
        ...preference,
        status: COUNTERFACTUAL_STATUS.NOT_APPLICABLE,
        removed: [],
        added: [],
        reason: '你目前沒有開啟這項偏好。',
      };
    }

    const variantResult = generateSchedule(
      candidateCourses,
      { ...constraints, [preference.preferenceId]: false }
    );
    const variantPlan = variantResult.plans?.[0] ?? null;
    const diff = diffPlans(basePlan, variantPlan);

    if (diff.removed.length === 0 && diff.added.length === 0) {
      return {
        ...preference,
        status: COUNTERFACTUAL_STATUS.UNCHANGED,
        removed: [],
        added: [],
        // 「不會變」必須說得出為什麼，否則使用者無法分辨是這項偏好沒作用，
        // 還是系統根本沒算。實測 demo 帳號 13 項偏好全部落在這一支：
        // 可競爭的課只有 16 門，候選用完就停了，偏好沒有發揮空間。
        reason: describeUnchangedReason(baseResult),
      };
    }

    return {
      ...preference,
      status: COUNTERFACTUAL_STATUS.CHANGED,
      removed: diff.removed,
      added: diff.added,
      reason: null,
      metricsDelta: buildMetricsDelta(basePlan, variantPlan),
    };
  });

  return {
    baseline: basePlan ? { planId: basePlan.planId ?? null, variantId: basePlan.id } : null,
    competablePoolSize: baseResult.planDiversity?.competablePoolSize ?? null,
    counterfactuals: results,
  };
}

function describeUnchangedReason(baseResult) {
  const poolSize = baseResult.planDiversity?.competablePoolSize ?? null;
  if (poolSize === null) return '取消這項偏好後，排出來的課表完全相同。';
  return `取消這項偏好後，排出來的課表完全相同——可競爭的課程只有 ${poolSize} 門，`
    + '候選課程用完就停了，這項偏好沒有可以發揮的空間。';
}

function buildMetricsDelta(basePlan, variantPlan) {
  const base = basePlan?.planMetrics;
  const variant = variantPlan?.planMetrics;
  if (!base || !variant) return null;

  return {
    totalCredits: variant.totalCredits - base.totalCredits,
    scheduledCourseCount: variant.scheduledCourseCount - base.scheduledCourseCount,
    usedDays: variant.usedDays - base.usedDays,
    morningCourses: variant.morningCourses - base.morningCourses,
    gapPeriods: variant.gapPeriods - base.gapPeriods,
  };
}

export default {
  COUNTERFACTUAL_STATUS,
  COUNTERFACTUAL_PREFERENCES,
  diffPlans,
  summarizeMetricDifferences,
  buildCounterfactuals,
};
