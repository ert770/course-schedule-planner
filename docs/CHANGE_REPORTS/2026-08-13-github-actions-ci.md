# GitHub Actions CI

## 修改日期

2026-08-13

## 修改檔案

- `.github/workflows/ci.yml`
- `docs/CHANGE_REPORTS/2026-08-13-github-actions-ci.md`

## 主要改動

- 新增 GitHub Actions `CI` workflow。
- PR 目標為 `main` 時自動執行；推送至 `backend` 或 `main` 時也會執行。
- 前端 job 使用 Node.js 24，執行 `npm ci`、lint 與 production build。
- 後端 job 使用 Node.js 24，執行 `npm ci`、完整測試及
  `server/src/**/*.js` 語法檢查。
- workflow 權限限制為唯讀 repository content，並以 concurrency 取消同一 ref 上已過時的
  執行。

## 影響範圍

- 不修改前端或後端程式邏輯。
- PR #7 在本次 commit 推送到 `backend` 後會收到新的 CI checks。
- GitHub runner 沒有本機 `server/.env`；需要 MySQL 的資料庫契約測試會依既有測試設計
  明確標記為 skipped。其餘單元與整合測試照常執行，且不把資料庫憑證放進 workflow。
- 本 workflow 不執行瀏覽器驗收；使用者可見功能仍依個別變更報告記錄人工 A/B 驗證。

## 測試與驗證結果

- 本機 `npm run verify` 通過：前端 lint、production build，以及 283 tests／62 suites
  全數通過。
- 所有 `server/src/**/*.js` 均通過 `node --check`。
- 使用專案現有 ESLint 依賴內的 `js-yaml` 成功解析 workflow，確認頂層
  `name`／`on`／`permissions`／`concurrency`／`jobs` 與 `frontend`、`backend` jobs
  均存在。
- GitHub Actions 實際執行結果：推送後驗證。

## Commit 與 Push

- Commit：是，本報告與 CI workflow 一併提交。
- Push：是，推送至 `origin/backend`，觸發 PR #7 CI。
