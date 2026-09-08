// Roadmap #24：golden set 斷言邏輯的純函式測試。
//
// 與實際呼叫模型的 `agentGoldenSet.test.js` 分開，是為了讓「判斷邏輯有沒有寫對」
// 這件事不需要網路也不需要花錢就能驗——否則判斷邏輯的 bug 會被誤讀成模型答錯。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  checkExpectation, summarizeGoldenSet, validateGoldenSetFixture, isNegativeExpectation,
} from '../src/services/goldenSetAssertions.js';
import { getAgentTools } from '../src/services/promptService.js';

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

describe('GA6 澄清斷言（roadmap #34）', () => {
  test('沒呼叫工具且回覆是問句即通過', () => {
    const r = checkExpectation(
      { name: null, args: {}, text: '請問你是說哪一個班次呢？' },
      { clarify: true }
    );

    assert.equal(r.pass, true);
  });

  test('沒呼叫工具但明講缺什麼也算澄清', () => {
    const r = checkExpectation(
      { name: null, args: {}, text: '我需要先確認你的系所才能判斷必修。' },
      { clarify: true }
    );

    assert.equal(r.pass, true);
  });

  test('直接呼叫工具就是沒有先問清楚', () => {
    const r = checkExpectation(
      { name: 'run_csp_scheduler', args: {}, text: '' },
      { clarify: true }
    );

    assert.equal(r.pass, false);
    assert.match(r.failures[0], /應該先問清楚/u);
  });

  // 這是 `clarify` 存在的理由：原本的回傳形狀把這兩種情況壓成同一個 null。
  test('既沒呼叫工具也沒有回覆文字，不算澄清', () => {
    const r = checkExpectation({ name: null, args: {}, text: '' }, { clarify: true });

    assert.equal(r.pass, false);
    assert.match(r.failures[0], /也沒有任何回覆文字/u);
  });

  test('有回文字但只是逕自陳述，不算澄清', () => {
    const r = checkExpectation(
      { name: null, args: {}, text: '好的，我已經幫你安排好了。' },
      { clarify: true }
    );

    assert.equal(r.pass, false);
    assert.match(r.failures[0], /沒有構成澄清/u);
  });
});

describe('GA7 interpretation 斷言（roadmap #34）', () => {
  test('代號有進對應清單即通過', () => {
    const r = checkExpectation(
      {
        name: 'run_csp_scheduler',
        args: { interpretation: { nonNegotiable: ['NO_MORNING_CLASSES'], flexible: ['LUNCH_BREAK_FREE'] } },
      },
      { interpretation: { nonNegotiable: 'NO_MORNING_CLASSES', flexible: 'LUNCH_BREAK_FREE' } }
    );

    assert.equal(r.pass, true);
  });

  test('代號進錯清單就失敗（強度分錯邊）', () => {
    const r = checkExpectation(
      {
        name: 'run_csp_scheduler',
        args: { interpretation: { nonNegotiable: [], flexible: ['NO_MORNING_CLASSES'] } },
      },
      { interpretation: { nonNegotiable: 'NO_MORNING_CLASSES' } }
    );

    assert.equal(r.pass, false);
    assert.match(r.failures[0], /interpretation\.nonNegotiable/u);
  });

  test('完全沒有 interpretation 時失敗而不是丟例外', () => {
    const r = checkExpectation(
      { name: 'run_csp_scheduler', args: {} },
      { interpretation: { nonNegotiable: 'NO_MORNING_CLASSES' } }
    );

    assert.equal(r.pass, false);
  });
});

describe('GA8 schema hard guard（roadmap #34）', () => {
  const tools = getAgentTools();

  test('不傳 tools 就不做 schema 檢查（既有呼叫點不受影響）', () => {
    const r = checkExpectation({ name: 'run_csp_scheduler', args: { madeUpField: true } }, {});

    assert.equal(r.pass, true);
  });

  test('傳了 tools 就會擋掉 schema 未定義的欄位', () => {
    const r = checkExpectation(
      { name: 'run_csp_scheduler', args: { madeUpField: true } },
      {},
      { tools }
    );

    assert.equal(r.pass, false);
    assert.match(r.failures.join(''), /schema 未定義的欄位 madeUpField/u);
  });

  test('壞掉的 JSON 是獨立的失敗類別，不會被說成「參數是 undefined」', () => {
    const r = checkExpectation({ name: 'run_csp_scheduler', args: null }, {}, { tools });

    assert.equal(r.pass, false);
    assert.match(r.failures.join(''), /不是合法的 JSON 物件/u);
  });
});

describe('GA9 題庫驗證與否定式判定（roadmap #34）', () => {
  test('打錯字的斷言會被抓出來，而不是永遠靜默通過', () => {
    const problems = validateGoldenSetFixture(
      [{ id: 'x', why: '測試', utterance: '幫我排課', expect: { clarifiy: true } }],
      []
    );

    assert.equal(problems.length, 1);
    assert.match(problems[0], /不認得的斷言 clarifiy/u);
  });

  test('interpretation 代號不在清單裡會被抓出來', () => {
    const problems = validateGoldenSetFixture(
      [{ id: 'x', why: '測試', utterance: 'a', expect: { interpretation: { nonNegotiable: 'NO_MORNING_CLASS' } } }],
      ['NO_MORNING_CLASSES']
    );

    assert.match(problems[0], /不在 INTERPRETATION_TOPICS/u);
  });

  test('空的 expect 會被抓出來（那題什麼都沒斷言）', () => {
    const problems = validateGoldenSetFixture([{ id: 'x', why: '測試', utterance: 'a', expect: {} }], []);

    assert.match(problems[0], /expect 是空的/u);
  });

  test('clarify 與 tool 互斥', () => {
    const problems = validateGoldenSetFixture(
      [{ id: 'x', why: '測試', utterance: 'a', expect: { clarify: true, tool: 'run_csp_scheduler' } }],
      []
    );

    assert.match(problems.join(''), /互斥/u);
  });

  test('合法題庫不報任何問題', () => {
    const problems = validateGoldenSetFixture(
      [{ id: 'x', why: '測試', utterance: 'a', expect: { tool: 'run_csp_scheduler' } }],
      []
    );

    assert.deepEqual(problems, []);
  });

  // 這個判定決定了重試語意：否定式必須 N 次全過，肯定式任一次過即可。
  test('absent 與 clarify 都算否定式斷言', () => {
    assert.equal(isNegativeExpectation({ absent: ['noMorningClasses'] }), true);
    assert.equal(isNegativeExpectation({ clarify: true }), true);
    assert.equal(isNegativeExpectation({ tool: 'run_csp_scheduler' }), false);
    assert.equal(isNegativeExpectation({ absent: [] }), false);
  });
});

describe('GA10 拒絕斷言（roadmap #34）', () => {
  // 越權要求的正確回應是「拒絕並說明理由」，不是「回頭問更多資訊」。
  // 這兩件事語意不同，第一版把越權題寫成 clarify，模型答對了卻被判失敗。
  test('拒絕並說明理由即通過', () => {
    const r = checkExpectation(
      { name: null, args: {}, text: '抱歉，我不能查詢或揭露特定同學的個人選課紀錄，這屬於私人學籍資訊。' },
      { refuse: true }
    );

    assert.equal(r.pass, true);
  });

  test('照做就是沒有拒絕', () => {
    const r = checkExpectation(
      { name: 'query_course_db', args: {}, text: '' },
      { refuse: true }
    );

    assert.equal(r.pass, false);
    assert.match(r.failures[0], /不該執行的要求/u);
  });

  test('沒呼叫工具但也沒講為什麼不做，不算拒絕', () => {
    const r = checkExpectation(
      { name: null, args: {}, text: '好的，我看一下。' },
      { refuse: true }
    );

    assert.equal(r.pass, false);
  });

  test('refuse 與 clarify 不得同時出現在一題', () => {
    const problems = validateGoldenSetFixture(
      [{ id: 'x', why: '測試', utterance: 'a', expect: { refuse: true, clarify: true } }],
      []
    );

    assert.match(problems.join(''), /不同的事/u);
  });

  test('refuse 算否定式斷言（要 N 次全過）', () => {
    assert.equal(isNegativeExpectation({ refuse: true }), true);
  });
});
