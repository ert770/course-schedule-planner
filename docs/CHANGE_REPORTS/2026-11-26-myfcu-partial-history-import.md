# MyFCU 部分修課匯入與待核對明細

修改日期為 2026-11-26。

- `server/src/myfcu/console-poc.js` 在兩個受影響分類辨識有明確未修課訊號的占位列。缺少必要欄位或格式無法解析的列保留在待核對明細。六個分類的表格皆可讀時，這兩類的待核對列可與正常紀錄一起預覽。
- `server/scripts/observeMyFcuCompatibility.mjs`、`server/src/services/localMyFcuPreview.js` 和 `server/src/services/historySnapshot.js` 將部分匯入限於本機 MyFCU SessionImport。保留原預檢及確認程序。表格缺失、必要表頭無法解析或其他分類異常時，後端不建立部分匯入快照。
- `client/src/pages/ControlledHistoryMockPage.jsx` 顯示待核對課程及欄位，並允許確認匯入正常紀錄。`docs/API_SPEC.md` 記錄快照與匯入規則。
- `server/test/historySnapshot.test.js` 和 `server/test/myfcuObservation.test.js` 涵蓋占位列、正常修課、待核對列與表格讀取失敗。
- Chrome 隔離驗收以兩筆占位列、兩筆正常修課及兩筆待核對紀錄確認部分匯入。正常紀錄寫入測試介面後進入偏好設定，待核對紀錄只出現在預覽。另一情境未讀到表格，畫面顯示擷取失敗，沒有匯入按鈕，也沒有寫入。
- 前端 build、lint、154 個後端來源檔及擷取腳本語法檢查通過。完整後端測試包含 Chrome 擷取測試，共 2,046 項通過、1 項跳過。已重啟本機後端，後端、前端代理及 MyFCU 預覽路徑皆回應 HTTP 200。
- 修改留在本機，未 commit 或 push。
