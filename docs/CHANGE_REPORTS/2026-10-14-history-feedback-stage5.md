# 協同過濾與 User Embedding：階段 5 歷史修課回饋視窗（含 Codex 階段 4 審查）

- 日期：2026-10-14
- 對應構想：[協同過濾與 User Embedding 的搭建方式](./2026-10-14-cf-user-embedding-design.md) 3.4、第 7 節階段 5
- 性質：**使用者看得到的變更**（排課主頁對話框、個人設定頁區塊）與新的互動事件類型。不影響排課的硬條件。

---

## 0. Codex 階段 4 兩個 commit 的審查

| Commit | 內容 | 審查結果 |
| --- | --- | --- |
| `f115f2a` 課程文字向量探索本機原型 | 「從一門課出發」可切換字元二元組 tf-idf 與課程文字向量（構想 3.7） | 可接受。向量檔只存在本機、不進版控；缺檔時明確回報，不改用別的算法；依內容雜湊判斷向量是否過期 |
| `08e4b3a` 系外保留候選改用 s_vec | 系外保留名額從「關鍵字命中」改為「正向 s_vec 前 5 門、每系一門」，只決定名額，不加計分 | 可接受。真實 API／MySQL 的 keyword／vector A/B 與 6 個方案的獨立驗證都完整 |

發現的問題與處理：

1. **效能**：`08e4b3a` 在系外仍有缺口的每次排課都多讀一次完整課程目錄（約 1.4～3 秒），報告未提及。
   本次新增 `server/src/services/courseCatalogCache.js`（10 分鐘快取），系外保留與歷史修課回饋共用。
   實測 D1249697：第一次 2.6 秒，之後約 0.55 秒（剩下的是讀同意與事件）。
2. **S1～S10**：改了 `scheduler.js`，報告沒有特別列出 S1～S10；它們在 `scheduler.test.js` 中，屬於 `npm test`，本次全套重跑通過。
3. **不穩定的測試**：審查時第一次全套測試有 2 項失敗，之後連續 3 次都全過，未能重現（當時另有預覽伺服器在跑，可能是時序問題）。
4. 我先前未提交的降權改動（新增的 14 個、降權名單 388 個）Codex 沒有動到，另以獨立 commit 先提交。

---

## 1. 結論

1. **新增歷史修課回饋**：使用者對自己已通過的選修、通識、系外選修表示喜歡／普通／不喜歡。
   - 排課主頁有尚未回答的課時自動跳出一次；「稍後再說」把這批課記為普通，同一批不再跳出。
   - 個人資料設定頁新增「我修過的課」，隨時可以修改（只送出有改變的回答）。
2. **新事件類型 `history_course_feedback`**（來源 `history_review`），不需改資料表。
   **伺服器依 Profile 的修課歷史核對課號**，不是本人已通過的非必修課一律拒絕。
3. **學習權重**：喜歡 +1、不喜歡 −1、普通 0；同一門課以最後一次回答為準；不套用 120 天時間衰減。
   標籤空間使用者向量中，回答「不喜歡」的課不再給歷史修課的 +0.5。標籤興趣檔 `s_tag` 與 `s_vec` 都採用。
4. **效果（離線 A/B，D1249697，模擬回饋只在記憶體）**：模擬「不喜歡」兩門西班牙文與性別議題課、
   「喜歡」人工智慧導論與資訊與網路安全後，探索頁的「AI與機器翻譯」（語言學、外語學習）消失，
   多出「時間序列與財務應用」「系統資料分析與建模」兩門資料科學課。

---

## 2. 做了什麼

### 2.1 後端

| 檔案 | 異動 |
| --- | --- |
| `server/src/data/interactionEventSchema.js` | 新增 `history_course_feedback`、來源 `history_review`；回應只能是 liked／neutral／disliked，`canonicalTagIds` 必須是空陣列 |
| `server/src/services/interactionEventService.js` | 新類型納入標籤快照；`assertProvenance()` 依修課歷史核對課號（可注入 `loadProfile` 供測試） |
| `server/src/data/courseHistory.js` | 新增 `getPassedNonRequiredAttempts()`：最新一次已通過的選修／通識／系外。使用者向量、清單 API 與事件驗證共用 |
| `server/src/skills/tagInterestLearning.js` | 權重 `historyLiked`／`historyDisliked`；每門課最後一次回答為準；歷史修課回饋不套用時間衰減 |
| `server/src/skills/userTagVector.js` | 回答「不喜歡」的歷史課不再給 +0.5，`sources.historyDisliked` 記錄數量 |
| `server/src/services/historyFeedbackService.js`（新增） | 可回饋課程清單：必須本學期有開（事件快照要讀班次的標籤）且有可比對標籤；附目前回答與待回答數 |
| `server/src/routes/historyFeedback.js`（新增）、`server/src/app.js` | `GET /api/history-feedback` |
| `server/src/services/courseCatalogCache.js`（新增） | 課程目錄 10 分鐘快取（見第 0 節） |
| `server/src/services/externalInterestReservationService.js` | 改用共用快取 |

### 2.2 前端

| 檔案 | 異動 |
| --- | --- |
| `client/src/components/Profile/HistoryFeedbackModal.jsx`（新增） | 依學期分組、每門課三個按鈕；超過 15 門時先顯示最近兩學期；`initial` 與 `edit` 兩種模式；每次最多送 50 筆 |
| `client/src/pages/DashboardPage.jsx` | 同意個人化學習且有待回答的課時自動跳出 |
| `client/src/pages/SetupPage.jsx` | 「我修過的課」區塊與「調整喜好」按鈕；未同意時停用並說明 |
| `client/src/services/api.js` | `historyFeedbackAPI.get()` |
| `client/src/App.css` | 對話框與區塊樣式（使用主題變數，深色模式可用） |

排課主頁的提示元件 `ScheduleNotice` 在 PR #27 已改為不顯示，因此存檔後不另外顯示提示；
對話框本身寫明「之後可以到個人資料設定的『我修過的課』修改」。

### 2.3 文件

- `docs/API_SPEC.md`：`GET /api/history-feedback` 與 `history_course_feedback` 事件格式、驗證與權重。
- `docs/DATA_SCHEMA.md`：`Interaction_Events` 的新事件類型與欄位用法。

### 2.4 測試

| 編號 | 內容 |
| --- | --- |
| HF-1～HF-3（`interactionEvents.test.js`） | 本人非必修已修課可寫入且快照以整門課標籤為證據；未修、必修、未通過一律拒絕；來源、回答、標籤欄位的格式限制 |
| TIL-HF | 喜歡 +1、不喜歡 −1、以最後一次為準、一年後仍不衰減、普通不產生證據 |
| UV7 | 不喜歡取消 +0.5 並記負向；喜歡另加 +1 |
| HF-4 | 同一批多筆回饋只讀一次 Profile |
| CCC-1、CCC-2（新增 `courseCatalogCache.test.js`） | 同時請求共用一次查詢、命中快取、過期重查；失敗不留快取 |
| HFS-1～HFS-3（新增 `historyFeedbackService.test.js`） | 清單範圍與排除原因、學期排序、同課號取固定班次；最後一次回答與 180 天到期；未同意不列 |

---

## 3. 驗證

- `server/src` 全部 `node --check` 通過；`npm test` 1,549 項，1,548 通過、1 略過、0 失敗（含 S1～S10）。
- 前端 `npm run lint`、`npm run build` 通過。
- **瀏覽器（D1249697，沿用已登入的工作階段）**：
  - 排課主頁自動跳出對話框，18 門待回答；先顯示最近兩學期 7 門，「顯示更早的課（11 門）」展開後 6 個學期共 18 列。
  - 點「人工智慧導論」的「喜歡」：`aria-checked=true`、按鈕變綠。
  - 個人設定頁「我修過的課」→「調整喜好」：以編輯模式開啟（按鈕為「取消／儲存」，沒有「稍後再說」）；「取消」可關閉。
    發現窄畫面時按鈕文字被擠成直排，已修正後重新確認為單行。
  - `GET /api/history-feedback` 皆為 200；console 無錯誤。
- **實際儲存（使用者同意後，D1249697 本人在瀏覽器操作，寫入共用資料庫）**：
  1. 排課主頁對話框按「儲存」：寫入 17 筆（13:15:21～13:15:43，共 22 秒）。
     應為 18 筆：當時我修改 `courseCatalogCache.js`，`node --watch` 重新啟動後端，切斷了寫到一半的請求，
     「科學與人文的對話」沒有寫入、仍顯示待回答。不是邏輯錯誤，但暴露出兩個問題，見下方 4.、5.。
  2. 個人設定「調整喜好」編輯模式按「儲存」：只送出改變的 5 筆（普通→喜歡），符合設計。
  3. 剩下那門再由編輯模式回答（不喜歡），待回答數變成 0。
  4. A/B：儲存前排課主頁自動跳出（待回答 18）；儲存後重新載入不再跳出（待回答 0），console 無新錯誤。
- **儲存太慢（已修正）**：每筆歷史回饋都重讀 Profile、修課歷史與 `user_preferences`，實測每筆約 0.93 秒。
  `recordInteractionEvents()` 改為同一批共用一次讀取（`withBatchProfileCache`），新增 HF-4（3 筆只讀 1 次 Profile）。
  估計 18 筆從 22 秒降到 6 秒左右（以讀取耗時推算，未再實寫一次量測，避免改動你的回答）。
- **頁面載入同時打多個 API 時重複查課程目錄（已修正）**：開發模式下歷史回饋 API 一次載入打 4 次，各自查一次完整目錄。
  `courseCatalogCache.js` 改為同時進來的請求共用同一次查詢；查詢失敗不留快取。新增 `courseCatalogCache.test.js`（CCC-1、CCC-2）。

---

## 4. 已知限制

- 只列本學期有開的歷史課：事件快照要從當學期班次讀標籤。資料庫只有當學期課程，D1249697 有 7 門非必修已修課因此不列。
  匯入 112～114 學年度課程大綱後可放寬。
- 一批寫到一半失敗時，已寫入的部分會保留，對話框顯示錯誤；重按會再送一次，因為以最後一次回答為準所以結果一致。
- 「稍後再說」會為每門待回答的課寫一筆 `neutral` 事件（D1249697 為 18 筆），用來記住「這批問過了」，不影響學習。
- 對話框在排課主頁載入時跳出，此時初始課表可能已經產生；回答在下次排課與探索時生效。

---

## 5. 本次異動

見第 2 節；另含第 0 節與第 3 節的效能修正。先前未提交的 14 個降權（`tagVectorDownweights.json`、
`formalTagClassify.js`、`scripts/lib/readFormalTagDecisions.py`、合併報告第 8 節）另成一個 commit。未修改資料庫結構。

分兩個 commit 推到 `origin backend`：先是 14 個降權，再是階段 5。
