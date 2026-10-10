# rag-tag-interest-v1 階段 6：三個候選池與候選分數資料流

## 修改日期

2026-10-10

## 修改檔案

- `docs/PLANS/2026-10-10-rag-tag-interest-v1-stage6-interface-design.md`：補上六項候選分數公式、三池候選資料流、池內分數邊界、全域硬條件檢查及年級扣分的待確認規則。
- `docs/CHANGE_REPORTS/README.md`：新增本報告索引。
- `docs/CHANGE_REPORTS/2026-10-10-rag-tag-interest-three-pools-score-flow.md`：新增本次變更報告。

## 主要改動

- 單課候選分數改為明列：`poolBaseScore × (1 + 0.6 × courseTagScore) + creditScore + textPreferenceMatchScore + legacyInterestKeywordScore + compactPreferenceScore + easePreferenceScore`。
- 說明標籤興趣分只乘同一候選池內可比較、非負的基礎分；其他分項各自相加。`null` 標籤興趣分的倍率視為 1。
- 候選分成「本系選修、通識、系外選修」三池，各依各自需求與名額形成候選；排課器共同搜尋並全域檢查衝堂、學分、先修等限制，不先獨立排完再拼接。
- 移除不同池之間的課程類別優先分與非本系扣分比較。現行 `−2500` 年級扣分若保留，只限本系選修池；是否保留列為待確認。
- 更新目標 Mermaid 資料流圖，保留第一節現況流程圖描述實際程式，不將設計誤寫成已實作。

## 影響範圍

- 僅更新階段 6 設計文件與變更報告索引；未修改程式邏輯、API、資料欄位、資料庫、migration 或使用者可見行為。
- 三池排課與新候選公式尚未實作；α=0.6 仍是待驗證的設計初值。

## 測試與驗證

- 前後端測試未執行：本次僅修改文件，沒有程式邏輯變更，也未執行不必要的前後端測試。
- 文件完成後檢查 `git diff --check`、公式例子、資料流與 Markdown 本機連結。

## Commit 與 Push

- 未 commit、未 push。
