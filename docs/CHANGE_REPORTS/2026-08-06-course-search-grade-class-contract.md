# F7 課程搜尋班級契約修正報告

## 修改日期

2026-08-06

## 修改檔案

- `server/src/skills/courseScope.js`
- `server/src/routes/profile.js`
- `server/src/routes/courses.js`
- `server/src/skills/courseQuery.js`
- `client/src/pages/SearchPage.jsx`
- `client/src/pages/SchedulePage.jsx`
- `client/src/pages/SetupPage.jsx`
- `server/test/courseScope.test.js`
- `server/test/courseQuery.test.js`
- `docs/API_SPEC.md`

## 主要改動

- 後端從使用者完整班級（例如 `資訊三乙`）解析出 `department`、`grade` 與班別尾碼 `className`，透過 profile API 的 `courseSearchScope` 統一提供給前端。
- `GET /api/courses` 強制要求 `department`、`grade`、`className`，只接受 `className`，不接受 `class` alias。
- 缺少任一班級範圍欄位時回傳 HTTP 400 與「缺少班級資料，請先匯入學生班級再搜尋課程。」，不再執行廣泛搜尋。
- 課程搜尋限制為相同系所、年級及學生班別，並保留同年級的合班課程。
- 課程搜尋、排課頁課程抽屜與設定頁選修載入，都改用後端解析的班級範圍；API 失敗時不再顯示模擬選修課程。

## 影響範圍

- 課程查詢 API 的必要 query 參數與錯誤回應。
- Profile API 新增衍生欄位 `courseSearchScope`。
- 課程搜尋、排課與初始設定畫面的課程載入行為。
- 排課與 Agent 既有的內部課程查詢仍保留原有行為，不受 REST API 必填契約影響。

## 測試與驗證

- 後端所有 `server/src/**/*.js` 語法檢查通過。
- 前端 `npm run lint` 通過。
- 前端 `npm run build` 通過。
- 根目錄 `npm test` 通過：47 suites、230 tests。
- API A/B：未帶 `className` 時回傳 HTTP 400 與指定錯誤；帶入 `department=資訊工程學系&grade=3&className=乙` 時回傳 16 筆，班級只有 `資訊三乙` 與 `資訊三合`。
- 瀏覽器實測課程搜尋頁：由 D1249697 的 `資訊三乙` 顯示「資訊工程學系／大三／乙班」，搜尋結果為 16 筆，只包含本班必修與合班選修；瀏覽器 console 無 error 或 warning。

## Commit 與 Push

- 將依使用者指示與同批 F13、個人歷史修課資料變更一起 commit 並 push 至 `origin main`。
