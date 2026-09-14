# 2026-09-11 課程年級、Profile 擴充與已存課表接線

## 修改日期

2026-09-11

## 修改檔案與主要內容

- 後端資料層：讀取 `Courses.target_grade`／`prerequisites`，統一輸出 `gradeLevel`；接上 Profile 六個擴充欄位與 `Saved_Schedules` MySQL CRUD。
- 搜尋與排課：0 視為全年級可修，1～4 對應大一至大四，5 對應碩博士；班級年次另用 `classYear`。
- 前端：設定頁可維護學制、學程、學院與避開教師；課程卡與詳情顯示開課年級，先修 NULL 明示資料尚未提供。
- 開發啟動：前端改用同源 `/api`，Vite 預設代理至專案後端 `27151`，修正本機登入無法連線。
- 文件與測試：更新 API、schema、排課規格、roadmap 狀態並新增年級契約測試。

## 影響範圍

課程查詢、課程卡片、排課候選、Profile 儲存、已存課表與隱私匯出／刪除。
本次只接 #13D 資料欄位，不宣稱已取得 B～F 類、特殊身分或先修的官方規則。

## 測試與驗證

- `client npm run lint`：通過。
- `client npm run build`：通過（1,778 modules）。
- 全部 `server/src/**/*.js` 執行 `node --check`：80 個檔案通過。
- 相關後端測試：111/111 通過，包含帳號隔離、target_grade、搜尋、scope 與 scheduler 年級閘門。
- `npm test`：執行期間已輸出的測試皆通過，但整套程序在長時間無新輸出後仍未自行結束，人工中止；未宣稱完整 suite 通過。
- MySQL round-trip：建立一筆測試課表、讀回 schemaVersion/term/courses/totalCredits 後，以精確 ID 清除；資料表恢復 0 列。
- 瀏覽器 A/B：大三乙搜尋 16 筆且卡片均標示大三；切成大二乙後搜尋 20 筆且卡片均標示大二，完成後還原大三乙。
- 設定頁：既有非標準 `program_type` 顯示為「待確認」，未擅自正規化；Profile 擴充欄位可載入與送出。
- Browser console：本次流程無新增 error/warning。

## Commit / Push

- 本次依使用者指示建立 commit，並推送至 `origin/backend`。
- 工作樹中其他未核准變更維持未暫存，不納入本次 commit。
