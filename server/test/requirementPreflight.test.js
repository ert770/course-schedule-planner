// Roadmap #24：排課前矛盾偵測的純函式測試。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  checkPreflightContradictions,
  courseIntersectsBlockedPeriods,
} from '../src/services/requirementPreflight.js';
import { buildClarification } from '../src/skills/scheduler.js';

const resolvedScope = { department: '資訊工程學系', grade: 3, resolved: true };

describe('RP1 系所／年級無法解析時先問', () => {
  test('resolved 為 false 時產生 confirm-student-scope', () => {
    const result = checkPreflightContradictions({ studentScope: { resolved: false } });

    assert.equal(result.required, true);
    assert.equal(result.reason, 'pre-scheduling-contradiction');
    assert.equal(result.questions.length, 1);
    assert.equal(result.questions[0].id, 'confirm-student-scope');
    assert.deepEqual(result.questions[0].constraintIds, ['REQUIRED_COURSE_COVERAGE']);
  });

  // 系所填了但對不到對照表，跟根本沒填是不同的處境，問法也該不同。
  test('系所對不到對照表時給不同的提示文字', () => {
    const unmapped = checkPreflightContradictions({
      studentScope: { resolved: false, departmentUnmapped: true },
    });
    const missing = checkPreflightContradictions({ studentScope: { resolved: false } });

    assert.match(unmapped.questions[0].prompt, /對照表/);
    assert.notEqual(unmapped.questions[0].prompt, missing.questions[0].prompt);
  });

  test('scope 正常且無其他矛盾時 required 為 false', () => {
    const result = checkPreflightContradictions({ studentScope: resolvedScope });

    assert.equal(result.required, false);
    assert.equal(result.reason, null);
    assert.deepEqual(result.questions, []);
  });
});

describe('RP2 必修課與自訂封鎖時段互相矛盾', () => {
  const course = { id: 55, name: '資料結構', dayOfWeek: 1, startPeriod: 3, endPeriod: 4 };

  test('落在封鎖時段內時產生 confirm-required-course-conflict', () => {
    const result = checkPreflightContradictions({
      constraints: { mustTakeCourseIds: [55], blockedPeriods: [{ day: 1, period: 4 }] },
      studentScope: resolvedScope,
      courseById: new Map([[55, course]]),
    });

    assert.equal(result.required, true);
    assert.equal(result.questions[0].id, 'confirm-required-course-conflict');
    assert.match(result.questions[0].prompt, /資料結構/);
    assert.deepEqual(result.relatedCourseIds, [55]);
  });

  test('不同天不算衝突', () => {
    const result = checkPreflightContradictions({
      constraints: { mustTakeCourseIds: [55], blockedPeriods: [{ day: 2, period: 4 }] },
      studentScope: resolvedScope,
      courseById: new Map([[55, course]]),
    });

    assert.equal(result.required, false);
  });

  // Z5（TEST_PLAN）已經在排課層處理「id 根本不存在」，這一層不重複檢查，
  // 只要確認它不會因為查不到課而誤報或炸掉。
  test('查不到的課程 id 靜默略過，不誤報也不丟例外', () => {
    const result = checkPreflightContradictions({
      constraints: { mustTakeCourseIds: [999], blockedPeriods: [{ day: 1, period: 4 }] },
      studentScope: resolvedScope,
      courseById: new Map(),
    });

    assert.equal(result.required, false);
  });
});

describe('RP3 時段比對的欄位語意', () => {
  // `timeBlocks` 用 `dayOfWeek`，`blockedPeriods` 正規化後用 `day`——
  // 兩者混用會靜默失效，因此明確釘住。
  test('多時段課程只要有一段落入封鎖時段就算衝突', () => {
    const course = {
      id: 7,
      name: '多時段課',
      timeBlocks: [
        { dayOfWeek: 4, startPeriod: 1, endPeriod: 4 },
        { dayOfWeek: 5, startPeriod: 6, endPeriod: 9 },
      ],
    };

    assert.equal(courseIntersectsBlockedPeriods(course, [{ day: 5, period: 7 }]), true);
    assert.equal(courseIntersectsBlockedPeriods(course, [{ day: 3, period: 7 }]), false);
  });

  test('沒有封鎖時段時一律不衝突', () => {
    const course = { dayOfWeek: 1, startPeriod: 1, endPeriod: 2 };

    assert.equal(courseIntersectsBlockedPeriods(course, []), false);
    assert.equal(courseIntersectsBlockedPeriods(course, undefined), false);
  });

  test('沒有時間資訊的課程不會被誤判', () => {
    assert.equal(courseIntersectsBlockedPeriods({ id: 1 }, [{ day: 1, period: 1 }]), false);
  });
});

describe('RP4 與 #22 的 clarification 形狀相容', () => {
  // 兩個澄清產生器的回傳形狀必須一致，模型既有的 #22 指令才能原封不動套用。
  // 任何一邊日後多加或少掉欄位，這個測試會先擋下來。
  test('與 buildClarification() 的欄位完全一致', () => {
    const preflight = checkPreflightContradictions({ studentScope: { resolved: false } });
    const scheduler = buildClarification('data-insufficient', [], []);

    assert.deepEqual(Object.keys(preflight).sort(), Object.keys(scheduler).sort());
  });

  test('問題物件的欄位也一致', () => {
    const preflight = checkPreflightContradictions({ studentScope: { resolved: false } });
    const scheduler = buildClarification('data-insufficient', [], []);

    assert.ok(scheduler.questions.length > 0, '需要一個實際的 #22 問題來比對');
    assert.deepEqual(
      Object.keys(preflight.questions[0]).sort(),
      Object.keys(scheduler.questions[0]).sort()
    );
  });
});

// ---------------------------------------------------------------------------
// Roadmap #24 第二輪：結構性矛盾偵測補完整。
//
// 「結構性矛盾」= 數字、時段、集合互相打架，可以窮舉、可以宣告完整。
// 每一項都有正例（該擋）與反例（不該誤報）。
// ---------------------------------------------------------------------------

const ok = { studentScope: resolvedScope };
const ids = result => result.questions.map(q => q.id);

describe('RP5 學分區間自相矛盾', () => {
  test('最少 20 但最多 15 → 擋下', () => {
    const r = checkPreflightContradictions({ ...ok, constraints: { minCredits: 20, maxCredits: 15 } });

    assert.equal(r.required, true);
    assert.ok(ids(r).includes('confirm-credit-range'));
  });

  test('最少 15 最多 20 → 不誤報', () => {
    const r = checkPreflightContradictions({ ...ok, constraints: { minCredits: 15, maxCredits: 20 } });

    assert.equal(r.required, false);
  });

  test('相等也合法', () => {
    const r = checkPreflightContradictions({ ...ok, constraints: { minCredits: 18, maxCredits: 18 } });

    assert.equal(r.required, false);
  });

  test('負學分擋下', () => {
    const r = checkPreflightContradictions({ ...ok, constraints: { minCredits: -3 } });

    assert.ok(ids(r).includes('confirm-credit-range'));
  });

  test('只給其中一個不比對', () => {
    assert.equal(checkPreflightContradictions({ ...ok, constraints: { maxCredits: 20 } }).required, false);
  });
});

describe('RP6 每日課程數上限', () => {
  test('0 門代表一門都不能排 → 擋下', () => {
    const r = checkPreflightContradictions({ ...ok, constraints: { maxCoursesPerDay: 0 } });

    assert.ok(ids(r).includes('confirm-daily-cap'));
  });

  test('正常值不誤報', () => {
    assert.equal(
      checkPreflightContradictions({ ...ok, constraints: { maxCoursesPerDay: 4 } }).required,
      false
    );
  });
});

describe('RP7 指定必修彼此衝堂', () => {
  const a = { id: 1, name: '甲課', dayOfWeek: 1, startPeriod: 3, endPeriod: 4, credits: 3 };
  const b = { id: 2, name: '乙課', dayOfWeek: 1, startPeriod: 4, endPeriod: 5, credits: 3 };
  const c = { id: 3, name: '丙課', dayOfWeek: 2, startPeriod: 3, endPeriod: 4, credits: 3 };

  test('兩門指定必修撞在一起 → 擋下並列出兩門', () => {
    const r = checkPreflightContradictions({
      ...ok,
      constraints: { mustTakeCourseIds: [1, 2] },
      courseById: new Map([[1, a], [2, b]]),
    });

    assert.ok(ids(r).includes('confirm-required-course-conflict'));
    assert.deepEqual(r.relatedCourseIds.sort(), [1, 2]);
  });

  test('不同天不誤報', () => {
    const r = checkPreflightContradictions({
      ...ok,
      constraints: { mustTakeCourseIds: [1, 3] },
      courseById: new Map([[1, a], [3, c]]),
    });

    assert.equal(r.required, false);
  });
});

describe('RP8 指定必修的學分超過上限', () => {
  const heavy = n => ({ id: n, name: `課${n}`, credits: 4, dayOfWeek: n, startPeriod: 1, endPeriod: 2 });

  test('合計超過 maxCredits → 擋下', () => {
    const r = checkPreflightContradictions({
      ...ok,
      constraints: { mustTakeCourseIds: [1, 2, 3], maxCredits: 9 },
      courseById: new Map([[1, heavy(1)], [2, heavy(2)], [3, heavy(3)]]),
    });

    assert.ok(ids(r).includes('confirm-credit-range'));
  });

  test('剛好等於上限不誤報', () => {
    const r = checkPreflightContradictions({
      ...ok,
      constraints: { mustTakeCourseIds: [1, 2], maxCredits: 8 },
      courseById: new Map([[1, heavy(1)], [2, heavy(2)]]),
    });

    assert.equal(r.required, false);
  });
});

describe('RP9 指定必修不在本學期', () => {
  test('舊學期的課擋下', () => {
    const stale = { id: 9, name: '舊課', academicYear: 110, semester: '1', dayOfWeek: 1, startPeriod: 3, endPeriod: 4 };
    const r = checkPreflightContradictions({
      ...ok,
      constraints: { mustTakeCourseIds: [9] },
      courseById: new Map([[9, stale]]),
    });

    assert.ok(ids(r).includes('confirm-course-term'));
  });

  // 沒有標學年學期的課視為本學期（相容既有無 term 資料），不該被誤擋。
  test('沒有 term 欄位的課不誤報', () => {
    const r = checkPreflightContradictions({
      ...ok,
      constraints: { mustTakeCourseIds: [9] },
      courseById: new Map([[9, { id: 9, name: '無標註', dayOfWeek: 1, startPeriod: 3, endPeriod: 4 }]]),
    });

    assert.equal(r.required, false);
  });
});

describe('RP10 已選課程撞封鎖時段', () => {
  const picked = { id: 20, name: '已選課', dayOfWeek: 3, startPeriod: 6, endPeriod: 7 };

  test('撞到 → 擋下', () => {
    const r = checkPreflightContradictions({
      ...ok,
      constraints: { selectedCourseIds: [20], blockedPeriods: [{ day: 3, period: 6 }] },
      courseById: new Map([[20, picked]]),
    });

    assert.ok(ids(r).includes('confirm-selected-course-conflict'));
  });

  test('沒撞到不誤報', () => {
    const r = checkPreflightContradictions({
      ...ok,
      constraints: { selectedCourseIds: [20], blockedPeriods: [{ day: 4, period: 6 }] },
      courseById: new Map([[20, picked]]),
    });

    assert.equal(r.required, false);
  });
});

describe('RP11 時段偏好把可用節次清空', () => {
  // 週一到週五 × 14 節全部封鎖 → 一個節次都不剩。
  const everySlot = [];
  for (let day = 1; day <= 5; day += 1) {
    for (let period = 1; period <= 14; period += 1) everySlot.push({ day, period });
  }

  test('全部封鎖 → 擋下', () => {
    const r = checkPreflightContradictions({ ...ok, constraints: { blockedPeriods: everySlot } });

    assert.ok(ids(r).includes('confirm-time-preferences'));
  });

  test('留一個節次就不算矛盾', () => {
    const r = checkPreflightContradictions({
      ...ok,
      constraints: { blockedPeriods: everySlot.slice(0, -1) },
    });

    assert.equal(r.required, false);
  });

  test('只開三個時段偏好不會清空（仍有其他節次）', () => {
    const r = checkPreflightContradictions({
      ...ok,
      constraints: { noMorningClasses: true, lunchBreakFree: true, noEveningClasses: true },
    });

    assert.equal(r.required, false);
  });
});

describe('RP12 指名不可放寬但該偏好沒開', () => {
  test('列了 NO_MORNING_CLASSES 卻沒設 noMorningClasses → 擋下', () => {
    const r = checkPreflightContradictions({
      ...ok,
      constraints: { nonNegotiablePreferenceIds: ['NO_MORNING_CLASSES'] },
    });

    assert.ok(ids(r).includes('confirm-preference-strength'));
  });

  test('偏好有開就不誤報', () => {
    const r = checkPreflightContradictions({
      ...ok,
      constraints: { nonNegotiablePreferenceIds: ['NO_MORNING_CLASSES'], noMorningClasses: true },
    });

    assert.equal(r.required, false);
  });
});

// 回講改用代號之後是代號直接比對，不再靠關鍵字猜。
describe('RP13 理解回講與實際參數必須一致', () => {
  // 模型對使用者說「絕對不排早八」，參數卻沒把它設成硬性限制——排出來的課表
  // 會與它自己剛剛講的話不符。這是模型前後矛盾，退回去讓它修。
  test('說了絕對不排早八卻沒開該限制 → 擋下', () => {
    const r = checkPreflightContradictions({
      ...ok,
      constraints: { interpretation: { nonNegotiable: ['NO_MORNING_CLASSES'] } },
    });

    assert.ok(ids(r).includes('confirm-interpretation-mismatch'));
  });

  test('說了也確實設好了 → 不誤報', () => {
    const r = checkPreflightContradictions({
      ...ok,
      constraints: {
        interpretation: { nonNegotiable: ['NO_MORNING_CLASSES'] },
        noMorningClasses: true,
        nonNegotiablePreferenceIds: ['NO_MORNING_CLASSES'],
      },
    });

    assert.equal(r.required, false);
  });

  // 開了偏好但沒列進 nonNegotiablePreferenceIds，等於還是可能被自動放寬，
  // 與「絕對」不符。
  test('只開偏好但沒列進不可放寬清單 → 仍擋下', () => {
    const r = checkPreflightContradictions({
      ...ok,
      constraints: {
        interpretation: { nonNegotiable: ['NO_MORNING_CLASSES'] },
        noMorningClasses: true,
      },
    });

    assert.ok(ids(r).includes('confirm-interpretation-mismatch'));
  });

  test('放在 flexible 而非 nonNegotiable 不觸發檢查', () => {
    const r = checkPreflightContradictions({
      ...ok,
      constraints: { interpretation: { nonNegotiable: [], flexible: ['NO_MORNING_CLASSES'] } },
    });

    assert.equal(r.required, false);
  });

  test('沒有 interpretation 時不檢查（其他呼叫端不受影響）', () => {
    assert.equal(checkPreflightContradictions({ ...ok, constraints: {} }).required, false);
  });
});
