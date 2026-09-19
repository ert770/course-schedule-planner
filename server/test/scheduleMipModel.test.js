import test from 'node:test';
import assert from 'node:assert/strict';

import { buildScheduleMip, decodeSelection } from '../src/skills/optimization/scheduleMipModel.js';
import { solveLpText, SOLVE_STATUS } from '../src/skills/optimization/highsRuntime.js';

const allowed = { allowed: true };

function section(id, code, { day = 1, start = 1, end = 2, credits = 3, score = 100, ...extra } = {}) {
  return {
    course: {
      id, catalogCourseCode: code, name: `課程${id}`, credits,
      timeBlocks: [{ dayOfWeek: day, startPeriod: start, endPeriod: end }], ...extra,
    },
    courseKey: `code:${code}`,
    seriesKey: extra.seriesKey ?? null,
    placement: allowed,
    score,
  };
}

function inputs(competitive, overrides = {}) {
  return {
    fixedSchedule: [], fixedUnscheduled: [], fixedCredits: 0,
    minCredits: 0, maxCredits: 25, maxCoursesPerDay: Infinity, explicitIds: [],
    competitive, internships: [], ...overrides,
  };
}

async function solve(mipInputs) {
  const model = buildScheduleMip(mipInputs);
  const result = await solveLpText(model.lpText, model.columnNames);
  return { result, ids: decodeSelection(model, result.values).map(s => s.course.id).sort((a, b) => a - b) };
}

test('MILP：同時段只選一門，挑分數較高者（精確 argmax）', async () => {
  const { result, ids } = await solve(inputs([
    section(1, 'A', { score: 100 }),
    section(2, 'B', { score: 300 }),
    section(3, 'C', { day: 2, score: 50 }),
  ]));
  assert.equal(result.status, SOLVE_STATUS.OPTIMAL);
  assert.deepEqual(ids, [2, 3]);
});

test('MILP：同課號兩個班次最多選一個', async () => {
  const { ids } = await solve(inputs([
    section(1, 'A', { day: 1, score: 100 }),
    section(2, 'A', { day: 2, score: 90 }),
  ]));
  assert.deepEqual(ids, [1]);
});

test('MILP：greedy 會選錯的組合，MILP 選出整體最佳', async () => {
  // A 單獨分數最高，但與 B、C 都衝堂；B+C 合計更高。greedy 先拿 A 就回不了頭。
  const { ids } = await solve(inputs([
    section(1, 'A', { day: 1, start: 1, end: 4, score: 150 }),
    section(2, 'B', { day: 1, start: 1, end: 2, score: 100 }),
    section(3, 'C', { day: 1, start: 3, end: 4, score: 100 }),
  ]));
  assert.deepEqual(ids, [2, 3]);
});

test('MILP：學分上限與下限都成立', async () => {
  const courses = [1, 2, 3].map(id => section(id, `K${id}`, { day: id, score: -10 }));
  const { result, ids } = await solve(inputs(courses, { minCredits: 6, maxCredits: 6 }));
  assert.equal(result.status, SOLVE_STATUS.OPTIMAL);
  assert.equal(ids.length, 2);
});

test('MILP：正課與實習一起選，實習不能單獨出現', async () => {
  const regular = section(1, 'M1', { score: 200, corequisiteRole: 'regular', corequisiteCode: 'M1P' });
  const internship = {
    ...section(2, 'M1P', { day: 3, score: 0, corequisiteRole: 'internship' }),
  };
  delete internship.score;
  const { ids } = await solve(inputs([regular], { internships: [internship] }));
  assert.deepEqual(ids, [1, 2]);

  const { ids: none } = await solve(inputs(
    [{ ...regular, score: -500 }],
    { internships: [internship] }
  ));
  assert.deepEqual(none, []);
});

test('MILP：同系列課不同時選，明確指定者豁免', async () => {
  const one = section(1, 'S1', { day: 1, score: 100, seriesKey: '微積分' });
  const two = section(2, 'S2', { day: 2, score: 100, seriesKey: '微積分' });
  assert.equal((await solve(inputs([one, two]))).ids.length, 1);
  assert.equal((await solve(inputs([one, two], { explicitIds: [2] }))).ids.length, 2);
});

test('MILP：與固定課程衝突的候選在建模前排除', () => {
  const blocked = { ...section(1, 'A'), placement: { allowed: false, constraintId: 'TIME_CONFLICT' } };
  const model = buildScheduleMip(inputs([blocked, section(2, 'B', { day: 2 })]));
  assert.equal(model.prefilter.blockedAgainstFixed, 1);
  assert.equal(model.stats.sectionVars, 1);
});
