# rag-tag-interest-v1 階段 6 第二階段：同意感知的 profile shadow 資料流

## 修改日期

2026-10-10

## 修改檔案

- `.env.example`
- `server/src/skills/tagInterestRanking.js`
- `server/src/services/scheduleService.js`
- `server/test/tagInterestRanking.test.js`
- `server/test/scheduleService.test.js`
- `docs/PLANS/2026-10-10-rag-tag-interest-v1-stage6-interface-design.md`
- `docs/CHANGE_REPORTS/2026-08-01-personalization-roadmap.md`
- `docs/CHANGE_REPORTS/README.md`
- `docs/CHANGE_REPORTS/2026-10-10-rag-tag-interest-ranking-stage2.md`

## 主要改動

- 新增 `buildTagInterestContext()`，把每個候選班次的 `rag_tag` 解析為跨課配對合格的 canonical tags，產生以 `sectionId` 為 key 的分數、標籤覆蓋數、命中標籤、模型／目錄／資格版本與來源。
- 新增 `TAG_INTEREST_RANKING_MODE`。預設 `off`，不讀 profile 且沿用原 scheduler 呼叫；設成 `shadow` 時才以已載入的 prefs 呼叫既有 consent-aware profile service，再把 request-scoped context 傳入 scheduler runtime options。`active` 暫時安全視為 `off`。
- 未同意行為學習時，profile service 回傳的明確主題先驗標記為 `explicit-prior`；不讀行為事件。服務錯誤標記為 `unavailable`，分數為 `null`，排課 fail-open。
- scheduler 目前尚未消費這份 context；實際 scheduler 測試確認 `shadow` 與原流程的課表、方案順序及學分相同。沒有新增 API 回應欄位、資料表、事件或 migration，也沒有把 profile 分數持久化。
- 設計稿記錄已確認的 consent 假設：Persona 基準假設使用者已同意，但前端同意勾選框仍維持未勾選；未同意仍保留明確主題先驗分支。
- 更新 roadmap #43 與其完整狀態／相依表核對結果；其他任務狀態與相依均未變。

## 影響範圍

- 僅新增伺服器內部的 request-scoped shadow 資料流，正式排課排序與 API 輸出不變。
- 不修改前端、`scheduler.js`、資料庫 schema 或 `counterfactualForUser()`。
- 下一階段仍需讓 scheduler 消費 context，建立三個候選池的基礎分與標籤倍率，並驗證全域硬條件；本報告不代表標籤興趣已影響正式推薦。

## 測試與驗證

- `node --test server/test/tagInterestRanking.test.js server/test/scheduleService.test.js`：36/36 通過。
- 完整 `cd server && npm test`：1,482 項，1,481 通過、0 失敗、1 項略過（未設定隔離 MySQL 測試資料庫）；live model golden set 13/13 通過。
- `server/src/**/*.js`：105 個來源檔 `node --check` 全數通過。
- 實際 scheduler off／shadow 對照：相同候選與限制下，成功狀態、排入課程、方案順序及學分相同。
- 未做瀏覽器驗收：本階段沒有改變使用者可見畫面或 API 回應。

## Commit 與 Push

- 本報告撰寫時尚未 commit／push；後續依使用者明確要求執行，實際結果見本次最終回報。
