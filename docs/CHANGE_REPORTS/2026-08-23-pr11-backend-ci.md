# 2026-08-23 變更報告：讓 PR #11 執行 GitHub Actions CI

## 修改日期

2026-08-23

## 問題

專案原有 `.github/workflows/ci.yml`，但 `pull_request` 事件只監聽 `main`。PR #11 的合併目標是
`backend`，所以建立 PR 與後續 push 都不會產生 GitHub Actions checks，reviewer 無法直接從 PR
確認前端 lint／build 與後端測試／語法檢查結果。

## 修改檔案

- `.github/workflows/ci.yml`
- `docs/CHANGE_REPORTS/2026-08-23-pr11-backend-ci.md`
- `docs/CHANGE_REPORTS/README.md`

## 主要改動

1. 在 `pull_request.branches` 加入 `backend`，讓 PR #11 及後續所有 targeting `backend` 的 PR
   在 opened、reopened、synchronize 等預設事件執行 CI。
2. 加入 `workflow_dispatch`，維護者可在 GitHub Actions 頁面手動重跑同一套驗證。
3. 保留原本 `main` pull request 與 `main`／`backend` push 觸發，不縮減既有保護範圍。
4. 保留最小權限 `contents: read`、同分支舊 run 自動取消及每個 job 的 10 分鐘 timeout。

## CI 功能

### Frontend lint and build

- 使用 `ubuntu-latest` 與 Node.js 24。
- 以 `client/package-lock.json` 建立 npm cache。
- 執行 `npm ci`、`npm run lint`、`npm run build`。

### Backend tests and syntax

- 使用 `ubuntu-latest` 與 Node.js 24。
- 以 `server/package-lock.json` 建立 npm cache。
- 執行 `npm ci`、`npm test`。
- 對 Git 追蹤的 `server/src/**/*.js` 逐檔執行 `node --check`。
- 未在 GitHub Actions 寫入正式 MySQL 或隱私金鑰；未設定 `DB_*` 時，資料庫契約測試依既有測試設計
  明確標示 skipped，其餘單元與 route 測試仍執行。

## 影響範圍

- PR #11 及後續以 `backend` 為 base 的 pull request。
- 不修改產品程式、API、資料 schema、課表演算法或使用者資料。
- 不修改 `server/data/users.json`、`server/data/saved_schedules.json`。

## 測試與驗證

- `npm run lint`：通過。
- `npm run build`：通過，Vite 轉換 1755 modules。
- `npm test`：481 passed、0 failed、0 skipped。
- 對 `server/src/**/*.js` 逐檔執行 `node --check`：通過。
- `git diff --check`：通過；只有 Windows LF／CRLF 轉換提示。
- push 後以 PR #11 的 GitHub Actions run 驗證 workflow 可被 `backend` pull request 事件觸發，
  並追蹤 `Frontend lint and build` 與 `Backend tests and syntax` checks 至完成。

## Commit 與 Push

- 本次變更依使用者指示 commit。
- Push 目標：`origin/codex/fix-pr3-course-search-schedule-sync`。
- 既有 runtime JSON 修改不納入 commit。
