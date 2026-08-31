// Roadmap #24：golden set 的斷言邏輯。
//
// **為什麼與呼叫模型的部分分開**：這裡是純函式，可以用假資料徹底測過；
// 真正打 API 的部分（`test/agentGoldenSet.test.js`）就只剩「送出去、拿回來」
// 這件事，不會把判斷邏輯的 bug 誤判成模型答錯。
//
// **為什麼斷言的是語意性質而不是逐字相同**：即使 model id 固定
// （`gpt-5.6-luna`），推理模型的輸出本來就不保證每次一模一樣，而且這個模型
// 不吃 `temperature`。要求逐字重現只會做出一個間歇性失敗的測試——那比沒有
// 測試更糟，因為大家會開始習慣忽略紅燈。
//
// 所以每題只斷言「這次解析有沒有抓到該抓的重點」：該設的旗標有沒有設、
// 該進清單的值有沒有進去、有沒有挑對工具。

function has(container, value) {
  if (!Array.isArray(container)) return false;
  return container.some(item => String(item).includes(value) || value.includes(String(item)));
}

/**
 * 檢查一次工具呼叫是否滿足題目的期望。
 *
 * @param call   `{ name, args }`——模型實際選的工具與參數。
 * @param expect 題庫裡的期望描述，四種斷言可任意組合：
 *               `tool`（該選哪個工具）、
 *               `params`（某些參數必須等於指定值）、
 *               `includes`（某個陣列參數必須含有某個值）、
 *               `absent`（某些參數不該出現，用來擋「自行假設」）。
 * @returns `{ pass, failures }`——`failures` 是人看得懂的原因，直接印給使用者。
 */
export function checkExpectation(call, expect = {}) {
  const failures = [];
  const args = call?.args ?? {};

  if (expect.tool && call?.name !== expect.tool) {
    failures.push(`應該呼叫 ${expect.tool}，實際呼叫 ${call?.name ?? '（沒有呼叫工具）'}`);
    // 工具都選錯了，後面的參數比對沒有意義。
    return { pass: false, failures };
  }

  for (const [key, want] of Object.entries(expect.params ?? {})) {
    if (args[key] !== want) {
      failures.push(`${key} 應為 ${JSON.stringify(want)}，實際為 ${JSON.stringify(args[key])}`);
    }
  }

  for (const [key, want] of Object.entries(expect.includes ?? {})) {
    if (!has(args[key], want)) {
      failures.push(`${key} 應含有「${want}」，實際為 ${JSON.stringify(args[key])}`);
    }
  }

  for (const key of expect.absent ?? []) {
    if (args[key] !== undefined) {
      failures.push(`${key} 不該被設定（使用者沒提到），實際為 ${JSON.stringify(args[key])}`);
    }
  }

  return { pass: failures.length === 0, failures };
}

/**
 * 把一輪結果整理成可讀的通過率報告。
 *
 * @param results `[{ utterance, pass, attempts, failures }]`
 */
export function summarizeGoldenSet(results = []) {
  const passed = results.filter(r => r.pass).length;
  return {
    total: results.length,
    passed,
    failed: results.length - passed,
    // 0 題時算 1 而不是 NaN——沒有題目不代表通過率是「未定義」。
    passRate: results.length === 0 ? 1 : passed / results.length,
    failures: results.filter(r => !r.pass).map(r => ({
      utterance: r.utterance,
      attempts: r.attempts,
      failures: r.failures,
    })),
  };
}

export default { checkExpectation, summarizeGoldenSet };
