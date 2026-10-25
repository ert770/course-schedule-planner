# 2026-10-11 變更報告：修復 PR #27 全校課程搜尋

## 修改日期

2026-10-11

## 修改檔案

- `server/src/routes/courses.js`
- `server/src/skills/courseQuery.js`
- `server/test/courseQuery.test.js`
- `client/src/services/api.js`
- `client/src/pages/SearchPage.jsx`
- `docs/API_SPEC.md`
- `docs/CHANGE_REPORTS/2026-10-11-pr27-global-course-search-fix.md`

## 改動內容與影響範圍

PR #27 的「查詢全校課程」原本呼叫 `GET /api/courses`。此端點要求使用者提供系所、
年級與班別，因此全校搜尋會收到 `400 CLASS_NAME_REQUIRED`。

新增 `GET /api/courses/catalog`，從目前學期的全校課程套用關鍵字、課號、教師、星期、
節次、學分、語言及通識篩選，不要求個人班級。前端全校搜尋改呼叫此端點；依系所搜尋
仍使用原本的個人搜尋端點。全校目錄結果不代表個人修課或畢業認列資格，加入課表時仍
由原有流程檢查。

新增課程目錄篩選測試，並同步更新 API 規格。排課、興趣計分與資料庫內容未修改。

## 驗證

- `node --test server/test/courseQuery.test.js`：22 通過、0 失敗。
- `CI=true npm test`：1,423 通過、0 失敗、18 略過。略過項目依專案設定，是需要真實模型呼叫的 golden set。
- `npm run lint`：通過。
- `npm run build`：通過。
- `node --check server/src/routes/courses.js` 與 `node --check server/src/skills/courseQuery.js`：通過。
- Chrome 本機瀏覽器 A/B 使用一位 Persona UX 帳號：舊 API 在全校搜尋頁顯示「缺少班級資料」；新 API 搜尋「人工智慧」顯示 105 筆課程。通識篩選顯示 211 筆，結果均標示為通識。瀏覽器 console 有 0 error、0 warning。
- A/B 的 HTTP control `GET /api/courses` 回傳 `400 CLASS_NAME_REQUIRED`；treatment `GET /api/courses/catalog?keyword=人工智慧` 回傳 `200`、105 筆；`category=通識` 回傳 `200`、211 筆。查詢使用唯讀 MySQL 課程資料，沒有新增課程或修改使用者資料。

## Commit 與 Push

本變更隨 PR #27 的來源分支更新一併 commit，並推送至 `origin ui-ux-update`；更新後等待
GitHub checks 通過，再合併 PR。
