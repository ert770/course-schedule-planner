# 2026-08-14 #13B 班級分類與 unknown eligibility 變更報告

## 修改日期

2026-08-14

## 修改檔案

### 後端

- `server/src/data/classKindCatalog.js`
- `server/src/skills/courseScope.js`
- `server/src/skills/courseCategory.js`
- `server/src/skills/scheduler.js`
- `server/src/services/promptService.js`

### 前端

- `client/src/components/CourseCard/CourseCard.jsx`
- `client/src/pages/SearchPage.jsx`

### 測試

- `server/test/courseScope.test.js`
- `server/test/courseQuery.test.js`
- `server/test/scheduler.test.js`
- `server/test/prompt.test.js`
- `server/test/database-contract.test.js`

### 文件

- `docs/API_SPEC.md`
- `docs/DATA_SCHEMA.md`
- `docs/DEPARTMENT_MAPPING.md`
- `docs/SCHEDULING_LOGIC.md`
- `docs/PROMPT_DESIGN.md`
- `docs/TEST_PLAN.md`
- `docs/專題進度報告.md`
- `docs/CHANGE_REPORTS/2026-08-01-personalization-roadmap.md`
- `docs/CHANGE_REPORTS/2026-08-14-complete-13b-class-eligibility.md`

## 主要改動

- 重新查詢現行 MySQL，確認 562 個相異 `Courses.dept` 全部可分類：483 個一般格式 A 類、8 個特殊格式 A 類、71 個 B～F 類。roadmap 原本的 51 個是過期盤點值。
- 建立明確班級目錄：B 全校共同與通識、C 學院綜合班、D 英語／國際班、E 學分學程、F 其他用途待確認班級。
- `parseClassName()` 統一回傳 `classGroup` 與 `classKind`；未收錄的新名稱回傳 `unclassified`，不再以模糊樣態猜測。
- 課程物件新增 `eligibility` 與 `eligibilityReason`。B～F 類在取得正式規則前一律為 `unknown`。
- 搜尋回應保留 unknown；排課自動候選保守排除並保留原因。使用者明確指定時保留課程，並警告「資格待確認」。
- CourseCard、搜尋頁與 Agent prompt 都能呈現 unknown，且 Agent 不得宣稱使用者確定可修。
- roadmap 將 #13B 標為完成；正式適用對象規則仍保留在 #13C／#13D。

## 影響範圍

- 課程搜尋：B～F 類課程仍可查詢，但會顯示資格待確認。
- 自動排課：資格未知課程不會再被靜默當成一般候選排入。
- 明確選課：使用者仍可保留自行指定的 unknown 課程，系統同時呈現風險原因。
- AI Agent：只能依工具結果說明資格未知，不得自行推論可修。
- MySQL schema 與資料未變更；本次只新增應用程式衍生欄位與靜態分類目錄。
- `server/data/users.json` 的既有未提交換行差異未使用、未覆寫。

## 測試與驗證

- `npm test`：322 項全部通過。
- `client/npm run lint`：通過。
- `client/npm run build`：通過。
- `server/src/**/*.js` 全檔 `node --check`：通過。
- MySQL 契約：562 個班級名稱無 `unclassified`；資料庫非系所名稱與 71 筆 B～F 目錄完全一致。
- 瀏覽器 A：隔離帳號自動排課顯示保守排除 170 門資格待確認課程；通識搜尋 211 筆均保留 classKind／eligibility 原因。
- 瀏覽器 B：明確指定週二的 C 類課程後，畫面產生 1 門、2 學分課表，課程保留且 warning 明列「資格待確認」。
- 瀏覽器 console：無新增 error 或 warning。

## Commit 與 Push

- 本報告與 #13B 程式、測試及規格文件一併 commit。
- Push 目標為 `origin backend`。
