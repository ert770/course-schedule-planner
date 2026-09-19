// Roadmap #10 任務 1 spike：HiGHS（WebAssembly）執行環境。
//
// 套件是第三方的 highs-js 包裝（npm `highs`，MIT）；求解核心 HiGHS 由愛丁堡大學團隊開發。
// `loadHighs()` 是非同步初始化，但 `model.run()` 是同步呼叫、單執行緒：求解期間會卡住
// Node event loop。正式接入多人流量前要移到 worker_threads（見 roadmap #10 計畫）。
//
// WASM 只在程序內載入一次；每個 persistent model 擁有原生記憶體，GC 不會釋放，
// 所以一律透過 `solveLpText()` 在 finally 裡 dispose。
import loadHighs from 'highs';

export const SOLVE_STATUS = Object.freeze({
  OPTIMAL: 'optimal',
  FEASIBLE_TIME_LIMIT: 'feasible-time-limit',
  INFEASIBLE: 'infeasible',
  SOLVER_ERROR: 'solver-error',
});

let runtimePromise = null;

export function getHighsRuntime() {
  if (!runtimePromise) runtimePromise = loadHighs();
  return runtimePromise;
}

function mapStatus(highs, modelStatus, hasPrimal) {
  const codes = highs.constants.modelStatus;
  if (modelStatus === codes.optimal) return SOLVE_STATUS.OPTIMAL;
  if (modelStatus === codes.infeasible) return SOLVE_STATUS.INFEASIBLE;
  // 時間／迭代／目標值限制提前停止：有可行解就回傳，但不得宣稱最佳性。
  if (hasPrimal) return SOLVE_STATUS.FEASIBLE_TIME_LIMIT;
  return SOLVE_STATUS.SOLVER_ERROR;
}

/**
 * 求解一個 CPLEX LP 格式的模型。
 *
 * @param lpText       模型文字
 * @param columnNames  要讀回的欄位名稱
 * @param options      `{ timeLimitSeconds, mipRelGap }`；未給的沿用 HiGHS 預設
 *                     （MIP 預設相對 gap 為 1e-4）
 * @returns `{ status, values: Map<name, number>, objective, mipGap, runtimeMs }`
 */
export async function solveLpText(lpText, columnNames, options = {}) {
  const highs = await getHighsRuntime();
  const startedAt = performance.now();
  const model = highs.createModel({ format: 'lp', data: lpText });
  try {
    model.options.set({ output_flag: false });
    if (options.timeLimitSeconds != null) model.options.set('time_limit', options.timeLimitSeconds);
    if (options.mipRelGap != null) model.options.set('mip_rel_gap', options.mipRelGap);
    model.run();
    const modelStatus = model.getModelStatus();
    const solution = model.getSolution();
    const hasPrimal = Boolean(solution?.colValue?.length)
      && model.info.get('primal_solution_status') !== 0;
    const status = mapStatus(highs, modelStatus, hasPrimal);
    const values = new Map();
    if (status === SOLVE_STATUS.OPTIMAL || status === SOLVE_STATUS.FEASIBLE_TIME_LIMIT) {
      for (const name of columnNames) {
        values.set(name, solution.colValue[model.getColByName(name)]);
      }
    }
    return {
      status,
      values,
      objective: hasPrimal ? model.getObjectiveValue() : null,
      mipGap: hasPrimal ? model.info.get('mip_gap') : null,
      runtimeMs: performance.now() - startedAt,
    };
  } finally {
    model.dispose();
  }
}
