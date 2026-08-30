# Roadmap #22 有限回溯方案文件變更報告

## 修改日期

2026-08-29

## 修改檔案

- `docs/PLANS/2026-08-29-roadmap-22-bounded-backtracking-repair-plan.md`
- `docs/CHANGE_REPORTS/2026-08-29-roadmap-22-plan-documentation.md`

## 主要改動

- 新增 roadmap #22 的 decision-complete 實作方案。
- 確認第一版採 bounded backtracking、greedy 失敗時 repair，以及每次請求共用 2 秒上限。
- 定義候選決策組、撤銷流程、deterministic 搜尋、solver 狀態及 final validator gate。
- 定義 repair timeout 後的兩層輸出：通過 validator 的合法 fallback，以及不得標為成功的
  `draftSchedule`。
- 定義 `unmetRequirements` 與 `clarification` 契約，供日後 Chat 詢問使用者指定課程、學分、
  時段與可調整偏好。
- 明確切分 #8、#20、#24、#25、#35 與 #22 的責任，避免 solver 推測未知 eligibility、先修或
  不可放寬限制。

## 影響範圍

- 本次只有規劃文件，未修改前端、後端、API、資料 schema 或排課行為。
- 文件未寫入任何 API key、secret 或帳號資料。
- 後續實作 #22 時，預期影響排課器、solver、API additive response fields、Chat clarification
  契約與相關測試文件。

## 測試與驗證

- 已確認 `docs/PLANS/` 的既有命名與 Markdown 結構後建立文件。
- 本次未修改程式邏輯，因此未執行不必要的前端 build、lint、後端語法檢查或測試。

## Commit 與 Push

- 未 commit。
- 未 push。
