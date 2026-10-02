// Roadmap #10：HiGHS（WebAssembly）執行環境。
// Wasm 只載入一次；每個 model 都必須 dispose，否則原生記憶體不會由 JS GC 釋放。
import loadHighs from 'highs';

export const SOLVE_CATEGORY = Object.freeze({
  OPTIMAL: 'optimal',
  LIMIT_WITH_SOLUTION: 'limit-with-solution',
  LIMIT_NO_SOLUTION: 'limit-no-solution',
  INFEASIBLE: 'infeasible',
  UNBOUNDED: 'unbounded',
  SOLVER_ERROR: 'solver-error',
});

// 舊 spike/tests 的相容名稱；值改用新的 category。
export const SOLVE_STATUS = Object.freeze({
  OPTIMAL: SOLVE_CATEGORY.OPTIMAL,
  FEASIBLE_TIME_LIMIT: SOLVE_CATEGORY.LIMIT_WITH_SOLUTION,
  INFEASIBLE: SOLVE_CATEGORY.INFEASIBLE,
  SOLVER_ERROR: SOLVE_CATEGORY.SOLVER_ERROR,
});

let runtimePromise = null;
let readyRuntime = null;
let loadFailure = null;

export function getHighsRuntime() {
  if (!runtimePromise) {
    runtimePromise = loadHighs()
      .then(runtime => {
        readyRuntime = runtime;
        loadFailure = null;
        return runtime;
      })
      .catch(error => {
        loadFailure = error;
        throw error;
      });
  }
  return runtimePromise;
}

export const getReadyHighsRuntime = () => readyRuntime;
export const getHighsLoadFailure = () => loadFailure;

const RAW_STATUS_LABELS = Object.freeze({
  notSet: 'Not set', loadError: 'Load error', modelError: 'Model error',
  presolveError: 'Presolve error', solveError: 'Solve error', postsolveError: 'Postsolve error',
  empty: 'Empty', optimal: 'Optimal', infeasible: 'Infeasible',
  unboundedOrInfeasible: 'Unbounded or infeasible', unbounded: 'Unbounded',
  objectiveBound: 'Objective bound reached', objectiveTarget: 'Objective target reached',
  timeLimit: 'Time limit reached', iterationLimit: 'Iteration limit reached',
  unknown: 'Unknown', solutionLimit: 'Solution limit reached', interrupted: 'Interrupted',
});

function rawStatusName(highs, modelStatus) {
  const entry = Object.entries(highs.constants.modelStatus).find(([, code]) => code === modelStatus);
  return entry ? (RAW_STATUS_LABELS[entry[0]] ?? entry[0]) : `Unknown (${modelStatus})`;
}

export function categorizeHighsStatus(highs, modelStatus, hasPrimal) {
  const codes = highs.constants.modelStatus;
  if (modelStatus === codes.optimal) return SOLVE_CATEGORY.OPTIMAL;
  if (modelStatus === codes.infeasible || modelStatus === codes.unboundedOrInfeasible) {
    return SOLVE_CATEGORY.INFEASIBLE;
  }
  if (modelStatus === codes.unbounded) return SOLVE_CATEGORY.UNBOUNDED;
  const isLimit = [
    codes.objectiveBound, codes.objectiveTarget, codes.timeLimit,
    codes.iterationLimit, codes.solutionLimit, codes.interrupted,
  ].includes(modelStatus);
  if (isLimit) {
    return hasPrimal ? SOLVE_CATEGORY.LIMIT_WITH_SOLUTION : SOLVE_CATEGORY.LIMIT_NO_SOLUTION;
  }
  return SOLVE_CATEGORY.SOLVER_ERROR;
}

/** 使用已載入的 runtime，同步求解一個 CPLEX LP 模型。 */
export function solveLpTextSync(highs, lpText, columnNames, options = {}) {
  if (!highs) {
    return {
      rawStatus: 'Runtime unavailable', category: SOLVE_CATEGORY.SOLVER_ERROR,
      status: SOLVE_CATEGORY.SOLVER_ERROR, values: new Map(), objective: null,
      mipGap: null, runtimeMs: 0,
    };
  }
  const startedAt = performance.now();
  let model = null;
  try {
    model = highs.createModel({ format: 'lp', data: lpText });
    model.options.set({ output_flag: false });
    if (options.timeLimitSeconds != null) model.options.set('time_limit', options.timeLimitSeconds);
    if (options.mipRelGap != null) model.options.set('mip_rel_gap', options.mipRelGap);
    // MIP 起始解（Trapp & Konrad §3.3.1 的暖啟動）：只提供 incumbent，不改變模型或最優性判定；
    // HiGHS 拒絕時照常求解，結果中記錄 warmStart 狀態。
    let warmStart = 'none';
    if (options.initialValues instanceof Map && options.initialValues.size > 0) {
      const indices = [];
      const startValues = [];
      for (const [name, value] of options.initialValues) {
        const index = model.getColByName(name);
        if (index >= 0) { indices.push(index); startValues.push(value); }
      }
      try {
        if (indices.length > 0) {
          model.setSolution({ indices: new Int32Array(indices), values: new Float64Array(startValues) });
          warmStart = 'accepted';
        }
      } catch {
        warmStart = 'rejected';
      }
    }
    model.run();
    const modelStatus = model.getModelStatus();
    const solution = model.getSolution();
    const hasPrimal = Boolean(solution?.colValue?.length)
      && model.info.get('primal_solution_status') !== 0;
    const category = categorizeHighsStatus(highs, modelStatus, hasPrimal);
    const values = new Map();
    if (category === SOLVE_CATEGORY.OPTIMAL || category === SOLVE_CATEGORY.LIMIT_WITH_SOLUTION) {
      for (const name of columnNames) {
        const index = model.getColByName(name);
        if (index >= 0) values.set(name, solution.colValue[index]);
      }
    }
    return {
      rawStatus: rawStatusName(highs, modelStatus), category, status: category, values, warmStart,
      objective: hasPrimal ? model.getObjectiveValue() : null,
      mipGap: hasPrimal ? model.info.get('mip_gap') : null,
      runtimeMs: performance.now() - startedAt,
    };
  } catch (error) {
    return {
      rawStatus: error?.message || 'Solver error', category: SOLVE_CATEGORY.SOLVER_ERROR,
      status: SOLVE_CATEGORY.SOLVER_ERROR, values: new Map(), objective: null,
      mipGap: null, runtimeMs: performance.now() - startedAt, error,
    };
  } finally {
    model?.dispose();
  }
}

/** spike 與獨立腳本使用的 async 相容入口。 */
export async function solveLpText(lpText, columnNames, options = {}) {
  try {
    const highs = await getHighsRuntime();
    return solveLpTextSync(highs, lpText, columnNames, options);
  } catch (error) {
    return {
      rawStatus: error?.message || 'Runtime unavailable', category: SOLVE_CATEGORY.SOLVER_ERROR,
      status: SOLVE_CATEGORY.SOLVER_ERROR, values: new Map(), objective: null,
      mipGap: null, runtimeMs: 0, error,
    };
  }
}
