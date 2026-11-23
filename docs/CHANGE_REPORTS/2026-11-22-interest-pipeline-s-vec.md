# 課程主題問答接管線：s_vec 段

- 日期：2026-11-22
- 背景：
  - s_vec 是標籤空間的使用者向量和課程的相似度，用在四個地方：探索卡同分排序、系外保留名額、排課的 `vectorInterest` 加分、探索頁「依你的修課與興趣」。
  - 使用者向量裡的「明確興趣」以前只讀舊的文字欄位 `interests`、`preferredKeywords`，用名稱比對，問答結果完全沒用到。
  - 上一段實測時也看到，只在舊欄位放「日語」，s_vec 仍會把日語課往前推。
- 使用者決定：
  - s_vec 改讀問答勾選的標籤；
  - 拿掉舊關鍵字的路徑，和探索卡（ADR-029）一致；
  - 四段都做完之後，再刪除舊欄位與資料。

## 修改檔案

| 檔案 | 內容 |
| --- | --- |
| `server/src/skills/userTagVector.js` | 明確興趣改成用 `resolveInterestSelections()` 取勾選的標籤 ID，經 `isVectorEligibleTag` 過濾後，照舊做成單位向量並乘上 priorMass。移除舊關鍵字的名稱路徑與 `sources.unmappedTopics`。修課紀錄、事件、計分都沒有改 |
| `server/test/userTagVector.test.js` | UV2 改寫；新增 UV-SEL1～4 |
| `docs/DECISIONS.md` | ADR-030 |
| `docs/API_SPEC.md` | 探索卡一節改成「s_vec 也不再讀舊欄位」 |
| `docs/TEST_PLAN.md` | 新增 UV-SEL 測試列 |
| `docs/CHANGE_REPORTS/2026-10-14-cf-user-embedding-design.md` | 初始向量一節補註：已改讀問答（不改寫原文） |
| `docs/CHANGE_REPORTS/2026-08-01-personalization-roadmap.md` | #43 延伸段：已完成三段 |

## 規則

- 問答勾選的標籤只要向量可用就進入明確興趣，包括策畫「人工智慧」選項裡勾的 too_common 標籤（人工智慧、機器學習）。
- 只選方向、沒勾標籤時，不加任何東西（方向不計分）。
- 目錄裡不存在的分類或標籤會被忽略。

## 驗證

| 項目 | 結果 |
| --- | --- |
| 後端 `CI=true npm test` | 1,797 項：1,796 通過、1 略過、0 失敗 |
| `node --check`（`server/src` 全部） | 通過 |
| `userTagVector.test.js` | 11 項全過 |

### 瀏覽器 A/B（D0009003，已同意個人化學習）

使用的是使用者自己啟動的 `node --watch` 後端與 Vite 前端。先備份 `interestSelections`、`interests`、`preferredKeywords`，每組存檔後讀取兩個 API：
- 探索頁「依你的修課與興趣」：`GET /api/exploration?mode=profile`，直接用 s_vec 排序；
- 探索卡：`GET /api/interest-exploration/cards`。

| 組別 | 設定 | `explicitTags` | 系外推薦前 5 | 探索卡前 4 |
| --- | --- | --- | --- | --- |
| A | 只在系外「語言、文學與溝通」勾「日語」 | 1 | 雲端服務應用於數據分析、人工智慧與大數據分析、**日語短劇**、大數據視覺化分析實作、智慧城市與環境模擬 | 日語讀解、日語短劇、日文（一）、韓文（一） |
| B | 問答清空，只在舊 `interests` 放「日語」 | 0 | 雲端服務應用於數據分析、人工智慧與大數據分析、大數據視覺化分析實作、智慧城市與環境模擬、科技創新與會計應用 | 大數據分析入門、雲端服務應用於數據分析、人工智慧實務案例分析、5G 發展與智慧生活 |
| C | 全部清空 | 0 | 與 B 完全相同 | 與 B 完全相同（8 張都相同） |

- **A 對 C**：勾了日語之後，日語短劇進入系外推薦第 3 名。
- **B 等於 C**：舊欄位已經完全不影響 s_vec。上一段實測時，B 組的日語課還被 s_vec 推到探索卡第 4、第 8 張，這次沒有了。
- **還原**：測完寫回備份，回應 `verified`，讀回三個欄位與備份完全相同。帳號原本在三組共勾了 8 個標籤，還原後 `explicitTags` 是 8。
- **探索頁（`/explore`）**：還原後的系外推薦第 1 名是人工智慧與大數據分析，共同主題的說明正常顯示，console 沒有錯誤，有截圖。
- **副作用**：A 組另外產生了一次排課，系統照常寫入一筆曝光事件。那次排課裡沒有日語課，所以排課加分不列入比較。

## 尚未處理

- **排課的興趣方向（`scoringPolicy`）**：還沒做，是最後一段。
- **探索頁說明文字**：仍寫「依你修過的選修、通識、系外課，以及收藏、加選、表示有興趣的課」，沒有提到問答勾選的主題。要不要改另外決定。

## 是否 commit 與 push

否。
