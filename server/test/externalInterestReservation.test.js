import test from 'node:test';
import assert from 'node:assert/strict';
import { loadExternalInterestReservation } from '../src/services/externalInterestReservationService.js';
import { generateSchedule, rankExternalReservationCandidates } from '../src/skills/scheduler.js';
import { buildStudentScope } from '../src/skills/courseScope.js';
import { annotateCourseCategory } from '../src/skills/courseCategory.js';
import { buildCounterfactuals } from '../src/skills/planComparison.js';
import { generateScheduleWithTagInterestContext } from '../src/services/scheduleService.js';
import { makeCourse } from './fixtures.js';

const outside = (id, code, overrides = {}) => makeCourse(id, {
  catalogCourseCode: code, name: `系外課${id}`, department: '經濟三甲', dayOfWeek: id,
  category: '選修', ...overrides,
});
const general = (id, overrides = {}) => makeCourse(id, {
  catalogCourseCode: `G${id}`, department: '世界格局與歷史地理視野', credits: 2,
  year: 114, semester: '下學期', dayOfWeek: id, ...overrides,
});
const courses = [general(1), general(2), outside(3, 'LOW'), outside(4, 'HIGH', { department: '會計三甲' })];
const constraints = {
  department: '資訊工程學系', gradeLevel: 3, className: '資訊三甲', minCredits: 0, maxCredits: 25,
  graduationPlanning: { enabled: true, gaps: { elective: 0, general: 10, external: 4 },
    semesterTargets: { elective: 0, general: 5, external: 1 }, warnings: [] },
};
const context = (values, source = 's_vec') => ({ source,
  scores: new Map(Object.entries(values).map(([code, score]) => [code, { score }])) });
const run = (reservation, extra = {}) => generateSchedule(courses, { ...constraints, ...extra }, {
  solverMode: 'greedy', planSet: 'primary-only', externalInterestReservation: reservation,
});

test('ER1 使用完整課程目錄建立歷史向量；keyword 模式完全不讀學習資料', async () => {
  const catalog = [...courses, outside(5, 'HISTORY')];
  let loaded = 0;
  const deps = { loadCourses: async () => { loaded += 1; return catalog; },
    loadContext: async (_identity, prefs, list) => {
      assert.equal(list, catalog); assert.equal(prefs.courseHistory[0].courseCode, 'HISTORY');
      return { consented: true, user: { positive: new Map([['T', 1]]), negative: new Map() },
        index: { vectors: new Map([['HIGH', { weights: new Map([['T', 1]]) }]]) } };
    } };
  const result = await loadExternalInterestReservation({}, { courseHistory: [{ courseCode: 'HISTORY' }] }, courses, deps);
  assert.equal(result.source, 's_vec'); assert.equal(result.scores.get('HIGH').score, 1);
  assert.equal(result.scores.get('LOW').score, null);
  assert.equal(await loadExternalInterestReservation({}, {}, courses, { ...deps, mode: 'keyword' }), null);
  assert.equal(loaded, 1);
});

test('ER2 未同意、沒有正向訊號、讀取失敗均不推定興趣、不退回關鍵字', async () => {
  for (const [value, source] of [[{ consented: false }, 'no-consent'],
    [{ consented: true, user: { positive: new Map() } }, 'no-positive-signal']]) {
    const result = await loadExternalInterestReservation({}, {}, courses, {
      loadCourses: async () => [], loadContext: async () => value,
    });
    assert.equal(result.source, source); assert.equal(result.scores.size, 0);
  }
  const failed = await loadExternalInterestReservation({}, {}, courses, {
    loadCourses: async () => { throw new Error('fixture unavailable'); },
  });
  assert.equal(failed.source, 'unavailable');
  assert.equal(run(failed, { interests: ['系外課'] }).graduationPlanning.externalReservedForInterest, false);
});

test('ER3 A/B：沒有關鍵字也能因正 s_vec 保留一席；較高向量候選優先', () => {
  const a = run(context({ LOW: null, HIGH: null }));
  const b = run(context({ LOW: 0.1, HIGH: 0.9 }));
  assert.deepEqual(a.graduationPlanning.breadthSequence, ['general', 'general']);
  assert.deepEqual(b.graduationPlanning.breadthSequence, ['general', 'external']);
  assert.ok(b.schedule.some(course => course.catalogCourseCode === 'HIGH'));
  assert.equal(b.schedule.some(course => course.catalogCourseCode === 'LOW'), false);
  assert.equal(b.graduationPlanning.selected.general.courses + b.graduationPlanning.selected.external.courses, 2);
});

test('ER4 null、0、負分及非有限值不保留名額；系外缺口為零不保留', () => {
  for (const score of [null, 0, -0.8, NaN, Infinity]) {
    assert.equal(run(context({ HIGH: score })).graduationPlanning.externalReservedForInterest, false);
  }
  const planning = { ...constraints.graduationPlanning,
    gaps: { ...constraints.graduationPlanning.gaps, external: 0 } };
  assert.equal(run(context({ HIGH: 1 }), { graduationPlanning: planning }).graduationPlanning.externalReservedForInterest, false);
});

test('ER5 保留前五門穩定課號、每系一門；課號重複班次不增加名額', () => {
  const scope = buildStudentScope(constraints);
  const list = [outside(3, 'LOW'), outside(4, 'HIGH'), outside(8, 'HIGH'),
    ...['會計', '財金', '企管', '統計', '行銷', '國貿'].map((unit, i) => outside(20 + i, `X${i}`, { department: `${unit}三甲` }))];
  const scores = context({ LOW: 0.1, HIGH: 0.9, X0: 0.8, X1: 0.7, X2: 0.6, X3: 0.5, X4: 0.4, X5: 0.3 });
  const result = rankExternalReservationCandidates(list.map(course => annotateCourseCategory(course, scope)), scope, scores);
  assert.deepEqual(result.map(item => item.courseCode), ['HIGH', 'X0', 'X1', 'X2', 'X3']);
});

test('ER6 高分課衝堂時仍遵守硬條件，嘗試其他系外候選', () => {
  const required = makeCourse(50, { name: '必修', catalogCourseCode: 'R', category: '必修', dayOfWeek: 4 });
  const result = generateSchedule([...courses, required], constraints, {
    solverMode: 'greedy', planSet: 'primary-only', externalInterestReservation: context({ HIGH: 1, LOW: 0.5 }),
  });
  assert.ok(result.schedule.some(course => course.id === 50));
  assert.equal(result.schedule.some(course => course.catalogCourseCode === 'HIGH'), false);
  assert.ok(result.schedule.some(course => course.catalogCourseCode === 'LOW'));
});

test('ER7 當保留候選全被封鎖，仍可退到一般系外課；HTTP constraints 不能偽造 context', () => {
  const result = run(context({ HIGH: 1 }), { blockedPeriods: [{ day: 4, period: 3 }] });
  assert.ok(result.schedule.some(course => course.catalogCourseCode === 'LOW'));
  const spoof = generateSchedule(courses, { ...constraints, externalInterestReservation: context({ HIGH: 1 }) }, {
    solverMode: 'greedy', planSet: 'primary-only',
  });
  assert.equal(spoof.graduationPlanning.externalReservedForInterest, false);
});

test('ER8 已修、無時間與不能認列的高分課不觸發保留', () => {
  const additional = [outside(8, 'DONE'), outside(9, 'NOTIME', { dayOfWeek: null, startPeriod: null, endPeriod: null }),
    outside(10, 'MATH3069', { name: '密碼學', department: '應數三甲' })];
  const result = generateSchedule([...courses, ...additional], { ...constraints,
    courseHistory: [{ courseCode: 'DONE', passed: true, requirementType: '選修', graduationCategory: 'external' }] }, {
    solverMode: 'greedy', planSet: 'primary-only', externalInterestReservation: context({ DONE: 1, NOTIME: 1, MATH3069: 1 }),
  });
  assert.equal(result.graduationPlanning.externalReservedForInterest, false);
  assert.equal(result.graduationPlanning.externalInterestReservation.preferredCourses.length, 0);
});

test('ER9 標籤計分關閉仍傳遞保留 context；反事實基準沿用同一政策', () => {
  const reservation = context({ HIGH: 1 });
  let received;
  generateScheduleWithTagInterestContext(courses, constraints, null, (...args) => { received = args; }, reservation);
  assert.equal(received[2].externalInterestReservation, reservation);
  assert.equal(received[1], constraints);
  const morningCourses = courses.map(course => course.catalogCourseCode === 'HIGH'
    ? { ...course, startPeriod: 1, endPeriod: 2 } : course);
  const result = buildCounterfactuals(morningCourses, { ...constraints, noMorningClasses: true }, {
    runtimeOptions: { externalInterestReservation: reservation, solverMode: 'greedy' },
  });
  const delta = result.counterfactuals.find(item => item.preferenceId === 'noMorningClasses');
  assert.equal(delta.status, 'changed');
  assert.ok(delta.added.some(course => course.catalogCourseCode === 'HIGH'));
});
