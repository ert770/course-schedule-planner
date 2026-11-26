# MyFCU 歷史修課學期比對

修改日期為 2026-11-26。

- `server/src/services/courseHistoryAutoImport.js` 讓本機 MyFCU SessionImport 依修課學年、學期、課號比對 `Course_Syllabi` 和同學期開課。開課目錄有對應課名時也核對名稱，保留 `(Online)` 後綴規則。新增共用規則的唯讀重比對；未新增資料表。
- `server/src/services/courseHistoryListService.js` 與 `client/src/pages/CourseHistoryPage.jsx` 在未匹配的 MyFCU 紀錄缺少修課學期目錄時顯示「缺少該學期比對資料」。已有該學期目錄但仍未匹配的紀錄維持「未匹配」。
- `server/test/courseHistoryAutoImport.test.js`、`courseHistoryListService.test.js`、`sessionHistoryImport.test.js` 涵蓋同學期、不同學期、缺目錄、唯讀預跑及重複匯入。`docs/API_SPEC.md`、`docs/DATA_SCHEMA.md` 補記規則。
- 以唯讀方式重比對 22 筆未匹配紀錄，確認其中 2 筆可補匹配。經使用者確認後以單筆交易回寫這 2 筆，重新讀取確認共 33 筆、13 筆已匹配，另外 20 筆顯示缺少該學期比對資料。
- Chrome 使用隔離資料驗收歷史修課頁的缺學期、一般未匹配及已匹配顯示。前端 build、lint 和 154 個後端來源檔語法檢查通過。後端測試 2,035 項通過、14 項跳過。
- 依使用者指示提交並推送至 `origin backend`，發布結果以 Git 紀錄為準。
