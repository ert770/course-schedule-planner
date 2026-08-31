// Roadmap #24 驗收標準一：自然語言 golden set。
//
// **這個檔案會真的呼叫模型。** 使用者明確決定要放進 `npm test` 無條件執行，
// 所以以下設計都是為了讓那個決定的代價盡量小：
//
//   - **並行送出**所有題目：總時間約等於最慢的一題（實測單次呼叫 30～60 秒），
//     而不是題數相乘。
//   - **第一次答對就不再打**，最多重試 3 次。順利時 = 題數次呼叫；推理模型
//     偶爾失手才補打，避免整份測試變成間歇性紅燈。
//   - **每次呼叫設逾時**，不讓 `npm test` 無限等待。
//   - 只取模型選的工具與參數，**不執行任何工具**——不碰資料庫、不寫入任何東西。
//
// 沒有 `OPENAI_API_KEY` 時直接失敗並說明「這是環境未設定，不是程式壞掉」。
// 既然是無條件執行，缺 key 就該講清楚而不是靜默跳過。
//
// 斷言邏輯本身在 `src/services/goldenSetAssertions.js`，是純函式、另外測。

// 這個檔案直接呼叫模型，需要 server/.env 的 OPENAI_API_KEY；
// 其他測試不碰網路，所以只有這裡載入 dotenv。
import 'dotenv/config';
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import OpenAI from 'openai';

import { buildSystemPrompt, getAgentTools } from '../src/services/promptService.js';
import { checkExpectation, summarizeGoldenSet } from '../src/services/goldenSetAssertions.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, 'fixtures', 'agentGoldenSet.json'), 'utf8')
);

const MAX_ATTEMPTS = 3;
const CALL_TIMEOUT_MS = 90_000;
// 每題最差 3 次呼叫、題目並行，留足夠餘裕給最慢的那一題。
const SUITE_TIMEOUT_MS = 5 * 60_000;

// 用一份「什麼都沒設定」的 profile，讓題目本身成為唯一的輸入來源。
// 若用 demo 帳號的真實偏好，模型可能從 prompt 的偏好摘要抄答案，
// 題目就測不到「它有沒有讀懂這句話」。
const EMPTY_PREFS = {};

let client;
let results;

async function askModel(utterance) {
  const response = await client.responses.create({
    model: process.env.OPENAI_MODEL || 'gpt-5.6-luna',
    instructions: buildSystemPrompt(EMPTY_PREFS),
    input: [{ role: 'user', content: utterance }],
    tools: getAgentTools(),
    tool_choice: 'auto',
  }, { timeout: CALL_TIMEOUT_MS });

  const call = (response.output || []).find(item => item.type === 'function_call');
  if (!call) return null;

  let args = {};
  try {
    args = JSON.parse(call.arguments || '{}');
  } catch {
    args = {};
  }
  return { name: call.name, args };
}

async function runCase(testCase) {
  let lastFailures = ['模型沒有呼叫任何工具'];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let call = null;
    try {
      call = await askModel(testCase.utterance);
    } catch (err) {
      lastFailures = [`呼叫模型失敗：${err.message}`];
      continue;
    }

    const { pass, failures } = checkExpectation(call, testCase.expect);
    if (pass) return { utterance: testCase.utterance, pass: true, attempts: attempt, failures: [] };
    lastFailures = failures;
  }

  return {
    utterance: testCase.utterance,
    pass: false,
    attempts: MAX_ATTEMPTS,
    failures: lastFailures,
  };
}

describe('GS 自然語言 golden set（會實際呼叫模型）', { timeout: SUITE_TIMEOUT_MS }, () => {
  before(async () => {
    assert.ok(
      process.env.OPENAI_API_KEY,
      'golden set 需要 OPENAI_API_KEY。這是環境未設定，不是程式壞掉——'
        + '請在 server/.env 設定後再跑，或改用有開關的執行方式。'
    );
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0 });

    // 所有題目並行；總時間約等於最慢的一題。
    results = await Promise.all(fixture.cases.map(runCase));
  });

  for (const [index, testCase] of fixture.cases.entries()) {
    test(`${testCase.id}：${testCase.utterance}`, () => {
      const result = results[index];
      assert.ok(
        result.pass,
        `${testCase.why}\n  失敗原因：${result.failures.join('；')}\n  （已重試 ${result.attempts} 次）`
      );
    });
  }

  // Roadmap #24 驗收標準四的前半句：「同一句需求重跑能得到相同結構化結果」。
  //
  // 模型本身**不是**確定性的（此模型連 temperature 都不接受），所以這裡不是靠
  // 讓它變確定，而是靠把輸出空間縮到「每個意思只有一種寫法」：
  // interpretation 全部改用代號、學分不得從偏好摘要抄。
  //
  // 實測改造前同一句話跑三次，語意判斷完全一致，但自由文字有三種寫法、學分
  // 有時抄有時不抄——變異全部來自寫法而非理解。這個測試就是釘住那件事。
  test('同一句話重跑三次得到逐位元相同的結構化結果', async () => {
    // **題目必須是無歧義的。** 最早用的是「午休可以彈性」，實測四輪有一輪不一致
    // ——那句話本身就能解讀成「要保留午休但可放寬」或「午休不用保留」，模型在
    // 兩者間搖擺是合理的，不是不穩定。同句重跑的一致性只對明確的需求成立，
    // 這是句子的性質，不是系統的缺陷。
    const utterance = '幫我排一份課表，我絕對不要早八。';
    const runs = await Promise.all([1, 2, 3].map(() => askModel(utterance)));

    const serialized = runs.map(call => JSON.stringify({
      tool: call?.name,
      // 鍵排序後比對，避免只是欄位順序不同就被判定為不一致。
      args: call?.args
        ? JSON.stringify(call.args, Object.keys(call.args).sort())
        : null,
    }));

    const detail = serialized.map((x, i) => `  run${i + 1}: ${x}`).join('\n');
    assert.equal(new Set(serialized).size, 1, `三次結果不一致：\n${detail}`);
  });

  test('整體通過率', () => {
    const summary = summarizeGoldenSet(results);
    console.log(
      `\n  golden set：${summary.passed}/${summary.total} 通過`
      + `（${Math.round(summary.passRate * 100)}%）`
    );
    for (const item of summary.failures) {
      console.log(`    ✗ ${item.utterance} → ${item.failures.join('；')}`);
    }
    assert.equal(summary.failed, 0, `${summary.failed} 題未通過`);
  });
});
