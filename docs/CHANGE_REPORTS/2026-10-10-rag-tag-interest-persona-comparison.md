# rag-tag-interest-v1：10 位 Persona 四組排序比較

## 日期

2026-10-10

## 修改檔案

- `server/scripts/lib/tagInterestEvaluation.js`：在固定候選集上重播三種 rag-tag profile 與現行 v2 learner／scheduler，計算排序指標與標籤理由忠實度。
- `server/scripts/tagInterestEvaluation.js`：在既有唯讀評估輸出中加入 persona 比較結果。
- `server/test/fixtures/tagInterestPersonaUxCases.json`：新增 10 位合成 persona、固定 10 門合成課程及可重播的角色扮演互動規則。
- `server/test/tagInterestEvaluation.test.js`：驗證四組排序、v2 十筆門檻、冷啟動、固定 top-K 及 synthetic 標記。
- `docs/PLANS/2026-10-08-rag-tag-interest-v1-plan.md`：更新階段 5、真人時間切分評估及階段 6 介接狀態。
- `docs/CHANGE_REPORTS/2026-08-01-personalization-roadmap.md`：更新 #43 階段狀態與相依，並核對 roadmap 狀態／相依總表。
- `docs/CHANGE_REPORTS/README.md`：加入本報告索引。

## 主要改動

1. 以同一批 10 門候選課比較四種排序：初始主題先驗、行為標籤檔案、先驗加行為的 rag-tag v1，以及現行 v2 learner 接既有排課器的結果。各模型都回報前 3 門課及 NDCG@3、Precision@3、Recall@3、目錄覆蓋率、子分類多樣性與理由標籤忠實度。
2. 合成角色扮演互動明確記在 fixture：P02–P07、P09、P10 各查看同一組 10 張合成課程卡；P01 與 P08 沒有行為事件，用來驗證冷啟動。瀏覽事件仍依正式程式的弱訊號規則計算。
3. v2 比較使用正式 `learnPreferenceWeights()`、`computeLearnedBoosts()` 與 `generateSchedule()`。8 位 persona 達到 10 筆可用事件門檻並套用 v2 學習權重；P01／P08 維持 insufficient 並退回顯式興趣。
4. 修正子分類多樣性計算，使其從固定候選課資料讀取分類，而不是從排序器的分數列讀取；CLI 的每人排序清單只輸出 top 3，避免報表過長。

## 離線比較結果

所有數字都是這批人工設定案例的平均值，不是學生推薦成效或準確率。

| 排序組 | NDCG@3 | Precision@3 | Recall@3 | 課程目錄覆蓋率 | 子分類多樣性 | 標籤理由忠實度 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 初始主題先驗 | 0.544424 | 0.400000 | 0.566667 | 0.60 | 1.00 | 6/6 |
| 行為標籤檔案 | 0.660480 | 0.433333 | 0.616667 | 0.80 | 1.00 | 40/40 |
| 初始先驗＋行為（rag-tag-interest-v1） | 0.745259 | 0.500000 | 0.700000 | 0.80 | 1.00 | 42/42 |
| 現行 v2 learner＋排課器 | 0.578420 | 0.566667 | 0.766667 | 0.90 | 1.00 | 不提供標籤理由 |

這組結果只說明：在目前的 persona 偏好標註與候選課設定中，v1 混合組的 NDCG@3 最高；v2 組的 Precision、Recall 及目錄覆蓋率較高。理由忠實度只檢查 v1 宣告命中的標籤是否真的存在於候選課，不等於學生認同推薦理由。

## 影響範圍與限制

- 只擴充離線評估腳本、合成 fixture、測試及計畫文件；沒有改正式 `scheduler.js`、排課服務、API、資料庫、前端或使用者推薦結果。
- 候選課相關性由 persona fixture 人工指定，角色扮演瀏覽也由固定 protocol 生成；不能據此宣稱真人推薦準確率、實際使用滿意度或統計顯著差異。
- 時間先後切分的真人評估依使用者決定列入未來上線規劃；目前樣本不足，不計算真實推薦成效。
- 排課介接暫緩，先重新設計標籤興趣分與既有偏好／方案排序的介面；本次沒有實作接線。

## 測試與驗證

- `node --test test/tagInterestEvaluation.test.js`：9/9 通過。
- `node scripts/tagInterestEvaluation.js`：9/9 基礎合成情境通過，10 位 persona 的四組排序成功產出；8 位 v2 學習權重實際套用，2 位維持冷啟動。
- `npm test`：1,463 通過、0 失敗、1 略過；略過項是需明確設定隔離測試 DB 的 MySQL 持久化測試。
- `npm run lint`：通過。
- `npm run build`：通過（Vite 顯示 plugin timing 提示，沒有 build error）。
- `node --check`：107 個 `server/src/**/*.js`、新增／修改的評估腳本及測試檔全部通過。
- 未執行瀏覽器驗收：沒有修改使用者可見行為或正式排課程式。

## Git 狀態

- 未 commit、未 push。
