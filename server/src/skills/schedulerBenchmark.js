// Roadmap #35：排課引擎的 feasibility／constraint violation benchmark。
//
// Z1-Z7（`scheduler.test.js`）用 2-3 門課的最小合成情境釘住每一種 solver 行為
// （貪婪陷阱、真無解、逾時、資料不足）——這對「這個邏輯分支對不對」很有效，
// 答不出「接近真實選課規模的候選池下，引擎多常真的找到解」。這裡不取代
// Z1-Z7，是規模擴充：同一套五類判定邏輯，套在 `schedulerBenchmarkCases.json`
// 那份跨科系／年級／班級的題庫上。
//
// 不連 MySQL、不寫入使用者資料——只吃固定 fixture 與 `generateSchedule()`，
// 純本地運算，可以直接留在 `npm test` 裡跑，沒有 #34 那種 API 成本考量。

import { generateSchedule } from './scheduler.js';
import { validateScheduleAgainstConstraints } from './scheduleValidator.js';
import { summarizeExperiment } from './personalizationMetrics.js';

// `buildStudentScope()` 讀的是 `constraints.department`／`.gradeLevel`／
// `.className`，不是題庫裡獨立的 `scope` 物件——題庫把「這是誰」與「這次排課
// 條件」分開寫是為了給人看的可讀性，這裡合併回排課引擎真正要的形狀。
function buildConstraints(caseDefinition) {
  return {
    department: caseDefinition.scope?.department,
    gradeLevel: caseDefinition.scope?.grade,
    className: caseDefinition.scope?.className,
    ...caseDefinition.constraints,
  };
}

// 是否「終態未完成」——依 roadmap #41 的 operation 終態語意，`solver.status`
// 是這裡唯一需要的來源，不必重新判斷 solverStatus 以外的東西。
function isTimedOut(result) {
  return result.solver.status === 'timeout';
}

function judgeFeasible(result, revalidation) {
  const pass = result.success === true && revalidation.violations.length === 0;
  return { pass, note: pass ? null : `success=${result.success}，violations=${revalidation.violations.length}` };
}

function judgeInfeasible(result) {
  // `conflictSet` 只在特定失敗路徑才會出現在回傳物件上（見 scheduler.js 的
  // 兩個 `conflictSet:` 賦值點）——一份真正成功的排課結果上這個欄位是
  // undefined，不是空陣列，用 `?? []` 才不會在誤判成 infeasible 的 feasible
  // case 上直接丟出 TypeError。
  const conflictSet = result.conflictSet ?? [];
  const pass = result.success === false
    && result.solver.status === 'infeasible'
    && conflictSet.length > 0;
  return {
    pass,
    note: pass ? null : `success=${result.success}，status=${result.solver.status}，conflictSet=${conflictSet.length}`,
  };
}

function judgeDataInsufficient(result) {
  const pass = result.solver.status === 'data-insufficient';
  return { pass, note: pass ? null : `status=${result.solver.status}` };
}

// timeout 類拆兩種子情況（比照 Z3／Z4）：`expectSuccess: true` 代表「逾時但
// 有已驗證的 fallback」，`false` 代表「逾時且真的沒找到解」。**這是 #35 要
// 測的核心區分**——不把「還沒搜完」和「搜完了確定無解」混為一談。
function judgeTimeout(caseDefinition, result) {
  const timedOut = isTimedOut(result);
  if (!timedOut) return { pass: false, note: `solver.status=${result.solver.status}，預期 timeout` };

  const expectSuccess = caseDefinition.expectSuccess === true;
  const pass = result.success === expectSuccess;
  return {
    pass,
    note: pass ? null : `success=${result.success}，預期 ${expectSuccess}`,
  };
}

// 貪婪陷阱：純 greedy 的基準線必須真的比較差，repair 必須真的把它修好——
// 兩者都要驗證，只看其中一個會漏掉「repair 其實沒有生效，只是這題本來就
// 簡單」這種偽陽性。
function judgeGreedyTrap(caseDefinition, result, revalidation) {
  const constraints = buildConstraints(caseDefinition);
  const greedyOnly = generateSchedule(
    caseDefinition.candidateCourses,
    constraints,
    { ...caseDefinition.runtimeOptions, solverMode: 'greedy' }
  );

  const trapConfirmed = greedyOnly.totalCredits < result.totalCredits;
  const repairSucceeded = result.success === true && revalidation.violations.length === 0;
  const pass = trapConfirmed && repairSucceeded;

  return {
    pass,
    note: pass ? null : `greedy=${greedyOnly.totalCredits}，repaired=${result.totalCredits}，`
      + `trapConfirmed=${trapConfirmed}，repairSucceeded=${repairSucceeded}`,
    greedyTotalCredits: greedyOnly.totalCredits,
  };
}

const JUDGES = {
  feasible: (caseDefinition, result, revalidation) => judgeFeasible(result, revalidation),
  infeasible: (caseDefinition, result) => judgeInfeasible(result),
  'data-insufficient': (caseDefinition, result) => judgeDataInsufficient(result),
  timeout: (caseDefinition, result) => judgeTimeout(caseDefinition, result),
  'greedy-trap': (caseDefinition, result, revalidation) => judgeGreedyTrap(caseDefinition, result, revalidation),
};

/**
 * 跑一個 benchmark case，回傳一列可以直接餵給 `summarizeExperiment()` 的 row。
 *
 * @param caseDefinition `schedulerBenchmarkCases.json` 的一個 case 物件
 */
export function runSchedulerCase(caseDefinition) {
  const constraints = buildConstraints(caseDefinition);
  const result = generateSchedule(caseDefinition.candidateCourses, constraints, caseDefinition.runtimeOptions ?? {});

  // 獨立於排課邏輯本身的第二把尺：不能只信任 `result.success`／
  // `result.solver.status` 自己說沒問題——roadmap #35 就是靠這一步驗出
  // `DAILY_COURSE_CAP` 從來沒被真正檢查過。
  const revalidation = validateScheduleAgainstConstraints(result.schedule, constraints);

  const judge = JUDGES[caseDefinition.expectedCategory];
  if (!judge) {
    throw new Error(`未知的 expectedCategory：${caseDefinition.expectedCategory}（case ${caseDefinition.id}）`);
  }
  const { pass, note, ...extra } = judge(caseDefinition, result, revalidation);

  return {
    id: caseDefinition.id,
    category: caseDefinition.expectedCategory,
    pass,
    note,
    solverStatus: result.solver.status,
    hardViolationCount: revalidation.violations.length,
    hardViolations: revalidation.violations.map(v => v.constraintId),
    softUtility: result.preferenceScore ?? null,
    runtimeMs: result.solver.elapsedMs,
    nodesVisited: result.solver.nodesVisited,
    // repair 未觸發（純 greedy 就通過）時 elapsedMs／nodesVisited 固定是 0，
    // 不代表「跑了 0ms」——一併帶這個欄位避免報告誤讀。
    repairAttempted: result.solver.repairAttempted,
    timedOut: isTimedOut(result),
    ...extra,
  };
}

/**
 * 跑整份題庫，回傳 `summarizeExperiment()` 的展開（`total`/`passed`/`failed`/
 * `passRate`/`rows`）——與 #36 的 `runExperimentSuite()` 用同一個彙總器，
 * 不重寫一份 rows/pass/passRate 邏輯。
 *
 * @param cases `schedulerBenchmarkCases.json` 的 `cases` 陣列
 */
export function runSchedulerBenchmark(cases = []) {
  const rows = cases.map(runSchedulerCase);
  return summarizeExperiment(rows);
}

export default { runSchedulerCase, runSchedulerBenchmark };
