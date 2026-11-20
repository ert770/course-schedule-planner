# 課程主題選擇改版 Step B：interestSelections 進入 S_tag 先驗

## 1. 修改日期

2026-11-20

## 2. 背景

接續 [Step A](./2026-11-20-interest-selections-step-a.md)（資料模型）。這一步讓使用者選到的具體標籤真的成為
S_tag（`rag-tag-interest-v1`）的先驗，進而影響排課的候選分數。設定頁與追問流程尚未接上。

## 3. 修改檔案清單

- `server/src/data/interestSelections.js`（新增）
- `server/src/skills/tagInterestLearning.js`
- `server/src/services/tagInterestService.js`
- `server/test/interestSelections.test.js`（新增）
- `server/test/interestSelectionPipeline.test.js`（新增）
- `docs/DATA_SCHEMA.md`
- `docs/CHANGE_REPORTS/2026-11-20-interest-selections-step-b.md`（本報告）、`docs/CHANGE_REPORTS/README.md`

## 4. 主要改動內容

- **目錄感知的選擇解析 `resolveInterestSelections()`**：對照標籤目錄，判斷分類是否存在（大類別或子類別）、
  標籤是否存在、標籤是否可選（同時可學習與可跨課配對）、標籤是否屬於使用者當時選的分類。不合格的項目不丟
  例外，列在 `ignored` 並附原因（`unknown_category`、`unknown_tag`、`tag_not_selectable`、
  `tag_not_in_category`）。這裡只對照目錄，**不對照候選池**。
- **`buildExplicitTagInterest()` 讀 `interestSelections`**（依 ID，避開 39 個子類別與標籤同名的歧義）：
  - 分類只進 `categoryInterests`，**仍然不展開成底下的標籤**（沿用既有規則，沒有推翻）。
  - 只有使用者明確選的具體標籤得到先驗 `p₀ = 1`，`tagPriors` 的該筆帶 `source: 'selection'`。
  - 同一個標籤從多組多筆選到只算一次；名稱路徑（`interests`、`preferredKeywords`）行為不變，兩條路徑選到
    同一個標籤時以先建立的那筆為準。
  - 回傳多一個 `ignoredSelections`（診斷用，不寫進標籤興趣快取）。
- **`priorSignature()` 改為 export**（只加了 `export`），測試才能證明「選擇改變時快取簽章跟著變」。快取簽章
  本來就包含 `tagPriors` 與 `categoryInterests`，所以選擇改變時快取會自動失效重算，不需要改簽章邏輯。
- **刻意沒做**：`userTagVector.js` 只讀 `explicitTopics` 名稱，不讀 `tagPriors`，所以 **s_vec 不受影響**，
  也不會與 S_tag 重複放大；本次要求只調整 S_tag。

## 5. 影響範圍

- **使用者看得到的行為沒有改變**：設定頁、追問、API 路由都還沒接上；沒有 `interestSelections` 的使用者，
  先驗、標籤分、排課結果與之前完全相同（`ignoredSelections` 為空、`categoryInterests` 不變）。
- 有 `interestSelections` 的 Profile（目前只能透過 `POST /api/profile` 直接送）：選到的標籤得到先驗，
  含該標籤的候選課單課 S_tag 上升，候選分乘上 `1 + 0.6 × S_tag`。
- 未動 `scheduler.js`，不需要 S1-S10。
- 未推進 roadmap 任務的狀態（#43 延伸改版，尚未完成）。

## 6. 測試與驗證結果

- 新增 27 個測試，全數通過：
  - `interestSelections.test.js` 18 個（SP1～SP17）：目錄對照、各種不合格原因、分類不展開、名稱與 ID 重複、
    跨組去重與取消一組只撤該組、只選類別沒有標籤先驗、負向證據下 `p₀ = 1` 時分數約 0.333（不是 1）、
    `priorSignature` 只在選擇改變時才變且與順序無關。
  - `interestSelectionPipeline.test.js` 9 個（SPL1～SPL8，不連資料庫）：從存進 `preferences_json` 一路到
    先驗、標籤分、單課 S_tag、候選分、方案分，**每個斷言都有「沒選」的對照組**。結果：只有含被選標籤的課
    分數變成 1、候選分乘 1.6、名次第一；同類別沒被選的標籤、無關類別、沒標籤的課完全不變；只選類別時
    排課沒有任何變化；無效標籤 ID 不影響任何課。
  - 測試標籤一律從真實標籤目錄抽樣，不寫死名稱。
- 後端完整測試：1,641 個，1,640 通過、0 失敗、1 略過。
- `server/src/**/*.js` 共 117 個檔案加上新檔 `node --check` 通過。
- 沒有前端或 API 路由的行為改變，所以沒有做瀏覽器驗收；瀏覽器 Persona A/B 驗收留到最後一個 step。

## 7. 是否 commit 與 push

是，推到 `origin backend`。`docs/CHANGE_REPORTS/README.md` 原本就有別人尚未提交的索引，這次只提交本次新增的
那一行。
