# 2026-08-30 `intent` 不再謊報工具成功，並放寬 Agent 步數上限

## 1. 修改日期

2026-08-30（接續同日的
[AI Agent 改用 OpenAI 與原生 tool calling](./2026-08-30-openai-native-tool-calling.md)）

## 2. 為什麼做這件事

**問題 1：`intent` 與 `data` 會宣稱一件沒有發生的事。**

`agentService.js` 原本在**工具執行之前**就設定 `detectedIntent = call.name`，並且
無條件把可渲染工具的結果寫進 `responseData`。Agent 的工具有伺服器端驗證——
`record_schedule_feedback` 會對照推薦曝光紀錄，`sectionId` 不在那次實際顯示的課表裡
就拒絕——被拒時只回一個 `{ error }` 給模型自行修正，但回應照樣帶
`intent: "record_schedule_feedback"`，而資料庫裡一筆回饋都沒有。`data` 的情況更直接：
會被塞進一個錯誤物件。

當時沒有實際災情：唯二的消費端 `ChatPanel.jsx:47` 與 `DashboardPage.jsx:279` 都寫成
`res.intent === 'run_csp_scheduler' && res.data?.success`，那個 `data?.success` 剛好
擋住了。但那是呼叫端在替上游遮錯——一旦有人照字面相信 `intent`（例如顯示「已記錄你的
回饋」），就會對使用者說謊。

**問題 2：`MAX_STEPS = 8` 太緊。** 一輪完整的回饋流程可能是
`record_schedule_feedback` →（被拒）修正重試 → `run_csp_scheduler` →
`query_course_db` 補資料 → 回覆，很容易逼近上限。

## 3. 修改檔案清單

| 檔案 | 改動 |
| --- | --- |
| `server/src/services/agentService.js` | 新增 `applyToolOutcome()` 與 `resolveMaxSteps()`；迴圈改用兩者；耗盡步數時保留模型已產出的文字並記 warn |
| `server/test/agentTools.test.js` | 新增 AG7（`intent`／`data` 誠實性，5 項）與 AG8（步數上限，4 項） |
| `.env.example` | 新增選填的 `AGENT_MAX_STEPS=12` |
| `docs/API_SPEC.md` | `POST /api/chat` 補上 `reply`／`intent`／`data` 的欄位語意表，並說明被拒的工具不會出現在 `intent`／`data` |
| `docs/PROMPT_DESIGN.md` | 新增「單次請求的步數上限」一節 |
| `docs/CHANGE_REPORTS/2026-08-30-openai-native-tool-calling.md` | 把 `intent` 落差補進「未完成／已知限制」並指向本報告 |

## 4. 主要改動內容

### 4.1 `applyToolOutcome()`：工具成功才更新回應信封

```js
export function applyToolOutcome(envelope, toolName, result) {
  if (result && typeof result === 'object' && result.error) return envelope;
  return {
    intent: toolName || envelope.intent,
    data: RENDERABLE_TOOLS.has(toolName) ? result : envelope.data,
  };
}
```

行為變化：

- 工具被拒時 `intent` 維持前一個成功值（初始為 `general_chat`），`data` 維持前一個
  成功結果，**不會**被錯誤物件蓋掉。
- 非渲染型工具（`record_schedule_feedback`、`update_preferences`）成功時更新 `intent`
  但不動 `data`——否則會把畫面上已顯示的課表洗掉。

抽成**純函式**是為了測得到：`handleChat` 需要真的資料庫（`getUserPreferences()` 走
`getAll()`）加上真的模型呼叫，整條迴圈無法在單元測試裡跑，但這個判斷本身完全不需要
I/O。作法比照 repo 既有的 `scheduleService.loadCourseReviewsSafely()`、
`scheduleFeedbackService` 的 `loadExposure` 與上一輪抽出來的 `executeAgentTool()`。

### 4.2 步數上限：預設 12，可設定，硬性天花板 20

```js
export function resolveMaxSteps(raw = process.env.AGENT_MAX_STEPS) {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1) return DEFAULT_MAX_STEPS; // 12
  return Math.min(parsed, MAX_STEPS_CEILING);                            // 20
}
```

**為什麼要有天花板**：每一步都是一次模型往返，而且 `input` 會持續累積（推理項目 +
工具結果）。不設上限的話，一個卡住的模型會把延遲與費用拉到無界，也會重新逼近同日
剛修好的 context window 問題。設定值寫錯（`AGENT_MAX_STEPS=1000`）不該變成一次
失控的請求。垃圾值（`abc`、`0`、`-3`、空字串）一律退回預設，不會變成 `NaN`。

### 4.3 耗盡步數時不再丟掉模型已寫出的內容

`finalReply` 原本只在「這一輪沒有工具呼叫」時才被賦值，因此踩到上限時模型沿途產出的
文字全部被丟棄、換成罐頭訊息。現在迴圈會記住最後一段非空的 `output_text`，耗盡時
優先用它；真的一個字都沒有才用罐頭訊息。同時補一行 `logger.warn`——這件事先前在
伺服器端完全沒有痕跡，與同日「讓靜默失敗看得見」的處理一致。

## 5. 影響範圍

- `/api/chat` 的回應**欄位不變**，但 `intent`／`data` 的語意收緊為「最後一個**成功**
  的工具」。兩個既有消費端的條件式不受影響——它們本來就要求
  `intent === 'run_csp_scheduler'` 且 `data?.success`。
- 排課引擎、前端元件、隱私與互動記錄路徑都沒有改動。
- 沒有資料庫 schema 或遷移變動。

## 6. 測試與驗證結果

### 自動化

- `npm test`：**559 pass / 0 fail**（改動前 550，新增 9 項）。
- `node --check src/services/agentService.js` 通過。
- `client`：`npm run build` 成功、`npm run lint` 無輸出。

### 瀏覽器實機（真實 MySQL、真實 OpenAI 呼叫）

見第 7 節。

## 7. 瀏覽器驗收

登入 demo 帳號後，對 `/api/chat`（聊天面板背後的同一支 API）依序操作。

### 7.1 工具成功：`intent` 與 `data` 如實反映

送出「幫我排一份不要早八的課表，我對網路和資安有興趣。」

```json
{ "intent": "run_csp_scheduler", "data": { "success": true,
  "requestId": "0937654d-863f-4718-ab82-eaa4cb2679cf" } }
```

課表 8 門：1295 行動應用程式開發、1299 軟體框架設計、1300 程式語言、1296 安全程式設計、
1301 電腦視覺與擴增實境、1297 系統安全、1302 資訊實務案例探討、1303 資訊安全管理。

### 7.2 工具被拒：`intent` 與 `data` 不再被污染（本次的核心 A/B）

接著送出「順便幫我查『量子占卜學導論』這門課的評價。」——這門課不存在，
`search_dcard_reviews` 會回 `{ error: '找不到該課程的評價' }`。

伺服器 log 證實工具**確實被呼叫且確實失敗**：

```text
INFO  [ToolCall]        LLM 請求呼叫工具：`search_dcard_reviews`
INFO  [ToolCall_Result] 工具執行完成
WARN  [ToolCall_Result] 工具 search_dcard_reviews 回報錯誤：找不到該課程的評價
```

| | `intent` | `data` |
| --- | --- | --- |
| **修正後（實測）** | `general_chat` | `null` |
| **修正前** | `search_dcard_reviews` | `{ "error": "找不到該課程的評價" }` |

「修正前」那一列不是實跑，是由舊碼的控制流直接判定：`HEAD:agentService.js:320` 是
`detectedIntent = call.name \|\| detectedIntent;`（工具執行**之前**無條件設定），
`:335` 是 `if (RENDERABLE_TOOLS.has(call.name)) responseData = result;`
（無條件覆寫），而 `search_dcard_reviews` 就在 `RENDERABLE_TOOLS` 裡。單元測試
AG7 以純函式形式窮舉了這些分支。

### 7.3 步數上限確實生效

在 `server/.env` 暫時設 `AGENT_MAX_STEPS=1` 並重啟後送出排課請求：

```text
WARN [AgentCore] 已達最大思考步數（1），回覆可能不完整
```

回應為 `任務過於複雜，已達最大思考步數。請嘗試簡化您的需求。`——該回合模型的第一則
回應是純 `function_call`、沒有任何文字，因此 `lastAssistantText` 為空、正確落到罐頭
訊息。同一回合 `intent` 仍為 `run_csp_scheduler`、`data` 有值，因為那一步的工具**確實
成功了**。驗完已移除該設定並重啟，確認回到預設 12（同樣的請求不再觸發耗盡路徑，
回覆結尾仍如 roadmap #2 要求詢問「這份課表符合你的需求嗎？」）。

### 7.4 回歸檢查：#2 的回饋迴圈沒有被弄壞

回覆「『資訊安全管理』那門時間不行，其他都可以。」後，資料庫實際落地：

```text
23:29:48 | recommendation_exposed | 54979727 |    -  | -        | -
23:29:43 | course_withdrawn       | c3f8c96b | 1303  | IECS4074 | time
23:29:22 | recommendation_exposed | c3f8c96b |    -  | -        | -
```

`course_withdrawn` 的 `request_id` 與它前一筆曝光一致、`section_id` 是實際顯示過的課、
`feedback_reason` 是 enum `time`，且記錄發生在重新排課（`23:29:48`）**之前**。與同日
前一個 commit 的結果一致，未回歸。

## 8. 是否 commit 與 push

見本次 commit 紀錄。
