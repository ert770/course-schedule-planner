# rag-tag-interest-v1 階段 5：合成情境與離線評估就緒度

## 日期

2026-10-09

## 修改檔案

- `server/scripts/tagInterestEvaluation.js`：新增評估 CLI；預設只執行 synthetic fixture，`--check-real-readiness` 才執行唯讀 aggregate 查詢。
- `server/scripts/lib/tagInterestEvaluation.js`：新增合成情境斷言、時間切分、排序指標、覆蓋率、多樣性、理由標籤一致性與資料就緒度工具。
- `server/test/fixtures/tagInterestEvaluationCases.json`：新增 9 個明確標記為 synthetic 的 persona 情境。
- `server/test/tagInterestEvaluation.test.js`：新增 7 組評估工具測試。
- `server/package.json`：新增 `eval:tag-interest` 與 `eval:tag-interest:real-readiness` 指令。
- `docs/PLANS/2026-10-08-rag-tag-interest-v1-plan.md`：記錄 Stage 5 工具、資料就緒度與限制。
- `docs/CHANGE_REPORTS/2026-08-01-personalization-roadmap.md`：更新 #43 階段狀態及相依；核對整張 roadmap 狀態／相依表，#43 為最後一項，沒有下游列需連動更新。
- `docs/CHANGE_REPORTS/README.md`：新增本報告索引。

## 主要改動

1. 合成案例直接呼叫現有 `rag-tag-interest-v1` 計算器，核對探索初始興趣、多標籤平均分配、指定標籤負向回饋、必修排除、單課標籤資格、瀏覽上限、時間衰減、高頻排除與已核准別名去重。
2. 合成輸出明確標註 `datasetType=synthetic`、`accuracyClaimAllowed=false`，並拒絕未標記為 synthetic 的 fixture，避免把角色扮演資料混成真人推薦成效。
3. 提供 NDCG@K、Precision@K、Recall@K、課程目錄覆蓋率、子分類多樣性及理由標籤一致性計算函式。沒有正向標註時回傳空指標，不推測相關性。
4. 時間切分依事件時間排序並穩定處理同時事件；相同時間戳的事件不會被拆到訓練集與測試集，若全部事件時間相同則回報無法切分。
5. 就緒度 CLI 只輸出彙總數字及原因，不輸出使用者 ID 或事件內容；它只判斷能否形成最小多使用者時間切分，不代表統計檢定力或推薦品質。

## 影響範圍與目前限制

- 本階段只新增離線評估工具，沒有把標籤興趣分接入排課器；排課介接仍是 Stage 6，需等真實離線評估與驗收。
- 9/9 synthetic persona 案例通過，這只證明指定規則與資料流符合案例，不是準確率或推薦品質證據。
- 2026-10-09 的唯讀資料盤點得到 30 筆有效標籤快照、1 位使用者、0 筆正向排課結果，以及 0 位具至少兩筆結果的使用者；因此真實時間切分評估尚未就緒。興趣快取表目前 0 筆。
- migration 008 對應的 schema 已透過唯讀查詢確認存在；本次沒有執行 DDL，也沒有向 MySQL 寫入資料。

## 測試與驗證

- `node --test test/tagInterestEvaluation.test.js`：7/7 通過。
- `npm run eval:tag-interest`：9/9 synthetic 情境通過，7/7 個推薦理由標籤符合候選課程標籤；未宣稱準確率。
- `npm run eval:tag-interest:real-readiness`：成功完成唯讀 aggregate 查詢；資料不足原因如上。
- `npm test`：1,461 項通過，0 失敗。
- `npm run lint`：通過。
- `npm run build`：通過。
- `server/src/**/*.js`、新增 CLI、評估模組及測試檔的 `node --check`：通過。
- 未執行瀏覽器驗收：本次沒有修改使用者可見畫面或排課行為。

## Git 狀態

- 未 commit、未 push。
