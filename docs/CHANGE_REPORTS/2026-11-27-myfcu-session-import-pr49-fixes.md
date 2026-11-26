# MyFCU SessionImport 修正 PR #49 的三項匯入問題

修改日期為 2026-11-27。

## 修改檔案與影響範圍

| 檔案 | 變更 |
| --- | --- |
| `server/src/services/courseHistoryAutoImport.js` | 同名比對限於同一學年與學期。既有的 MyFCU 紀錄若兩個課號欄皆為空，須以同帳號、課名、學年、學期、班級、學分和成績唯一確認原紀錄，且新課號未被同學期其他紀錄使用，才在同一筆補上課號與目錄比對結果。預檢與確認共用判定。 |
| `client/src/utils/historyNameDedup.js` | 同批有課號列與無課號列時，以班級、學分及成績核對是否為同一次修課。合併保留唯一合法來源課號和原始來源列，候選不明或同組有多碼時列為衝突。 |
| `client/src/pages/ControlledHistoryMockPage.jsx` | SessionImport 預覽以「資料衝突」涵蓋課號、班級和成績，明細顯示課號與班級供核對。 |
| `server/test/sessionHistoryImport.test.js`、`server/test/historyNameDedup.test.js` | 涵蓋預檢唯讀、原筆補號、再次匯入、帳號隔離、候選與課號衝突、跨學期留存、兩種來源列順序及同組來源資料差異。 |
| `docs/API_SPEC.md`、`docs/DATA_SCHEMA.md` | 補記同名去重範圍、來源課號的判定與補值方式。 |

補號保留原 `history_id`、`source_attempt_key`、成績、學分和原始來源紀錄。目錄比對結果仍獨立保存，缺少目錄證據的課程維持未匹配。匯入使用既有欄位與唯一鍵。

## 驗證結果

- 三個匯入相關測試檔共 26 項通過。完整 `npm test` 共 2,062 項通過、14 項跳過、0 項失敗。前端 build、lint 與 `server/src` 全部 JavaScript 語法檢查通過。
- 在 Chrome 對照 PR head `fa9b1dac9741af88575821352dd4ccd5e32b3e78` 的匯入服務與去重邏輯及修正版。用 Vite、實際快照與匯入路由、記憶體資料庫替身及合成資料，操作 MyFCU 預檢、確認、歷史修課紀錄與首頁，兩版皆無瀏覽器 console 錯誤。
- 舊版重匯跳過原本缺少兩個課號的紀錄，修正版顯示更新一筆，確認後保留同一筆紀錄並補號，回首頁觸發一次重排。再次匯入全數跳過，保留既有課表。
- 舊版將跨學期同名換碼判成衝突，修正版保留兩學期各自的課號。舊版有無課號列順序不同會得到不同結果，修正版兩種順序均保留同一課號。多課號案例在修正版預覽列為衝突並顯示待核對課號。
- 驗證使用本機隔離資料，未連線至真實 MyFCU 或共用 MySQL。

實作與驗證階段的修改保留在本機，該階段未 commit、push 或發布 PR 留言。
