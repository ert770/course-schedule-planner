# 2026-06-08 變更報告：Git Commit / Push 說明規範

## 修改日期

2026-06-08

## 修改檔案清單

- `AGENTS.md`
- `docs/CHANGE_REPORTS/2026-06-08-git-commit-push-summary-rule.md`

## 主要改動內容

1. 新增 Git commit message 可讀性規範。
   - commit 不能只使用模糊的一行訊息。
   - commit message 應使用清楚標題與條列式 body。
   - body 需列出該次 commit 的主要修改內容。

2. 新增 push 後回報格式規範。
   - 回報需列出 commit SHA、commit 標題、push 目標。
   - 回報需用條列式整理修改檔案分類、主要修改內容與測試結果。
   - 若本次只修改文件，需明確說明未修改程式邏輯與未執行不必要的前後端測試。

## 影響範圍

- 影響 Codex 後續 commit message 撰寫方式。
- 影響 Codex 後續 push 完成後的回報格式。
- 未修改前端、後端、排課邏輯或 AI Agent 程式碼。

## 測試與驗證結果

- 本次為文件規範修改，未執行前端 lint/build 或後端語法檢查。
- 將執行 `git diff --check` 檢查文件格式。
- 將依照 `AGENTS.md` 檢查 `git status`、`git remote -v`、目前 branch 與 `.env` ignore 狀態。

## Commit 與 Push

本報告建立後，將依照專案 Git 規範 commit 並 push 到：

```text
origin main
```
