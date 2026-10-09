# rag-tag-interest-v1：後端事件與使用者標籤興趣檔案

## 修改日期

- 2026-10-09。

## 修改檔案

- 新增 `server/src/skills/tagInterestLearning.js`：事件快照、明確分類／標籤先驗、時間衰減、多標籤平均分權、每課瀏覽上限、興趣 profile 重算與新課程標籤分數。
- 新增 `server/src/services/tagInterestService.js`：讀取、重算、版本檢查、快取、隱私刪除及到期清理。
- 修改 `server/src/data/interactionEventSchema.js`：新增 `course_rated` 與 `interest_exploration_feedback` 契約，驗證評分、探索回答與 canonical tag IDs，拒收 client 標籤快照。
- 修改 `server/src/services/interactionEventService.js`：由 server 依事件當下課程、目錄版本及個人必修 scope 建快照；將評分、探索回答與快照一併持久化和匯出；保留冪等競態處理。
- 修改 `server/src/routes/privacy.js`：新增 `GET /api/privacy/tag-interests`，並把標籤 profile 接入本人匯出、個人化重設、撤回同意與帳號刪除。
- 修改 `server/src/services/preferenceLearningService.js`：個人化重設一併清除標籤興趣快取；既有 v2 三軸 learner 未改變。
- 修改 `server/src/data/privacyPolicy.js`：更新用途說明、資料項目及政策版本，涵蓋標籤興趣事件與 profile。
- 修改 `server/scripts/privacyCleanup.js`：把標籤興趣快取 180 天到期清理納入 `npm run cleanup:privacy`。
- 新增 `server/migrations/008_tag-interest-profile.up.sql`、`server/migrations/008_tag-interest-profile.down.sql` 與 `server/scripts/tagInterestMigration.js`：新增事件評分／探索欄位、標籤快取表及 dry-run 預設的 migration runner。
- 新增 `server/test/tagInterestLearning.test.js`、`server/test/tagInterestService.test.js`、`server/test/tagInterestSchema.test.js`；修改 `server/test/interactionEvents.test.js`、`server/test/privacyRoutes.test.js`。
- 修改 `docs/API_SPEC.md`、`docs/DATA_SCHEMA.md` 及本專案 roadmap，記錄 API、欄位、隱私生命週期與階段狀態。

## 主要改動內容

- 個人興趣以稀疏的 canonical tag profile 保存；寬泛主／子分類只保留為分類意圖，不自動把所有子標籤展開成正向興趣。
- 新行為事件使用 server 產生的版本化標籤快照。舊事件沒有快照時不按今天的目錄回推；所有必修課（本人或其他班級）都不提供學習標籤，必修範圍無法確認時亦 fail closed。
- 探索表示有興趣 `+1.0`、高分評價／收藏 `+1.0`、自願選修／接受單課推薦 `+0.5`、瀏覽 `+0.1`（每課累計上限 `+0.15`）。明確不感興趣與因內容不合退選提供負向證據；其他退選理由不當成主題反感。
- 每筆事件的總證據先套 120 天半衰期及舊學期 `0.5` 折減，再平均分給該事件的有效標籤。新課程分數只用符合跨課配對資格的標籤；本階段尚未把分數接入排課。
- 事件、標籤快照與興趣 profile 仍受 `personalization_learning` consent 約束，保留 180 天；撤回、重設、本人匯出、刪除帳號與清理命令均涵蓋新增資料。
- 新增 migration，但**沒有套用到共用 MySQL**。部署或實際啟用相關端點前需先套用 migration 008。

## 影響範圍

- 後端事件契約、隱私 API、標籤興趣 profile 與保存期限清理。
- 沒有新增前端探索頁，沒有改動排課器、課程排序或 v2 三軸權重，因此目前不會改變既有推薦／排課結果。
- Roadmap #43 狀態已改為「階段 3 後端程式完成、migration 待套用」；重新核對狀態／相依總表後，沒有其他任務列以 #43 作為已完成前置條件。

## 測試與驗證

- `node --test test/tagInterestLearning.test.js test/tagInterestService.test.js test/tagInterestSchema.test.js`：11 項通過。
- `node --test test/interactionEvents.test.js test/privacyRoutes.test.js`：56 項通過。
- `npm test`：1,449 項通過，0 失敗。
- `npm run build`：通過。
- `npm run lint`：通過。
- `node --check`：`server/src` 下 102 個 JavaScript 檔案通過。
- 瀏覽器驗收與 A/B 未執行：本階段尚無探索頁或排課介接可操作；相關畫面會在後續階段完成，且本次 migration 尚未套用。事件與隱私路徑已用記憶體 store 的 HTTP 整合測試驗證。

## Commit 與 Push

- 未 commit、未 push。
- 未對共用 MySQL 執行 migration。
