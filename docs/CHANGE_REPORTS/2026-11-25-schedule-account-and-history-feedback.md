# 2026-11-25 課表帳號隔離與歷史修課喜好

## 修改與影響範圍

| 檔案 | 改動 |
| --- | --- |
| `client/src/contexts/AuthContext.jsx` | 首次啟動先確認 session，再載入帳號資料。帳號變更時重新建立頁面狀態，忽略前一帳號延遲回來的登入與同意狀態。 |
| `client/src/contexts/ScheduleContext.jsx` | 載入及儲存時附目前帳號，換帳號時中止前一筆載入，並檢查已存課表的擁有者。 |
| `client/src/pages/DashboardPage.jsx` | 產生課表時附目前畫面帳號，由伺服器核對 session。 |
| `client/src/services/api.js` | 拿到登出回應後才開始下一次登入。查詢 session 與已存課表時停用快取。 |
| `server/src/routes/schedule.js` | 已存課表成功回應標記為私有且停用快取。 |
| `client/src/components/Profile/HistoryFeedbackModal.jsx`、`server/src/services/historyFeedbackService.js` | 設定頁依學期顯示全部符合條件的已通過非必修課。首頁仍只主動詢問有當期班次和可比對標籤的課。 |
| `server/src/data/interactionEventSchema.js`、`server/src/services/interactionEventService.js` | 已確認是本人修過的歷史課可在沒有班次時保存喜好，沒有班次的回答不建立班次標籤快照。 |
| `server/test/accountIsolation.test.js`、`server/test/historyFeedbackService.test.js`、`server/test/interactionEvents.test.js` | 驗證前端帳號與 cookie 不符時拒絕載入、當期未開與無標籤的課均列出，以及無班次回饋仍需核對本人修課資料。 |
| `docs/API_SPEC.md`、`docs/DATA_SCHEMA.md` | 更新帳號核對、快取和歷史修課班次欄位的契約。 |

## 驗證

- 共用 MySQL 唯讀核對。Persona 7 與對照帳號分別有 38 筆、53 筆修課紀錄，學年、學期與課號組合沒有重疊。Persona 7 的 5 門、11 學分快照和對照帳號任一份已存課表的班次組合均不同。Persona 7 的快照儲存於台灣時間 2026-10-15，依本人資料重新試算得到 5 門、12 學分，班次組合也不同。未重現原回報的混用情境，未重置既有快照。
- 用同一個瀏覽器分頁由 Persona 7 切換至 Persona 6。首頁各自顯示 5 門、11 學分與 6 門、17 學分的已存課表，畫面名稱和課程皆不同。
- 在瀏覽器打開 Persona 5 的「個人資料設定 → 我修過的課 → 調整喜好」。原規則會略過 1 門當期未開課，清單從 7 門變成 8 門，分布於 5 個學期。對照帳號依原規則列 18 門，現行 API 列 25 門。瀏覽器 console 未出現錯誤或警告，喜好的寫入另外用隔離測試驗證。
- 前端 build、lint 與 151 個後端 JavaScript 檔案語法檢查通過。初次測試受沙箱 localhost 及外部模型連線限制，以允許 localhost 的 CI 模式重跑，1,978 項通過、0 失敗、14 項跳過，含真模型測試。

本次未執行 commit 或 push。
