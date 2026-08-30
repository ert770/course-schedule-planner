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
