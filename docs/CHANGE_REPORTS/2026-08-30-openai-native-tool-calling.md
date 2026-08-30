# 2026-08-30 AI Agent 改用 OpenAI 與原生 tool calling

## 1. 修改日期

2026-08-30

## 2. 為什麼做這件事

**Chat 整條路徑在這次改動之前是壞的。** `agentService.js` 寫死 `gemini-2.5-pro`，
Google 已對新使用者下架該模型，`/api/chat` 一直回 `404 This model
models/gemini-2.5-pro is no longer available to new users`。這件事在
`2026-08-11` 與 `2026-08-26` 的變更報告都記錄過——也因此，**roadmap #2 的「排課後
確認」流程從來沒有在瀏覽器裡真的跑過一次**。老師提供的 OpenAI key 是目前唯一能把
這條路徑修回來的方法。

既然無論如何都要換 provider，順便把脆弱的文字 tool-call parser 一起換掉：先前要求
模型輸出 `[LLM_Thought]:` 與 `[ToolCall]: {json}` 再用 regex 撈，等於把參數合法性
完全交給模型自律。`docs/專題進度報告.md` 早就把「parser 脆弱」列為風險。

## 3. 修改檔案清單

### 後端

| 檔案 | 改動 |
| --- | --- |
| `server/src/services/agentService.js` | 換成 OpenAI Responses API；抽出 `executeAgentTool()`；新增 `summarizeScheduleForModel()`；補上最近一次推薦的上下文；工具錯誤留 log |
| `server/src/services/promptService.js` | `getAgentTools()` 由空 stub 改為六個工具的 JSON Schema；system prompt 移除 ReAct 格式段，新增回饋記錄順序規則與「最近一次推薦」區塊 |
| `server/src/services/interactionEventService.js` | 新增 `findLatestExposureRequestId()`（只認 `surface: chat`，一併回傳 `displayedSet`） |
| `server/src/services/scheduleFeedbackService.js` | 空回饋的錯誤訊息改成可行動的修正指示 |
| `server/src/data/privacyPolicy.js` | `PRIVACY_POLICY_VERSION` → `2026-08-30.v2`；processor 由 Google Gemini 改為 OpenAI |
| `server/package.json` | 新增 `openai` 依賴 |

### 測試

| 檔案 | 改動 |
| --- | --- |
| `server/test/agentTools.test.js` | **新增**。工具派送與排課結果投影共 15 項 |
| `server/test/prompt.test.js` | 參數／enum 斷言從 prompt 字串改為對 `getAgentTools()` schema |
| `server/test/interactionEvents.test.js` | IL-13d 改為驗行為而非錯誤文案；`before()` 一併 delete `OPENAI_API_KEY` |
| `server/test/privacyRoutes.test.js` | `before()` 一併 delete `OPENAI_API_KEY` |

### 文件與設定

`docs/PROMPT_DESIGN.md`、`docs/DECISIONS.md`（ADR-020、ADR-021，ADR-004 標記
superseded）、`docs/ARCHITECTURE.md`、`.env.example`、
`.claude/skills/commit-push/SKILL.md`。

`server/.env` 另外設定了 `OPENAI_API_KEY` 與 `OPENAI_MODEL=gpt-5.6-luna`，該檔已被
`.gitignore` 忽略、未進版控。

## 4. 主要改動內容

### 4.1 Provider 與協定

- OpenAI `gpt-5.6-luna`，走 **Responses API**（`/v1/responses`）原生 tool calling。
- **不用 Chat Completions**：`gpt-5.6-luna` 是推理模型，在 `/v1/chat/completions`
  掛 function tools 會被擋——`Function tools with reasoning_effort are not
  supported ... use /v1/responses or set reasoning_effort to 'none'`。另一條路
  要關掉推理，而這個 Agent 要做的正是多步驟推理。同理不送 `temperature`。
- model id 一律由 `OPENAI_MODEL` 決定，程式裡不寫死。

### 4.2 六個工具，沒有 `final_answer`

參數改由 JSON Schema 約束：`feedbackReason` 是七個值的 enum、`requestId` 必填、
`additionalProperties: false`。這些以前只是 prompt 裡的一句叮嚀，模型可以照樣填
「太難」或亂編 requestId。原生 tool calling 的自然終止就是「模型回一則沒有
`function_call` 的訊息」，因此 `final_answer` 移除。

### 4.3 瀏覽器驗收才發現的三個真實缺陷

這三個都不是這次遷移引入的，而是**因為 Chat 從來沒真的跑過所以看不見**：

**(a) `record_schedule_feedback` 實際上永遠呼叫不成功。**
`saveChatExchange()` 只保存使用者訊息與最終文字回覆，工具結果不保存。下一回合模型
手上既沒有合法的 `requestId`，也沒有課程 `sectionId`，只記得自己寫過的課名。驗收時
模型自己講了出來：「目前這段對話沒有保留上一份推薦的課表識別資料，因此我無法先正式
記錄」。修法是伺服器每回合查出最近一次 **chat** 曝光，把 `requestId`、`planId` 與
`sectionId → 課名` 對照表補進 prompt。只認 `chat` 是刻意的——排課頁一載入就會寫下
`dashboard / initial_load` 曝光，不分介面地取最新一筆會對到使用者沒在聊天裡看過的
課表。**來源驗證完全沒有鬆動**：`scheduleFeedbackService` 仍對照曝光紀錄檢查。

**(b) 第二次排課會撐爆 context window。**
完整排課結果序列化是 **838 KB**（`excludedCourses` 一項就有 200+ 門完整課程物件，
`plans` 每個方案又各帶一份完整課表）。實測回 `400 Your input exceeds the context
window of this model`。新增 `summarizeScheduleForModel()` 投影成 **9.7 KB**；
**完整結果仍原封不動回傳給前端**渲染，被裁掉的只有送進模型的那一份。

**(c) 工具失敗是靜默的。**
工具「被呼叫了」不等於「成功了」——驗證失敗只是回一個 `{ error }` 給模型，模型往往
自己換個說法圓過去，畫面上完全看不出來。現在伺服器會把工具回報的錯誤寫進 log
（訊息是伺服器自己產生的固定文案，不含使用者輸入或工具結果內容）。

順帶修掉一個既有 bug：原本每回合 `contents.pop()` 會丟掉最近一則助理回覆，那是
Gemini `chats.create` 的 history 形狀限制留下的痕跡，在這裡只會弄壞對話連續性。

### 4.4 隱私政策升版

`privacyPolicy.js` 原本告訴使用者「對話會傳送至 Gemini」、processor 列 Google
Gemini。**換第三方接收者正是同意的標的**，只改文字不改版本等於偷換，因此
`PRIVACY_POLICY_VERSION` 由 `2026-08-22.v1` 升到 `2026-08-30.v2`。不需要改任何
service 程式——版本比對機制（#33）就是為這件事蓋的。

## 5. 影響範圍

- `/api/chat`：從完全不可用變成可用。回應契約（`reply` / `intent` / `data`）不變。
- 所有既有同意失效，使用者需在隱私中心重新同意後才能使用 Chat 與互動記錄。
- `/api/schedule/generate`、排課引擎、前端元件都沒有改動。
- `@google/genai` 仍留在 `package.json`，因為 `src/testFunc*.js` 還 import 它；
  應用端已是單一 provider。

## 6. 測試與驗證結果

### 自動化

- `npm test`：**545 pass / 0 fail**（改動前 531；新增 10 項工具派送 + 5 項投影測試，
  prompt 契約測試淨增）。
- `node --check`：`agentService.js`、`promptService.js`、`interactionEventService.js`、
  `scheduleFeedbackService.js` 全數通過。
- `client`：`npm run build` 成功（7.17s）、`npm run lint` 無輸出。

### 瀏覽器實機（真實 MySQL、真實 OpenAI 呼叫）

**A/B 對照 1：政策升版的效果**

| 情境 | 結果 |
| --- | --- |
| 升版後、重新同意前 | 登入後**直接被導到隱私中心**；`POST /api/chat` 回 `428 CONSENT_VERSION_OUTDATED` |
| 隱私中心重新同意後 | `POST /api/chat` 回 `200`，正常對話 |

隱私中心畫面同時確認顯示「政策版本：2026-08-30.v2」與「對話會傳送至 OpenAI」。

**A/B 對照 2：roadmap #2 的完整回饋迴圈**（`/schedule` 的聊天面板）

送出「幫我排一份不要早八的課表，我對網路和資安有興趣。」，模型呼叫
`run_csp_scheduler`，實際帶入的參數為
`{"noMorningClasses":true,"interests":["網路","資安"],"preferredKeywords":["網路","資安"],…}`
——個人化確實傳到了排課引擎。回覆結尾如 #2 要求詢問「這份課表符合你的需求嗎？」，
並照實說明「目前只有『資訊安全管理』有評價資料（5 則）；其餘 7 門沒有評價資料，
不能據此判定涼或好拿分」。

回覆「『資訊安全管理』那門時間不行」之後，資料庫實際落地的事件：

```text
23:00:32 | recommendation_exposed | 1ada78f7 |    -  | -        | aac:interest | -
23:00:27 | course_withdrawn       | ab3d896e | 1303  | IECS4074 | -            | time
22:59:13 | recommendation_exposed | ab3d896e |    -  | -        | 318:interest | -
```

`course_withdrawn` 的 `request_id` 與它前一筆曝光一致（`ab3d896e`），`section_id`
是那次推薦**實際顯示過**的課，`feedback_reason` 是 enum `time`，而且記錄發生在
重新排課（`23:00:32` 那筆新曝光）**之前**。**這是 roadmap #2 第一次通過端對端驗收。**

**修好之前的對照**：同一段操作在修正 4.3(a)(b) 之前，資料庫只長出曝光事件、沒有任何
回饋事件；伺服器 log 顯示 `工具 record_schedule_feedback 回報錯誤：使用者尚未表達
接受或指出不適合的課程`。

### 未完成／已知限制

- 開發期間 `node --watch` 每次改檔重啟都會清掉記憶體 session，瀏覽器 console 因此
  留有數筆 401。重新登入後 `POST /api/schedule/generate` 回 200，非程式缺陷。
- 聊天面板的輸入框按 Enter 不會送出，必須點送出鍵。這是既有的前端行為，本次未改動。
- `src/testFunc.js`、`src/testFunc3.js` 仍是 Gemini 實驗檔，未清理。
- **`intent` 會謊報**：不論工具成功或被拒都照 `call.name` 設定。當時沒有消費端受影響
  （兩處都額外檢查 `data?.success`），因此本次未動。
  **已於後續 commit 修正**——見
  [`2026-08-30-honest-intent-and-step-limit.md`](./2026-08-30-honest-intent-and-step-limit.md)。

## 7. 是否 commit 與 push

見本次 commit 紀錄。`server/.env` 未進版控（`git check-ignore` 已確認）。
