# A2 修課歷史限制條件直通

## 修改日期

2026-08-12

## 修改檔案

- `server/src/services/constraintService.js`
- `server/test/constraints.test.js`
- `docs/CHANGE_REPORTS/2026-08-12-a2-course-history-constraint-passthrough.md`

## 主要改動內容

- 將排課限制中的 `completedCourseIds` 合併邏輯改為 `courseHistory` 直通。
- `courseHistory` 只取自已載入的 profile（`prefs.courseHistory`），不接受單次 request 覆蓋。
- 移除限制條件測試對 `completedCourseIds` 陣列合併語意的依賴。
- 新增測試，固定「profile 直通、request 被忽略、缺少 profile 資料時回傳空陣列」三項契約。

## 影響範圍

- REST 與 AI Agent 共用的排課限制建構流程現在會攜帶完整 `courseHistory`。
- 本次僅完成 Step 2 計畫的 A2。排課器依課號排除已修課程屬於 A3，尚未在本次修改中執行，因此 A2 單獨不宣告已修排除功能完成。
- 未修改 MySQL schema、前端畫面或 API payload 格式。

## 測試與驗證結果

- `cd server && node --test test/constraints.test.js`：通過，10 項測試全數成功。
- `server/src/**/*.js` 逐檔執行 `node --check`：全部通過。
- 根目錄 `npm test`：通過，270 項測試全數成功，0 項失敗。
- A2 是內部限制物件的 staged 修改，尚未形成獨立的使用者可見行為；瀏覽器 A/B 驗收留待 A3 接上排課器後一併執行。

## Commit 與 Push

- Commit：否。
- Push：否。
