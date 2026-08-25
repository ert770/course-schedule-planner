# 2026-08-26 埋互動 log（Roadmap #2）

## 修改日期

2026-08-26

## 問題

系統的個人化程度等於使用者自己勾了幾個 checkbox。`preferenceProfile` 100% 來自
`User_Profiles.preference_tags` 的顯式填寫，沒有任何行為訊號——系統顯示了什麼、
使用者選了什麼、為什麼把課拿掉，全部沒有被記錄。

#29 已定義事件語意、#33 已建立 consent 與假名邊界，但兩者都刻意不持久化任何真實事件。
因此整條相依鏈（#30 → #5B／#7 → #6／#9／#32）卡在同一個地方：**沒有輸入可以喂進去**。

另有兩個開工後才發現的缺口：

1. **排課回應沒有任何請求識別碼。** `plan.id` 只是 variant 名稱（`required_first` 等），
   五個方案在不同次排課之間完全無法區分，曝光事件記下來也指認不到是哪一次推薦。
2. **排完課就結束，沒有問使用者這份課表好不好。** 排課只是推薦；使用者是否覺得符合需求
   才是 roadmap 說的「最終選擇」，而這個訊號從來沒有被取得。

## 修改檔案清單

**新增**：

- `server/migrations/003_interaction-events.up.sql` / `.down.sql`
- `server/scripts/interactionEventsMigration.js`
- `server/src/services/interactionEventService.js`
- `server/src/services/scheduleFeedbackService.js`
- `server/src/routes/interactions.js`
- `server/test/interactionEvents.test.js`
- `client/src/services/interactionLog.js`
- `client/src/components/Schedule/RemoveReasonDialog.jsx`
- `docs/CHANGE_REPORTS/2026-08-26-interaction-logging.md`（本檔）

**修改**：

- 後端：`app.js`、`routes/privacy.js`、`services/privacyService.js`（匯出共用 helper）、
  `services/scheduleService.js`、`services/agentService.js`、`services/promptService.js`、
  `scripts/privacyCleanup.js`、`test/prompt.test.js`
- 前端：`services/api.js`、`contexts/ScheduleContext.jsx`、`components/Chat/ChatPanel.jsx`、
  `pages/DashboardPage.jsx`、`pages/SchedulePage.jsx`、`pages/SearchPage.jsx`、`App.css`
  （另新增 `components/Schedule/ScheduleConfirmationBar.jsx`，見對抗式審查修正）
- 文件：`docs/API_SPEC.md`、`docs/DATA_SCHEMA.md`、`docs/PROMPT_DESIGN.md`、
  `docs/DECISIONS.md`（ADR-018）、`docs/TEST_PLAN.md`、個人化 roadmap

## 主要改動內容

### 1. 儲存體：`Interaction_Events`

- **沒有任何學號欄位。** 只存 #33 的 HMAC `subject_id`。`createInteractionEvent()` 依 #29
  產出帶 canonical ID 的 envelope，但寫入前一律換成 `subject_id`——canonical ID 只存在於記憶體。
- `(subject_id, idempotency_key)` 為 UNIQUE。去重不只靠應用層的
  `resolveIdempotentAppend()`：並行請求擠過「檢查」與「寫入」之間的空隙時由資料庫擋下，
  撞到 `ER_DUP_ENTRY` 一律視為 `duplicate`，不重試、不覆寫。
- `expires_at` = `occurred_at` + 180 天，清理併入既有 `npm run cleanup:privacy`。
- migration 沿用 #33 的契約：預設 dry-run，`--apply` 另需 `--confirm-shared-mysql`，
  並先檢查 `Privacy_Subject_State` 是否存在（缺了會失敗在難解讀的 errno 1215）。

`privacyService.js` 的 `useMemoryStore()`／`toMysqlDate()`／`touchSubject()` 改為匯出後共用，
而不是在新模組複製一份——同一條規則存兩份必然漂移。

### 2. API：`POST /api/interactions`

**刻意不掛 `requireConsent(PERSONALIZATION_LEARNING)`。** 那會回 `428 CONSENT_REQUIRED`，
語意是「使用者必須先去處理」——對必要的 `service_processing` 正確，但
`personalization_learning` 是**可選**用途，預設關閉是完全合法的狀態，回 428 等於把使用者
推到同意牆前面。改為回 `200 { recorded:false, reason:'CONSENT_NOT_GRANTED' }`，
**一列都不寫入**（#33 驗收標準成立），前端也不必處理錯誤路徑。理由記於 ADR-018。

`GET /api/privacy/export` 加入 `interactionEvents`（不含 subject ID 與 idempotency key），
`DELETE /api/privacy/data` 加入互動事件刪除。

### 3. 讓「推薦清單」可被指認

`scheduleService.generateForUser()`（REST 與 Chat 的唯一共同入口）回傳前補上頂層
`requestId`，以及每個方案的 `planId = ${requestId}:${variantId}` 與 `variantId`。
用組合字串而非另一個 UUID，是為了從 planId 本身就能反推是哪一次請求的哪一個 variant。

識別碼屬於請求層，因此加在這裡而不是 `skills/scheduler.js`；成功與失敗路徑都帶。
向後相容的欄位新增，既有欄位語意不變。

**誠實邊界**：重新登入後從 `saved_schedules` 載回的課表沒有 `requestId`，此時前端另發一個
新的——「這個操作不屬於任何一次推薦曝光」本身就是正確資訊，不偽造關聯。

### 4. 「使用者最終選擇」：排課後的確認

- `promptService.js` 新增規則：`run_csp_scheduler` 成功後，`final_answer` **必須**詢問這份
  課表是否符合需求，並說明若有不適合的課請指出哪一門及原因；使用者沒回答時**不得**代為假設接受。
- 新增 Agent tool `record_schedule_feedback`，由 `scheduleFeedbackService.js` 處理：
  驗證 `requestId`／`planId` 確實來自本系統產生的那次推薦、把 sectionId 換成穩定課號與學期、
  把回答映射成 `recommendation_accepted` 與 `course_withdrawn`。模型只轉述使用者說了什麼，
  不決定資料長什麼樣。`actionId` 由 `(requestId, planId)` 決定而非隨機，重送同一個回答會被判為
  duplicate 而不是第二次接受。
- 非 Chat 路徑在 Dashboard 與 SchedulePage 顯示確認列：`[符合]` / `[需要調整]`。

**儲存課表不再視為接受。** 存草稿也會按儲存，語意含糊；明確回答「符合」才是接受，
沒回答就是沒接受。課表內容本身已由 `course_selected` 涵蓋，不會遺失資訊。

### 5. 前端埋點與移除原因

曝光、查看、收藏／取消收藏、選擇、接受、退選、重新排課全部埋齊，集中在 `ScheduleContext`
而非各頁自己記一套。`source` 依「必修／系統推薦／使用者自己加」判定——標錯等於 label 錯，
#30 會往相反方向學。

移除時提供 7 個原因選單（時間／內容／教師／負擔／額滿／資格／其他）與「略過」（記 `null`，
不猜）。未同意個人化學習的人**不會看到這個對話框**——問了也不會記錄，只是白白多一步。

**互動記錄是旁路。** `logInteraction()` 吞掉錯誤，加選、移除、排課、聊天絕不可因為記錄
失敗而失敗；但它仍回傳真實結果供確認列使用——旁路可以不擋操作，不能謊報結果
（見對抗式審查修正發現三）。

### 6. `course_withdrawn` 在本系統的定義

#29 的字面語意是「已在學校正式選課系統選上、之後在加退選期間退掉」。本專案不連學校選課
系統，沒有那個外部狀態，因此**以「退掉推薦課表上的課」對應之**。roadmap 的「加選後退選」
由這個事件承接；`course_removed`（在課表之外拒絕推薦）成為目前沒有介面的 forward contract。

兩者在 `interactionEventSchema.js` 的處理完全相同（都在 `COURSE_REQUIRED_EVENTS` 與
`FEEDBACK_EVENTS` 中，都接受 `feedbackReason`），因此**沒有改動 #29 的程式**，
只更新 `docs/DATA_SCHEMA.md` 的敘述，不留下與實作不符的舊定義。

## 影響範圍

- 新增 `POST /api/interactions`；`GET /api/privacy/export` 與 `DELETE /api/privacy/data` 擴充。
- `POST /api/schedule/generate` 與 `/api/chat` 的 `run_csp_scheduler` 回應新增 `requestId`、
  `plans[].planId`、`plans[].variantId`（向後相容）。
- Agent tool 契約新增 `record_schedule_feedback`，並要求排課後必問。
- **排課結果、候選池與偏好計算完全未變。** #2 只負責記錄，不影響任何推薦邏輯。
- #30 的阻塞解除；#5B 只剩 #30 一項相依。

## 測試與驗證結果

- `node --check`：`server/src` 全數通過。
- `npm test`：**508/508 通過**（由 481 增加；含對抗式審查追加的 5 項，見文末），
  零回歸；`scheduleService.js` 有改動，S1–S15 逐項確認通過。
- `client npm run lint`、`npm run build`：通過（1758 modules transformed）。
- migration：dry-run 確認 `missingPrerequisites` 為空後套用，`uq_interaction_idempotency`
  UNIQUE 索引已建立。

### 瀏覽器 A/B 實機驗收

demo 帳號 `D1249697`（資訊三乙），前後端由 `preview_start` 啟動。

**A 組（Privacy Center 關閉 `personalization_learning`）**

| 操作 | 結果 |
| --- | --- |
| 套用偏好排課、開啟課程詳情、從課表移除 | 全部正常完成 |
| 移除時 | **不出現原因選單**，直接移除（9→8 門，學分同步下降） |
| 確認列 | 仍顯示且可按（好的 UX 不因未同意而消失），但不產生記錄 |
| `Interaction_Events` | **0 列**，且完全沒有發出 `/api/interactions` 請求 |
| console | 無新增錯誤 |

**B 組（開啟 `personalization_learning`）**

| # | 操作 | 驗到的結果 |
| --- | --- | --- |
| 1–2 | 套用偏好排課 | `schedule_regenerated` + `recommendation_exposed`，同一 `requestId`；`planId` = `<requestId>:required_first` |
| — | 曝光內容 | **candidateSet 227 門、displayedSet 8 門，子集關係成立**——219 門從未顯示的課不會被誤讀成「看過但拒絕」 |
| 3 | 開啟課程詳情 | `course_viewed`（共 9 筆） |
| 4–5 | 關注／取消關注 | `course_favorited`、`course_unfavorited`，`source=required`（該課為必修） |
| 6–7 | 加入課表 | `course_selected`，必修課正確標成 `source=required` 而非 `explicit_selection` |
| — | 加選超過學分上限被擋 | **不產生 `course_selected`**——沒進課表就不是「使用者選了」 |
| 8 | 確認列「符合」 | `recommendation_accepted`，plan 層級，`planId` 對得上該次 `requestId` |
| 9 | 移除 7 門，原因各選一個 | 7 筆 `course_withdrawn`，`feedback_reason` 分別為 `time`／`content`／`instructor`／`workload`／`full`／`eligibility`／`other` |
| 10 | 再移除一門並「略過」 | `course_withdrawn`，`feedback_reason` 為 `NULL`（不是猜的值） |
| 12 | 同一 `actionId` 重送 | 第一次 `append`、第二次 `duplicate` |

**失敗隔離**：把 `/api/interactions` 強制回 500 後重跑排課與移除——課表照常重新產生、
課程照常移除、確認列照常顯示、**畫面沒有任何錯誤**，只有 console 四則
「互動記錄未送出（不影響操作）」警告。

**假名驗證**：全表 24 列序列化後檢查，`D1249697`（學號）與 `黃思瑜`（姓名）皆
**不存在**；`subject_id` 只有一個 `v1:` HMAC 值。`GET /api/privacy/export` 的
`interactionEvents` 同樣不含 subject ID 與學號。

### 未完成的驗收項目

**Agent 排課後確認的瀏覽器端對端驗收未完成。** 送出「幫我排課表」後回傳錯誤，後端日誌顯示：

```text
This model models/gemini-2.5-pro is no longer available to new users.
```

Google 已下架 `gemini-2.5-pro`，**Chat 整條路徑在本次改動之前就已失效**，與 #2 無關，
也不影響 REST 排課。該路徑的邏輯由 IL-13～IL-13d（tool 行為）與 P 系列 prompt 契約測試
（排課後必問、7 個原因 enum）涵蓋，但實機對話未跑過。模型版本更新需另行決定並處理。

## 對抗式審查修正（2026-08-26 追加）

`/codex:adversarial-review` 對工作區變更提出四項發現，四項均已處理。前兩項是實際的資料
完整性與隱私缺口，且都**不是實作瑕疵，而是原本設計就沒有涵蓋的情境**。

### 發現一（high）：帳號刪除後並行寫入仍可能落地

`DELETE /api/privacy/data` 原本先刪除互動事件、最後才 `markServiceWithdrawn()`；
而寫入路徑只檢查 consent，不看撤回狀態。

關鍵在於**同意紀錄依政策保留 365 天**，因此刪除帳號之後 consent 檢查仍然通過。一個已經
通過檢查、正在執行中的 `POST /api/interactions`，可以在刪除跑完之後才寫入，甚至透過
`touchSubject()` 把已刪除的 subject 列重新建回來——刪除 API 回報成功，個人資料卻還在。

處置：

- 刪除流程改為**先 `markServiceWithdrawn()` 再刪除**。
- 事件寫入改為單一交易：`SELECT ... FOR UPDATE` 鎖住 subject 列 → 檢查
  `service_withdrawn_at` → 更新 `last_active_at` → `INSERT`。原本 `touchSubject()` 與
  `INSERT` 各自 autocommit，中間的空隙正是刪除可以整個插進去的地方。
- 已撤回的 subject 一律回 `rejected`，不是靜默略過——呼叫端要看得見。

這個順序讓並行寫入只剩兩種結局：搶在撤回之前落地（隨後被刪除清掉），或等到鎖釋放後
看到已撤回而被拒絕。兩者都不會留下殘存資料。

### 發現二（high）：回饋來源只做了字串驗證

`recordScheduleFeedback()` 原本只檢查 `requestId` 像不像 UUID、`planId` 前綴對不對、
`sectionId` 在全校課程表裡找不找得到。**這等於沒有驗證。**

模型是會編造的。它可以捏出一組格式完全合法、但這位使用者從來沒看過的推薦，寫進一批假的
`recommendation_accepted` 與 `course_withdrawn`。#30 之後學到的東西就建立在這批假資料上
——後面再好的推薦演算法都救不回來。

處置：改為對照 **`recommendation_exposed` 事件**驗證來源。該事件已記錄這個 subject、
這個 requestId、主推方案的 planId，以及畫面上真正顯示過的課程清單：

- `requestId` 必須有對應的曝光紀錄，且屬於這位使用者。
- 接受的 `planId` 必須就是當時實際顯示的那一份方案。
- 每個退選的 `sectionId` 必須在該次曝光的 `displayedSet` 裡——**沒被顯示過的課，
  使用者不可能退掉它**。只在 `candidateSet` 出現也不算。
- 課號與學期改由曝光紀錄本身提供，不再另外查課程表。

**刻意不另建推薦快照表**：曝光事件已經是同一份事實，再存一份必然漂移，而且會為尚未同意
個人化的使用者建立新的個資。代價是曝光沒送出成功時，合法的回饋也會被拒絕——這是安全的
方向：少一筆標籤只是少一個資料點，多一筆假標籤會污染整個學習過程。

### 發現三（medium）：UI 宣稱已記錄，實際上沒有

確認列原本一按「符合」就顯示「已記錄……後續推薦會參考這個回饋」。但未同意個人化時
前端根本不會發出請求，寫入失敗時錯誤也被刻意吞掉——兩種情況下這句話都是不實的。

處置：`logInteraction()` 改為回傳**永不 reject** 的 promise 帶回真實結果，確認列依結果
決定文案。旁路可以不擋操作，但不能謊報結果：

| 情況 | 文案 |
| --- | --- |
| 實際寫入（append／duplicate） | 已記錄這份課表符合你的需求，後續推薦會參考這個回饋。 |
| 未同意個人化 | 已在畫面上標記。你尚未開啟「從互動持續改善個人化」，因此這個回饋不會被儲存，也不會影響後續推薦。 |
| 寫入失敗 | 已在畫面上標記，但回饋沒有送出成功，不會影響後續推薦。 |
| 課表非本次推薦產生 | 已在畫面上標記。這份課表不是這次推薦產生的，沒有可記錄的方案。 |

「需要調整」的提示同樣改為 consent-aware。兩頁重複的確認列抽成
`components/Schedule/ScheduleConfirmationBar.jsx`，避免兩處文案各自漂移。

### 發現四（medium）：`saved_schedules.json` 含瀏覽器測試資料

成立，但**不是本次改動造成的**：該檔的兩筆資料時間戳為 `2026-08-22T15:55`，是 #33 驗收
時留下的，早在本次工作開始前就已是 working tree 的未提交變更。已備份後還原為 `[]`。

順帶清除本次瀏覽器驗收在 shared MySQL `Interaction_Events` 留下的 24 列 demo 帳號測試事件。
`users.json` 的變更是關注清單資料結構調整（物件 → id 陣列），不是測試殘留，未動。

### 追加驗證

- 新增 IL-13e／IL-13f／IL-13g（來源驗證負向案例）與 IL-14／IL-14b（撤回後寫入、
  刪除並行）共 5 項；`npm test` 由 501 增至 508，全數通過。
- **撤回守門另以真實 MySQL 驗證**（單元測試只涵蓋記憶體 store）：未撤回時 `append`、
  標記撤回後同一批寫入回 `rejected`，測試後已還原 `service_withdrawn_at` 並清空測試列。
- 瀏覽器逐一驗證三種確認列文案：未同意 → 「不會被儲存」；同意但端點回 500 → 「沒有送出
  成功」；正常 → 「已記錄」。三種情況下課表都照常產生，`/api/interactions` 無 401。

## 是否 commit 與 push

- 未 commit。
- 未 push。
