# 補清楚 Windows 本機 MyFCU 啟動設定

修改日期為 2026-11-27。

- `README.md` 區分一般開發與 Windows MyFCU 同步。說明前端使用相對 `/api`，一般開發預設代理到 `3001`，`npm run dev:myfcu` 啟動 `127.0.0.1:27151` 並設定相應的代理目標。列出所需 Chrome、Aiven MySQL 和 TLS CA。
- `.env.example` 改用 `VITE_API_BASE=/api`，說明 MyFCU 模式的後端埠由啟動指令設定。移除舊文字向量原型及已停用的探索說明。
- 本報告記錄文件範圍、驗證與推送目標。未修改程式邏輯。

## 驗證

- 從 GitHub 全新 clone `backend`，套用這次的文件差異，確認沒有本機環境設定或 CA。根目錄、前端與後端均使用鎖定檔安裝依賴。
- 檢查環境範例及 README 的設定與實際啟動腳本一致。使用 Vite 和隔離的 HTTP 測試介面，確認 `/api/health` 經代理抵達 `127.0.0.1:27151`。一般開發的代理目標仍是 `http://localhost:3001`。
- Windows MyFCU 啟動腳本在缺少本機 `.env` 時如預期停止並提示。探索索引檢查通過。驗證未連線至共用 MySQL，未登入真實 MyFCU。未執行不必要的前後端測試。

## 版本控制

提交與推送目標為 `origin/backend`。本機環境與憑證不在提交範圍。檢查時 PR #51 已合併，新文件另以後續 commit 留在 `backend`。
