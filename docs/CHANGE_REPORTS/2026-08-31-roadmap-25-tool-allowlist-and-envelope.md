# 2026-08-31 Roadmap #25：Tool allowlist、工具結果信封與非法課程 id 過濾

## 1. 修改日期

2026-08-31

## 2. 為什麼做這件事

`#25` 盤點時已經達成四條驗收標準中的三條——三份不同日期的變更報告合計交付
（OpenAI 原生 tool calling、`intent`/`data` 誠實化、同回合 scope 重建）。剩下的
「非法 course ID 不會進入核心 service」與「正式 tool allowlist」尚未動工，查證後
確認不需要外部資料，可以完成。

## 3. 修改檔案清單

| 檔案 | 改動 |
| --- | --- |
| `server/src/services/agentToolRegistry.js` | **新增**。七個工具的政策單一來源 |
| `server/src/services/agentService.js` | 消費登記表（`applyToolOutcome()`、`runConfirmedWrite()` 呼叫、pending changes 清單）；新增 `buildToolResultEnvelope()`；`run_csp_scheduler` 濾掉查無對應課程的 `watchingCourseIds`；六個錯誤路徑加上 `errorCode` |
| `server/src/services/promptService.js` | system prompt 新增信封說明、`update_student_profile` 加入選填欄位不追問的規則 |
| `server/test/agentToolRegistry.test.js` | **新增**（AR1-AR4） |
| `server/test/agentTools.test.js` | 新增 AG14（watching id 過濾）、AG15（信封）；AG4 更新 `errorCode` |
| `server/test/prompt.test.js` | 新增 P7（信封說明契約） |
| 文件 | `docs/API_SPEC.md`、`docs/PROMPT_DESIGN.md`、`docs/TEST_PLAN.md`、roadmap `#25`、本報告與索引 |

## 4. 主要改動內容

### 4.1 查證推翻了原計畫的一部分範圍

進 plan mode 時假設要在 `requirementPreflight.js` 新增一項檢查，涵蓋
`mustTakeCourseIds`／`selectedCourseIds`／`watchingCourseIds` 三種 id 的存在性。
**開始寫程式前重新查證**，發現 `requirementPreflight.js` 檔頭本來就寫著：
「`mustTakeCourseIds` 指向不存在的課程 id 已由 Z5 在排課層處理，這裡不再檢查」。

實測確認範圍比那句註解講的更大——不只 `mustTakeCourseIds`，`selectedCourseIds`
撞到不存在的 id 時**也**由 `generateSchedule()` 回傳結構化的 `data-insufficient`：

```js
generateSchedule(courses, { mustTakeCourseIds: [999999], ... })
// → success:false, solver.status:'data-insufficient',
//   clarification.questions[0].courseIds:[999999]
```

**真正的缺口只有 `watchingCourseIds`**：實測撞到不存在的 id 時 `success:true`、
無 warning、無 clarification——`isWatching()` 只是拿 id 去比對候選課程，比對不到
就沒有任何一門課會被標記，那個 id 就這樣消失。

### 4.2 為什麼 `watchingCourseIds` 不套用跟另外兩者一樣的機制

`mustTakeCourseIds`／`selectedCourseIds` 是「這門課一定要在課表裡」的硬性宣告，
答錯會讓整份課表偏離使用者真正要的東西，值得停下來問清楚——這是 #22 既有機制
在做的事，不重複。

關注課程只是追蹤用途，不佔時段也不計學分。為了一個打錯的 id 擋下整次排課、
逼使用者先確認，跟它的重要程度不相稱，也會讓兩種嚴重程度不同的問題共用同一個
「回頭問」機制。改成在 `agentService.js` 的 `run_csp_scheduler` case：

- `lookupCourses` 呼叫加入 `watchingCourseIds`（與 mustTake／selected 合併一次查詢）。
- 濾掉 `schedulingArgs.watchingCourseIds` 裡查無課程的 id——**讓它們真的不會進
  `scheduler.js`**，比 #22 那種「回頭問」更直接地滿足「非法 id 不進核心 service」。
- 排課完成後把「已略過」的 id 併入 `scheduled.warnings`，不中斷排課。

### 4.3 Tool allowlist：`agentToolRegistry.js`

工具的定義先前散在三處，各自維護：`promptService.js` 的 schema（七個工具）、
`agentService.js` 的 switch（七個 case）、獨立的 `RENDERABLE_TOOLS` Set（四個
名稱）。漏一邊的後果具體存在——只在 switch 而不在 schema：模型永遠呼叫不到；
只在 schema 而不在 switch：模型呼叫後拿到「不明的函數呼叫」。

新登記表每個工具一筆 `{ name, renderable, writes, confirmation }`，**由程式實際
消費**：

- `applyToolOutcome()` 改讀 `isRenderableTool()`，刪掉 `RENDERABLE_TOOLS` 這份
  平行維護的 Set。
- `update_preferences`／`update_student_profile` 的 `changeType` 改由
  `getConfirmationChangeType(name)` 取得，不再是兩處各自寫死的字串常數。
- `handleChat()` 組 prompt 時列舉待確認變更的清單，改用
  `listConfirmationChangeTypes()`，取代原本寫死的 `['preferences', 'profile-scope']`
  （這是實作時多找到的第四處平行維護）。

`agentToolRegistry.test.js` 直接讀 `agentService.js` 原始碼掃 `case '...'` 名稱
（比對手法沿用 `courseHistoryDatabase.test.js` 的 H8），與登記表、
`getAgentTools()` 三者的名稱集合互相比對——任一處漏改，測試先失敗，不必等到
模型實際呼叫才發現。

### 4.4 工具結果信封

`buildToolResultEnvelope(name, modelResult)` 把送給模型的結果包成統一形狀：

```json
{
  "schemaVersion": 1,
  "dataSource": "mysql",
  "term": { "academicYear": 114, "semester": "下學期" },
  "warnings": [],
  "errorCode": null,
  "result": { "...": "投影後的原始內容" }
}
```

- **只影響模型看到的那一份**。這個分岔本來就存在——`summarizeScheduleForModel()`
  已經證明「前端拿完整結果、模型拿投影後的版本」是安全的做法。前端消費的是
  `applyToolOutcome()` 寫進 `/api/chat` 回應 `data` 的原始 `result`，完全不經過
  這裡；AG15 有一項測試專門釘住這件事。
- `dataSource` 讀 `isMysqlConfigured()`，`json-fallback` 時 system prompt 要求
  模型講成「暫時性限制」，不能說成資料真的不存在。
- `term` 只附加在會回傳課程物件的四個工具，偏好／身分寫入與排課後確認不附加。
- `warnings` 把結果既有的 `warnings`（若有）提到信封層。
- `errorCode`：七個工具的失敗路徑統一標上穩定碼——`UNKNOWN_TOOL`、
  `MALFORMED_ARGUMENTS`、`TOOL_EXECUTION_FAILED`、`REVIEWS_NOT_FOUND`、
  `NOTHING_TO_CHANGE`、`CONFIRMATION_INVALID`、
  `PREFLIGHT_CLARIFICATION_REQUIRED`。`run_csp_scheduler` 的原始結果沒有直接
  流向信封——`summarizeScheduleForModel()` 是白名單式投影，只列舉要保留的欄位，
  因此另外補上 `errorCode: result.errorCode` 讓它透得過去。

## 5. 影響範圍

- `/api/chat`：回應欄位不變。模型看到的工具結果形狀改變（多一層信封），因此
  system prompt 一併更新說明；已用瀏覽器實機驗證模型仍正確讀取
  `reviewCoverage`、`warnings` 等巢狀欄位並用於回覆內容。
- `run_csp_scheduler` 唯一的行為變更：`watchingCourseIds` 含不存在的 id 時，
  該 id 會被濾掉並多一則 warning；合法 id 不受影響。
- 排課引擎（`scheduler.js`）、前端、隱私與互動記錄路徑完全沒有改動。

## 6. 測試與驗證結果

### 自動化

- `npm test`：**770 pass / 0 fail**（改動前 767，新增 20 項 AR1-AR4 + AG14/AG15 +
  P7；AG4 更新一項既有斷言），golden set 連續兩輪 8/8。
- `node --check`：`agentService.js`、`agentToolRegistry.js`、`promptService.js`、
  `requirementPreflight.js` 全數通過。

### node 端 A/B（很難讓模型主動產生假 id，改用 stub 直接驗證邊界）

```text
傳進 generateSchedule 的 watchingCourseIds: [1]        （原始輸入 [1, 999999]）
回傳的 warnings: ["既有的排課警告","關注課程 id 999999 查無對應課程，已略過。"]
```

### 瀏覽器實機（真實 MySQL、真實 OpenAI 呼叫）

登入 demo 帳號，聊天面板送出「幫我排一份不要早八的課表，我對資訊安全有興趣。」：

1. 模型先問清楚「不要早八」是絕對還是有彈性——preflight 未被觸發（模型自己問了）。
2. 回覆「盡量不要排早八，如果真的排不出來可以接受。」後，`run_csp_scheduler`
   成功執行，產生 8 門課、23 學分的課表，回覆正確引用評價覆蓋率
   （「評價資料目前只涵蓋 8 門中的 1 門」）、資格待確認課程與內容偏好訊號強度
   ——證明模型在信封改動後仍正確解讀巢狀欄位，沒有因為多一層 `result` 包裝而
   讀錯或忽略內容。
3. 伺服器 log 全程無 error；`read_console_messages` 只有既有的登入前 401
   殘留，無新增錯誤。

## 7. 驗收標準對照

| # | 驗收標準 | 結果 |
| --- | --- | --- |
| 1 | malformed、未知工具、非法 course ID 與矛盾參數不會進入核心 service | **完成**（見 4.1、4.2） |
| 2 | Tool schema 與 `PROMPT_DESIGN.md` 有自動契約測試 | **完成**（`prompt.test.js` + 新增 `agentToolRegistry.test.js`） |
| 3 | Agent 修改 Profile 後，同一對話後續查詢使用更新後 scope | **完成**（#24 第一輪已達成，本次未變動） |
| 4 | Tool 失敗時 final answer 正確轉述錯誤，不宣稱任務成功 | **完成**（2026-08-30 已達成；本次補上系統性 `errorCode`） |

**#25 四條驗收標準全數達成。**

## 8. 已知限制

- Tool result 的 `schemaVersion` 目前恆為 `1`；日後改動信封形狀時才需要遞增，
  尚未有實際的版本分歧情境可測。
- `errorCode` 的錯誤碼清單是本次盤點既有的六個錯誤路徑逐一命名，未來新增工具
  或新的失敗路徑時需要一併補上，`docs/PROMPT_DESIGN.md` 的維護規則已加註提醒。

## 9. 是否 commit 與 push

見本次 commit 紀錄。
