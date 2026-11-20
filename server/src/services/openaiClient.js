// 「單次呼叫」用的 OpenAI client：設定頁的追問題目這類一次性、結構化輸出的呼叫。
//
// 與聊天 Agent（`agentService.js`）分開，因為需求不同：聊天是多步的工具呼叫迴圈，可以容忍重試；
// 這裡是使用者按下「保存」後等著的一次呼叫，**不重試**（`maxRetries: 0`），逾時由呼叫端用
// `{ timeout }` 逐次指定，失敗就改用固定問句，不能讓使用者多等。
//
// model id 一律由環境變數決定，不寫死在程式裡。fallback 值刻意與 `.env.example` 和
// `agentService.js` 一致：哪天 `.env` 少了這一行，系統用同一個模型，而不是靜默改用另一個。

import OpenAI from 'openai';

let client = null;

export function getOpenAIModel() {
  return process.env.OPENAI_MODEL || 'gpt-5.6-luna';
}

/** 沒有 OPENAI_API_KEY 時回 null（呼叫端必須有不用 OpenAI 的後備）。 */
export function getOpenAIClient() {
  if (!client && process.env.OPENAI_API_KEY) {
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0 });
  }
  return client;
}

export function resetOpenAIClientForTests() {
  client = null;
}

export default { getOpenAIModel, getOpenAIClient, resetOpenAIClientForTests };
