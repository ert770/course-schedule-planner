# 2026-11-25 本機 MyFCU 匯入與首頁重排

## 修改檔案

| 檔案 | 改動 |
| --- | --- |
| `package.json` | 新增 Windows 本機啟動指令 `npm run dev:myfcu`，前端與既有 SessionImport 後端搭配使用。 |
| `server/package.json`、`server/package-lock.json` | 加入擷取工具需要的 Playwright 開發依賴，搭配本機 Chrome。 |
| `client/src/pages/DashboardPage.jsx` | 依後端設定顯示可用的同步入口。匯入成功且新增紀錄時，保留匯入摘要，先隱藏舊課表再以新修課紀錄排課。失敗時保留摘要並提供重試提示。 |
| `docs/AIVEN_HISTORY_MIGRATION_RUNBOOK.md` | 補上 Windows 本機啟動及匯入流程。 |

## 影響範圍

本機 SessionImport 延用既有的排課帳號核對、預覽、本人確認及交易。匯入觸發的重排更新當前畫面的課表，既有快照仍需由使用者執行儲存才會更新。一般登入及正式站同步入口沿用既有規則。

## 測試與驗證

- 啟動實際 Windows 本機模式，首頁及健康檢查正常。瀏覽器從首頁開啟「同步 MyFCU 修課紀錄」並確認進入可匯入模式和看見開啟本機 MyFCU 視窗的按鈕。
- 使用虛構快照在瀏覽器對照三種情境。新增 1 筆時，等待與完成後均看不到舊課，完成後可見新課。新增 0 筆時保留原課表，排課 API 呼叫 0 次。重排失敗時維持舊課表隱藏，顯示錯誤，且「套用偏好排課」可用。
- 修正驗收資料缺少分類識別值後重跑，沒有新 console 錯誤或警告。
- 前端 build、lint 和 151 個後端 JavaScript 檔案語法檢查通過。後端 CI 測試 1,978 項通過、14 項跳過。另以安裝的 Chrome 跑六分類擷取模擬及 SessionImport 驗證，3 項通過。
- 真人 MyFCU 登入及匯入由同學本人操作。本次驗收未提交真實修課資料。

本次未 commit 或 push。
