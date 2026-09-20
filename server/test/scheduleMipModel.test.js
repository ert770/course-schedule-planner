import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildDiverseScheduleMip,
  buildScheduleMip,
  collectBindingConstraints,
  decodeSelection,
} from '../src/skills/optimization/scheduleMipModel.js';
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

function diverseInputs(competitive, overrides = {}) {
  const baseCourses = competitive.slice(0, 2).map(entry => entry.course);
  return inputs(competitive, {
    minCredits: 6,
    maxCredits: 6,
    basePlan: { success: true, totalCredits: 6, schedule: baseCourses, unscheduledCourses: [] },
    ...overrides,
  });
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

test('MILP 空模型：區分無競爭課、不可行與上游資料不足', () => {
  assert.equal(buildScheduleMip(inputs([], { fixedCredits: 6, minCredits: 6 })).status, 'no-competitive-candidates');
  assert.equal(buildScheduleMip(inputs([], { fixedCredits: 0, minCredits: 6 })).status, 'infeasible');
  assert.equal(buildDiverseScheduleMip(inputs([])).status, 'data-insufficient');
});

test('正式 MILP：學分對齊、雙向換課、興趣門檻與品質下限均寫成限制', () => {
  const competitive = [1, 2, 3, 4, 5].map(id => ({
    ...section(id, `D${id}`, { day: id, score: 1000 + id * 10 }),
    scoreComponents: { base: 1000 },
    interestScore: id / 5,
    rated: true,
    easyScore: id / 5,
  }));
  const model = buildDiverseScheduleMip(diverseInputs(competitive), {
    creditTarget: 6,
    referenceSelections: [new Set(['code:D1', 'code:D2'])],
    axis: { type: 'interest', threshold: 0.4, fixedCount: 0, fixedScoreSum: 0 },
    centroid: new Map(),
    baselineUtility: 30,
    qualityScale: 1000,
    qualityLossLimit: 130,
  });
  assert.equal(model.status, 'ready');
  const types = new Set(model.rows.map(row => row.meta?.type));
  for (const type of ['credit-target', 'replacement-out', 'replacement-in', 'quality-loss', 'axis-interest']) {
    assert.ok(types.has(type), `缺少 ${type}`);
  }
  assert.equal(model.stats.competitiveCourseVars, 5);
});

test('正式 MILP：輕鬆門檻含最低評價數，集中方案建立日變數', () => {
  const competitive = [1, 2, 3, 4].map(id => ({
    ...section(id, `E${id}`, { day: id, score: 1000 }),
    scoreComponents: { base: 1000 }, interestScore: 0,
    rated: true, easyScore: id / 4,
  }));
  const common = {
    creditTarget: 6,
    referenceSelections: [new Set(['code:E1', 'code:E2'])],
    centroid: new Map(), baselineUtility: 0, qualityScale: 1000, qualityLossLimit: 130,
  };
  const easy = buildDiverseScheduleMip(diverseInputs(competitive), {
    ...common,
    axis: { type: 'easy', threshold: 0.5, minRated: 2, fixedRatedCount: 0, fixedEasySum: 0 },
  });
  assert.ok(easy.rows.some(row => row.meta?.type === 'rated-floor'));
  const compact = buildDiverseScheduleMip(diverseInputs(competitive), {
    ...common,
    axis: { type: 'compact', maxDays: 3 },
  });
  assert.equal(compact.dayVariables.length, 7);
  assert.ok(compact.rows.some(row => row.meta?.type === 'axis-compact'));
});

test('bindingConstraints 使用相對數值容差', () => {
  const model = { rows: [{
    name: 'near', terms: [{ coef: 1, name: 'x' }], sense: '<=', rhs: 1_000_000,
    meta: { type: 'test' },
  }] };
  assert.equal(collectBindingConstraints(model, new Map([['x', 1_000_000.5]])).length, 1);
  assert.equal(collectBindingConstraints(model, new Map([['x', 1_000_002]])).length, 0);
});

test('正式 MILP：階層數量由硬限制維持，87% 品質排除階層懲罰', () => {
  const own = {
    ...section(1, 'OWN', { day: 1, score: 1010 }),
    scoreComponents: { base: 1000, crossYearElective: 0, outsideOwnDepartment: 0 },
    interestScore: 0, rated: false, easyScore: null,
  };
  const outside = {
    ...section(2, 'OUT', { day: 2, score: -3990 }),
    scoreComponents: { base: 1000, crossYearElective: 0, outsideOwnDepartment: -5000 },
    interestScore: 0, rated: false, easyScore: null,
  };
  const more = [3, 4].map(id => ({
    ...section(id, `OWN${id}`, { day: id, score: 1010 }),
    scoreComponents: { base: 1000, crossYearElective: 0, outsideOwnDepartment: 0 },
    interestScore: 0, rated: false, easyScore: null,
  }));
  const model = buildDiverseScheduleMip(diverseInputs([own, outside, ...more]), {
    creditTarget: 6,
    referenceSelections: [new Set(['code:OWN', 'code:OUT'])],
    axis: { type: 'interest', threshold: 0, fixedCount: 0, fixedScoreSum: 0 },
    hierarchyTargets: { 'cross-year': 0, outside: 1 },
    centroid: new Map(), baselineUtility: 20, qualityScale: 1000, qualityLossLimit: 130,
  });
  assert.equal(model.status, 'ready');
  assert.ok(model.rows.some(row => row.meta?.type === 'hierarchy-parity' && row.meta.tier === 'outside'));
  assert.deepEqual(model.quality.utilityTerms.map(term => term.coef), [10, 10, 10, 10]);
});
