// Roadmap #22：與排課領域規則分離的 bounded backtracking 搜尋核心。
//
// 本模組不知道課程、學分或衝堂的欄位長相；scheduler.js 透過 callback
// 注入決策套用、狀態比較與目標判斷。這樣搜尋器不會複製一份 hard
// constraint，所有實際放置仍走 scheduler.js 的既有規則。

export const DEFAULT_SOLVER_TIMEOUT_MS = 2000;
export const DEFAULT_SOLVER_MAX_NODES = 50000;
export const DEFAULT_SOLVER_SEED = 0;

function normalizePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeNonNegativeInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

// FNV-1a 32-bit。只用於同分候選的 deterministic tie-break，不是探索隨機性。
export function seededStableHash(value, seed = DEFAULT_SOLVER_SEED) {
  let hash = (2166136261 ^ normalizeNonNegativeInteger(seed, DEFAULT_SOLVER_SEED)) >>> 0;
  const text = String(value ?? '');
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash;
}

/**
 * 執行有限深度優先搜尋。
 *
 * groups 中的 option 由呼叫端定義；applyOption 必須回傳新的 state，失敗則
 * 回傳 evidence。required group 不允許 skip，optional group 會在所有選項後
 * 多探索一條 skip 分支。
 */
export function solveWithBoundedBacktracking({
  groups = [],
  initialState,
  cloneState,
  applyOption,
  compareStates,
  isHardComplete,
  isGoal,
  shouldPrune,
  timeoutMs = DEFAULT_SOLVER_TIMEOUT_MS,
  maxNodes = DEFAULT_SOLVER_MAX_NODES,
  seed = DEFAULT_SOLVER_SEED,
  now = () => performance.now(),
} = {}) {
  if (typeof cloneState !== 'function' || typeof applyOption !== 'function') {
    throw new TypeError('schedule solver requires cloneState and applyOption callbacks');
  }

  const normalizedTimeoutMs = normalizePositiveInteger(timeoutMs, DEFAULT_SOLVER_TIMEOUT_MS);
  const normalizedMaxNodes = normalizePositiveInteger(maxNodes, DEFAULT_SOLVER_MAX_NODES);
  const normalizedSeed = normalizeNonNegativeInteger(seed, DEFAULT_SOLVER_SEED);
  const startedAt = now();
  const deadline = startedAt + normalizedTimeoutMs;
  const evidence = [];
  let nodesVisited = 0;
  let prunedNodes = 0;
  let timedOut = false;
  let goalFound = false;
  let bestValid = null;
  let bestDraft = cloneState(initialState);

  const isBetter = (candidate, incumbent) => (
    incumbent == null || compareStates(candidate, incumbent) > 0
  );

  const rememberState = (state, index) => {
    if (isBetter(state, bestDraft)) bestDraft = cloneState(state);
    if (isHardComplete(state, index) && isBetter(state, bestValid)) {
      bestValid = cloneState(state);
    }
  };

  const budgetExceeded = () => {
    if (nodesVisited >= normalizedMaxNodes || now() >= deadline) {
      timedOut = true;
      return true;
    }
    return false;
  };

  const visit = (index, state) => {
    if (goalFound || budgetExceeded()) return;
    nodesVisited += 1;
    rememberState(state, index);

    if (isGoal(state, index)) {
      bestValid = cloneState(state);
      goalFound = true;
      return;
    }

    if (index >= groups.length) return;
    if (typeof shouldPrune === 'function' && shouldPrune(state, index, groups)) {
      prunedNodes += 1;
      return;
    }

    const group = groups[index];
    for (const option of group.options) {
      if (goalFound || budgetExceeded()) return;
      const branch = cloneState(state);
      const outcome = applyOption(branch, option, group);
      if (!outcome?.ok) {
        prunedNodes += 1;
        if (Array.isArray(outcome?.evidence)) evidence.push(...outcome.evidence);
        continue;
      }
      visit(index + 1, outcome.state ?? branch);
    }

    if (!group.required && !goalFound && !budgetExceeded()) {
      visit(index + 1, cloneState(state));
    }
  };

  visit(0, cloneState(initialState));
  const elapsedMs = Math.max(0, now() - startedAt);
  const searchComplete = !timedOut && !goalFound;

  return {
    status: timedOut ? 'timeout' : (bestValid ? 'solved' : 'infeasible'),
    solution: bestValid,
    draft: bestDraft,
    evidence,
    nodesVisited,
    prunedNodes,
    timeoutMs: normalizedTimeoutMs,
    elapsedMs,
    seed: normalizedSeed,
    goalFound,
    searchComplete,
    optimizationComplete: searchComplete,
  };
}

export default {
  solveWithBoundedBacktracking,
  seededStableHash,
  DEFAULT_SOLVER_TIMEOUT_MS,
  DEFAULT_SOLVER_MAX_NODES,
  DEFAULT_SOLVER_SEED,
};
