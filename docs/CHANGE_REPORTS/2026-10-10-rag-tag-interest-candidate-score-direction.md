# rag-tag-interest-v1 階段 6：候選興趣分數方向修訂

## 修改日期

2026-10-10

## 修改檔案

- `docs/PLANS/2026-10-10-rag-tag-interest-v1-stage6-interface-design.md`：明確記錄標籤興趣分數與候選／方案排序的單調正向關係。
- `docs/CHANGE_REPORTS/README.md`：新增本報告索引。
- `docs/CHANGE_REPORTS/2026-10-10-rag-tag-interest-candidate-score-direction.md`：新增本次變更報告。

## 主要改動

- 固定候選分數方向：`β_course` 不得為負；在既有候選分數相同時，標籤興趣分數越高，候選總分越高，並按總分由高到低排序。`active` 模式下係數須大於 0。
- 定義正分提高、負分降低、零分不改變既有候選分數；`null` 表示沒有可跨課匹配的標籤，不當成負分，也不排除課程。
- 固定方案分數方向：標籤方案分數越高，合併分數不得降低；沒有可評分方案分數時，忽略標籤軸並維持既有比較結果。
- 保留 soft ranking 邊界：標籤加分只影響軟性排序，既有候選分數和排課硬條件仍然有效；係數值仍待 shadow／Persona 校準。

## 影響範圍

- 僅修訂階段 6 設計稿與文件索引；未修改程式邏輯、API、資料欄位、資料庫、migration 或使用者可見行為。
- 本次確認的是分數方向與排序語意，不代表階段 6 排課介接已實作或係數已校準。

## 測試與驗證

- 前後端測試未執行：本次僅修改文件，沒有程式邏輯變更。
- 文件修改後執行 `git diff --check`，並檢查設計稿與變更報告索引連結。

## Commit 與 Push

- 未 commit、未 push。
