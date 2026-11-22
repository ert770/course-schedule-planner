# 課程主題問答接管線：S_tag 段（服務層測試與排課實測）

- 日期：2026-11-22
- 背景：
  - S_tag 早在 2026-11-20（Step B）就開始讀 `interestSelections`：
    - 勾選的標籤先驗 p0 = 1；
    - 方向只記成 `categoryInterests`，不展開成標籤。
  - 純函式那段已經由 `interestSelectionPipeline.test.js` 的 SPL1～8 測過。
  - 還沒測的是服務層：真的 `getTagInterestProfile`，接到排課實際呼叫的 `loadTagInterestContextSafely`；以及改了問答之後，快取的標籤興趣檔會不會失效。
- 結論：程式不用改，這一段只補測試，並在瀏覽器實測排課。

## 修改檔案

| 檔案 | 內容 |
| --- | --- |
| `server/test/tagInterestService.test.js` | 新增 STS1～3（下表） |
| `docs/TEST_PLAN.md` | 新增 STS 測試列 |

| 測試 | 驗證什麼 |
| --- | --- |
| STS1 | 未同意個人化學習時，只勾問答標籤 A：來源是 `explicit-prior`，含 A 的課有 S_tag，不相關的課分數不變；沒勾時兩門都是 0 |
| STS2 | 已同意時先勾 A，會寫入快取；改成勾 Z 之後 A 的分數歸 0、Z 有分數。`priorSignature` 包含勾選的標籤，所以舊快取不會被沿用 |
| STS3 | 只選方向、沒勾標籤：S_tag 和沒選時完全相同，符合 A（只有勾選的標籤算分） |

## 程式路徑確認（沒有改動）

1. 問答存檔後，`interestSelections` 寫進 `preferences_json`。
2. `getTagInterestProfile`（`services/tagInterestService.js`）呼叫 `computeTagInterestProfile`，再由 `buildExplicitTagInterest` 用 `resolveInterestSelections` 產生勾選標籤的先驗。
3. `loadTagInterestContextSafely`（`services/scheduleService.js`）把先驗轉成每個候選班次的 S_tag。
4. 排課加上 α × 基礎分 × S_tag。

S_tag 的模式預設是 `active`（`resolveTagInterestRankingMode`），`.env` 沒有覆寫。

## 驗證

| 項目 | 結果 |
| --- | --- |
| 後端 `CI=true npm test` | 1,793 項：1,792 通過、1 略過、0 失敗 |
| `tagInterestService.test.js` | 6 項全過（含 STS1～3） |

### 瀏覽器 A/B（D0009003，資訊三甲）

使用的是使用者自己啟動的前後端。先備份 `interestSelections`、`interests`、`preferredKeywords`，兩組都呼叫 `POST /api/schedule/generate`，每次約 15 秒。下表列的是非必修課與推薦理由裡的 `tagInterest` 分數。

| 組別 | 設定 | 方案 1 | 方案 2 |
| --- | --- | --- | --- |
| A | 帳號原本的問答結果（本系「人工智慧」勾 4 個標籤，通識、系外也有勾選） | 智慧綠台灣 21.2、系統安全 1.2、**人工智慧導論 332.1**、資訊實務案例探討 3.4 | 人工智慧導論 332.1、**人工智慧入門與省思 300.0**、資訊實務案例探討 3.4、**人工智慧自然語言導論 361.7** |
| B | 清空 `interestSelections`，其他不變 | 智慧綠台灣 21.2、人工智慧導論 64.2、資訊實務案例探討 3.4、資訊安全管理 5.9 | 系統安全 1.2、人工智慧導論 64.2、資訊實務案例探討 3.4、智慧城市競爭力 24.6 |

- **人工智慧導論**：S_tag 從 64.2 升到 332.1。B 組剩下的 64.2 來自互動紀錄和舊關鍵字。
- **只在 A 組出現的課**：人工智慧入門與省思、人工智慧自然語言導論。
- **方案組成**：兩組產生的方案種類不同，A 組有「興趣導向方案」，B 組沒有。
- **還原**：測完寫回備份，回應 `verified`，讀回三個欄位與備份完全相同。
- **首頁**：課表顯示人工智慧導論等課，console 沒有錯誤，有截圖。
- **副作用**：排課成功時，系統會照常為這個帳號寫入推薦曝光事件，這次共兩筆，是一般使用時就會產生的紀錄。

## 尚未處理

- 舊關鍵字（`interests`、`preferredKeywords`）目前仍會透過名稱路徑影響 S_tag。四段都做完之後，會依使用者決定移除這兩個欄位和它們的資料。

## 是否 commit 與 push

否。
