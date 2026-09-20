// Roadmap #10 任務 1：用 Dinkelbach + HiGHS MILP 產生各主軸候選。
import {
  buildDiverseScheduleMip,
  collectBindingConstraints,
  decodeSelection,
  selectionCourseKeys,
  utilityForSelection,
} from './scheduleMipModel.js';
import { SOLVE_CATEGORY } from './highsRuntime.js';

export const DIVERSE_SOLVER_METHOD = 'dinkelbach-milp';
// 線上設定（2026-09-19 使用者決定，2026-09-20 恢復）：每個主軸只取 1 個候選，
// 全部求解共用 2.5 秒 deadline，單次求解上限 0.8 秒。線上要的是「快而且有方案」，
// 不是把候選池挖乾淨。
export const DEFAULT_DIVERSE_OPTIONS = Object.freeze({
  candidatesPerAxis: 1,
  maxIterations: 8,
  residualTolerance: 1e-6,
  denominatorEpsilon: 1e-3,
  qualityLossFraction: 0.13,
  minQualityScale: 1000,
  perSolveSeconds: 0.8,
  totalBudgetMs: 2500,
  mipRelGap: 1e-4,
});

// Benchmark 專用：每個主軸取 3 個候選，用來評估完整候選池的品質與可行性。
// 兩組設定分開記錄，改其中一邊不會默默動到另一邊——線上預算與離線量測是兩件事。
export const BENCHMARK_DIVERSE_OPTIONS = Object.freeze({
  ...DEFAULT_DIVERSE_OPTIONS,
  candidatesPerAxis: 3,
});

const allCourses = plan => [...(plan?.schedule || []), ...(plan?.unscheduledCourses || [])];
const sectionId = course => Number(course?.id ?? course?.sectionId);

function baseSelection(inputs) {
  const selectedIds = new Set(allCourses(inputs.basePlan).map(sectionId));
  return new Set((inputs.competitive || [])
    .filter(entry => selectedIds.has(sectionId(entry.course)))
    .map(entry => entry.courseKey));
}

function qualityOfEntry(entry) {
  return (Number(entry.score) || 0)
    - (Number(entry.scoreComponents?.base) || 0)
    - (Number(entry.scoreComponents?.crossYearElective) || 0)
    - (Number(entry.scoreComponents?.outsideOwnDepartment) || 0);
}

function hierarchyTargets(inputs, selectedKeys) {
  const result = { 'own-year': 0, 'cross-year': 0, outside: 0 };
  const seen = new Set();
  for (const entry of inputs.competitive || []) {
    if (!selectedKeys.has(entry.courseKey) || seen.has(entry.courseKey)) continue;
    seen.add(entry.courseKey);
    const tier = (Number(entry.scoreComponents?.outsideOwnDepartment) || 0) < 0
      ? 'outside'
      : (Number(entry.scoreComponents?.crossYearElective) || 0) < 0 ? 'cross-year' : 'own-year';
    result[tier] += 1;
  }
  return result;
}

function baselineUtility(inputs) {
  const selectedIds = new Set(allCourses(inputs.basePlan).map(sectionId));
  return (inputs.competitive || [])
    .filter(entry => selectedIds.has(sectionId(entry.course)))
    .reduce((sum, entry) => sum + qualityOfEntry(entry), 0);
}

function centroid(referenceSets, universe) {
  const result = new Map();
  for (const key of universe) {
    const count = referenceSets.reduce((sum, reference) => sum + (reference.has(key) ? 1 : 0), 0);
    result.set(key, count / referenceSets.length);
  }
  return result;
}

function normalizedDiversity(selected, center, universe) {
  if (universe.size === 0) return 0;
  let total = 0;
  for (const key of universe) {
    const c = center.get(key) ?? 0;
    total += selected.has(key) ? 1 - c : c;
  }
  return total / universe.size;
}

function setDifference(left, right) {
  return [...left].filter(value => !right.has(value));
}

export function compareCourseSets(left, right) {
  const removed = setDifference(left, right);
  const added = setDifference(right, left);
  return {
    removed, added,
    hammingDistance: removed.length + added.length,
    replacementDistance: Math.min(removed.length, added.length),
  };
}

function hasSignal(axis) {
  return axis && axis.signal !== false;
}

// 求解器判定不可行時，逐一放寬單一限制群組重解，找出「只要放寬這一組就可行」的群組。
// 只用於說明原因，放寬後的解一律不採用。沒有任何單一群組能解開時回報 combined-constraints。
const RELAXATION_GROUPS = Object.freeze([
  // rated 放在 axis 前：放寬 axis 會連帶放寬評價數下限，單獨放寬評價數下限就可行時應回報後者。
  { group: 'rated', relax: ['rated'], reason: 'rating-coverage-infeasible' },
  { group: 'axis', relax: ['axis', 'rated'], reason: 'axis-threshold-infeasible' },
  { group: 'replacement', relax: ['replacement'], reason: 'insufficient-difference' },
  { group: 'quality', relax: ['quality'], reason: 'quality-floor' },
  { group: 'credit', relax: ['credit'], reason: 'credit-parity-infeasible' },
  { group: 'hierarchy', relax: ['hierarchy'], reason: 'hierarchy-parity-infeasible' },
]);

function diagnoseInfeasibility(inputs, modelOptions, solve, timeLimit, settings, deadline, now) {
  const resolvedBy = [];
  for (const { group, relax } of RELAXATION_GROUPS) {
    if (group === 'rated' && !['easy', 'challenge'].includes(modelOptions.axis?.type)) continue;
    if (deadline - now() <= 0) {
      return { reason: 'solver-budget-exceeded', resolvedBy, complete: false };
    }
    const model = buildDiverseScheduleMip(inputs, { ...modelOptions, objective: 'quality', relax: new Set(relax) });
    if (model.status !== 'ready') continue;
    const result = solve(model, { timeLimitSeconds: timeLimit(), mipRelGap: settings.mipRelGap });
    if ([SOLVE_CATEGORY.OPTIMAL, SOLVE_CATEGORY.LIMIT_WITH_SOLUTION].includes(result.category)) {
      resolvedBy.push(group);
    }
  }
  const first = RELAXATION_GROUPS.find(item => resolvedBy.includes(item.group));
  return { reason: first ? first.reason : 'combined-constraints', resolvedBy, complete: true };
}

/**
 * @param inputs scheduler 擷取的固定狀態與候選。
 * @param config `{ solve(model, options), axes, now, ... }`，solve 必須是同步函式。
 */
export function generateDiverseCandidates(inputs, config = {}) {
  const settings = { ...DEFAULT_DIVERSE_OPTIONS, ...(config.options || {}) };
  const solve = config.solve;
  const now = config.now ?? (() => performance.now());
  if (typeof solve !== 'function') {
    return { status: 'solver-unavailable', candidates: [], axes: [] };
  }
  if (!inputs?.basePlan?.success) {
    return { status: 'data-insufficient', candidates: [], axes: [] };
  }

  const baseSet = baseSelection(inputs);
  const universe = new Set((inputs.competitive || []).map(entry => entry.courseKey));
  const baseUtility = baselineUtility(inputs);
  const baseHierarchyTargets = hierarchyTargets(inputs, baseSet);
  const qualityScale = Math.max(Math.abs(baseUtility), settings.minQualityScale);
  const qualityLossLimit = settings.qualityLossFraction * qualityScale;
  const startedAt = now();
  const deadline = startedAt + settings.totalBudgetMs;
  const candidates = [];
  const axisResults = [];

  for (const axis of config.axes || []) {
    if (!hasSignal(axis)) {
      axisResults.push({
        archetype: axis.archetype, status: 'no-signal',
        reason: axis.reason || 'no-signal', detail: axis.detail ?? null, candidates: [],
      });
      continue;
    }

    const accepted = [];
    const references = [baseSet];
    let terminalReason = null;
    let axisDiagnosis = null;
    for (let candidateIndex = 0; candidateIndex < settings.candidatesPerAxis; candidateIndex += 1) {
      if (now() >= deadline) {
        terminalReason = 'solver-budget-exceeded';
        break;
      }
      const center = centroid(references, universe);
      let best = null;
      const trace = [];
      let allOptimal = true;
      let converged = false;
      let stopReason = null;
      let infeasibleDiagnosis = null;
      const modelOptions = {
        creditTarget: inputs.basePlan.totalCredits,
        referenceSelections: references,
        axis,
        centroid: center,
        baselineUtility: baseUtility,
        qualityScale,
        qualityLossLimit,
        hierarchyTargets: baseHierarchyTargets,
      };
      // 單次求解撞到自己的時間上限但全域 deadline 仍有餘裕，記為 solver-time-limit，
      // 不與「共用預算用盡」(deadline) 混為一談。
      const limitReason = category => (category !== SOLVE_CATEGORY.LIMIT_NO_SOLUTION ? category
        : (deadline - now() <= 0 ? 'deadline' : 'solver-time-limit'));
      const timeLimit = () => Math.max(0.001, Math.min(settings.perSolveSeconds, (deadline - now()) / 1000));
      // 每一輪都由選課結果重算 d、N̂、D̂，不採用求解器回傳的 d 變數值。
      const evaluate = (model, result, lambda) => {
        const selectedKeys = selectionCourseKeys(model, result.values);
        const utility = utilityForSelection(model, result.values);
        const loss = Math.max(0, baseUtility - utility);
        const denominator = loss / qualityScale + settings.denominatorEpsilon;
        const diversity = normalizedDiversity(selectedKeys, center, universe);
        return {
          archetype: axis.archetype,
          axis,
          selectedKeys,
          selectedSections: decodeSelection(model, result.values),
          utility,
          baselineUtility: baseUtility,
          qualityLoss: loss,
          qualityScale,
          qualityRetention: 1 - loss / qualityScale,
          diversity,
          denominator,
          ratio: diversity / denominator,
          residual: lambda === null ? null : diversity - lambda * denominator,
          bindingConstraints: collectBindingConstraints(model, result.values),
          rawStatus: result.rawStatus,
          category: result.category,
          mipGap: result.mipGap,
          modelStats: model.stats,
        };
      };
      const traceEntry = (iteration, lambda, result, evaluated) => ({
        iteration, lambda, rawStatus: result.rawStatus, category: result.category,
        runtimeMs: result.runtimeMs, mipGap: result.mipGap, warmStart: result.warmStart ?? 'none',
        ...(evaluated ? {
          diversity: evaluated.diversity, denominator: evaluated.denominator, ratio: evaluated.ratio,
          utility: evaluated.utility, qualityLoss: evaluated.qualityLoss, residual: evaluated.residual,
        } : {}),
      });

      // 第 0 步：初始可行解 x⁰＝同一組限制下品質最大的課表（Trapp & Konrad Algorithm 1
      // 允許任一可行解起步）。x⁰ 只提供 λ₁ 與暖啟動，本身不參與收斂判定。
      if (deadline - now() <= 0) {
        stopReason = 'deadline';
      }
      const initialModel = stopReason ? null : buildDiverseScheduleMip(inputs, { ...modelOptions, objective: 'quality' });
      let lambda = null;
      let previousValues = null;
      if (initialModel && initialModel.status !== 'ready') {
        stopReason = initialModel.reason || initialModel.status;
      } else if (initialModel) {
        const initial = solve(initialModel, { timeLimitSeconds: timeLimit(), mipRelGap: settings.mipRelGap });
        if (![SOLVE_CATEGORY.OPTIMAL, SOLVE_CATEGORY.LIMIT_WITH_SOLUTION].includes(initial.category)) {
          stopReason = limitReason(initial.category);
          trace.push(traceEntry(0, null, initial, null));
          if (initial.category === SOLVE_CATEGORY.INFEASIBLE) {
            const diagnosis = diagnoseInfeasibility(inputs, modelOptions, solve, timeLimit, settings, deadline, now);
            stopReason = diagnosis.reason;
            infeasibleDiagnosis = diagnosis;
          }
        } else {
          const start = evaluate(initialModel, initial, null);
          trace.push(traceEntry(0, null, initial, start));
          best = start;
          lambda = start.ratio;
          previousValues = initial.values;
        }
      }

      for (let iteration = 1; lambda !== null && iteration <= settings.maxIterations; iteration += 1) {
        if (deadline - now() <= 0) {
          stopReason = 'deadline';
          break;
        }
        const model = buildDiverseScheduleMip(inputs, { ...modelOptions, lambda });
        if (model.status !== 'ready') {
          stopReason = model.reason || model.status;
          break;
        }
        const result = solve(model, {
          timeLimitSeconds: timeLimit(),
          mipRelGap: settings.mipRelGap,
          initialValues: previousValues,
        });
        if (![SOLVE_CATEGORY.OPTIMAL, SOLVE_CATEGORY.LIMIT_WITH_SOLUTION].includes(result.category)) {
          allOptimal = false;
          stopReason = limitReason(result.category);
          trace.push(traceEntry(iteration, lambda, result, null));
          break;
        }
        if (result.category !== SOLVE_CATEGORY.OPTIMAL) allOptimal = false;

        const candidate = evaluate(model, result, lambda);
        if (candidate.ratio > best.ratio) best = candidate;
        trace.push(traceEntry(iteration, lambda, result, candidate));
        if (Math.abs(candidate.residual) <= settings.residualTolerance) {
          converged = true;
          break;
        }
        lambda = candidate.ratio;
        previousValues = result.values;
      }

      if (!best) {
        axisDiagnosis = infeasibleDiagnosis;
        terminalReason = stopReason === 'deadline'
          ? 'solver-budget-exceeded'
          : (stopReason || 'infeasible');
        break;
      }
      // 第 0 步 x⁰ 不算 Dinkelbach 迭代。
      const dinkelbachIterations = trace.filter(entry => entry.iteration > 0).length;
      const reachedIterationLimit = dinkelbachIterations >= settings.maxIterations && !converged;
      const approximateReason = stopReason === 'deadline'
        ? 'deadline'
        : !allOptimal ? 'solver-limit'
          : reachedIterationLimit ? 'iteration-limit' : null;
      best.trace = trace;
      best.convergence = {
        converged: converged && allOptimal && !reachedIterationLimit,
        reason: converged && allOptimal && !reachedIterationLimit ? null : (approximateReason || 'not-converged'),
        iterations: dinkelbachIterations,
        residual: trace.at(-1)?.residual ?? null,
        initialSolution: trace[0]?.iteration === 0 ? 'quality-optimal' : null,
      };
      best.approximate = !best.convergence.converged;
      best.distanceFromBase = compareCourseSets(baseSet, best.selectedKeys);
      best.distancesFromReferences = references.map(reference => compareCourseSets(reference, best.selectedKeys));
      accepted.push(best);
      candidates.push(best);
      references.push(best.selectedKeys);
      if (stopReason === 'deadline') {
        terminalReason = 'solver-budget-exceeded';
        break;
      }
    }

    axisResults.push({
      archetype: axis.archetype,
      status: accepted.length > 0 ? 'generated' : (terminalReason || 'infeasible'),
      reason: terminalReason,
      ...(axisDiagnosis ? { diagnosis: axisDiagnosis } : {}),
      candidates: accepted,
    });
  }

  return {
    status: candidates.length > 0 ? 'generated' : (axisResults[0]?.status || 'no-candidates'),
    method: DIVERSE_SOLVER_METHOD,
    baseSelection: baseSet,
    universeSize: universe.size,
    baselineUtility: baseUtility,
    qualityScale,
    qualityLossLimit,
    hierarchyTargets: baseHierarchyTargets,
    elapsedMs: now() - startedAt,
    candidates,
    axes: axisResults,
  };
}

export default { generateDiverseCandidates, compareCourseSets };
