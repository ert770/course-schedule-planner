// Agent 工具的單一登記表（Roadmap #25：tool allowlist）。
//
// **為什麼需要這一份**：改用原生 tool calling 之後，工具的定義散在三處，各自
// 維護、沒有互相檢查：
//
//   - `promptService.js` 的 `getAgentTools()`：七個工具的 JSON Schema。
//   - `agentService.js` 的 `executeAgentTool()`：一個對應七個 case 的 switch。
//   - `agentService.js` 的 `RENDERABLE_TOOLS`：四個工具名稱的獨立 Set。
//
// 漏一邊的後果是具體的、已經在其他地方發生過同一種模式：只在 switch 裡而不在
// schema 裡＝模型永遠呼叫不到；只在 schema 裡而不在 switch 裡＝模型呼叫後拿到
// 「不明的函數呼叫」。這份登記表是**唯一來源**，`agentToolRegistry.test.js`
// 釘住它與另外兩處的名稱集合一致；三者中的任一處新增或移除工具卻忘了同步，
// 測試就會失敗。
//
// **這裡只放政策，不放 schema。** 參數的型別、enum、必填欄位仍然定義在
// `promptService.js`——那是模型看得到的介面契約，改動需要連 prompt 措辭一併
//考慮（見 `docs/PROMPT_DESIGN.md` 的「選填欄位的兩個陷阱」）。登記表回答的是
// 「這個工具的結果算不算課表渲染資料」「它會不會寫入」「寫入前要不要兩段式確認」
// 這三個跟 schema 無關的問題。

export const AGENT_TOOL_REGISTRY = Object.freeze([
  Object.freeze({
    name: 'query_course_db',
    // 結果要不要覆蓋回應信封的 data（畫面上顯示的課表／課程清單）。
    renderable: true,
    // 這個工具本身會不會寫入任何持久化狀態。
    writes: false,
    // 寫入需要的兩段式確認設定；不寫入的工具固定為 null。
    confirmation: null,
  }),
  Object.freeze({
    name: 'search_dcard_reviews',
    renderable: true,
    writes: false,
    confirmation: null,
  }),
  Object.freeze({
    name: 'get_easy_courses',
    renderable: true,
    writes: false,
    confirmation: null,
  }),
  Object.freeze({
    name: 'update_preferences',
    // 只是確認訊息；讓它覆蓋 data 會把畫面上已顯示的課表洗掉。
    renderable: false,
    writes: true,
    confirmation: Object.freeze({ changeType: 'preferences' }),
  }),
  Object.freeze({
    name: 'update_student_profile',
    renderable: false,
    writes: true,
    confirmation: Object.freeze({ changeType: 'profile-scope' }),
  }),
  Object.freeze({
    name: 'run_csp_scheduler',
    renderable: true,
    // 排課本身不直接寫入 Profile／偏好；曝光事件由 `scheduleService` 另外記錄，
    // 不屬於這裡定義的「工具本身的寫入」。
    writes: false,
    confirmation: null,
  }),
  Object.freeze({
    name: 'record_schedule_feedback',
    // 只是確認訊息，同 update_preferences 的理由。
    renderable: false,
    writes: true,
    confirmation: null,
  }),
]);

const BY_NAME = new Map(AGENT_TOOL_REGISTRY.map(entry => [entry.name, entry]));

export function getToolRegistryEntry(name) {
  return BY_NAME.get(name) ?? null;
}

export function isRenderableTool(name) {
  return getToolRegistryEntry(name)?.renderable === true;
}

export function getConfirmationChangeType(name) {
  return getToolRegistryEntry(name)?.confirmation?.changeType ?? null;
}

// 所有需要兩段式確認的 changeType，供 prompt 組裝「待確認變更」區塊時使用
// （取代原本寫死的 `['preferences', 'profile-scope']`）。
export function listConfirmationChangeTypes() {
  return AGENT_TOOL_REGISTRY
    .map(entry => entry.confirmation?.changeType)
    .filter(Boolean);
}

export function listToolNames() {
  return AGENT_TOOL_REGISTRY.map(entry => entry.name);
}

export default {
  AGENT_TOOL_REGISTRY,
  getToolRegistryEntry,
  isRenderableTool,
  getConfirmationChangeType,
  listConfirmationChangeTypes,
  listToolNames,
};
