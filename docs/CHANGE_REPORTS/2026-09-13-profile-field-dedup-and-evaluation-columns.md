# 2026-09-13 Profile 欄位去重、課程評量欄位接線與 v0 相容層修復

## 修改日期

2026-09-09 ～ 2026-09-13（分次完成，本次一併提交）

## 修改檔案

### 後端資料層

- `server/src/db/database.js`
- `server/src/data/creditPolicy.js`（新增）
- `server/src/data/profileSchema.js`
- `server/src/services/identityService.js`
- `server/src/services/memoryService.js`
- `server/src/routes/auth.js`
- `server/src/skills/scheduler.js`
- `server/data/users.json`

### 前端

- `client/src/pages/DashboardPage.jsx`
- `client/src/pages/GraduationPage.jsx`
- `client/src/pages/SchedulePage.jsx`
- `client/src/pages/SearchPage.jsx`

### 刪除的死檔案

- `client/src/pages/ProfilePage.jsx`
- `client/src/components/Profile/ProfileForm.jsx`
- `client/src/components/Layout/Navbar.jsx`（連同已空的 `Layout/` 目錄）
- `client/src/pages/HomePage.jsx`

### 測試

- `server/test/creditPolicy.test.js`（新增）
- `server/test/constraints.test.js`
- `server/test/courseScope.test.js`
- `server/test/databaseProfileContract.test.js`

### 開發工具設定

- `.claude/launch.json`

## 主要改動

### 1. `className`（班別）去重

`User_Profiles.class_name` 與 `users.json.className` 逐筆核對 4 位 demo 使用者的既有值
完全一致後，刪除 `users.json.className` 與相關後備讀寫路徑（`pickClassNameTarget()`、
`readClassNameOverrides()`、`applyClassNameOverride()`、`writeClassNameOverride()`、
`hasUsersJsonRow()`）。`User_Profiles.class_name` 是現在唯一儲存體，欄位偵測
（`hasUserProfileClassNameColumn()`）維持不變。

### 2. `name`（顯示名稱）去重與接線

`User_Profiles.name` 過去存在但零消費者。核對 `users.json.name` 與 DB 值後接上讀寫：
`mapUserProfileRow()` 輸出 `displayName`、`updateMysqlUserPreference()` 新增寫入分支。
`routes/auth.js` 的 `/login`、`/me` 過去直接回傳 `users.json` 該筆列，`name` 因此原樣消失；
新增 `withProfileDisplayName()` 補接 Profile 的 `displayName`，並嚴格排除
`User ${user_id}` 這種排課引擎內部用的合成佔位字串。`users.json.name` 確認全專案
zero consumer 後刪除；`identityService.js` 的 `resolveIdentityFrom()` 同步移除死欄位。

### 3. 大四最低學分 bug 修復（9 學分永遠沒生效）

`mapUserProfileRow()` 過去把 `targetCreditsMin` 寫死 12，經 `constraintService.js` 的
`input.minCredits ?? prefs.targetCreditsMin` 合併後變成明確存在的值，蓋過
`scheduler.js` 原本「四年級以上下限 9」的判斷——四年級下限從未在真實請求中生效過。
新增 `server/src/data/creditPolicy.js` 的 `resolveMinCredits(gradeLevel)` 作為單一真相
來源，`scheduler.js`／`database.js`／`memoryService.js` 全部改呼叫它。

### 4. `room`／`syllabus` 死別名移除

`mapCourseRow()` 的 `course.room`、`course.syllabus` 全專案 grep 確認零消費者
（皆已改用 `course.location`／`course.description`）後移除。

### 5. 課程評量 7 欄位接線

`Course_Sections` 新增的 `has_midterm`／`has_final`／`has_teamwork`／`has_presentation`／
`is_english_taught`／`assessment_summary`／`limit_amount`（對應容量上限）全部接上讀取路徑
（`null` 保留、不視為 `false`）。`limit_amount` 映射為 `course.capacity`：初版誤用
`normalizeNumber(value, null)`，因 `Number(null) === 0` 導致 NULL 容量誤報為 0；
改用新寫的 `normalizeNullableNumber()` 修正，並補上 regression 測試（`databaseProfileContract.test.js`
B11）。`CONTENT_PREFERENCE_RULES` 的 `noMidterm`／`noGroupReport`／`englishTaught`
改為優先信任這些欄位，缺席才退回關鍵字比對。全庫目前仍 100% NULL，資料補齊後自動生效。

### 6. ProfileForm 與相關死檔刪除

`ProfileForm.jsx`／`ProfilePage.jsx`／`Navbar.jsx`／`HomePage.jsx` 逐一 grep 確認
零剩餘參照後刪除。4 個主要頁面（Dashboard／Graduation／Schedule／Search）新增
「個人資料設定」下拉選單項目，導向既有的 `/setup`（`SetupPage.jsx`）作為新入口。
`DashboardPage.jsx` 移除自動排課呼叫中寫死的 `minCredits: 12`（改由第 3 點的年級判斷接手）。

### 7. `profileSchema.js` v0 相容層 regression 修復

2026-09-11 的課程年級改名（commit `a9421ab`）誤刪了 `gradeLevel` 的 v0 別名
（`?? profile.grade` 與對應的 `delete normalized.grade`），與同一函式裡
`maxCredits`／`avoidTime` 兩組相同性質的別名不一致，導致 `migrateProfileV0ToV1()`
對舊 profile 產出 `gradeLevel: null`（`server/test/profileSchema.test.js` 起初失敗）。
本次補回這兩行並加註解，說明三組別名要嘛一起留、要嘛一起退役，不能只改其中一組。
本次只修復 regression。整組退役 v0 相容層（`migrateProfileV0ToV1()`、
`storedSchemaVersion` 等 5 個無生產呼叫端、且共用 MySQL 至今未套用
`profile_schema_version` 欄位的死路徑）已於同日獨立處理完成，見
[退役 Profile v0 相容層](./2026-09-13-retire-profile-v0-compatibility.md)。

### 8. 開發環境 port 設定修正

`.claude/launch.json` 的 `server` 設定原寫死 `port: 3001`，與 2026-09-11 commit 把
`client/vite.config.js` 的 proxy 預設值改成 `27151`（對齊 `.env` 的 `PORT=27151`）
不一致，導致本機預覽環境登入一律 502。改為 `port: 27151`，與 `.env`／vite 預設一致。

### 9. 文件同步

`docs/DATA_SCHEMA.md` 的 `Course_Sections`／`User_Profiles` 欄位表、`className`（班別）
整節、`users.json 的職責` 段落皆已過時（仍描述已刪除的 `room`／`syllabus`／
`pickClassNameTarget()`／`users.json` 後備），一併更正為目前實作狀態，並新增
`min_credits`／`target_credits_min`／`target_credits_max` 三個零消費者欄位的說明
（疑似複製自已放棄的舊 SQLite 設計，預設值與現行校規不符）。`docs/API_SPEC.md`
補上 `/login`／`/me` 回應 `name` 欄位來源，以及 `minCredits` 依年級預設值的說明。

## 影響範圍

- 登入與 Profile 讀寫：顯示名稱與班別改為單一來源，行為對使用者透明（值不變）。
- 排課：四年級學生的最低學分下限首次真正生效（9 而非 12）；課程篩選新增 7 個
  評量特徵可用（目前全庫 NULL，尚無實際排序影響）。
- 前端：「個人資料設定」入口從已刪除的獨立頁面改為導向 `/setup`。
- 本次未修改 roadmap 任一編號任務的完成狀態，故未更動
  `2026-08-01-personalization-roadmap.md` 的進度總覽表。

## 測試與驗證

- `server/src/**/*.js`：全數 80 個檔案 `node --check` 通過。
- 後端測試（排除已知會 hang、與本次無關的 `interactionEvents.test.js`）：1028/1028 通過。
- 排課測試案例 S1-S10、N1-N15、X1-X18：186/186 通過（`scheduler.test.js`／
  `scheduleValidator.test.js`／`constraints.test.js`／`creditPolicy.test.js`）。
- `client npm run lint`：通過。
- `client npm run build`：通過（1,778 modules）。
- 瀏覽器 A/B（demo 帳號 `D1249697`）：
  - 登入／設定流程／Dashboard 全程無新增 console error（502 錯誤僅出現於修正
    `launch.json` port 之前，修正後重新整理即消失，全部 `/api/*` 請求回 200）。
  - Dashboard 顯示 `黃思瑜`（來自 `User_Profiles.name`，非 `users.json`）。
  - 點開使用者下拉選單，「個人資料設定」為第一個項目，點擊後正確導向 `/setup`
    並顯示既有 Profile 值（`大三`、`資訊三乙`、`資訊工程學系`）。
  - `avoidInstructors` A/B：呼叫 `POST /api/schedule/generate`，不帶限制時課表含
    `安全程式設計(蔡國裕)` 共 8 門課；帶 `avoidInstructors: ["蔡國裕"]` 時該課從
    課表移除、`excludedCourses` 正確標記 `constraintId: "AVOID_INSTRUCTOR"`、
    reason 為「不符合避開教師限制」（未落入 `scheduleValidator.js` 對未對應 reason
    的 `BLOCKED_PERIODS` fallback），課表門數 8 → 7。

## Commit / Push

- 依使用者指示建立 commit 並推送至 `origin/backend`。
