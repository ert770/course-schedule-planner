# Agent：查課修正、聊天偏好直接存、找替代課與換課（ADR-036，第一批）

日期：2026-11-24

## 背景

使用者跟 Agent 對話時遇到三個問題：

1. 要「把人工智慧入門與省思換成一門星期一的通識課」，Agent 一直說查不到。重跑確認是模型送了 `keyword:"通識"`（比對課名與說明，0 筆）；D1249697 星期一其實有 64 門通識、32 門可修。
2. Agent 說「早晚課你沒提到，我沒有替你預設」，但左側已勾「不排早八」，排課也有套用。
3. 聊天說「星期一排空」不會存，左側的「星期一排空」不會勾起來。存偏好的工具只能改 15 個勾選中的 2 個，而且要兩段式確認。

使用者決定（2026-11-24）：

- 聊天說的條件直接存進偏好，左側跟著改；說「這次就好」才只用一次。
- 新增「找替代課」工具。
- Agent 讀寫課程主題偏好（s_tag、s_vec、s_cf）分到第二批。

## 修改檔案

| 檔案 | 內容 |
| --- | --- |
| `server/src/services/agentService.js` | `normalizeCourseQueryArgs`（分類用語不當 keyword）、`rankByEligibility`（可修的排前面再取 10 筆）、`update_preferences` 直接寫入＋`expandPreferenceChecklist`／`dropNoopPreferenceChanges`、新工具 `find_replacement_courses`／`swap_course`、回應帶 `preferencesUpdated`、找替代課算進查課上限 |
| `server/src/services/agentToolRegistry.js` | `update_preferences` 不再需要確認；登記兩個新工具 |
| `server/src/services/promptService.js` | `query_course_db` 說明補規則；`update_preferences` 改成 `check`／`uncheck` 清單；兩個新工具 schema；prompt 新增「已存偏好與這次條件」「換課」規則、「目前使用者偏好」列出全部已勾選偏好與不能上課時段、理解回講改成「沿用已存偏好」 |
| `server/src/services/goldenSetRunner.js` | 單輪題目可走多步（先存偏好再排課），最多 3 步 |
| `client/src/contexts/ScheduleContext.jsx` | `applyCourseSwap()`：先驗證整份課表再移除舊課、加入新課 |
| `client/src/pages/DashboardPage.jsx` | 收到 `preferencesUpdated` 重抓偏好；收到換課結果套用到課表 |
| 測試 | `agentTools.test.js`（AG5、AG20、AG21）、`requirementGate.test.js`（AG9、AG12）、`prompt.test.js`（P4）、`agentToolRegistry.test.js`（9 個工具）、`explanationFaithfulness.test.js`（F30）、`fixtures/agentGoldenSet.json`（改 `permanent-vs-once`，新增 `chat-pref-saved`、`replace-course-gen-ed-monday`） |
| 文件 | `docs/DECISIONS.md`（ADR-036）、`docs/PROMPT_DESIGN.md`、`docs/API_SPEC.md`（`preferencesUpdated`、`swap`） |

## 與計畫不同的地方

- `update_preferences` 原計畫用 15 個布林欄位。重跑時模型把 15 個全部填滿，抄錯一個就會刪掉偏好，所以改成 `check`／`uncheck` 清單。伺服器也會丟掉跟現值相同的欄位和空的 `blockedPeriods`（模型會抄回來，照寫會清掉已存的不能上課時段）。
- `swap_course` 沒有用 `validateScheduleAgainstConstraints`：它會檢查必修涵蓋，對部分課表不適用。改成伺服器重跑同一套候選條件，前端再用既有的 `/api/schedule/validate` 驗證整份課表。
- `ChatPanel.jsx` 沒有任何頁面使用，所以沒改。

## 影響範圍

- 只影響 AI Agent 聊天與首頁左側偏好、課表的同步。排課引擎本身沒改。
- Roadmap #24「確認前不得永久更新偏好」對排課偏好不再成立（ADR-036）；系所、年級、班別仍是兩段式。
- 不排晚間課、最低學分仍然沒有地方存，只能單次使用。

## 測試與驗證

- `npm test`：見 commit 回報。前端 lint、build 通過；後端所有 `src/**/*.js` 的 `node --check` 通過。
- 黃金題組（實際呼叫模型）18 題全部通過。
- **Agent 新舊對照**（舊版 `c9ab340` 放在暫時 worktree，與新版同時重跑；寫入類工具不執行）：
  - 換課（使用者同意取消星期一排空後）：舊版 3 次中 2 次用 `keyword:"通識"` 查到 0 筆、1 次改去重排；新版 3 次都先 `uncheck mondayFree`，再 `find_replacement_courses` 找到 10 門候選並列出 5 門。
  - 「星期一排空，星期二到四都要上課」：舊版說「其他條件沒有替你額外決定」；新版 `check mondayFree` 並回覆「沿用你已存的偏好：不排早八、涼課優先」。
- **瀏覽器**（`localhost:5173`，D1249697，使用者正在跑的開發伺服器，後端已自動載入新程式）：
  - 說「星期一排空，幫我排課」：資料庫偏好變成 `#不排早八`、`#星期一排空`、`#涼課優先`，左側「星期一排空」變成勾選，課表 4 門 9 學分、星期一沒課，回覆點名沿用不排早八、涼課優先。
  - 說「這次就好，星期五不要排課，幫我重排」：偏好與不能上課時段都沒變，回覆說明星期五只套用這次。
  - 說「把人工智慧入門與省思換成一門星期一的通識課」：Agent 先問是否取消星期一排空；回「好，取消」後左側取消勾選，列出台灣考古學與原住民等 5 門候選；回「換第一門」後課表上「人工智慧入門與省思」換成「台灣考古學與原住民」（週一 3～4 節），舊課出現在「本次避開」。
  - console 只有既有的 `/api/controlled-browser/config` 404。
  - 測試後 D1249697 的偏好回到原本的 `#不排早八`、`#涼課優先`，並清除了本次避開。

## 尚未處理（第二批）

- Agent 讀取與修改課程主題偏好（s_tag、s_vec；s_cf 只讀）。

## Commit 與 push

commit 並 push 至 `origin backend`。
