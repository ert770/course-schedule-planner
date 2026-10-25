# 協同過濾與 User Embedding：階段 6 s_vec 以 shadow 接入排課

- 日期：2026-10-14
- 對應構想：[協同過濾與 User Embedding 的搭建方式](./2026-10-14-cf-user-embedding-design.md) 5.1～5.3、第 7 節階段 6
- 性質：**使用者看不到的變更**。shadow 不改變任何候選分、方案分或課表，只寫伺服器日誌。
- 另含：PR [ert770/course-schedule-planner#30](https://github.com/ert770/course-schedule-planner/pull/30)（`backend` → `main`，含階段 4、5 與標籤清理）已開，CI 通過。

---

## 1. 結論

1. **α 總和檢查**：`α_tag` 0.6、`α_vec` 0.2、`α_cf` 0.1，總和上限 0.9。設定超過上限、α 不是 0～1 的數字，
   或 `VECTOR_INTEREST_MODE` 設成尚未開放的 `active`，伺服器**拒絕啟動**，不靜默截斷。
2. **`s_vec` shadow 接進排課**：`VECTOR_INTEREST_MODE` 預設 `shadow`（可設 `off`）。每次排課為候選課計算 `s_vec`，
   以 0 計入，記錄「如果啟用，排序會差多少」：
   - 候選池：每個決策點的順序、第一名是否不同（候選分 + α_vec × 基礎分 × s_vec）。
   - 方案：方案分 + 方案偏好分 × α_vec × 平均 s_vec 後，名次與推薦方案是否不同；平均只計入有分數的自由選擇課，涵蓋率分開記。
   - `s_tag` 與 `s_vec` 的相關係數（構想第 9 節風險：兩者都來自 rag_tag，可能把同一個訊號算兩次）。
3. **D1249697 真實資料 shadow 結果**（離線呼叫 `generateForUser`，未帶 `surface`，不寫曝光事件）：

   | 項目 | 結果 |
   | --- | --- |
   | 課表與方案 | shadow 與 off **完全相同**（2 個方案） |
   | 候選 `s_vec` 分布 | 正向 395、負向 69、無分數 102 |
   | 與 `s_tag` 相關係數 | **0.53**（205 門兩邊都有分數） |
   | 候選池決策點 | 13 個中 13 個順序不同、**10 個第一名不同** |
   | 方案 | 2 個都有分數、涵蓋率 100%；名次與推薦方案**不變** |

   解讀：`α_vec` 0.2 對單課選擇影響不小（10/13 個決策點會換第一名），對方案名次沒有影響。
   相關係數 0.53 屬中度相關，`s_vec` 帶有興趣檔案以外的訊號，但也有一半重疊；`α_vec` 維持 0.2 是合理起點。
   **只有一位使用者，不能據此決定啟用**；要等更多使用者的 shadow 日誌。

---

## 2. 做了什麼

| 檔案 | 異動 |
| --- | --- |
| `server/src/skills/interestAlphas.js`（新增） | 三個 α、總和上限、`VECTOR_INTEREST_MODE` 解析與啟動檢查 |
| `server/src/skills/vectorInterestShadow.js`（新增） | 以班次為鍵的 `vectorInterestContext`、候選分布與相關係數、決策點比較、方案平均 s_vec |
| `server/src/skills/scheduler.js` | greedy 每個決策點記錄 shadow 比較（系外保留名額的決策點已依 s_vec 排序，不再比較）；方案層 shadow；統計以不可列舉屬性掛在結果上，不進 API 回應 |
| `server/src/services/scheduleService.js` | `loadVectorInterestContext()`：與標籤興趣檔案**並行**讀取；系外保留已算過同批候選的 s_vec 時直接沿用；彙總寫入日誌 |
| `server/src/services/externalInterestReservationService.js` | 抽出 `loadCandidateVectorScores()`，系外保留可接收已算好的結果 |
| `server/src/app.js` | 啟動時 `assertInterestConfig()` |
| `.env.example`、`docs/SCHEDULING_LOGIC.md` | 新環境變數與 shadow 規則 |

**適用範圍與標籤興趣相同**：只有可選課池（本系選修、通識、系外）的非必修、非指定、非實習課；
必修與指定課分數再高也不列入比較（VI-2）。

**效能**：一開始 shadow 讓 D1249697 每次排課多約 0.7 秒（候選 s_vec 計算排在標籤興趣檔案之後）。
改為兩者並行後，交替各跑 3 次：off 3.4～3.8 秒、shadow 3.5～3.9 秒（第一次 5.9 秒是建立課程向量索引）。

---

## 3. 測試與驗證

| 編號 | 內容 |
| --- | --- |
| VA-1～VA-4 | 預設 α 總和剛好 0.9；超過拒絕、調低另一項可以；α 範圍；模式只接受 off／shadow，active 拒絕 |
| VS-1～VS-5 | context 原因（scored／no_similarity／no-consent）；分布與相關係數只計入兩邊都有分數的課；相關係數邊界；第一名與順序分開計數；方案平均與涵蓋率 |
| VI-1～VI-5 | shadow 不改課表與方案、但記錄第一名會不同；必修不套用；off 時 scheduler 呼叫方式不變；系外保留沿用已算的 s_vec；shadow context 沿用或自行計算、off 不算 |

- `server/src` 全部 `node --check` 通過；`npm test` 1,563 項，1,562 通過、1 略過、0 失敗（含 S1～S10）。
- 啟動檢查實測：`VECTOR_INTEREST_ALPHA=0.3` → 「興趣模型 α 總和 1.000 超過上限 0.9」，未啟動；
  `VECTOR_INTEREST_MODE=active` → 「尚未開放」，未啟動。
- **A/B（D1249697，真實資料庫）**：同一個人、同一份候選，`vectorInterestMode` off 與 shadow 的方案與每個方案的課完全相同，
  只有 shadow 產生統計（見第 1 節第 3 點）。
- **瀏覽器**：開發伺服器以新程式重啟後，排課主頁按「套用偏好排課」，`POST /api/schedule/generate` 200、`success: true`，
  課表正常顯示；回應中沒有 shadow 統計。console 唯一的 502 是稍早後端重啟時的舊紀錄。
  本次按下排課會照常寫入一筆推薦曝光事件（一般使用行為）。
- 未修改前端，未執行前端 build／lint 以外的前端驗證（本次無前端改動）。

---

## 4. 已知限制與下一步

- shadow 彙總只寫日誌，沒有落地成可查詢的資料；要比較多位使用者時需要收集日誌，或之後改寫進曝光事件。
- 只有 D1249697 一位真實使用者的結果，不足以決定 `s_vec` 轉 active 或調整 `α_vec`。
- 下一步階段 7：新增 `collaborative_learning` 同意與 item-item 離線管線，CF 以 shadow 接入；結論需要真實樣本。

## 5. 是否 commit 與 push

已 commit 並推到 `origin backend`（PR #31）。
