import test from 'node:test';
import assert from 'node:assert/strict';

import { getHighsRuntime, solveLpTextSync } from '../src/skills/optimization/highsRuntime.js';
import {
  BENCHMARK_DIVERSE_OPTIONS,
  DEFAULT_DIVERSE_OPTIONS,
  generateDiverseCandidates,
} from '../src/skills/optimization/diversePlanSolver.js';

const allowed = { allowed: true };
const entry = (id, selected = false) => ({
  course: {
    id, catalogCourseCode: `C${id}`, name: `課程${id}`, credits: 3,
    timeBlocks: [{ dayOfWeek: id, startPeriod: 1, endPeriod: 2 }],
  },
  courseKey: `code:C${id}`, seriesKey: null, placement: allowed,
  score: 1000, scoreComponents: { base: 1000 }, interestScore: id / 10,
  easyScore: null, rated: false, selected,
});

function inputs() {
  const competitive = [1, 2, 3, 4, 5, 6].map(id => entry(id));
  return {
    fixedSchedule: [], fixedUnscheduled: [], fixedCredits: 0,
    minCredits: 6, maxCredits: 6, maxCoursesPerDay: Infinity, explicitIds: [],
    competitive, internships: [], featureSummary: {},
    basePlan: {
      success: true, totalCredits: 6,
      schedule: [competitive[0].course, competitive[1].course], unscheduledCourses: [],
    },
  };
}

test('Dinkelbach：每一步都用選課結果重算 d，並收斂到窮舉可得的最佳比值', async () => {
  const runtime = await getHighsRuntime();
  const result = generateDiverseCandidates(inputs(), {
    axes: [{ archetype: 'interest', type: 'interest', signal: true,
      threshold: 0, fixedCount: 0, fixedScoreSum: 0 }],
    options: { candidatesPerAxis: 1, totalBudgetMs: 1000 },
    solve: (model, options) => solveLpTextSync(runtime, model.lpText, model.columnNames, options),
  });
  assert.equal(result.candidates.length, 1);
  const candidate = result.candidates[0];
  assert.equal(candidate.trace[0].qualityLoss, 0);
  assert.equal(candidate.qualityRetention, 1);
  assert.equal(candidate.convergence.converged, true);
  assert.equal(candidate.distanceFromBase.replacementDistance, 2);
  // S₀={1,2}，任選兩門外部課都得到 4/6 的 centroid Hamming。
  assert.ok(Math.abs(candidate.diversity - 4 / 6) < 1e-6);
  for (let index = 1; index < candidate.trace.length; index += 1) {
    assert.ok(candidate.trace[index].lambda >= candidate.trace[index - 1].lambda - 1e-9);
  }
});

test('Dinkelbach：U(S₀) 為負數時仍以固定尺度計算品質保留率', async () => {
  const negative = inputs();
  for (const entry of negative.competitive) entry.score = 900;
  const runtime = await getHighsRuntime();
  const result = generateDiverseCandidates(negative, {
    axes: [{ archetype: 'interest', type: 'interest', signal: true,
      threshold: 0, fixedCount: 0, fixedScoreSum: 0 }],
    options: { candidatesPerAxis: 1, totalBudgetMs: 1000 },
    solve: (model, options) => solveLpTextSync(runtime, model.lpText, model.columnNames, options),
  });
  assert.equal(result.baselineUtility, -200);
  assert.equal(result.qualityScale, 1000);
  assert.equal(result.candidates[0].qualityRetention, 1);
});

test('Dinkelbach：共用 deadline 用盡時標記 approximate/deadline', () => {
  let now = 0;
  const result = generateDiverseCandidates(inputs(), {
    axes: [{ archetype: 'interest', type: 'interest', signal: true,
      threshold: 0, fixedCount: 0, fixedScoreSum: 0 }],
    now: () => { now += 700; return now; },
    options: { candidatesPerAxis: 1, totalBudgetMs: 1000 },
    solve: () => { throw new Error('deadline 前不應進入求解'); },
  });
  assert.equal(result.axes[0].status, 'solver-budget-exceeded');
});

const interestAxis = (threshold = 0) => ({
  archetype: 'interest', type: 'interest', signal: true, threshold, fixedCount: 0, fixedScoreSum: 0,
});
const solveWith = runtime => (model, options) => solveLpTextSync(runtime, model.lpText, model.columnNames, options);

test('Dinkelbach：先以品質最佳的 x⁰ 起步，λ₁ 取 x⁰ 的比值，x⁰ 不計入迭代數', async () => {
  const runtime = await getHighsRuntime();
  const result = generateDiverseCandidates(inputs(), {
    axes: [interestAxis()],
    options: { candidatesPerAxis: 1, totalBudgetMs: 5000 },
    solve: solveWith(runtime),
  });
  const [candidate] = result.candidates;
  assert.equal(candidate.trace[0].iteration, 0);
  assert.equal(candidate.trace[0].lambda, null);
  assert.ok(Math.abs(candidate.trace[1].lambda - candidate.trace[0].ratio) < 1e-12);
  assert.equal(candidate.convergence.initialSolution, 'quality-optimal');
  assert.equal(candidate.convergence.iterations, candidate.trace.length - 1);
});

test('Dinkelbach：第 1 輪起把上一輪的解交給 HiGHS 當起始解', async () => {
  const runtime = await getHighsRuntime();
  const seen = [];
  generateDiverseCandidates(inputs(), {
    axes: [interestAxis()],
    options: { candidatesPerAxis: 1, totalBudgetMs: 5000 },
    solve: (model, options) => {
      seen.push(options.initialValues instanceof Map ? options.initialValues.size : 0);
      return solveWith(runtime)(model, options);
    },
  });
  assert.equal(seen[0], 0, 'x⁰ 沒有起始解');
  assert.ok(seen.slice(1).every(size => size > 0), 'Dinkelbach 各輪都有起始解');
});

test('不可行時逐一放寬限制群組，回報可單獨解開的原因', async () => {
  const runtime = await getHighsRuntime();
  // 興趣門檻 0.95：所有課的 interestScore ≤ 0.6，只有放寬主軸才可行。
  const result = generateDiverseCandidates(inputs(), {
    axes: [interestAxis(0.95)],
    options: { candidatesPerAxis: 1, totalBudgetMs: 5000 },
    solve: solveWith(runtime),
  });
  assert.equal(result.candidates.length, 0);
  assert.equal(result.axes[0].reason, 'axis-threshold-infeasible');
  assert.deepEqual(result.axes[0].diagnosis.resolvedBy, ['axis']);
  assert.equal(result.axes[0].diagnosis.complete, true);
});

test('線上預設：每主軸 1 個候選、共用 2.5 秒預算、單次 0.8 秒', () => {
  assert.equal(DEFAULT_DIVERSE_OPTIONS.candidatesPerAxis, 1);
  assert.equal(DEFAULT_DIVERSE_OPTIONS.totalBudgetMs, 2500);
  assert.equal(DEFAULT_DIVERSE_OPTIONS.perSolveSeconds, 0.8);
});

test('benchmark 設定只覆寫候選數為 3，其餘與線上相同', () => {
  assert.equal(BENCHMARK_DIVERSE_OPTIONS.candidatesPerAxis, 3);
  assert.equal(BENCHMARK_DIVERSE_OPTIONS.totalBudgetMs, DEFAULT_DIVERSE_OPTIONS.totalBudgetMs);
  assert.equal(BENCHMARK_DIVERSE_OPTIONS.perSolveSeconds, DEFAULT_DIVERSE_OPTIONS.perSolveSeconds);
  assert.equal(DEFAULT_DIVERSE_OPTIONS.candidatesPerAxis, 1, '線上設定不得被 benchmark 設定影響');
});
