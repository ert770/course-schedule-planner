# rag-tag-interest-v1 階段 6 第一階段：純候選計分核心

## 修改日期

2026-10-10

## 修改檔案

- `server/src/skills/tagInterestRanking.js`：新增獨立、無副作用的單課候選計分函式。
- `server/test/tagInterestRanking.test.js`：新增倍率、分項加總、中性資料、邊界與輸入驗證測試。
- `docs/PLANS/2026-10-10-rag-tag-interest-v1-stage6-interface-design.md`：將本次實作依據的階段 6 設計稿納入版本，讓 roadmap 連結可用。
- `docs/CHANGE_REPORTS/2026-08-01-personalization-roadmap.md`：更新 #43 階段 6 進度；重新核對整張進度總覽表的狀態與相依欄。
- `docs/CHANGE_REPORTS/README.md`：新增本報告索引。
- `docs/CHANGE_REPORTS/2026-10-10-rag-tag-interest-ranking-stage1.md`：新增本次變更報告。

## 主要改動

- 新增公式：`poolBaseScore × (1 + α_course × courseTagScore) + creditScore + textPreferenceMatchScore + legacyInterestKeywordScore + compactPreferenceScore + easePreferenceScore`。
- α 預設為 0.6、允許範圍為 0～1；標籤興趣分允許 -1～1 或 `null`。`null` 和 0 都使用倍率 1，但保留不同語意。
- 只將標籤倍率乘在非負池內基礎分；其餘五項分數各自加總並回傳 breakdown。
- 此純計分 helper 尚未接入 scheduler 或 scheduleService，因此不改變正式排課結果、API 或使用者畫面。
- #43 階段 6 已開始分段實作；候選池、profile 資料流、方案排序和 Persona／瀏覽器驗收仍待後續階段。

## 影響範圍

- 新增後端純函式與單元測試；尚未改變正式排課行為。
- 不新增 API、資料庫欄位、migration 或前端功能。

## 測試與驗證

- `node --test server/test/tagInterestRanking.test.js`：5/5 通過。
- `node --check server/src/skills/tagInterestRanking.js`：通過。
- `cd server && npm test`：1,468 通過、0 失敗、1 項略過（未設定隔離 MySQL 測試資料庫）；13 個 live model golden-set 案例 13/13 通過。

## Commit 與 Push

- 未 commit、未 push。
