import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeProfile } from '../src/data/profileSchema.js';
import { mergeScheduleOptions } from '../src/data/scheduleOptions.js';
import { executeAgentTool, handleChat } from '../src/services/agentService.js';
import { buildScheduleConstraints } from '../src/services/constraintService.js';
import { buildScheduleMip, decodeSelection } from '../src/skills/optimization/scheduleMipModel.js';
import { solveLpText } from '../src/skills/optimization/highsRuntime.js';
import { generateSchedule } from '../src/skills/scheduler.js';
import { makeCourse, makeMultiBlockCourse } from './fixtures.js';

const profile = normalizeProfile({
  department: '資訊工程學系', gradeLevel: 3, className: '資訊三甲',
  targetCreditsMin: 0, targetCreditsMax: 12,
});
const courses = [
  makeCourse(801, { name: '週三實作', instructor: '王小明', dayOfWeek: 3, startPeriod: 6, endPeriod: 6, category: '一般選修' }),
  makeCourse(802, { name: '週四設計', instructor: '林小華', dayOfWeek: 4, startPeriod: 6, endPeriod: 6, category: '一般選修' }),
  makeCourse(803, { name: '通識閱讀', instructor: '張小美', dayOfWeek: 4, startPeriod: 7, endPeriod: 7,
    category: '通識', credits: 2 }),
  makeCourse(804, { name: '通識文化', instructor: '張小美', dayOfWeek: 4, startPeriod: 8, endPeriod: 8,
    category: '通識', credits: 2 }),
];
const ids = result => result.schedule.map(course => Number(course.id)).sort((a, b) => a - b);
const solve = (pool, constraints, prefs = profile) =>
  generateSchedule(pool, buildScheduleConstraints(constraints, prefs), { planSet: 'primary-only' });

function chatFixture(id, { pool = courses, initial = profile, manualIds = [] } = {}) {
  const identity = { canonicalId: id };
  let prefs = structuredClone(initial);
  let requests = 0;
  const options = {
    loadPreferences: async () => structuredClone(prefs),
    saveExchange: async () => {},
    resolvePlanning: async () => ({ status: 'accepted', value: { selectedCourseIds: manualIds } }),
    executeTool: (name, args, ctx) => executeAgentTool(name, args, ctx, {
      lookupCourses: async ids => new Map(pool.filter(course => ids.map(Number).includes(course.id)).map(course => [course.id, course])),
      updatePreferences: async (_, values) => {
        const preferencesJson = values.scheduleOptions
          ? mergeScheduleOptions(prefs.preferencesJson, values.scheduleOptions) : prefs.preferencesJson;
        prefs = normalizeProfile({ ...prefs, ...values, scheduleOptions: undefined, preferencesJson });
        return prefs;
      },
      generateSchedule: async (_, input, config) => {
        requests++;
        return solve(pool, input.constraints, config.prefs);
      },
    }),
  };
  return { chat: message => handleChat(identity, message, null, options), prefs: () => prefs, requests: () => requests };
}

test('可上課區間涵蓋每個節次；跨兩天班次只在其中一天合規時被排除', async () => {
  const multi = makeMultiBlockCourse(805, [
    { dayOfWeek: 4, startPeriod: 9, endPeriod: 9 },
    { dayOfWeek: 3, startPeriod: 9, endPeriod: 9 },
  ], { category: '一般選修', credits: 1 });
  const pool = [...courses, multi];
  assert.ok(ids(solve(pool, {})).includes(805));
  const f = chatFixture('ADV-TIME', { pool });
  assert.match((await f.chat('只有週四下午有空，幫我排課')).reply, /這次.*以後/);
  const result = await f.chat('這次');
  assert.equal(result.intent, 'run_csp_scheduler');
  assert.deepEqual(ids(result.data), [802, 803, 804]);
});

test('短句 6 學分先問目標或上限，補答後排出正好 6 學分', async () => {
  assert.equal(solve(courses, {}).totalCredits, 10);
  const f = chatFixture('ADV-CREDITS');
  assert.match((await f.chat('這次6學分，幫我重排')).reply, /排到 6 學分.*最多 6 學分/);
  assert.equal(f.requests(), 0);
  const result = await f.chat('剛好');
  assert.equal(result.intent, 'run_csp_scheduler');
  assert.equal(result.data.totalCredits, 6);
  assert.deepEqual(f.prefs().scheduleOptions, {});
});

test('總上限與每門學分分開套用，達不到明確的精準學分時回報失敗', () => {
  const limited = solve(courses, { scheduleOptions: { maxCredits: 4, courseCredits: 2 } });
  assert.deepEqual(ids(limited), [803, 804]);
  assert.equal(limited.totalCredits, 4);
  const exact = solve(courses.slice(0, 2), { scheduleOptions: { minCredits: 4, maxCredits: 4 } });
  assert.equal(exact.success, false);
  assert.match(JSON.stringify(exact.unmetRequirements), /目標至少 4 學分/);
});

test('進階學分目標仍受帳號下限與超修上限約束', async () => {
  const prefs = { ...profile, targetCreditsMin: 12 };
  const below = chatFixture('ADV-CREDIT-POLICY', { initial: prefs });
  const response = await below.chat('這次剛好6學分，幫我重排');
  assert.match(response.reply, /學分下限為 12.*上限 6/);
  assert.equal(below.requests(), 0);
  const input = { scheduleOptions: { maxCredits: 30 } };
  assert.equal(buildScheduleConstraints(input, prefs).maxCredits, 25);
  assert.equal(buildScheduleConstraints({ ...input, allowCreditOverload: true }, prefs).maxCredits, 30);
});

test('指定教師的避開條件改變實際班次，教師偏好改變同課班次排序', async () => {
  assert.ok(ids(solve(courses, {})).includes(801));
  const f = chatFixture('ADV-TEACHER');
  const result = await f.chat('這次不要王小明老師的課，幫我重排');
  assert.deepEqual(ids(result.data), [802, 803, 804]);
  const sameCourse = courses.slice(0, 2).map(course => ({ ...course, code: 'C900', catalogCourseCode: 'C900' }));
  const before = ids(solve(sameCourse, {}));
  const other = sameCourse.find(course => !before.includes(course.id));
  const after = solve(sameCourse, { scheduleOptions: { preferredInstructors: [other.instructor] } });
  assert.deepEqual(ids(after), [other.id]);
});

test('類別門數影響排課，最低門數無解時不回傳成功', async () => {
  assert.equal(solve(courses, {}).schedule.filter(course => course.category === '通識').length, 2);
  const f = chatFixture('ADV-CATEGORY');
  const result = await f.chat('這次通識一門，幫我重排');
  assert.equal(result.intent, 'run_csp_scheduler');
  assert.equal(result.data.schedule.filter(course => course.category === '通識').length, 1);
  const impossible = solve(courses, { scheduleOptions: { categoryQuotas: [{ category: '通識', minCourses: 3 }] } });
  assert.equal(impossible.success, false);
  assert.match(JSON.stringify(impossible.unmetRequirements), /通識需要至少 3/);
});

test('指定另一個班次會換成該班，且同一門課只留一班', async () => {
  const pool = courses.slice(0, 2).map(course => ({ ...course, code: 'C901', catalogCourseCode: 'C901' }));
  const before = ids(solve(pool, {}));
  const wanted = pool.find(course => !before.includes(course.id));
  const f = chatFixture('ADV-SECTION', { pool });
  const result = await f.chat(`這次排班次 ${wanted.id}，幫我重排`);
  assert.equal(result.intent, 'run_csp_scheduler');
  assert.deepEqual(ids(result.data), [wanted.id]);
});

test('手動加選與明確排除同一個班次時，只問衝突的條件', async () => {
  const f = chatFixture('ADV-FIXED-CONFLICT', { manualIds: [801] });
  const result = await f.chat('這次不要班次801，幫我重排');
  assert.match(result.reply, /週三實作.*要保留這個班次/);
  assert.equal(f.requests(), 0);
});

test('長期類別設定寫入 profile，和已有設定合併後由首頁排課套用', async () => {
  const preferencesJson = mergeScheduleOptions(profile.preferencesJson, { maxCoursesPerDay: 2 });
  const f = chatFixture('ADV-SAVED', { initial: normalizeProfile({ ...profile, scheduleOptions: undefined, preferencesJson }) });
  const result = await f.chat('以後只排通識');
  assert.equal(result.preferencesUpdated, true);
  assert.equal(f.requests(), 0);
  assert.deepEqual(f.prefs().scheduleOptions, { maxCoursesPerDay: 2, includeCategories: ['通識'] });
  assert.deepEqual(ids(solve(courses, {}, f.prefs())), [803, 804]);
});

test('MILP 類別門數及學分扣除固定課程，實際改變求解班次', async () => {
  const inputs = {
    fixedSchedule: [courses[2]], fixedUnscheduled: [], fixedCredits: 2,
    competitive: [courses[0], courses[3]].map(course => ({
      course, courseKey: course.code, placement: { allowed: true }, score: course.id === 801 ? 2 : 1,
    })),
    internships: [], explicitIds: [], minCredits: 0, maxCredits: 5,
  };
  const baseline = buildScheduleMip(inputs);
  const model = buildScheduleMip({
    ...inputs,
    categoryQuotas: [{ category: '通識', minCourses: 2, maxCredits: 4 }],
  });
  assert.match(model.lpText, /s1 >= 1/);
  assert.match(model.lpText, /2 s1 <= 2/);
  const selected = async input => {
    const result = await solveLpText(input.lpText, input.columnNames);
    return decodeSelection(input, result.values).map(section => section.course.id);
  };
  assert.deepEqual(await selected(baseline), [801]);
  assert.deepEqual(await selected(model), [804]);
});
