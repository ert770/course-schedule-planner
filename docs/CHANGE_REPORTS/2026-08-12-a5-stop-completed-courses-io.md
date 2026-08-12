# A5 停止讀寫 MySQL completed_courses

## 修改日期

2026-08-12

## 修改檔案

- `server/src/db/database.js`
- `server/test/databaseProfileContract.test.js`
- `docs/CHANGE_REPORTS/2026-08-12-a5-stop-completed-courses-io.md`

## 主要改動內容

- `mapUserProfileRow()` 不再解析 `User_Profiles.completed_courses`，profile 物件不再產生 `completedCourseIds`。
- `getMysqlUserPreferences()` 的 SELECT 清單不再讀取 `completed_courses`。
- `updateMysqlUserPreference()` 不再接受 `completedCourseIds`／`completedCourses` 並寫回 `completed_courses`。
- 新增資料層契約測試，避免上述讀寫路徑日後被誤加回來。

## 影響範圍

- `courseHistory`（`users.json`）是本專案修課歷史的唯一真相來源；MySQL profile 不再承載修課歷史。
- 即使舊呼叫端仍在 payload 中帶入 `completedCourseIds` 或 `completedCourses`，資料層也不會把它們寫進 MySQL。
- A4 尚未執行；`graduation.js` 目前仍有讀取 `users.json` 舊派生欄位的程式碼。該路徑不讀 MySQL profile，因此不阻擋本次停止 MySQL 欄位 I/O，但仍須由後續 A4 修正。

## 共用 MySQL schema

- **未執行 `ALTER TABLE`。** `User_Profiles.completed_courses` 欄位仍存在於組員共用的資料庫，只是本專案程式已停止讀寫。
- 未來若要實際刪除欄位，必須與共用資料庫的其他使用者另行協調，不屬於本次修改。

## 測試與驗證結果

- 修改前來源基準：`database.js` 會 SELECT／解析 `completed_courses`、輸出 `completedCourseIds`，並接受 `completedCourseIds`／`completedCourses` 寫回該欄位。
- 修改後來源檢查：`database.js` 已完全不含 `completed_courses`、`completedCourseIds`、`completedCourses` 三個名稱。
- `cd server && node --test test/databaseProfileContract.test.js`：通過，2 項測試全數成功。
- 根目錄 `npm test`：通過，277 項測試全數成功，0 項失敗。
- `server/src/**/*.js` 逐檔執行 `node --check`：全部通過。
- 根目錄 `npm run lint`：通過。
- 根目錄 `npm run build`：通過。
- 獨立後端冷啟動：以測試埠 27152 啟動成功，`GET /api/health` 回傳 `ok`。
- 同一冷啟動程序的 `GET /api/profile?userId=D1249697`：不含 `completedCourseIds`／`completedCourses`，仍正常回傳 53 筆 `courseHistory`。
- Dashboard 實機：登入狀態、profile 偏好載入與排課正常；產生 8 門、23 學分課表，A3 已修排除提示仍正常顯示。
- Browser console：無新增 error 或 warning。
- 未送出會修改其他有效偏好欄位的測試 payload，避免為驗證 A5 而變更組員共用 MySQL 資料；停止寫入由來源契約測試固定。

## Commit 與 Push

- Commit：否。
- Push：否。
