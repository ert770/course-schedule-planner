# 首頁自動儲存課表與同步排課偏好

日期 2026-11-25

首頁偏好一度在每次勾選後立即重排，發布前改成自動保存並等待使用者按「套用偏好排課」。最終行為見 [即時保存偏好與手動套用排課](2026-11-25-save-preferences-apply-on-demand.md)。

## 修改檔案與影響範圍

- `client/src/pages/DashboardPage.jsx` 以置中提示顯示排課開始，1 秒後消失。首頁勾選或取消排課偏好和已選課程主題會保存並重排。補上課程主題編輯入口，並移除首頁的「儲存課表」與「保存變更」按鈕。Agent 儲存偏好後重讀同一份設定，當次對話沒有提供新課表時由首頁重排。
- `client/src/contexts/ScheduleContext.jsx` 在課表更新、切換方案、加退選或換課成功後保存帳號快照。保存依序進行、略過相同快照和已被更新的待存版本，並可還原使用者清空後的課表。
- `client/src/pages/SetupPage.jsx`、`client/src/App.css` 統一「解除避開」和處理中按鈕的尺寸，加入排課提示和首頁課程主題的樣式。`client/src/services/api.js` 讓個人資料設定讀取前等待尚未完成的偏好保存。
- `server/src/services/constraintService.js` 讓單次取消「星期一排空」確實生效並保留個別封鎖時段。`server/src/data/constraintSchema.js`、`server/src/skills/scheduler.js` 與 `server/src/services/promptService.js` 讓「不點名」參與排序，採用課程說明明寫不點名的正向訊號。
- `server/src/services/agentService.js` 依保存後的偏好更新當次對話的排課資料。`server/test/preferencePipeline.test.js` 驗證 15 項偏好的勾選、取消及排課結果，`server/test/prompt.test.js` 同步檢查 Agent 排課參數。
- `docs/API_SPEC.md`、`docs/PROMPT_DESIGN.md` 與 `docs/SCHEDULING_LOGIC.md` 補上自動快照、Agent 參數及排課規則。

## 驗證

- Chrome A/B 對照確認原版需手動保存，新版 15 項偏好逐項勾選與取消都會保存並重排。實測「不排早八」和「星期一排空」取消後，對應課程可重新排入。兩項限制的封鎖與其他內容、難度及集中度偏好另以現有排課引擎的時段、命中理由或評分核對。
- 瀏覽器實測課程主題加入及取消、首頁與設定頁互讀、偏好尚未保存就切換至設定頁、Agent 修改後重排、按鈕尺寸及排課提示消失。Agent 使用本機工具呼叫與隔離資料驗證。
- 驗證自動保存後刷新可還原、空課表可保存並還原、載回快照不重複寫入。瀏覽器 console 無錯誤。
- 前端 lint 和 build、151 個後端 JavaScript 檔案語法檢查及 `git diff --check` 通過。完整測試 2,006 筆通過、14 筆跳過、0 筆失敗。

## 版本控制

本次僅做本機修改與驗證，尚未提交或推送。
