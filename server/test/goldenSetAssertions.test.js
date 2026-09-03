// Roadmap #24：golden set 斷言邏輯的純函式測試。
//
// 與實際呼叫模型的 `agentGoldenSet.test.js` 分開，是為了讓「判斷邏輯有沒有寫對」
// 這件事不需要網路也不需要花錢就能驗——否則判斷邏輯的 bug 會被誤讀成模型答錯。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { checkExpectation, summarizeGoldenSet } from '../src/services/goldenSetAssertions.js';

describe('GA1 工具選擇', () => {
  test('選對工具即通過', () => {
    const r = checkExpectation({ name: 'run_csp_scheduler', args: {} }, { tool: 'run_csp_scheduler' });

    assert.equal(r.pass, true);
  });

  test('選錯工具直接失敗，且不再比對參數', () => {
    const r = checkExpectation(
      { name: 'update_preferences', args: { noMorningClasses: false } },
      { tool: 'run_csp_scheduler', params: { noMorningClasses: true } }
    );

    assert.equal(r.pass, false);
    assert.equal(r.failures.length, 1, '工具都錯了，參數比對沒有意義');
    assert.match(r.failures[0], /run_csp_scheduler/);
  });

  test('完全沒呼叫工具時給得出可讀的原因', () => {
    const r = checkExpectation(null, { tool: 'run_csp_scheduler' });

    assert.equal(r.pass, false);
    assert.match(r.failures[0], /沒有呼叫工具/);
  });
});

describe('GA2 參數值比對', () => {
  test('值相同通過', () => {
    const r = checkExpectation({ name: 't', args: { noMorningClasses: true } }, {
      params: { noMorningClasses: true },
    });

    assert.equal(r.pass, true);
  });

  test('值不同時指出期望與實際', () => {
    const r = checkExpectation({ name: 't', args: { noMorningClasses: false } }, {
      params: { noMorningClasses: true },
    });

    assert.equal(r.pass, false);
    assert.match(r.failures[0], /應為 true/);
    assert.match(r.failures[0], /實際為 false/);
  });

  test('參數根本沒出現也算失敗', () => {
    const r = checkExpectation({ name: 't', args: {} }, { params: { noMorningClasses: true } });

    assert.equal(r.pass, false);
  });
});

describe('GA3 陣列包含比對', () => {
  test('含有指定值即通過', () => {
    const r = checkExpectation(
      { name: 't', args: { nonNegotiablePreferenceIds: ['NO_MORNING_CLASSES'] } },
      { includes: { nonNegotiablePreferenceIds: 'NO_MORNING_CLASSES' } }
    );

    assert.equal(r.pass, true);
  });

  // 興趣類的答案不會逐字相同（「資安」vs「資訊安全」），所以用雙向包含比對。
  test('部分字串相符也算命中', () => {
    assert.equal(
      checkExpectation({ name: 't', args: { interests: ['資訊安全'] } },
        { includes: { interests: '資' } }).pass,
      true
    );
    assert.equal(
      checkExpectation({ name: 't', args: { interests: ['資'] } },
        { includes: { interests: '資訊安全' } }).pass,
      true
    );
  });

  test('不含指定值時失敗', () => {
    const r = checkExpectation({ name: 't', args: { interests: ['音樂'] } }, {
      includes: { interests: '資訊安全' },
    });

    assert.equal(r.pass, false);
  });

  test('欄位不是陣列時失敗而不是丟例外', () => {
    assert.equal(
      checkExpectation({ name: 't', args: { interests: undefined } },
        { includes: { interests: '資安' } }).pass,
      false
    );
  });
});

describe('GA4 不得自行假設的欄位', () => {
  // 使用者什麼都沒提時，模型不該自己補上「不排早八」之類的限制。
  test('沒出現即通過', () => {
    const r = checkExpectation({ name: 't', args: {} }, { absent: ['noMorningClasses'] });

    assert.equal(r.pass, true);
  });

  test('出現了就失敗，即使值是 false', () => {
    const r = checkExpectation({ name: 't', args: { noMorningClasses: false } }, {
      absent: ['noMorningClasses'],
    });

    assert.equal(r.pass, false);
    assert.match(r.failures[0], /不該被設定/);
  });
});

describe('GA5 通過率彙總', () => {
  test('算出通過數與失敗明細', () => {
    const summary = summarizeGoldenSet([
      { utterance: 'A', pass: true, attempts: 1, failures: [] },
      { utterance: 'B', pass: false, attempts: 3, failures: ['x 應為 true'] },
    ]);

    assert.equal(summary.total, 2);
    assert.equal(summary.passed, 1);
    assert.equal(summary.failed, 1);
    assert.equal(summary.passRate, 0.5);
    assert.equal(summary.failures[0].utterance, 'B');
    assert.equal(summary.failures[0].attempts, 3);
  });

  test('沒有題目時通過率是 1 而不是 NaN', () => {
    assert.equal(summarizeGoldenSet([]).passRate, 1);
  });
});
