# rag-tag-interest-v1 階段 6：對稱可調興趣倍率

## 修改日期

2026-10-10

## 修改檔案

- `docs/PLANS/2026-10-10-rag-tag-interest-v1-stage6-interface-design.md`：將候選與方案標籤興趣合併方式改為正負對稱的可調乘數，補上倍率範圍、例子及候選基礎分邊界。
- `docs/CHANGE_REPORTS/README.md`：新增本報告索引。
- `docs/CHANGE_REPORTS/2026-10-10-rag-tag-interest-symmetric-adjustable-multiplier.md`：新增本次變更報告。

## 主要改動

- 候選層採 `candidateBaseScore × (1 + α_course × courseTagScore)`；方案層採 `existingPreferenceScore × (1 + α_plan × planTagScore)`。
- `α_course` 與 `α_plan` 各限制在 `0～1`，分層校準；每一層的正向與負向共用同一 α。
- 以同一個 `+0.8/-0.8` 說明對稱性：α=1 時倍率為 `1.8/0.2`（加／減 80%）；α=0.25 時倍率為 `1.2/0.8`（加／減 20%）。α=0 時該層不受標籤興趣影響。
- 明確要求候選層先拆出同一候選池內可比較的非負基礎分；硬性資格、候選池結構與其他分數不得不加辨別地一起乘，避免負分乘較小倍率後反而變大。
- `null` 維持倍率 1、不改變分數，也不排除課程；它和有效標籤的中性 0 有不同語意。

## 影響範圍

- 僅更新階段 6 設計文件與變更報告索引；未修改程式邏輯、API、資料欄位、資料庫、migration 或使用者可見行為。
- α 與候選基礎分的程式介接尚未實作，且沒有宣告為已校準的上線參數。

## 測試與驗證

- 前後端測試未執行：本次僅修改文件，沒有程式邏輯變更，也未執行不必要的前後端測試。
- 文件完成後檢查 `git diff --check` 與 Markdown 本機連結。

## Commit 與 Push

- 未 commit、未 push。
