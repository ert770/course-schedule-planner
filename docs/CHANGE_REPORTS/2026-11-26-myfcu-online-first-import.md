# MyFCU 首次匯入比對 Online 課名

修改日期為 2026-11-26。

- `server/src/services/courseHistoryAutoImport.js` 在本機 MyFCU SessionImport 預檢與確認匯入中，允許同課號的來源與目錄課名只差結尾的 `(Online)`。歷史紀錄保留 MyFCU 來源課名，並寫入匹配的目錄課號。既有紀錄的重複比對沿用相同的課名判定及原本的學年、學期和成績比對。
- `server/test/courseHistoryAutoImport.test.js` 涵蓋空帳號的預檢與寫入、後綴出現在目錄課名、同一筆修課再次匯入，以及實際課名衝突。
- Chrome 使用隔離修課資料與測試資料庫介面驗收。首次匯入新增一筆並進入偏好設定，重複匯入跳過一筆，實際課名衝突時確認按鈕停用。三個情境都未出現瀏覽器錯誤。
- 前端 build、修改檔案語法檢查及 20 項匯入相關測試通過。後端完整測試 2,031 項通過、14 項跳過。重啟後，前端、後端與 API 代理皆回應 HTTP 200。
- 依使用者指示提交並推送至 `origin backend`，發布結果以 Git 紀錄為準。
