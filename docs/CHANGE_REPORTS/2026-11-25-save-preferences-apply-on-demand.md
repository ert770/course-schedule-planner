# 即時保存偏好與手動套用排課

日期 2026-11-25

## 修改內容與影響範圍

- `client/src/pages/DashboardPage.jsx` 讓首頁勾選與取消立即保存，連續勾選可接續操作。偏好與目前課表分開呈現，按「套用偏好排課」才等待最新偏好保存完成並重排。設定頁保存後返回首頁也等待使用者套用。
- `client/src/services/api.js` 讓設定頁讀取前等待尚未完成的保存。Agent 發送前等待首頁最新的偏好保存。只透過 Agent 修改偏好時，首頁刷新偏好並標示待套用。
- `server/src/services/agentService.js`、`server/src/services/promptService.js` 優先採用本回合的已保存偏好。明確查詢目前偏好和緊接偏好對話的「現在呢」，由伺服器讀取最新 Profile 並直接回答。其他對話仍由原有 Agent 流程處理。
- `server/test/preferencePipeline.test.js`、`docs/PROMPT_DESIGN.md` 補上 Agent 回報最新資料的驗證和規格。這次提交一併帶入先前核准、尚未發布的自動課表快照及共用偏好流程。

## 驗證

- Chrome 對照舊版每次勾選會重排，新版連續勾選不產生排課請求。按套用等待最後一筆保存，重排一次並自動保存新課表。
- 重現聊天取消「星期一排空」、左欄重新勾選、保存尚未完成時追問「現在呢」，確認 Agent 回報最新設定。驗證設定頁顯示同一份偏好，保存後返回首頁仍等候使用者套用。
- 瀏覽器使用本機隔離帳號與真正的偏好合併、排課及 Agent 最新狀態回覆程式，console 無錯誤。
- 前端 lint、build、151 個後端 JavaScript 檔案語法檢查及 `git diff --check` 通過。完整測試 2,007 筆通過、14 筆跳過、0 筆失敗。

## 版本控制

驗證後提交並推送 `origin backend`，保留 PR 開啟供審查。
