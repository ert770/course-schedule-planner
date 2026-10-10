# rag-tag-interest-v1 階段 6 排課介接設計稿

## 修改日期

2026-10-10

## 修改檔案

- `docs/PLANS/2026-10-10-rag-tag-interest-v1-stage6-interface-design.md`：新增階段 6 介接設計草稿，記錄現況、server-side scoring context、單課與方案層分數、資格與同意規則、feature flag、相容性、驗收及待確認決策。
- `docs/PLANS/2026-10-08-rag-tag-interest-v1-plan.md`：更新階段 6 為「設計稿已提出、待確認；程式未開始」，加入設計稿連結。
- `docs/CHANGE_REPORTS/2026-08-01-personalization-roadmap.md`：更新 #43 狀態與相依描述，記錄設計草稿；核對進度總覽表中其他任務的狀態與相依沒有被 #43 此次設計稿改變。
- `docs/CHANGE_REPORTS/README.md`：新增階段 6 設計稿索引。

## 主要改動

- 明確區分現有 scheduler 的候選課評分與方案比較評分；說明 rag-tag profile 尚未接入正式排課流程。
- 建議以獨立 tag-interest 軸、server-only request context 及 `off / shadow / active` 模式介接；標籤不參與硬性資格判斷。
- 記錄單課分數、方案平均、缺標籤／無訊號時的回退、同意來源、既有三軸曝光向量相容性，以及 counterfactual 的適用範圍。
- 文件標為草稿，列出係數、方案彙總範圍、曝光 snapshot 與反事實比較等待確認決策；沒有開始程式實作。

## 影響範圍

- 僅修改設計、計畫、roadmap 與文件索引；未修改程式、API、資料欄位、migration、資料庫或使用者可見行為。
- 設計草稿尚待確認，不等於已核准 scheduler 接線或任何上線排序參數。

## 測試與驗證

- 前後端測試未執行：本次僅修改文件，沒有程式邏輯變更。
- 執行 `git diff --check`，並檢查新增文件的相對連結與 roadmap #43 的狀態／相依；狀態總表其他列未因本稿改變。

## Commit 與 Push

- 未 commit、未 push。
