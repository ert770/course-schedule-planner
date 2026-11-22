# 初始探索改為三題雙課程卡

修改日期：2026-11-22

## 改動與影響範圍

- `client/src/pages/InterestExplorationPage.jsx`、`client/src/pages/InterestExplorationPage.css`：每題顯示兩張課程卡，可勾選一張或兩張並前進，也可略過。卡片呈現已有課程摘要與 1～2 個代表標籤，未勾的卡不記負向證據。新版初始探索直接進雙卡，課程主題問答頁維持原流程。
- `client/src/services/interestExplorationState.js`：進度以題為單位保存。同一學期返回時保留配對。送出前記住當題的隨機請求 ID 和各課動作 ID，部分寫入、重新整理後仍沿用原 ID 重試。舊版未完成的單卡進度從新版第一題開始，完成或略過狀態仍保留。
- `server/src/services/interestExplorationService.js`：從當期合格選修配對，排除必修、已修、資格不符及沒有可用代表標籤的課程。配對優先選同類、主題不同的課。有足夠候選時產生三題，題目不重複課號。服務仍提供舊的平面清單與分類追問資料供相容。
- `server/src/data/interactionEventSchema.js`、`server/src/skills/tagInterestLearning.js`：新增 `paired_interested` 版本識別。每門勾選課程一筆事件，每個經伺服器核對的代表標籤名義正向證據各為 `+1`，再按原規則時間衰減。舊事件維持平均分攤。未同意個人化學習不保存回饋，無須資料表遷移。
- `server/test/interestExplorationService.test.js`、`server/test/tagInterestLearning.test.js`、`server/test/interactionEvents.test.js` 補配對、權重、相容性、去重與同意測試；`docs/API_SPEC.md`、`docs/DATA_SCHEMA.md` 同步規格。

## 驗證

- `CI=true npm run verify` 以上述程式與測試在本機執行，前端 lint、build 通過，後端 1,782 項通過、1 項略過。模型測試確認兩門課三個代表標籤各為 `+1`，舊事件仍各為 `+0.5`。
- Chrome 以獨立記憶體資料跑新版。第一題勾兩張，模擬第一筆成功、第二筆尚未處理時中斷。重新整理仍顯示第一題並保留勾選，重試回 `duplicate`、`append` 各一筆。第二題取消勾選可將「下一題」恢復停用，再選一張送出只寫一筆。第三題略過後回首頁，沒有送事件。
- 正常開發站 5173 的 Chrome 畫面確認真實課程第一題顯示兩張卡、進度為 1／3，沒有替使用者送出選擇。舊版獨立對照埠 5181 被瀏覽器權限阻擋，所以沒有重跑該端，僅使用先前已觀察的舊單卡畫面作比較。瀏覽器回饋寫入驗收使用隔離記憶體，未寫入共用 MySQL。

本次未提交或推送。
