# 修正 GitHub CI 身分測試與 Roadmap 進度整合

## 修改日期

2026-08-14

## 修改檔案

- `server/test/authRoutes.test.js`
- `docs/TEST_PLAN.md`
- `docs/CHANGE_REPORTS/2026-08-01-personalization-roadmap.md`
- `docs/CHANGE_REPORTS/2026-08-14-fix-ci-and-roadmap-reconciliation.md`

## 主要改動

### GitHub Actions 測試

- GitHub Actions 的 backend job 未提供 `DB_HOST`、`DB_USER`、`DB_NAME`，但原測試登入後要求 `/api/profile` 成功回傳 200。
- `/api/profile` 依正式契約只能讀取 MySQL `User_Profiles`；未設定資料庫時回傳 500 是既定行為，不是 session identity 失效。
- `authRoutes.test.js` 現在明確清除 DB 環境變數，只驗證 DB-less CI 可負責的身分邊界：未登入 401、登入後 `/auth/me` 成功、冒用另一身分在資料存取前 403、登出清除 cookie。
- Profile schema v1 仍由 `profileSchema.test.js` 的純函式測試驗證；成功讀寫 Profile 則保留給已設定 MySQL 的整合環境。

### Roadmap #12

- #12 維持「部分完成」，但修正舊文件中「排課器實際只有兩階類別」的過時結論。
- 確認 `courseCategory.js` 已衍生核心選修、一般選修與系外選修，`scheduler.js` 也有相符的優先度。
- `一般選修` 優先度由 scheduler P1/P2 回歸測試固定，從「待確認改動」整合為 #12A 已完成內容。
- 真正未完成項目收斂為 #12B：正式通識分類表、領域與適用學年度規則。

### Roadmap #28

- #28 詳細狀態由「未開始」修正為「部分完成」，與總覽表一致。
- 已完成 authenticated context、cookie session、移除 client user ID/default fallback、per-user onboarding/setup key、精確登出清理及 Graduation fallback 移除。
- 尚未完成同一瀏覽器雙帳號的 Profile、Chat、saved schedule、登出／切換／重新載入完整隔離驗收。
- interaction event 尚未由 #29 實作，因此其跨帳號驗收仍不可執行。

## 影響範圍

- 僅調整測試隔離方式與文件，不修改 production API 或排課邏輯。
- GitHub Actions 不再因缺少 MySQL secrets，把正確的 Profile 資料來源限制誤判成 session 測試失敗。
- Roadmap 的 #12、#28 狀態與目前程式及測試證據一致。

## 測試與驗證結果

- `node --test test/authRoutes.test.js`：2 tests 全部通過，測試內明確停用 DB 設定。
- `npm test`：301 tests、68 suites，全部通過。
- `node --check server/test/authRoutes.test.js`：通過。
- `git diff --check`：通過；僅有 CRLF 換行格式提示，沒有 whitespace error。
- 本次沒有修改使用者可見行為，因此未執行瀏覽器驗收。
- GitHub CLI 的既有 `ert770` token 已失效，無法直接重讀 Actions run；失敗原因取自使用者提供的完整 Actions log，並已用本機無 DB 重現確認。

## Commit 與 push

- 已納入 `fix(ci): isolate auth route tests from MySQL` commit。
- 已推送至 `origin backend`。
