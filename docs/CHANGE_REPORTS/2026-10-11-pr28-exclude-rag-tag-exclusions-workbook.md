# PR #28 移除不需提交的排除清單活頁簿

- 日期：2026-10-11
- 修改檔案：
  - `docs/CHANGE_REPORTS/2026-10-08-rag-tag-exclusions.xlsx`：從 PR 分支的版本追蹤移除；保留本機檔案，不納入合併內容。
  - 本報告：記錄 PR #28 的檔案範圍修正。
- 主要改動：PR #28 不再新增上述 Excel。標籤分類的 Markdown 報告、程式和其他文件不變。
- 影響範圍：只調整 PR 包含的檔案，不修改應用程式邏輯或活頁簿內容。
- 測試與驗證：此變更只移除二進位文件，不執行前後端測試；以 `git diff --check` 檢查補充報告與提交差異，並以 PR CI 驗證合併版本。
- Commit 與 push：此修正隨 PR #28 的 `backend` 分支提交並推送至 `origin/backend`；等待該提交的 CI 通過後再合併 PR。
