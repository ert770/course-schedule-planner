# 2026-08-01 前後端對接稽核與修復追蹤

## 文件性質

本文件為**持續更新的任務追蹤報告**。每完成一項即回來更新該項目的狀態、修改檔案清單、實際改動與驗證結果。

任務編號使用 `F` 前綴（Frontend alignment），與 `docs/CHANGE_REPORTS/2026-08-01-personalization-roadmap.md` 的 `#1`~`#11` 分開，避免混淆。

## 建立日期

2026-08-01

## 最後更新

2026-08-04（新增 F16）／2026-08-01（完成 F1、F2、F3、F14；新增 F15）

## 稽核範圍與方法

比對三個層面：

1. **API 端點**：`client/src/services/api.js` 的呼叫 vs `server/src/app.js` 掛載的路由。
2. **請求參數**：前端送出的欄位 vs 後端實際讀取的欄位。
3. **回應欄位**：後端回傳的欄位 vs 前端實際消費的欄位。

## 總結

**API 端點層面完全對得上**——`api.js` 的 7 組呼叫全部命中 `app.js` 掛載的路由，HTTP 方法與路徑參數皆正確。

斷裂集中在兩處：

- **契約細節**（F1、F2、F7）：打錯字等級的錯誤。因為沒有型別檢查也沒有整合測試接住，一路存活至今。`docs/TEST_PLAN.md:55-63` 的「前端操作測試」全為人工項目，無自動化。
- **功能覆蓋率**（F4、F5、F6）：後端進度顯著領先前端。文件已把關注/加選、多方案寫成規格，後端也已實作，UI 仍停在單方案唯讀。

### 未被前端消費的後端回應欄位

以下欄位後端已回傳，`client/src/` 全無引用：

`plans`、`preferenceScore`、`hasExpressedPreference`、`warnings`、`excludedCourses`、`watchOnly`、`skillTree`、`overallScore`

## 進度總覽

| # | 項目 | 嚴重度 | 狀態 |
| ---: | --- | --- | --- |
| F1 | Chat 回應欄位名不匹配，AI 回覆顯示空白 | 🔴 嚴重 | ✅ 已完成 |
| F2 | Chat intent 值不匹配，ChatPanel 從不更新課表 | 🔴 嚴重 | ✅ 已完成 |
| F3 | 排課失敗時 UI 完全靜默 | 🔴 嚴重 | ✅ 已完成 |
| F4 | 個人化偏好在 UI 上無法觸發 | 🟠 高 | ⬜ 未開始 |
| F5 | 多方案課表沒有任何 UI | 🟠 高 | ⬜ 未開始 |
| F6 | 關注／加選前端零實作 | 🟠 高 | ⬜ 未開始 |
| F7 | `grade` 過濾器不存在，被靜默丟棄 | 🟡 中 | ⬜ 未開始 |
| F8 | `hideConflict` 是死參數 | 🟡 中 | ⬜ 未開始 |
| F9 | 學分上下限寫死 25/15，忽略使用者設定 | 🟡 中 | ⬜ 未開始 |
| F10 | 技能樹是寫死的假資料 | 🟡 中 | ⬜ 未開始 |
| F11 | `authAPI.updateWatchlist` 定義但零呼叫 | 🟡 中 | ⬜ 未開始 |
| F12 | GraduationPage 三種按鈕沒有 onClick | 🟡 中 | ⬜ 未開始 |
| F13 | 畢業學分分類會渲染出英文 key，且與規格不符 | 🟡 中 | ⬜ 未開始 |
| F14 | `SchedulePage` 未掛載到任何路由 | 🟡 中 | ✅ 已完成 |
| F15 | `ScheduleGrid` 缺少 React key，持續污染 console | 🟡 中 | ✅ 已完成 |
| F16 | 年級有兩份、只有一份生效；改班別／年級後課表不動 | 🟠 高 | ⬜ 未開始 |

---

## F1 Chat 回應欄位名不匹配

**嚴重度**：🔴 嚴重　**狀態**：⬜ 未開始

`client/src/pages/DashboardPage.jsx:140`：

```js
setChatHistory(prev => [...prev, { role: 'bot', text: res.response }]);
```

後端 `server/src/services/agentService.js:169` 回傳的是 `reply`，回應物件中**沒有 `response` 這個欄位**。

**後果**：只要 AI 回的不是排課結果——查課程、查評價、問畢業門檻、資料不足說明，也就是 `docs/AI_AGENT_SPEC.md:45` 列的五種工具中的四種——聊天泡泡就顯示 `undefined`。這是主畫面的核心互動。

**注意**：`client/src/components/Chat/ChatPanel.jsx:31` 讀的是正確的 `res.reply`。同一個契約在兩個檔案有兩種寫法，其中一個錯。

**驗收**：DashboardPage 聊天面板能正確顯示所有非排課類的 AI 回覆。

### 修復（2026-08-01）

`DashboardPage.jsx` 改讀 `res.reply`，並加註說明後端回傳的欄位名，避免再次寫錯。

---

## F2 Chat intent 值不匹配

**嚴重度**：🔴 嚴重　**狀態**：⬜ 未開始

`client/src/components/Chat/ChatPanel.jsx:34`：

```js
if (res.intent === 'generate_schedule' && res.data?.success) {
  onScheduleGenerated?.(res.data.schedule);
}
```

後端送出的 intent 是 `'run_csp_scheduler'`，**永遠不會匹配**，`onScheduleGenerated` 從不觸發。

`DashboardPage.jsx:131` 用的是正確值 `'run_csp_scheduler'`。

**驗收**：ChatPanel 在 AI 產生課表後能正確通知父元件更新課表。

**相關**：`SchedulePage.jsx` 是 ChatPanel 目前唯一的使用者，但它未掛載到路由（見 F14），所以此問題目前不會被使用者遇到。仍應修正，否則 SchedulePage 一旦啟用就是壞的。

### 修復（2026-08-01）

`ChatPanel.jsx` 改比對 `'run_csp_scheduler'`。已確認 `agentService.js:87` 的 `detectedIntent = fnName`，即 intent 值等於 tool 名稱，`'generate_schedule'` 從未被送出過。

實機驗證需先解決 F14（ChatPanel 當時無路由可達），對照測試結果記於 F14 章節。

---

## F3 排課失敗時 UI 完全靜默

**嚴重度**：🔴 嚴重　**狀態**：⬜ 未開始

`client/src/pages/DashboardPage.jsx:90`：

```js
if (data.success) {
  setSchedule(data.schedule);
  ...
}
// 沒有 else
```

後端產生的 `message`、`warnings`、`excludedCourses`、`failures` **全部被丟棄**。使用者看到空白課表，沒有任何解釋。

**違反規格**：`docs/SCHEDULING_LOGIC.md:100` 規定「若指定必修課無法排入，必須回傳失敗原因」。後端已回傳，前端沒有顯示，規格實質未達成。

**範圍**

- `success === false` 時顯示 `message` 與 `warnings`
- 顯示 `excludedCourses` 的課程與排除理由，讓使用者知道為何某門課沒被排入
- `success === true` 但有 `warnings` 時（例如學分不足）也要顯示
- 處理 `watchOnly === true` 的情境

**驗收**：任何排課失敗或帶警告的結果，使用者都能在畫面上看到原因。

### 修復（2026-08-01）

**修改檔案**：`client/src/pages/DashboardPage.jsx`、`client/src/App.css`

- 新增 `buildScheduleNotice(data)`，把排課回應整理成畫面提示：
  - `success === false` → `error` 級提示
  - `watchOnly === true` → `warning` 級提示
  - 成功但有 `warnings` → `warning` 級提示（例如學分不足、未表達偏好）
  - 成功且無警告 → 不顯示，避免製造雜訊
- 課表區塊上方新增可關閉的提示橫幅，顯示 `message` 與 `warnings` 清單。
- 被排除課程收在 `<details>` 內，預設收合，展開後顯示課名與排除理由，最多列 5 門並標示其餘數量。
- `catch` 區塊也設定提示，網路或伺服器錯誤不再只寫進 console。
- 失敗時**不清空既有課表**，避免使用者原本的結果被無預警抹掉。

**測試與驗證結果**

以真實後端回應驗證 `buildScheduleNotice` 的三種分支：

| 情境 | 輸入 | 結果 |
| --- | --- | --- |
| 硬性限制導致失敗 | `discussion: true`（55 門課全被排除） | `error` 級，顯示原因與 55 門排除課程 |
| 成功但學分不足 | 候選僅 2 門課、`minCredits: 15` | `warning` 級，顯示 2 條警告 |
| 正常成功無警告 | `preferredKeywords: ['網路']` | 不顯示提示 |

第一個情境正是本報告背景章節記錄的失效模式（勾選「高度課堂討論」導致候選集歸零），修復前使用者完全看不到任何說明。

**瀏覽器實機驗收**

以 `preview_start` 啟動 server（3001）與 client（5173），用 demo 帳號 `D1249697` 走完登入 → 導引 → 偏好設定 → 儀表板全流程。

| 操作 | 結果 |
| --- | --- |
| 勾選「#高度課堂討論」後生成課表 | 紅色 `error` 橫幅，展開後顯示「程式設計(一)：不符合討論課偏好」等 5 門，並標示其餘 50 門 |
| 取消該偏好後重新排課 | 琥珀色 `warning` 橫幅，顯示成功訊息、「未設定興趣關鍵字…個人化程度有限」警告，以及 45 門衝堂排除理由；課表正常渲染 |
| 聊天送出「有什麼涼課」 | 泡泡顯示「系統發生錯誤：伺服器未設定 GEMINI_API_KEY。」，**不再是 `undefined`**（F1 驗收） |

**實機發現並修正的問題**：初版橫幅把同一句話顯示兩次。原因是後端排課失敗時將 `warnings[0]` 指派給 `message`，前端兩處都渲染。已在 `buildScheduleNotice` 過濾與 `message` 相同的警告。

**此問題 lint、build 與後端層級驗證全部通過，只有實際開瀏覽器才看得出來**——這也是後續將瀏覽器驗收列入 `commit-push` skill 必要步驟的原因。

- `npm run lint`：通過。
- `npm run build`：通過。
- console 錯誤：僅有 `ScheduleGrid` 的 React key 警告，屬既有缺陷，已立案為 F15。

---

## F4 個人化偏好在 UI 上無法觸發

**嚴重度**：🟠 高　**狀態**：⬜ 未開始

前端從不送 `preferredKeywords` / `interests` / `preferEasyCourses` / `preferredTrack`，UI 也沒有輸入興趣的欄位。`SetupPage` 的 12 個偏好標籤全是布林開關，沒有一個是興趣關鍵字。

**後果**：`hasExpressedPreference` **恆為 false**，主推方案永遠退回總學分排序。`#1` 完成的整套偏好符合度排序，從 UI 走進來時等於未啟用。

**範圍**

- SetupPage 與 DashboardPage 增加興趣關鍵字輸入
- 增加「偏好涼課」與修課路徑選擇
- 將這些值帶進 `scheduleAPI.generate` 的 `constraints`
- 顯示 `hasExpressedPreference` 為 false 時的提示，引導使用者補充偏好

**相依**：後端已就緒（`#1`），純前端工作。

---

## F5 多方案課表沒有任何 UI

**嚴重度**：🟠 高　**狀態**：⬜ 未開始

後端回傳完整的 `plans[]`（含 `title`、`description`、`preferenceScore`、`preferenceBreakdown`、`excludedCourses`），前端只取 `data.schedule`。

**違反規格**：`docs/REQUIREMENTS.md:60` 與 `docs/SCHEDULING_LOGIC.md:131` 都要求多方案比較，`docs/UX_FLOW.md:50` 標註「未來應顯示多方案比較」。

**範圍**

- 方案切換 UI，顯示每個方案的 `title`、`description`、總學分
- 顯示 `preferenceScore` 作為主推理由
- 切換方案時更新課表格

**相依**：可與 `#10`（多方案塌縮，目前 5 個 variant 實際只產出 2 種）一併考量——UI 做好後若後端仍只有 2 種方案，體驗仍不完整。

---

## F6 關注／加選前端零實作

**嚴重度**：🟠 高　**狀態**：⬜ 未開始

`client/src/` 查無 `watchedCourses`、`watching`、`關注` 任何一處。

後端的 `selectedCourseIds`、`watchingCourseIds`、`courseStates`、`watchedCourses` 全部沒有 UI 入口。

**違反規格**：`docs/UX_FLOW.md:52-65` 有完整的關注/加選流程規格；`docs/SCHEDULING_LOGIC.md:26-46` 定義了兩種課程狀態的行為。`docs/UX_FLOW.md:42` 已標註「未來應支援」，屬既知未實作。

**相依**：後端已於 `#11` 確保關注課程在成功與失敗回應中都會回傳，前端接上即可使用。

---

## F7 `grade` 過濾器不存在

**嚴重度**：🟡 中　**狀態**：⬜ 未開始

`client/src/pages/SetupPage.jsx:38` 送出 `coursesAPI.search({ department, grade })`，但 `server/src/routes/courses.js:8-17` 只讀取 `keyword`、`department`、`category`、`dayOfWeek`、`credits`、`instructor`、`code`、`period`、`language` 九個 filter，**`grade` 不在其中，被靜默丟棄**。

**後果**：「已修過的選修課程」清單其實沒有依年級過濾，大一與大四看到的是同一份清單。

**範圍**：後端 `searchCourses` 支援 `grade`，或前端移除該參數並改用其他方式。需先確認課程資料是否有年級欄位。

---

## F8 `hideConflict` 是死參數

**嚴重度**：🟡 中　**狀態**：⬜ 未開始

`DashboardPage.jsx:79` 送出，`constraintService.js` 接收並傳遞，但 `scheduler.js` **從不使用**。

**範圍**：實作該行為，或從前後端一併移除。UI 上目前也沒有對應的開關。

---

## F9 學分上下限寫死

**嚴重度**：🟡 中　**狀態**：⬜ 未開始

`DashboardPage.jsx:80-81` 寫死 `maxCredits: 25`、`minCredits: 15`，忽略使用者存在 profile 的 `targetCreditsMax` / `targetCreditsMin`。

SetupPage 也沒有提供學分目標設定，但 `docs/UX_FLOW.md:30` 明訂「使用者選擇學分目標」。

**範圍**：SetupPage 增加學分目標設定；DashboardPage 改讀使用者偏好而非寫死。

---

## F10 技能樹是寫死的假資料

**嚴重度**：🟡 中　**狀態**：⬜ 未開始

`DashboardPage.jsx:216-257` 寫死 4 項技能，全部 Lv.4/5、進度條 80%、整體能力指數 80/100。

後端 `graduation` API 已回傳 `skillTree` 與 `overallScore`，`server/data/users.json` 有 6 項技能且等級不一（含 Lv.3 與 Lv.5）。DashboardPage 根本沒有呼叫 graduation API。

UI 上還標示「基於歷年成績與修課紀錄動態生成」，與實作不符。

**範圍**：DashboardPage 呼叫 graduation API 並渲染真實 `skillTree` 與 `overallScore`。

---

## F11 `authAPI.updateWatchlist` 定義但零呼叫

**嚴重度**：🟡 中　**狀態**：⬜ 未開始

`client/src/services/api.js:33` 定義了 `updateWatchlist`，全專案無任何呼叫。後端 `POST /api/auth/update-watchlist` 存在但無人使用。

**範圍**：與 F6、F12 一併處理——關注功能做起來後即需要此 API。

---

## F12 GraduationPage 按鈕沒有 onClick

**嚴重度**：🟡 中　**狀態**：⬜ 未開始

三處按鈕皆無行為：

- `GraduationPage.jsx:144` watchlist 的 `+`（加入課表）
- `GraduationPage.jsx:172`「加入課表」
- `GraduationPage.jsx:176`「查看課程詳情」

`docs/UX_FLOW.md:80` 規定「使用者可依缺口返回排課」，目前無此路徑。

---

## F13 畢業學分分類渲染出英文 key 且與規格不符

**嚴重度**：🟡 中　**狀態**：⬜ 未開始

**問題一：英文 key 會出現在 UI 上**

`server/src/routes/graduation.js:6-13` 的預設值使用英文 key：

```js
{ required: 60, elective: 40, general: 20, external: 8 }
```

而 `GraduationPage.jsx:123` 渲染 `尚缺{category}`，畫面會出現「**尚缺required**」。

demo 使用者（`users.json`）有中文 key 的 `requiredCredits` 所以看起來正常，**但 MySQL `User_Profiles` 來的使用者沒有這個欄位，就會落進英文預設值**。

違反 `AGENTS.md:87`「UI 文字必須使用可讀中文，不得新增亂碼字串」。

**問題二：分類切法與規格不一致**

| 來源 | 分類 |
| --- | --- |
| `graduation.js` 預設 | required 60 / elective 40 / general 20 / external 8 |
| `users.json` | 必修 60 / 系內選修 40 / 通識 20 / 系外選修 8 |
| `docs/REQUIREMENTS.md:49-55` | 必修 63 / 核心選修 12 / 選修 16 / 通識基礎 16 / 通識選修 12 / 系外選修 9 |

三者總和都是 128，但分類切法完全不同。規格要求的六分類在實作中被壓成四分類，且數字對不上。

**相依**：與 `#8`（分類別畢業進度向量）相關，應一併設計。

---

## F14 `SchedulePage` 未掛載到任何路由

**嚴重度**：🟡 中　**狀態**：⬜ 未開始

`client/src/pages/SchedulePage.jsx` 存在且引用了 `ChatPanel`，但 `client/src/App.jsx` 的路由表沒有它。目前是死頁面。

`docs/UX_FLOW.md:11-18` 的路由表也沒有列出 SchedulePage。

**範圍**：確認此頁面是否仍需要。若需要則掛上路由並更新 `docs/UX_FLOW.md`；若不需要則刪除，避免 F2 這類問題藏在死程式碼中。

### 修復（2026-08-01）

**決策**：保留 SchedulePage，沿用既有版面外殼。

**掛路由前發現的問題**：SchedulePage 不只是缺少路由，它與 ChatPanel 引用了 **15 個完全不存在的 CSS class**（`.schedule-page`、`.schedule-controls`、`.schedule-container`、`.stat-item`、`.stat-icon`、`.stat-value`、`.course-card-code`、`.course-card-meta`、`.quick-actions`、`.quick-chip`、`.chat-input`、`.chat-send-btn`、`.typing-indicator`、`.typing-dot`、`.chat-header-icon`、`.chat-header-info`）。直接掛路由只會得到一個沒有版面、且沒有導覽列（進去出不來）的破頁面。

**修改檔案**

- `client/src/pages/SchedulePage.jsx`（改寫）
- `client/src/App.jsx`
- `client/src/pages/DashboardPage.jsx`、`SearchPage.jsx`、`GraduationPage.jsx`（導覽連結）
- `client/src/App.css`
- `docs/UX_FLOW.md`

**主要改動內容**

- SchedulePage 改用既有的 `.layout-container` / `.top-nav` / `.dashboard-content` / `.schedule-area` 外殼，不再依賴從未存在的 `.schedule-page` 系列樣式。
- 加上與其他頁面一致的頂部導覽列與使用者選單，使用者不再會被困在頁面內。
- `alert()` 改為與 DashboardPage 一致的 `.schedule-notice` 提示橫幅。
- 新增 `/schedule` 路由，並在 Dashboard、Search、Graduation 三頁的導覽列加入「排課」連結。
- 補上 ChatPanel、CourseCard 與課程瀏覽器缺少的樣式。
- `docs/UX_FLOW.md` 路由表補上 `/schedule`。

**測試與驗證結果（實機）**

| 操作 | 結果 |
| --- | --- |
| 由儀表板點「排課」 | 導向 `/schedule`，導覽列「排課」標為目前頁面 |
| 版面量測 | 課表區 1000px、聊天區 380px 並排，總高 900px 撐滿視窗，無重疊 |
| 瀏覽課程 → 搜尋 | 課程瀏覽器正常渲染，搜尋到 55 門，卡片樣式生效 |
| 選課 → 自動排課 | 產生 1 門 3 學分，提示橫幅顯示方案訊息 |
| 系所下拉 | 由 API 載入 6 個選項 |

**F2 的實機驗證**：`ChatPanel` 現在有路由可達，得以驗證。因尚無 `GEMINI_API_KEY`，改以攔截 `/api/chat` 回應做對照測試（測試前端分支，非端到端）：

| 送出的 intent | 聊天有回覆 | 課表是否更新 |
| --- | --- | --- |
| `generate_schedule`（修復前的錯誤值） | 是 | **否，0 門課** |
| `run_csp_scheduler`（修復後） | 是 | **是，2 門課 / 5 學分** |

第一列重現了原本的缺陷：AI 有回話但課表完全不動。

**待補**：取得 `GEMINI_API_KEY` 後應重跑一次真正的端到端驗證。

---

## F15 `ScheduleGrid` 缺少 React key

**嚴重度**：🟡 中　**狀態**：⬜ 未開始

於 F1-F3 的瀏覽器驗收時，從 console 發現。**既有缺陷，非 F1-F3 引入。**

`client/src/components/Schedule/ScheduleGrid.jsx:64` 在 `PERIODS.map()` 內回傳裸的 `<>` fragment：

```jsx
{PERIODS.map(period => (
  <>
    <div key={`time-${period.num}`} className="time-label">
```

內層元素有 key，但 fragment 本身沒有，因此 React 持續發出 `Each child in a list should have a unique "key" prop` 錯誤。

**影響**：每次渲染課表都會污染 console。由於瀏覽器驗收現已是 `commit-push` skill 的必要步驟，既有噪音會讓後續真正的新錯誤更難被發現。

**修法**：改用 `<Fragment key={period.num}>` 並 import `Fragment`。屬一行修正。

### 修復（2026-08-01）

已於 `2026-08-01-align-scheduler-with-database.md` 的多時段課表渲染改動中一併修正。全新分頁載入後 console 無任何錯誤。

## F16 年級有兩份、只有一份生效；改班別／年級後課表不動

**嚴重度**：🟠 高　**狀態**：⬜ 未開始

於 2026-08-04 班別收斂功能的驗收中，由使用者實測發現並回報：
**直接改 `server/data/users.json` 的班級與年級後，排出來的課表完全沒變。**

### 已重現

把 `users.json` 的 `grade` 從 `3` 改成 `2`、`className` 從 `資訊三甲` 改成 `資訊二乙`，
重新呼叫 `GET /api/profile?userId=D1249697`：

```json
{ "dept": "資訊工程學系", "grade": "3", "className": "資訊二乙" }
```

`grade` **仍然是 3**。接著排課，必修依然是三年級的：

```json
{
  "required": ["專題研究(一)|資訊三甲", "計算機結構學|資訊三甲", "計算機演算法|資訊三甲"],
  "warn": [
    "班別「資訊二乙」與系所或年級不一致，已忽略班別設定，必修僅依系所與年級判定。",
    "已排除 1576 門其他系所、學制、年級或班別的必修課（依 資訊工程學系 3 年級判定）。"
  ]
}
```

### 根因：同一筆資料存兩處，只有一處是真相來源

| 欄位 | 真正生效的來源 | `users.json` 的同名欄位 |
| --- | --- | --- |
| `department` | `user_preferences.json`（或 MySQL `User_Profiles.department`） | 有，**不生效** |
| `grade` | `user_preferences.json`（或 MySQL `grade_level`） | 有，**不生效** |
| `className` | `users.json` 的覆蓋層（欄位到位前的後備） | 有，**生效** |

`users.json` 的 `department` / `grade` 只被 `SetupPage` 當作表單初始值
（`useState(user?.grade || '1')`），排課完全不看它。

於是手改 `users.json` 會得到一個**內部矛盾的 profile**：班別來自 `users.json`（二乙）、
年級來自 `user_preferences.json`（三年級）。班別收斂偵測到不一致，依設計忽略班別、
退回年級判定——課表因此沒有任何變化。系統有發出警告，但使用者的預期是「改了就該變」。

### 兩個要分開處理的問題

**F16-a　`users.json` 的 `department`／`grade` 是死欄位。**
同一份資料存兩處而只有一處生效，任何人（包括未來的自己）手改都會踩到。
選項：從 `users.json` 移除這兩個欄位、或讓 profile 讀取時以它們為準、
或在讀取時偵測兩處不一致並警告。**需要決定真相來源是哪一個。**

**F16-b　班別與年級不一致時，「忽略班別」是否為正確處理。**
班別本身就編碼了年級（`資訊二乙` → 2 年級）。目前選擇忽略班別、保留年級，
理由是「不因為多一個欄位就讓原本能排課的使用者突然排不出必修」
（見 `server/src/skills/courseScope.js` 的 `buildStudentScope()`）。
但從使用者角度，改了班別卻毫無反應，警告也容易被忽略。
可考慮的替代方案：以班別覆寫年級、或在 UI 上把不一致擋成錯誤要求先修正。

### 影響

- 透過 UI（`SetupPage` 的系所／年級／班別下拉）操作**不受影響**——三個值一起送出，
  一起寫進 `user_preferences.json`，彼此一致。已於 2026-08-04 驗收：
  資訊三甲 → 計算機演算法(許芳榮)、資訊三乙 → 計算機演算法(黃秀芬)。
- 受影響的是**直接編輯 JSON 檔**的情境（開發、測試、造資料）。

### 相關

- 班別收斂與儲存位置：`docs/COURSE_SELECTION_RULES.md` 第八節。
- 班別的真相來源最終應為 `User_Profiles.class_name`（待組員新增欄位），
  屆時 F16-a 的重複問題會縮小到 `department` / `grade`。

## 建議修復順序

| 順序 | 項目 | 理由 |
| ---: | --- | --- |
| 1 | F1, F2 | 兩行字串修正，修完聊天功能立刻恢復 |
| 2 | F3 | 讓所有排課失敗都變成無聲失敗，會嚴重誤導後續除錯 |
| 3 | F14 | 先決定 SchedulePage 去留，避免後續在死程式碼上做白工 |
| 4 | F4 | 後端已就緒，純前端工作，能讓 `#1` 的成果真正生效 |
| 5 | F9, F13, F7 | 資料正確性問題，影響使用者看到的數字 |
| 6 | F5, F6 | 功能性開發，範圍較大，建議與 `#10` 一併規劃 |
| 7 | F8, F10, F11, F12 | 清理與補完 |

## 是否 commit 與 push

- F1、F2、F3、F14 已 commit 並 push 至 `origin claude/personalized-schedule-algorithm-6324a3`。
- F4~F13、F15 尚未開始。
