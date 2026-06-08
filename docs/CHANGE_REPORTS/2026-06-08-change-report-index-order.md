# 2026-06-08 變更報告：調整變更報告索引排序

## 修改日期

2026-06-08

## 修改檔案清單

- `docs/CHANGE_REPORTS/README.md`
- `docs/CHANGE_REPORTS/2026-06-08-change-report-index-order.md`

## 主要改動內容

1. 新增 `docs/CHANGE_REPORTS/README.md` 作為變更報告索引。
2. 在索引中依新增時間由新到舊排列變更報告。
3. 使用 Markdown link 連到每一份變更報告，方便在 GitHub 上閱讀。

## 目前排序

1. `2026-06-08-change-report-index-order.md`
2. `2026-06-08-update-demo-login-credentials.md`
3. `2026-06-08-git-commit-push-summary-rule.md`
4. `2026-06-08-lint-scheduling-encoding-browser-test.md`

## 影響範圍

- 影響 `docs/CHANGE_REPORTS` 的閱讀入口與排序方式。
- 未修改前端、後端、排課邏輯或 AI Agent 程式碼。

## 測試與驗證結果

- 將檢查 `README.md` 中的 Markdown link 目標檔案是否存在。
- 將執行 `git diff --check` 檢查文件格式。
- 將依照 `AGENTS.md` 檢查 `git status`、`git remote -v`、目前 branch 與 `.env` ignore 狀態。

## Commit 與 Push

驗證通過後，將依照專案 Git 規範 commit 並 push 到：

```text
origin main
```
