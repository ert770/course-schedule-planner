// Roadmap #34：golden set 的「送出去、拿回來」層。
//
// 與 `goldenSetAssertions.js`（判斷對錯）分開，也與 `test/agentGoldenSet.test.js`
// （每次 npm test 跑的那幾題）分開——因為離線 eval（`npm run eval:golden-set`）
// 需要跑同樣的題目加上多輪題，兩邊各寫一份 `askModel` 遲早會漂移。
//
// 這一層不做斷言、不寫檔、不決定哪些題要跑，只負責：把題目送給模型、必要時把
// 工具結果串回去續談、回報每次嘗試的結果。

import { buildSystemPrompt, getAgentTools } from './promptService.js';
import { parseToolArguments } from './agentService.js';
import { checkExpectation, isNegativeExpectation } from './goldenSetAssertions.js';

export const MAX_ATTEMPTS = 3;
export const CALL_TIMEOUT_MS = 90_000;

// 用一份「什麼都沒設定」的 profile，讓題目本身成為唯一的輸入來源。
// 若用 demo 帳號的真實偏好，模型可能從 prompt 的偏好摘要抄答案，
// 題目就測不到「它有沒有讀懂這句話」。
export const EMPTY_PREFS = {};

/**
 * 送一次請求給模型。
 *
 * **恆回物件，不回 null**：原本沒有 function_call 時回 `null`，把「模型回了一段
 * 澄清文字」與「模型什麼都沒回」壓成同一個值，而 `output_text` 從頭到尾沒被取
 * 出來——「該問就問」這種斷言在那個形狀上根本表達不出來。
 *
 * @param client OpenAI client
 * @param input  一句話（字串）或完整的 input items 陣列（多輪用）
 */
export async function askModel(client, input) {
  const messages = typeof input === 'string' ? [{ role: 'user', content: input }] : input;
  const response = await client.responses.create({
    model: process.env.OPENAI_MODEL || 'gpt-5.6-luna',
    instructions: buildSystemPrompt(EMPTY_PREFS),
    input: messages,
    tools: getAgentTools(),
    tool_choice: 'auto',
  }, { timeout: CALL_TIMEOUT_MS });

  const call = (response.output || []).find(item => item.type === 'function_call');
  return {
    name: call?.name ?? null,
    // 與生產共用 `parseToolArguments`：自己 JSON.parse + catch 會把「模型吐出壞
    // JSON」靜默變成「呼叫了工具但沒帶參數」，失敗訊息因此指向錯的方向。
    args: call ? parseToolArguments(call.arguments) : {},
    callId: call?.call_id ?? null,
    text: response.output_text || '',
    // 完整 output items（含 reasoning item）留給多輪——Responses API 對「input 裡
    // 有 function_call 卻沒有對應 call_id 的 function_call_output」是直接報錯。
    output: response.output || [],
    // 記 API 解析後的真實 model id，不是送出去的別名——別名隨時可能被指到新快照。
    model: response.model || null,
  };
}

/**
 * 跑一題單輪題目。
 *
 * **重試的語意依斷言方向而不同**（roadmap #34 修掉的既有缺陷）：
 *   - 肯定式：任一次通過就算過，替推理模型偶爾失手降噪。
 *   - 否定式（`absent`／`clarify`）：**每一次都要通過**。對「不該做什麼」而言，
 *     「三次過一次就算過」等於「給模型三次機會不要亂編」——放水放在最需要嚴格
 *     的地方。
 */
export async function runCase(client, testCase) {
  const negative = isNegativeExpectation(testCase.expect);
  const tools = getAgentTools();
  let lastFailures = ['模型沒有呼叫任何工具'];
  let model = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let call = null;
    try {
      call = await askModel(client, testCase.utterance);
      model = call.model ?? model;
    } catch (err) {
      lastFailures = [`呼叫模型失敗：${err.message}`];
      if (negative) break;
      continue;
    }

    const { pass, failures } = checkExpectation(call, testCase.expect, { tools });

    if (negative) {
      if (!pass) {
        lastFailures = failures.map(item => `${item}（第 ${attempt} 次嘗試就違反）`);
        break;
      }
      if (attempt === MAX_ATTEMPTS) {
        return {
          id: testCase.id, utterance: testCase.utterance, pass: true, attempts: attempt, failures: [], model,
        };
      }
      continue;
    }

    if (pass) {
      return {
        id: testCase.id, utterance: testCase.utterance, pass: true, attempts: attempt, failures: [], model,
      };
    }
    lastFailures = failures;
  }

  return {
    id: testCase.id,
    utterance: testCase.utterance,
    pass: false,
    attempts: MAX_ATTEMPTS,
    failures: lastFailures,
    model,
  };
}

/**
 * 跑一題多輪題目。
 *
 * 串接方式與生產的**同一回合多步**一致：把模型的完整 output items 放回 input，
 * 再接上對應 `call_id` 的 `function_call_output`。少了 reasoning item 或
 * call_id 對不上，Responses API 會直接報錯而不是降級。
 *
 * @param toolResultFor `async (call, turnIndex) => envelope | null`
 *        由呼叫端決定第 N 輪的工具結果從哪來（真的跑 preflight、或用罐頭信封）。
 *        回 `null` 代表這一輪模型沒有呼叫工具，下一輪走純文字續談——那與生產的
 *        跨回合形狀一致（工具結果不跨回合保存）。
 */
export async function runMultiTurnCase(client, testCase, toolResultFor) {
  const tools = getAgentTools();
  const input = [];
  const turnResults = [];

  for (const [index, turn] of (testCase.turns ?? []).entries()) {
    // `utterance` 是選填的：有些輪次不是使用者又說了什麼，而是「工具結果餵回去
    // 之後，模型接下來做什麼」——「被 preflight 擋下後有沒有真的回頭問」正是
    // 這種形狀，那一輪沒有新的使用者輸入。
    if (turn.utterance) input.push({ role: 'user', content: turn.utterance });

    let call;
    try {
      call = await askModel(client, input);
    } catch (err) {
      return {
        id: testCase.id,
        pass: false,
        attempts: 1,
        failures: [`第 ${index + 1} 輪呼叫模型失敗：${err.message}`],
        turns: turnResults,
      };
    }

    const { pass, failures } = checkExpectation(call, turn.expect, { tools });
    turnResults.push({
      turn: index + 1, utterance: turn.utterance, pass, failures, tool: call.name,
    });

    if (!pass) {
      return {
        id: testCase.id,
        pass: false,
        attempts: 1,
        failures: failures.map(item => `第 ${index + 1} 輪：${item}`),
        turns: turnResults,
        model: call.model,
      };
    }

    // 還有下一輪才需要把這一輪的結果串回去。
    if (index === testCase.turns.length - 1) {
      return {
        id: testCase.id, pass: true, attempts: 1, failures: [], turns: turnResults, model: call.model,
      };
    }

    if (call.name) {
      const envelope = await toolResultFor(call, index);
      input.push(...call.output);
      input.push({
        type: 'function_call_output',
        call_id: call.callId,
        output: JSON.stringify(envelope),
      });
    } else {
      // 沒有呼叫工具：純文字續談，形狀與生產的跨回合一致。
      input.push({ role: 'assistant', content: call.text });
    }
  }

  return { id: testCase.id, pass: true, attempts: 1, failures: [], turns: turnResults };
}

export default { askModel, runCase, runMultiTurnCase };
