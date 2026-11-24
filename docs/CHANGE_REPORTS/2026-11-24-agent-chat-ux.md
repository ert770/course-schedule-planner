# 課表助理對話與提示

修改日期：2026-11-24（台北時間）

## 修改檔案

- `client/src/pages/DashboardPage.jsx` 載入登入者的歷史對話，加入思考提示，將排課等待文案改為「正在規劃課表…」。
- `client/src/components/Chat/ChatMessageContent.jsx`、`client/src/App.css` 加入段落、標題、粗體及清單排版，以及循環跳點與減少動態效果設定。
- `client/src/components/Schedule/ScheduleConfirmationBar.jsx` 將「符合」回饋的顯示時間從 5 秒縮短為 2 秒，再以 300 毫秒淡出。提示更換或元件卸載時會取消計時。
- `client/src/components/CourseCard/CourseDetailModal.jsx`、`client/src/index.css` 移除「依據來源」一行與相關樣式。
- `client/src/services/api.js`、`server/src/routes/chat.js` 加入讀取歷史對話的 API。
- `server/test/privacyRoutes.test.js` 驗證登入、同意、本人存取、禁止快取，以及清除聊天後的結果。
- `server/src/services/promptService.js`、`docs/PROMPT_DESIGN.md` 更新 Agent 的回覆排版規則。`docs/API_SPEC.md` 記錄歷史對話 API。

## 影響範圍

課表主頁會還原最近 50 則尚未過期的對話文字，沿用既有的加密儲存、30 天保留期限與隱私設定清除功能。排課提示出現在課表產生請求進行期間，等待 Agent 回覆期間顯示思考提示。課程詳情繼續顯示推薦理由與偏好命中等資訊。

## 驗證

- 前端 build、lint 與 150 個後端 JavaScript 檔案的語法檢查通過。
- `npm test` 以專案既有 CI 模式重跑，1,931 項通過、0 項失敗、14 項依 CI 設定略過。對話與隱私路由測試另行執行，4 項通過。
- 以 `.claude/launch.json` 定義的連接埠啟動 Vite 與 Express 隔離環境，在 Chrome 的課表主頁操作。環境使用記憶體聊天儲存與實際歷史讀取、清除路由，排課、Agent 回覆與回饋寫入使用測試資料。
- 對照排課請求進行中和完成後，前者顯示「正在規劃課表…」，後者顯示課表。送出訊息前沒有思考提示，等待回覆期間三點持續循環，回覆出現後移除。另以減少動態效果設定對照，文字仍顯示且停用跳點動畫。
- 回覆中的短標題、粗體、項目與編號清單均正確排版，HTML 標記以文字顯示。有歷史對話時重新整理會還原一輪對話及排版，清除後重新整理回到歡迎訊息。
- 按「符合」後顯示回饋成功文字，Chrome 實測約 2.34 秒移除。課程詳細視窗以含來源資料的課程驗證，畫面保留推薦理由並移除「依據來源」。最後一次瀏覽器驗收的 console 無錯誤。

## 版本控制

未 commit，未 push。
