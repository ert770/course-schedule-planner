# 三位組員歷史修課與個人化 Demo 資料

## 修改日期

2026-09-06

## 修改檔案

### Demo 資料與匯入

- `server/data/users.json`
  - 新增 user 2 黃廷崴、user 3 陳彥齊、user 4 黃思瑋。
  - user 2、3 暫無帳密；user 4 使用學號 `D1249196`、demo 密碼 `000`。
- `server/src/data/courseHistoryMarkdown.js`
  - 解析三份 Markdown 修課成績、依欄名讀取不同表格格式。
  - 排除缺少正式課號的列、合併完全相同的重複列；同一唯一鍵內容衝突時停止匯入。
- `server/src/data/demoPersonas.js`
  - 定義三組偏好 persona、每人 50 筆固定 ID 的互動事件與可重播 learned weights。
  - user 4 的匿名 subject 依 `D1249196` 衍生，與實際登入身分一致。
- `server/scripts/demoPersonasSeed.js`
  - 預設 dry-run；只有同時使用 `--apply --confirm-shared-mysql` 才寫入 shared MySQL。
  - 交易式寫入修課歷史、偏好標籤、consent、互動事件與 learned weights，並拒絕覆蓋非 demo 資料。
- `server/package.json`
  - 新增 `seed:demo-personas` 指令。

### Demo 身分支援

- `server/src/services/identityService.js`、`server/src/db/database.js`、`server/src/routes/auth.js`
  - null／空白學號不再被轉成共用字串 `"null"`。
  - 無學號的 demo 使用者以 numeric id 維持獨立 session 與資料查詢；有學號的 user 4 維持 studentId canonical identity。
- `client/src/utils/userIdentity.js`
  - 統一前端登入身分判定：優先 studentId，沒有時退回 numeric id。
- `client/src/contexts/AuthContext.jsx`、`client/src/contexts/ScheduleContext.jsx`
  - onboarding、setup、已存課表與個人化狀態可依上述身分隔離。
- `client/src/pages/SetupPage.jsx`、`client/src/pages/DashboardPage.jsx`、`client/src/pages/SchedulePage.jsx`、`client/src/pages/SearchPage.jsx`、`client/src/pages/GraduationPage.jsx`、`client/src/components/Chat/ChatPanel.jsx`
  - 無學號 demo session 不再被誤判成未登入，可完整操作設定、排課、搜尋、畢業進度與聊天。

### 測試與文件

- `server/test/demoPersonas.test.js`
  - 覆蓋 Markdown 解析、重複與衝突處理、50 筆事件可重播性及三軸證據充分性。
- `server/test/identity.test.js`
  - 覆蓋 null 學號的獨立 numeric identity 與身分比對。
- `docs/DATA_SCHEMA.md`
  - 記錄 `users.json` 職責、三位 demo 的修課匯入規則、警告與執行方式。
- `docs/CHANGE_REPORTS/2026-08-01-personalization-roadmap.md`
  - 更新 #36 的 demo 資料就緒程度、瀏覽器 smoke A/B 與仍缺少的固定條件量化 runner。

## 主要改動與資料結果

- Shared MySQL 的 `User_Course_History` 已寫入 user 2／3／4 各 55／55／58 筆，共 168 筆。
- 每人各有 50 筆合成互動與一列 `Learned_Preference_Weights`，三人都達 `sufficient`：
  - 黃廷崴：集中排課、避開早八；compact = 1。
  - 陳彥齊：挑戰難課、學到許多知識；interest ≈ 0.167。
  - 黃思瑋：涼課優先、期末報告；easy ≈ 0.906。
- `completed_courses` 未作為匯入或執行期來源；歷史修課只讀 `User_Course_History`。
- 缺正式課號的「專題研究(二)」與「大學基礎英文」未匯入。部分認列或缺少認列學分的列保留 warning，沒有猜測正式畢業分類。

## 影響範圍

- 增加可重播的三人 demo 資料，供個人化流程展示與後續 #36 固定條件 A/B runner 使用。
- null studentId 的 demo session 現在可操作完整前端流程；正式有學號帳號仍以 studentId 為 canonical identity。
- Synthetic 事件只用於 demo 與資料流驗證，不能作為真實效果或協同過濾樣本的證據。

## 測試與驗證

- `npm run seed:demo-personas --prefix server` dry-run 通過，重跑確認既有資料精確為 55／55／58 筆歷史、每人 50 筆事件及一列 learned weights。
- `node --test test/demoPersonas.test.js test/identity.test.js`：23/23 通過。
- `npm run verify`：client lint、Vite production build、server 938 項測試全部通過。
- `node --check`：`server/src/**/*.js` 與 `server/scripts/*.js` 共 79 個檔案通過。
- 瀏覽器實機驗證：
  - 黃廷崴：畫面載入集中／避早八偏好，主推 2 門、8 學分，偏好符合度 100%。
  - 陳彥齊：顯示「使用學習到的偏好」，主推 4 門、13 學分並呈現挑戰訊號說明。
  - 黃思瑋：顯示「使用學習到的偏好」，主推 4 門、13 學分，偏好符合度 72%，顯示涼度證據涵蓋警告。
  - 使用 `D1249196`／`000` 從登入頁登入成功，能讀取黃思瑋的標籤與 learned weights。
  - 所有上述情境的 browser console warning/error 均為 0。

## Commit 與 Push

- 未 commit。
- 未 push。
