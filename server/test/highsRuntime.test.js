import test from 'node:test';
import assert from 'node:assert/strict';

import { categorizeHighsStatus, SOLVE_CATEGORY } from '../src/skills/optimization/highsRuntime.js';

const highs = {
  constants: {
    modelStatus: {
      optimal: 7, infeasible: 8, unboundedOrInfeasible: 9, unbounded: 10,
      objectiveBound: 11, objectiveTarget: 12, timeLimit: 13, iterationLimit: 14,
      unknown: 15, solutionLimit: 16, interrupted: 17,
    },
  },
};

test('HiGHS 狀態保留「限制停止」是否已有可行解的差異', () => {
  assert.equal(categorizeHighsStatus(highs, 7, true), SOLVE_CATEGORY.OPTIMAL);
  assert.equal(categorizeHighsStatus(highs, 13, true), SOLVE_CATEGORY.LIMIT_WITH_SOLUTION);
  assert.equal(categorizeHighsStatus(highs, 13, false), SOLVE_CATEGORY.LIMIT_NO_SOLUTION);
  assert.equal(categorizeHighsStatus(highs, 8, false), SOLVE_CATEGORY.INFEASIBLE);
  assert.equal(categorizeHighsStatus(highs, 10, false), SOLVE_CATEGORY.UNBOUNDED);
  assert.equal(categorizeHighsStatus(highs, 15, false), SOLVE_CATEGORY.SOLVER_ERROR);
});
