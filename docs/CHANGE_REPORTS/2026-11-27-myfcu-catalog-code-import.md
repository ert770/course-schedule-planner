# MyFCU 課號保存、比對與重匯

修改日期為 2026-11-27（台北時間）。

## 修改檔案與影響

- `server/src/services/courseHistoryAutoImport.js` 將合法 MyFCU 原課號保存到正式課號欄，並在既有 JSON 欄位獨立記錄匹配狀態、證據學期與來源。比對按原學期班次、原學期課綱、其他學期班次、其他學期課綱順序進行。重匯可補本人同一次修課的課號及比對狀態，保持原始修課事實。跨學期的同課號同名修課各自保存。
- `server/src/db/database.js`、`server/src/data/courseHistory.js` 讀回比對狀態，在歷史興趣來源中略過明確未匹配的紀錄。標籤向量、協同過濾和歷史喜好資格共用該來源。原有未標記的修課紀錄維持相容。
- `server/src/services/courseHistoryListService.js`、`client/src/pages/CourseHistoryPage.jsx` 根據獨立比對狀態保留既有歷史頁呈現。
- `client/src/pages/ControlledHistoryMockPage.jsx`、`client/src/pages/DashboardPage.jsx` 在預檢顯示更新筆數，只有更新、沒有新增時仍重排一次。全部跳過時保留原課表。
- `server/test/courseHistoryAutoImport.test.js`、`server/test/sessionHistoryImport.test.js` 驗證比對順序、課名衝突、未匹配仍保留合法課號，以及同筆更新和重試。
- `server/test/courseHistoryDatabase.test.js`、`server/test/courseHistory.test.js`、`server/test/courseHistoryListService.test.js` 驗證課號與狀態映射、歷史興趣資格和歷史列表。
- `docs/API_SPEC.md`、`docs/DATA_SCHEMA.md` 同步規則和欄位。

## 驗證

- 前端 build、lint 與 154 個後端來源檔語法檢查通過。
- 隔離環境的 `npm test` 使用 CI 模式。2,020 項通過、0 項失敗、32 項略過。六個相關測試檔另跑 49 項，全部通過。
- 以 Vite 和本機 Express 記憶體測試後端於 5173／27151 執行 Chrome 驗收。同步頁顯示新增 0、更新 2。預檢維持原資料，確認後更新同兩列，首頁只發出一次重排請求。實際排課器的同課號已修排除從 0 增至 1，同名不同課號班次未被此規則排除。
- 歷史頁驗證未匹配課號與既有提示仍顯示。以相同的記憶體標籤做對照，未匹配課不進 `s_vec` 歷史證據，也不提供 `s_cf` 修課訊號或列入歷史回饋清單。
- 再次操作同步頁，預檢顯示新增 0、更新 0、跳過 2。確認後沒有新增排課請求，瀏覽器 console 無錯誤。

## 範圍

驗收使用測試資料與實際匯入服務、排課器和學習函式。共用 MySQL 未連線或回填，未更動 `rag_tag`。未 commit 或 push。
