# 修復互動事件整合測試未關閉 MySQL pool，導致 npm test 延遲退出

日期：2026-10-02

## 問題

根目錄 `npm test` 會執行後端完整測試。`interactionEvents.test.js` 的斷言完成後，Node process 仍有連向設定資料庫的 TCP 連線，因此測試 runner 持續等待、沒有印出整套摘要。該測試 teardown 原本只關閉 Express server，沒有關閉由登入/profile 讀取建立的 MySQL connection pool。

## 修正

- `interactionEvents.test.js` 匯入既有 `closePool()`，並在 HTTP server 關閉後等待連線池結束。
- 不變更互動事件、登入或資料庫 runtime 行為；只補齊測試資源清理。

## 修改檔案

- `server/test/interactionEvents.test.js`：teardown 完成 server 關閉後呼叫 `closePool()`。
- `docs/CHANGE_REPORTS/README.md`：加入本報告索引。
- `docs/CHANGE_REPORTS/2026-10-02-fix-test-hang-mysql-pool.md`：記錄問題、修正與驗證。

## 影響範圍

僅影響測試結束時的資源生命週期；不修改產品程式、API、資料或使用者可見行為。

## 測試與驗證

- `node --test test/interactionEvents.test.js`：**52／52 通過**，約 4.5 秒自然退出，exit code 0。
- 根目錄 `npm test`：**1353／1353 通過**，約 29.2 秒完成並印出摘要，exit code 0。
- `node --check test/interactionEvents.test.js`：通過。
- `git diff --check`：通過；只有既有的 LF／CRLF 提示。

## Git 狀態

未 commit、未 push。
