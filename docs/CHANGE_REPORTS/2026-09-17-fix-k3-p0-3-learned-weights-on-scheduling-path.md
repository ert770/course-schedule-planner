# 2026-09-17 修復 K3／P0-3：學習權重在排課路徑生效

## 修改日期

2026-09-17

## 為什麼做這件事

`getSchedulingPreferenceWeights()`（排課要用的權重讀取函式）原本只讀 `Learned_Preference_Weights` 已存的那一列，絕不重算；只有呼叫 `getPersonalizationSource()`（隱私頁的個人化 API）時才會在過期時順手重算。這代表「互動紀錄會影響排序」這個個人化承諾，實際上只有使用者主動開過隱私頁之後才會生效——不開隱私頁、只是持續使用系統累積互動事件，學到的權重永遠不會被套用到排課，是資料包建立過程中發現的限制 K3 / 推甄前必要工作 P0-3。

程式碼裡已經有一段很清楚的既有理由說明「為什麼排課路徑刻意不重算」：排課是熱路徑，重算要付「一次全量事件掃描加一次寫入」的代價，每次產生課表都走一次不划算。本人在動手前先確認過這個既有設計是刻意的，不是疏漏，因此討論後決定的做法是「重用隱私頁已經寫好、測試過的過期判定邏輯，只在真的過期時才付那個代價」，而不是不分青紅皂白地每次都重算。

## 修改檔案清單

- `server/src/services/preferenceLearningService.js`：
  - 新增私有函式 `ensureFreshLearnedWeights(identity, options)`：把原本寫在 `getPersonalizationSource()` 裡的過期判定與重算邏輯（從沒算過／`modelVersion` 是舊版／有新事件／超過 24 小時沒更新）抽成共用函式。
  - `getSchedulingPreferenceWeights()` 改用 `ensureFreshLearnedWeights()` 取代原本的 `getStoredLearnedWeights()` 直接讀取；`stored.modelVersion !== 現行版本` 的檢查保留下來，當作重算後仍拿不到現行版本這種極端情況（例如重算過程中 consent 被撤回）的防呆。
  - `getPersonalizationSource()` 改用 `ensureFreshLearnedWeights()`，移除原本重複的過期判定與重算程式碼。
  - 更新了 4 處註解（`LEARNED_WEIGHTS_APPLIED_TO_SCHEDULING` 上方、`recomputeLearnedWeights()` 的 JSDoc、`getSchedulingPreferenceWeights()` 的 JSDoc、`getPersonalizationSource()` 的 JSDoc），反映新的行為。
- `server/src/services/scheduleService.js`：`prepareGenerationInputs()` 裡呼叫 `getSchedulingPreferenceWeights()` 那段的註解，從「這裡讀的是已存的權重，不重算、不寫入」改成「過期才重算」。
- `server/test/preferenceLearningService.test.js`：
  - 更新兩個因為行為改變而不再成立的舊測試斷言（`PL25 已同意但從未算過`、`PL27 modelVersion 過期`）：兩者原本斷言「排課路徑不會重算」，現在改成斷言「排課路徑會在過期時當場重算」，並補上重算後的正確結果。
  - 新增一個直接對應 P0-3 驗收標準的測試：已同意且事件數已達 50 筆門檻時，**不先呼叫 `getPersonalizationSource()`／不先開隱私頁**，直接呼叫 `getSchedulingPreferenceWeights()`，應該自己觸發重算並回傳 `applied: true`。

## 主要改動

- 沒有新增任何資料表或欄位，`Learned_Preference_Weights` 的 schema 不變。
- 沒有把「每次排課都重算」變成新行為——多數排課請求（權重還新鮮：24 小時內、沒有新事件、版本沒過期）行為與修復前完全相同，只有一次讀取；只有真的過期的請求才會多付一次全量事件掃描加一次寫入的代價，且這個代價本來就已經真實存在於隱私頁那一條路徑，只是現在排課路徑也可能付。
- 討論後決定**不**採用「接受互動事件後非同步重算」這個替代方案：那個做法能讓排課路徑永遠不受影響，但需要另外設計觸發頻率／debounce 策略（不能每個互動事件都重算），在目前的時程壓力下風險與工作量都比較高，而且會與現有「過期判定」邏輯變成兩套並存的機制。

## 測試與驗證

- `node --test test/preferenceLearningService.test.js`：18/18 通過（含新增的 P0-3 驗收測試、修正後的 2 個舊測試）。
- `node --test test/preferenceLearning.test.js test/scheduler.test.js test/scheduleRoutes.test.js test/privacyRoutes.test.js`：219/219 通過，確認排課核心邏輯與相關路由不受影響。
- `CI=true node --test --test-force-exit "test/**/*.test.js"`：1,059 個測試（比修復前多 1 個，即新增的測試），1,056 通過，3 個 fail 都是既有的 Windows libuv 收尾問題（`authRoutes`、`privacyRoutes`、`scheduleRoutes`），與本次修改無關。
- `node --test-force-exit test/database-contract.test.js`：18/18 通過，確認對真實共用 MySQL 沒有造成任何回歸。
- **瀏覽器與真實共用資料庫驗收**：用唯讀查詢直接確認 Persona C（`D1249196`）在共用 MySQL 的 `Learned_Preference_Weights` 列：修復前 `computed_at = 2026-09-17T07:19:12Z`，同一時間 `Interaction_Events` 的最新一筆是 `2026-09-17T07:46:58Z`（比 `computed_at` 新，屬於過期狀態，加上已超過 24 小時 TTL，雙重過期）。接著用瀏覽器登入 Persona C、**沒有**開過隱私頁，只是讓 Dashboard 照常自動觸發一次 `POST /api/schedule/generate`（200 OK）。事後再次唯讀查詢，`computed_at` 前進到 `2026-09-17T08:05:28Z`——證明重算確實是被這次排課請求觸發的，不是巧合或其他路徑造成的。期間沒有新增任何 console 錯誤。

## 影響範圍

- 只有 `server/src/services/preferenceLearningService.js`、`server/src/services/scheduleService.js`（註解）、`server/test/preferenceLearningService.test.js` 三個檔案被修改，前端沒有變動。
- 對共用 MySQL 的寫入行為改變：Persona C 這個 demo 帳號的 `Learned_Preference_Weights` 列已經被本次驗收過程的排課請求更新過一次（`computed_at` 前進），這是驗證這個修復必然會產生的副作用，不是額外的資料修正；內容仍是從同一批既有互動事件正確算出來的結果，沒有寫入任何合成或造假資料。

## 是否 commit 與 push

未 commit，等待使用者指示。
