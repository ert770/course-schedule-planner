# Agent 偏好適用範圍與手動加選

修改日期為 2026-11-26。範圍為使用者第 15 項的第一批。

## 改動

- 短句只交代條件時，Agent 先問要本次套用還是保存。短答「這次」或「以後」會接續原條件及原先的重排意圖。
- 明確要求保存時更新帳號偏好，設定頁顯示已存時段和學分上限。只改條件時維持課表。
- 單次條件暫存於伺服器記憶體，10 分鐘內供下一次成功的手動重排使用。可從聊天要求重排，或按首頁的「套用偏好排課」。
- Agent 取得畫面上的手動加選班次並在排課前核對。手動加選與新封鎖時段衝突時回報原因並保留原課表。
- 時段增刪保留未指定的節次。「週三下午」在本次對話範例對應第 6 至 10 節。

## 修改檔案

- 前端｜`client/src/contexts/ScheduleContext.jsx`、`client/src/pages/SetupPage.jsx`、`client/src/services/api.js`。
- 後端｜`server/src/data/planningContextSchema.js`、`server/src/routes/chat.js`、`server/src/routes/schedule.js`、`server/src/services/agentService.js`、`agentToolRegistry.js`、`chatPreferenceService.js`、`constraintService.js`、`planningContextService.js`、`promptService.js`、`scheduleService.js`。
- 測試｜`server/test/preferencePipeline.test.js`、`server/test/prompt.test.js`、`server/test/requirementGate.test.js`。
- 規格｜`docs/AI_AGENT_SPEC.md`、`docs/API_SPEC.md`、`docs/PROMPT_DESIGN.md`、`docs/SCHEDULING_LOGIC.md`。

## 本機驗收

- Chrome 開啟本機 Vite，使用隔離的課表和帳號資料。以實際 Agent 處理及排課引擎驗證「週三下午不排，幫我重排」。追問前週三有課、零次重排，回答「這次」後重排一次、週三下午無課，手動加選仍在。
- 輸入「週三下午要打工」再答「以後」。設定頁顯示新時段，重排次數維持原樣。
- 暫時解除週三下午限制，再用首頁按鈕套用。週三課程回到課表，手動加選和帳號已存的限制保留。
- Chrome 未出現應用程式執行錯誤。前端 lint、build、152 個後端 JavaScript 檔案語法檢查通過。完整測試 2012 通過、14 跳過、0 失敗。
- 瀏覽器驗收以隔離資料注入帳號與課程來源。共用 MySQL 在此環境無法解析主機，真實模型題依測試設定跳過。另以模擬模型呼叫驗證同回合提出偏好與重排時，伺服器會先確認範圍。

本批保留在本機工作區，尚未提交或推送。
