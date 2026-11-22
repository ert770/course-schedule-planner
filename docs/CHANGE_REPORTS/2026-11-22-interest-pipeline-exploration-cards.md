# 課程主題問答接管線第 1 段：探索卡依問答結果挑課

- 日期：2026-11-22
- 背景：課程主題問答的結果存成 `interestSelections`，裡面是方向 ID 和勾選的標籤 ID。但雙卡探索挑課時只讀舊的文字欄位 `interests` 和 `preferredKeywords`，所以只做問答的學生，探索卡和什麼都沒填的學生一樣。
- 使用者決定：
  - 接管線從探索卡開始；
  - 探索卡**只讀問答結果**，拿掉舊關鍵字的名稱比對；
  - 相關度各項可以疊加。

## 修改檔案

| 檔案 | 內容 |
| --- | --- |
| `server/src/services/interestExplorationService.js` | `topicIntent()` 改用 `resolveInterestSelections()` 解析問答結果，產生勾選標籤 ID、大類 ID、子類 ID；分類命中改成比對 ID（`matchesSelectedDirection()`）；移除舊關鍵字的名稱解析。相關度公式、s_vec 同分排序和雙卡配對都沒改 |
| `server/test/interestExplorationService.test.js` | 既有的「主題相關課程優先」測試改用 `interestSelections`；新增 IE-SEL1～6 |
| `docs/API_SPEC.md` | `GET /api/interest-exploration/cards`：相關度來源與計算方式 |
| `docs/DECISIONS.md` | ADR-029 |
| `docs/TEST_PLAN.md` | 新增 IE-SEL 測試列 |

## 相關度（每門課，可疊加）

- 課程標籤中，每個學生勾選的標籤 +2。
- 課程分類路徑中，每條落在學生所選方向（大類或子類，含「人工智慧」策畫選項對應的子類）的路徑 +1。
- 課程屬於 `preferredTrack` 時 +1。

排序先比相關度，同分比 s_vec，再同分比課號。方向只用來排探索卡，不寫進任何分數，所以仍符合 A（推薦時只有勾選的標籤算分）。

## 影響範圍

- **只有舊關鍵字、沒做問答的帳號**：相關度一律是 0，探索卡改依 s_vec 和課號排序。
- **舊關鍵字還在哪裡用到**：
  - 仍然存著，S_tag 和排課照常讀。
  - s_vec 也還會讀，所以在同分排序時仍可能有影響（見下方 B 組）。這要等接 s_vec 那一段時再處理。
- **`buildInterestCategoryPrompts`**：沒改，它仍讀舊關鍵字。前端從 d32f8fa 起已經不讀 `categoryPrompts`，要不要刪掉另外決定。

## 驗證

| 項目 | 結果 |
| --- | --- |
| 後端 `CI=true npm test` | 1,790 項：1,789 通過、1 略過、0 失敗 |
| `node --check`（`server/src` 全部） | 通過 |
| 探索服務測試 | 14 項全過（含 IE-SEL1～6） |

### 瀏覽器 A/B（D0009003，資訊三甲）

使用的是使用者自己啟動的 `node --watch` 後端與 Vite 前端，改檔後已自動重新載入。

開始前先備份這個帳號的 `interestSelections`、`interests`、`preferredKeywords`。每組都用 `POST /api/profile` 存檔，再讀 `GET /api/interest-exploration/cards`。

| 組別 | 設定 | 前 4 張探索卡 | 第一組雙卡 |
| --- | --- | --- | --- |
| O | 全部清空 | 大數據分析入門、雲端服務應用於數據分析、人工智慧實務案例分析、5G 發展與智慧生活 | 大數據分析入門｜人工智慧實務案例分析 |
| A | 只在系外「語言、文學與溝通」勾「日語」 | 日語讀解、日文（一）、日語短劇、韓文（一） | 日語讀解｜韓文（一） |
| B | 問答清空，只在舊 `interests` 放「日語」 | 大數據分析入門、雲端服務應用於數據分析、人工智慧實務案例分析、日語短劇 | 大數據分析入門｜人工智慧實務案例分析 |
| C | 只選「語言、文學與溝通」方向，不勾標籤 | 日語讀解、韓文（一）、電影與文學、自然語言處理 | 日語讀解｜韓文（一） |

- **A 對 O**：勾了日語，前 3 張都是日語課，三組雙卡的第一張也都是日語課。
- **B**：舊關鍵字不再讓日語課排到最前面，前 3 張和 O 相同。但日語短劇（第 4）和日語讀解（第 8）仍然出現在卡片清單裡，原因是 s_vec 還在讀舊關鍵字，影響了同分時的排序。雙卡和 O 相同。
- **C**：只選方向時，該方向的語言、文學課往前排，排在第一的是日語讀解（方向命中後依 s_vec 排序）。
- **還原**：測完以 `POST /api/profile` 寫回備份，回應 `verified`，讀回三個欄位與備份完全相同。
- **探索頁**：
  - 打開 `/interest-exploration`，第一組雙卡是「人工智慧自然語言導論｜資訊實務案例探討」，和還原後帳號在本系勾的 AI 標籤一致。
  - 有截圖，console 沒有錯誤。
  - 這次測試開頁時在瀏覽器存了探索進度，原本沒有這筆，測完已刪除。
- **觀察（非本次造成）**：`/api/interest-exploration/cards` 一次約 3 秒，頁面會先停在「正在準備探索課程…」。

## 是否 commit 與 push

否。
