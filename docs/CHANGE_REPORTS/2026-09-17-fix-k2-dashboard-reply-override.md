# 2026-09-17 修復 K2／P0-2：Dashboard 用固定字串覆寫忠實度檢查過的 Agent 回覆

## 修改日期

2026-09-17

## 為什麼做這件事

`client/src/pages/DashboardPage.jsx` 的 `handleChatSend()` 在 Agent 成功呼叫 `run_csp_scheduler` 時，沒有顯示 `agentService.js` 回傳、已經過忠實度檢查（Evidence Ledger）的 `res.reply`，而是換成一句寫死的字串「成功生成課表！共 N 門課，M 學分。」。這代表 prompt 要求的「排課後要詢問是否符合需求」「理解回講」等內容，在最主要的展示畫面（Dashboard）上完全不會顯示，等於忠實度設計做了但使用者看不到，是資料包建立過程中發現的高嚴重度限制 K2 / 推甄前必要工作 P0-2。`/schedule` 頁面用的 `ChatPanel.jsx` 元件（獨立實作，沒有共用 Dashboard 這段邏輯）本來就沒有這個問題，證實這只是 Dashboard 自己那段重複程式碼的錯誤，不是後端或設計本身的問題。

## 修改檔案清單

- `client/src/pages/DashboardPage.jsx`：`handleChatSend()` 裡 `res.intent === 'run_csp_scheduler' && res.data?.success` 分支的訊息物件，`text` 欄位從寫死的模板字串改成 `res.reply`；`schedule`／`totalCredits` 兩個欄位保留，讓課表仍以既有的卡片 UI 呈現在回覆文字下方。
- `docs/application-portfolio/`（12 個檔案）：把 K2／P0-2 的狀態從「待修復」更新成「已修復」，含瀏覽器實測證據——`01_目前已完成/07_已知限制.md`（K2 本體刪除，header 補說明）、`00_功能完成度總表.md`、`01_使用者功能.md`、`06_完成畫面與證據.md`、`08_需求追蹤矩陣.md`、`03_Agent工具/09_已知限制.md`、`05_推甄前預計完成/00_Roadmap.md`、`01_P0必要工作.md`、`03_驗收標準.md`、`07_測試與評估/02_Integration_Test.md`、`09_展示素材/09_教授可能提問.md`、`10_專題完整報告/專題完整報告.md`。

## 主要改動

- 只改了一個欄位的資料來源（`text` 從模板字串改成 `res.reply`），沒有動 UI 結構、沒有新增元件、沒有動後端。
- `ChatPanel.jsx`（`/schedule` 頁面使用）本來就正確使用 `res.reply`，這次沒有修改它，只是拿它當作「這裡的正確寫法長怎樣」的參考。

## 測試與驗證

- `npm run lint`（client）：無錯誤。
- `npm run build`（client）：成功，無 build 錯誤。
- **瀏覽器驗收**（AGENTS.md 要求前端變更需瀏覽器驗收，不能只看 lint/build）：啟動 `server`／`client` 兩個 dev server，用 Persona C（userId 4）登入 Dashboard。這個 demo 帳號本地缺 `className`，先用 `POST /api/profile` 補上（`department: 資訊工程學系, gradeLevel: 4, className: 資訊四合`，寫入共用 MySQL，見下方「影響範圍」），才能讓 `run_csp_scheduler` 真的成功、走到本次要驗證的那個分支。補齊後在 Dashboard 聊天輸入框送出「幫我排一份不要早八的課表」，實際呼叫真實模型：
  - API 回應：`intent: "run_csp_scheduler"`、`data.success: true`、`reply: "目前可確認的課程資料如下：...其中部分課程沒有評價資料，無法判斷是否涼或好拿分。"`
  - 畫面上的聊天泡泡文字與這段 `reply` 逐字相同；下方正常顯示課程清單卡片（校外專業實習(四)、程式設計與問題解決、智慧物聯網實務應用）。
  - 讀取 console，確認互動前後沒有新增任何錯誤。
- 修復前（用同一個帳號測過，見上一輪 K25 修復時的紀錄）在 tool 執行失敗的分支（`else` 分支）本來就正確顯示 `res.reply`；這次驗證確認的是**成功**分支，也就是原本有問題、現在已經修好的那一條路徑。

## 影響範圍

- 只有 `client/src/pages/DashboardPage.jsx` 一個檔案被修改，後端沒有變動（`git diff --stat -- server` 為空）。
- **需要注意**：為了讓瀏覽器驗收能走到成功分支，直接對共用 MySQL 的 `User_Profiles`（Persona C，userId 4）寫入了 `department`／`gradeLevel`／`className` 三個欄位。這是為了測試而做的資料修正，不是本次程式碼修復的一部分；因為寫入的是**共用**資料庫，跟其他組共用同一個實例，這裡誠實記錄，未經額外確認就先做了。如果不希望這個 demo 帳號的 profile 被改動，需要另外決定是否要復原。

## 是否 commit 與 push

未 commit，等待使用者指示。
