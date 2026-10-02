// 本次規劃的避開清單：使用者剛移除的課，下一次重排要立即避開。
//
// 這一組測試釘住的是「移除之後重排，同一門課又被排回來」這個原始症狀的修復，
// 以及三個容易寫錯的邊界：範圍怎麼放大、必修不得靜默移除、
// `explicitCourseIds` 不是必排硬限制。
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { generateSchedule } from '../src/skills/scheduler.js';
import { buildScheduleConstraints } from '../src/services/constraintService.js';
import { resolveSessionAvoidances } from '../src/services/scheduleService.js';
import { makeCourse } from './fixtures.js';

// 兩個班次同課號、不同教師與時段；另一門完全無關的課當對照組。
const DS_A = makeCourse(101, {
  name: '資料結構', catalogCourseCode: 'IECS2001', instructor: '王大明',
  dayOfWeek: 1, startPeriod: 3, endPeriod: 4,
});
const DS_B = makeCourse(102, {
  name: '資料結構', catalogCourseCode: 'IECS2001', instructor: '李小華',
  dayOfWeek: 3, startPeriod: 3, endPeriod: 4,
});
const OS = makeCourse(103, {
  name: '作業系統', catalogCourseCode: 'IECS3002', instructor: '王大明',
  dayOfWeek: 2, startPeriod: 3, endPeriod: 4,
});
const NET = makeCourse(104, {
  name: '計算機網路', catalogCourseCode: 'IECS3005', instructor: '張三',
  dayOfWeek: 4, startPeriod: 3, endPeriod: 4,
});

const CANDIDATES = [DS_A, DS_B, OS, NET];

// 走 `constraintService` 而不是手捏 constraints，順便確認欄位真的接得上。
async function scheduleWith(avoidances, extra = {}) {
  const sessionAvoidances = await resolveSessionAvoidances(avoidances, async () => CANDIDATES);
  const constraints = buildScheduleConstraints({ ...extra, sessionAvoidances }, {}, {});
  return generateSchedule(CANDIDATES, constraints);
}

function excludedIds(result) {
  return (result.excludedCourses || [])
    .filter(item => item.constraintId === 'USER_REMOVED_THIS_SESSION')
    .map(item => Number(item.course?.id));
}

describe('SA1-SA3 避開範圍由退課原因決定', () => {
  test('SA1 因內容移除 → 同課號的**所有**班次都被排除', async () => {
    const result = await scheduleWith([{ sectionId: 101, reason: 'content' }]);
    const removed = excludedIds(result);

    assert.ok(removed.includes(101), '被移除的班次本身要排除');
    assert.ok(removed.includes(102), '同課號的另一個班次也要排除');
    assert.ok(!removed.includes(103), '不相干的課不受影響');
  });

  test('SA2 因時段移除 → 只排除該班次，同課號的其他班次仍可排', async () => {
    const result = await scheduleWith([{ sectionId: 101, reason: 'time' }]);
    const removed = excludedIds(result);

    assert.deepEqual(removed, [101]);
  });

  test('SA3 因教師移除 → 排除該教師的班次，其他教師的同課仍可排', async () => {
    const result = await scheduleWith([{ sectionId: 101, reason: 'instructor' }]);
    const removed = excludedIds(result);

    assert.ok(removed.includes(101), '該教師的這門課');
    assert.ok(removed.includes(103), '同一位教師開的另一門課也避開');
    assert.ok(!removed.includes(102), '別的教師開的同課程仍可排');
  });

  test('SA3b 原因未知時保守處理，只排除該班次', async () => {
    const result = await scheduleWith([{ sectionId: 101, reason: null }]);
    assert.deepEqual(excludedIds(result), [101]);
  });
});

describe('SA4 explicitCourseIds 不是必排硬限制', () => {
  // `collectExplicitCourseIds()` 把 `explicitCourseIds`、`selectedCourseIds`、
  // `mustTakeCourseIds` 合併成同一個集合，用途只是讓課程繞過資格與學期過濾。
  // 若避開清單讓位給它，使用者在 SchedulePage 移除課程後重排（那一頁每次都把
  // 目前課表當 `courseIds` 重送、後端再併進 `explicitCourseIds`），那門課會
  // 原封不動被保留——正是這次要修的症狀。
  test('SA4 被 explicitCourseIds 指名的課仍然會被避開', async () => {
    const result = await scheduleWith(
      [{ sectionId: 101, reason: 'time' }],
      { explicitCourseIds: [101] }
    );

    assert.deepEqual(excludedIds(result), [101]);
    assert.ok(!result.schedule.some(course => Number(course.id) === 101));
  });

  test('SA4b 被 selectedCourseIds 指名的課則不得靜默移除，改為保留並警告', async () => {
    const result = await scheduleWith(
      [{ sectionId: 101, reason: 'time' }],
      { selectedCourseIds: [101] }
    );

    assert.deepEqual(excludedIds(result), [], '不能被靜默排除');
    const applied = result.appliedSessionAvoidances.find(item => item.sectionId === 101);
    assert.equal(applied.status, 'protected-conflict');
    assert.match(applied.message, /未套用/u);
  });
});

describe('SA5 appliedSessionAvoidances 的回報必須誠實', () => {
  test('SA5 成功避開的回 applied', async () => {
    const result = await scheduleWith([{ sectionId: 101, reason: 'content' }]);
    const applied = result.appliedSessionAvoidances;

    assert.equal(applied.length, 1);
    assert.equal(applied[0].status, 'applied');
    assert.equal(applied[0].scope, 'catalog_course');
    assert.equal(applied[0].message, null);
  });

  test('SA5b 候選池裡找不到對應課程時回 not-found，不謊稱已避開', async () => {
    const result = await scheduleWith([{ sectionId: 9999, reason: 'time' }]);
    const applied = result.appliedSessionAvoidances;

    assert.equal(applied[0].status, 'not-found');
    assert.match(applied[0].message, /找不到/u);
  });

  test('SA5c pendingReason 由呼叫端決定，不從 reason 推', async () => {
    // 「還沒問到原因」與「使用者說不想講」都是 reason === null，
    // 照 reason 推的話，Agent 每一輪都會把同一個問題再問一次。
    const declined = await scheduleWith([{ sectionId: 101, reason: null, pendingReason: false }]);
    const unasked = await scheduleWith([{ sectionId: 101, reason: null }]);

    assert.equal(declined.appliedSessionAvoidances[0].pendingReason, false);
    assert.equal(unasked.appliedSessionAvoidances[0].pendingReason, true);
  });
});

describe('SA6 沒有避開清單時行為完全不變', () => {
  test('SA6 空清單不產生任何排除，也不產生警告', async () => {
    const withEmpty = await scheduleWith([]);
    const withNothing = generateSchedule(CANDIDATES, buildScheduleConstraints({}, {}, {}));

    assert.deepEqual(excludedIds(withEmpty), []);
    assert.deepEqual(withEmpty.appliedSessionAvoidances, []);
    assert.deepEqual(
      withEmpty.schedule.map(course => Number(course.id)).sort(),
      withNothing.schedule.map(course => Number(course.id)).sort()
    );
  });
});

describe('SA7 課號與教師由伺服器解析，不收呼叫端送的字串', () => {
  test('SA7 呼叫端送錯課號也不影響範圍——解析結果來自課程資料', async () => {
    const resolved = await resolveSessionAvoidances(
      [{ sectionId: 101, reason: 'content', catalogCourseCode: 'FAKE9999', instructor: '不存在' }],
      async () => CANDIDATES
    );

    assert.equal(resolved[0].catalogCourseCode, 'IECS2001');
    assert.equal(resolved[0].instructor, '王大明');
    assert.equal(resolved[0].scope, 'catalog_course');
  });

  test('SA7b 課程資料查不到時降級成只排除班次，而不是整包放棄', async () => {
    const resolved = await resolveSessionAvoidances(
      [{ sectionId: 101, reason: 'content' }],
      async () => { throw new Error('DB timeout'); }
    );

    assert.equal(resolved.length, 1);
    assert.equal(resolved[0].catalogCourseCode, null);

    // 課號解析不出來時，`buildSessionAvoidanceRules()` 會把範圍退回 section。
    const constraints = buildScheduleConstraints({ sessionAvoidances: resolved }, {}, {});
    const result = generateSchedule(CANDIDATES, constraints);
    assert.deepEqual(excludedIds(result), [101]);
  });
});
