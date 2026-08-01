# 2026-08-01 前後端對接稽核與修復追蹤

## 文件性質

本文件為**持續更新的任務追蹤報告**。每完成一項即回來更新該項目的狀態、修改檔案清單、實際改動與驗證結果。

任務編號使用 `F` 前綴（Frontend alignment），與 `docs/CHANGE_REPORTS/2026-08-01-personalization-roadmap.md` 的 `#1`~`#11` 分開，避免混淆。

## 建立日期

2026-08-01

## 最後更新

2026-08-01（完成 F1、F2、F3）

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
| F14 | `SchedulePage` 未掛載到任何路由 | 🟡 中 | ⬜ 未開始 |

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

- `npm run lint`：通過。
- `npm run build`：通過。

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

---

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

- F1、F2、F3 已 commit 並 push 至 `origin claude/personalized-schedule-algorithm-6324a3`。
- F4~F14 尚未開始。
