# 2026-06-08 變更報告：Lint、排課邏輯、中文編碼與瀏覽器測試

## 修改日期

2026-06-08

## 修改檔案清單

- `AGENTS.md`
- `.editorconfig`
- `client/src/App.jsx`
- `client/src/components/CourseCard/CourseCard.jsx`
- `client/src/contexts/AuthContext.jsx`
- `client/src/contexts/AuthContextValue.js`
- `client/src/contexts/ThemeContext.jsx`
- `client/src/contexts/ThemeContextValue.js`
- `client/src/contexts/useAuth.js`
- `client/src/contexts/useTheme.js`
- `client/src/pages/DashboardPage.jsx`
- `client/src/pages/GraduationPage.jsx`
- `client/src/pages/LoginPage.jsx`
- `client/src/pages/OnboardingPage.jsx`
- `client/src/pages/SearchPage.jsx`
- `client/src/pages/SetupPage.jsx`
- `server/src/routes/schedule.js`
- `server/src/services/agentService.js`
- `server/src/services/promptService.js`
- `server/src/skills/scheduler.js`
- `docs/CHANGE_REPORTS/2026-06-08-lint-scheduling-encoding-browser-test.md`

## 主要改動內容

1. 修正前端 lint 問題。
   - 拆分 `AuthContext` / `ThemeContext` 的 provider、context value 與 hook，符合 React Fast Refresh lint 規則。
   - 修正 `useEffect` dependency 警告。
   - 移除未使用的 prop、state 與 import。

2. 依照 `docs/SCHEDULING_LOGIC.md` 改寫排課邏輯。
   - 支援多方案推薦：必修優先、集中排課、涼課高分、興趣路徑、學分最大化。
   - 支援已選、關注、已修、重補修、必修優先等狀態。
   - 關注課程不計入學分、不參與衝堂判定，只回傳在 `watchedCourses`。
   - 支援早八、晚課、午休、封鎖時段、期中考、分組報告、討論課、平時成績、實作考、期末報告、英語授課等限制。
   - 回傳 `plans`、`excludedCourses`、`warnings`，方便前端或 Agent 顯示推薦原因與失敗原因。

3. 補齊 API 與 AI Agent 的排課參數傳遞。
   - `server/src/routes/schedule.js` 會把已修、已選、關注、重補修、偏好領域、數位學分需求傳入 scheduler。
   - `server/src/services/agentService.js` 的 `run_csp_scheduler` 同步支援上述條件。

4. 更新 AI Agent prompt。
   - 重寫 `server/src/services/promptService.js`，明確規範 Agent 不可編造課程資料。
   - 列出 `run_csp_scheduler` 支援的工具參數。

5. 處理中文編碼風險。
   - 新增 `.editorconfig`，固定 `charset = utf-8` 與 LF。
   - 實際檔案未偵測到 UTF-8 replacement character；PowerShell 顯示亂碼屬於終端輸出編碼問題。

6. 新增專案修改確認與報告規範。
   - `AGENTS.md` 新增「修改前先宣告檔案與內容，等待使用者確認」規則。
   - `AGENTS.md` 新增「每次修改後必須新增變更報告」規則。

## 影響範圍

- 前端登入、偏好設定、搜尋、Dashboard、畢業檢查頁面匯入方式與 hook dependency。
- 後端排課 API 與 AI Agent 排課工具呼叫。
- 排課結果資料結構增加 `plans`、`watchedCourses`、`excludedCourses`、`warnings` 等欄位，但保留原本 `success`、`schedule`、`totalCredits`、`courseCount`、`message`。
- 專案協作流程新增修改確認與報告要求。

## 測試與驗證結果

已通過：

- `cd client && npm run lint`
- `cd client && npm run build`
- `node --check server/src/app.js`
- `node --check server/src/routes/schedule.js`
- `node --check server/src/services/agentService.js`
- `node --check server/src/services/promptService.js`
- `node --check server/src/skills/scheduler.js`
- scheduler smoke test：確認關注課程不計入正式課表學分，`validateSchedule` 通過。
- `git diff --check`
- `.env` ignore 檢查：`git check-ignore -v .env` 顯示 `.gitignore:2:.env`。

瀏覽器測試：

- in-app Browser 控制插件初始化失敗，錯誤摘要為 `node_repl kernel exited unexpectedly` 與 `windows sandbox failed: spawn setup refresh`。
- 已改用實際本機 Chrome headless 作為備援瀏覽器測試。
- Chrome headless 成功開啟 `http://127.0.0.1:5173/`，DOM 中確認登入頁、中文標題與 `Smart Schedule Planner` 正常載入。
- Chrome headless 成功開啟 `http://127.0.0.1:3001/api/health`，回傳 `{"status":"ok"}`。

## 環境變數與 Git 注意事項

- AI Agent 需要 `GEMINI_API_KEY`。
- `.env.example` 提供範例。
- 真實 `.env` 不應 commit。
- 本次檢查確認 `.env` 已被 `.gitignore` 排除。

## Commit 與 Push

本報告建立後，將依照 `AGENTS.md` 規範檢查目前路徑、branch、remote 與 `.gitignore`，再 commit 並 push 到：

```text
origin main
```
