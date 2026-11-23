# 課程主題問答：三層沙漏細項頁（預算分群、熱門、搜尋）

- 日期：2026-11-22
- 依據：設計稿 `docs/PLANS/2026-11-22-interest-questionnaire-funnel-design.md`（v2）。分群走過兩輪驗證：spike 1（同課共現，no-go）、spike 2（語言模型分群），之後跑了找標籤 A/B（`docs/PLANS/2026-11-22-interest-questionnaire-funnel-ab.md`）。
- 使用者決定：
  - 計分選 A：只有勾選的標籤算分；
  - 熱門標籤放在最上面；
  - 漏掉的 ID 不塞進「其他」，改退回完整清單；
  - 先預算分群、驗證完整後才給學生看。

## 修改檔案

| 檔案 | 內容 |
| --- | --- |
| `server/scripts/buildInterestTagClusters.js`（新）、`server/package.json` | 離線預算分群（`npm run interest:build-clusters`）：呼叫語言模型，驗證完整後才存；失敗重試一次，仍失敗就不存 |
| `server/src/data/interestTagClusters.js`、`interestTagClusters.json`（新） | 查表：鍵是方向 ID＋排序後的標籤 ID；命中後再核對群員，對不上就當作沒有分群。目前收錄資工四個 Persona 班級，共 48 個方向 |
| `server/src/services/interestQuestionnaireService.js` | `stage=detail` 一次回傳這組所有方向：12 個以下直接列；13 個以上有分群就回傳群卡、熱門 3 個與完整清單（給搜尋用），沒有分群就退回完整清單。拿掉細項的語言模型改寫與 3 個一批翻頁 |
| `server/src/data/interestQuestionnaireCopy.js`、`interestMenuConfig.js` | 細項頁改用一句共用題幹；移除用不到的設定 |
| `client/src/components/Profile/InterestQuestionnaire.jsx` | 細項頁改成方向區塊：熱門列、收合群卡（群名＋2 個代表標籤，點了才展開，先列 6 個＋「更多」）、同頁搜尋、完整清單（先列 12 個＋「更多」）。第 4 個以後的方向預設收合。已存的標籤預先勾好。確認頁加上「只選了方向」的提醒，附「回去選」 |
| `client/src/utils/interestQuestionnaireDraft.js` | 細項頁有作答時以作答為準（取消勾選的已存標籤不保留）；按略過時保留已存標籤 |
| `client/src/App.css` | 細項頁樣式；窄螢幕時方向標題可換行 |
| 測試 | `server/test/interestTagClusters.test.js`（新，7 項）；`interestQuestionnaireService.test.js` 細項部分改寫（QN11～QN15b）；`interestQuestionnaireDraft.test.js` 新增 QD13，QD8 依新行為修正 |
| 文件 | `API_SPEC.md`（stage=detail 新格式）、`PROMPT_DESIGN.md`（分群提示詞）、`DECISIONS.md`（ADR-028）、`DATA_SCHEMA.md`、`TEST_PLAN.md`；設計稿、spike 1、spike 2、A/B 報告 |

## 驗證

| 項目 | 結果 |
| --- | --- |
| 後端 `CI=true npm test` | 1,773 項：1,772 通過、1 略過、0 失敗；`node --check`（server/src、scripts）全部通過 |
| 前端 lint、build、單元測試 | 通過；前端單元測試 26 項全過 |
| 預算分群建檔 | 模型呼叫 54 次；48 個方向通過並存檔；一甲系外「商業與管理」重試後仍漏標籤，沒有存 |

### 瀏覽器（D0009003，重開前後端後）

開始前先備份這個帳號已存的主題選擇（使用者之前存的），測完原樣寫回，並確認完全相同。

1. **本系細項頁**：
   - 「讓電腦從資料中學習」（7 個）、「做出能實際使用的軟體」（8 個）直接列出。
   - 「資訊科技」（20 個）顯示熱門（資訊科技、系統開發、物件導向）、5 張收合群卡與搜尋框。
   - 已存的 4 個 AI 標籤預先勾好（「已選 4」）。
2. **群卡**：展開「程式開發」時沒有自動勾選任何標籤。勾「物件導向」後，熱門列同步顯示已勾，區塊顯示「已選 1」。
3. **搜尋**：搜尋「CSS」只列出 CSS，勾選後區塊顯示「已選 2」。
4. **通識、系外細項頁**：
   - 通識的「用歷史和思想理解現在」（23 個）分成歷史考古、宗教倫理哲學、文化社會、其他。
   - 系外的「了解品牌與消費者」（76 個）是分群模式。
   - 「學外語或了解不同文化」從群卡「語言學習與翻譯（中文、日語 等）」展開後勾「日語」。
5. **確認並儲存**：
   - 確認頁 7 個方向、11 個主題。
   - 回應 200、`verified`、無警告。
   - 讀回的 tagIds 與確認頁一致。
6. **確認頁提醒**：每組只留下沒有已存主題的方向，細項都略過。
   - 確認頁出現「這次只選了方向，還沒有新增會影響推薦的具體主題。回去選」。
   - 按「回去選」回到系外細項頁。
   - 沒有任何勾選時，「下一步」不能按。
   - 這一輪沒有儲存。
7. **備援**：API 查一甲系外「商業與管理」（沒有預算分群）回 `flat`、23 個標籤；三甲同一方向回 `clusters`（行銷市場、策略創新、營運治理、職涯職場、其他），熱門為行銷、市場分析、商業智能。
8. **窄螢幕（375px）**：一開始方向標題被右側的「已選 N・共 N 個主題」擠成每行一個字（寬 31px）。修正為可換行後，標題寬 261px、一行，沒有橫向捲動。
9. **Console**：沒有錯誤。

瀏覽器窗格高度只有約 100px，截圖看不到內容，所以版面改用程式量測。

### 測試限制

- 找標籤 A/B 的「模擬學生」和分群用的是同一個模型，結果偏樂觀。
- A/B 報告列了 8 個目標，請使用者實際操作確認。
- 已知分錯的群（例如「演算法」）還沒修。

## 是否 commit 與 push

否。
