# 2026-09-04 Roadmap #30：可重現的 per-user preference update pipeline

## 1. 修改日期

2026-09-04

## 2. 為什麼做這件事

`#2`（互動事件埋點）、`#5A`（評價分數進評分）、`#29`（事件 schema）都已完成，`#30`
的前置全部滿足。它同時是 `#5B`、`#31`、`#7`、`#32`、`#36` 這整條學習鏈的第一顆骨牌
——roadmap 自己寫著：「`#30` 產出的 easy 方向權重就是 `#5B` 要塞進 `scoreCourse()`
的值」。

**現在系統說的「個人化」，100% 來自使用者自己勾的 checkbox。** 排課時決定「這個人
多在乎集中排課／涼度／興趣」的三個權重（`scheduler.js` 的 `preferenceProfile`），
每一個都只有 0 或 1——有勾就是 1，沒勾就是 0。使用者實際做了什麼（點開哪些課、退掉
哪些課、退掉時的原因、在多個方案裡選了哪一個）全部記錄下來了，但沒有任何東西讀它。

更根本的是**沒有中間層**：今天要嘛照使用者勾的做，要嘛讓 Agent 直接改 Profile。
前者不會進步，後者不可重播、不可解釋、不可撤銷。

## 3. 規劃時先量測，避免從雜訊學東西

先用 demo 帳號（`D1249697`，真實 MySQL）實測互動事件：

| 事件類型 | 筆數 | 能學到什麼 |
| --- | ---: | --- |
| `recommendation_exposed` | 53 | 系統自己寫的曝光，不是使用者行為 |
| `course_viewed` | 26（11 門課） | 弱訊號 |
| `course_withdrawn` | 5（3 門課） | 真訊號，原因全是 `time` |
| `schedule_regenerated` | 5 | 不指向特定課 |
| `recommendation_accepted` | 3 | 真訊號（方案層） |
| `course_selected`／`favorited` | **0** | 完全沒有 |

真正的使用者行為只有 34 筆、來自 1 個人、而那個人是開發者。**結論：機制完全做得出
來、也測得住，但套用到今天這個真實帳號上會是從雜訊學東西。** 所以這輪的界線是——
算、存、可追溯，但資料不足就不套用，並且明講「還不夠」。這跟 `#13C` 那種外部阻塞
不同：這一項會在真的有學生開始用（`#38`）之後自己解除。

## 4. 主要改動內容

### 4.1 只動現有的三個軸

`buildPreferenceProfile()` 已經產出 `{ interest, compact, easy }`，
`evaluatePreference()` 也已經實作「權重 0 排除、其餘加權平均」——只是值恆為 0/1。
這輪只把它換成連續值，不新建 feature 向量：以今天 34 筆事件的量，學教師／時段／
`ragTag` 那種 per-feature 權重，絕大多數維度會是雜訊。

### 4.2 事件 → 訊號：新增 `server/src/skills/preferenceLearning.js`

純函式，只從事件推導，不讀資料庫、不呼叫排課（比照 `recommendationReason.js`／
`planComparison.js`）。規則寫死成一張帶代號的表：

| 事件 | 條件 | 影響的軸 | 強度 | 規則代號 |
| --- | --- | --- | --- | --- |
| `course_withdrawn` | `reason: time` | `compact` | 強 | `WITHDRAW_TIME` |
| `course_withdrawn` | `reason: workload` | `easy` | 強 | `WITHDRAW_WORKLOAD` |
| `course_withdrawn` | `reason: content` | `interest` | 強 | `WITHDRAW_CONTENT` |
| `recommendation_accepted` | 曝光時有兩個以上方案可選 | 該 variant 主打的軸 | 強 | `ACCEPT_VARIANT` |
| `course_viewed` | 該課之後沒被退掉 | `interest` | 弱 | `VIEWED_WEAK` |
| `course_viewed` | 該課之後被退掉 | 不計 | — | `VIEWED_THEN_WITHDRAWN` |

**`course_viewed` 納入，但擋住它的量。** 瀏覽是筆數最多的一類，直接丟掉等於放棄
76% 的資料，但單筆權重小擋不住筆數多（26 筆瀏覽對 5 筆退課，就算單筆只有十分之一
仍會蓋過）。真正的防線是**每條規則的累計上限**：`VIEWED_WEAK` 全部瀏覽事件加總後
的貢獻不得超過單一一筆強訊號——「看了很多次」最多等於「明確表態過一次」。

瀏覽固定映射到 `interest`：點開一門課最直接的解讀就是對內容有興趣，不去猜「因為它
涼」或「因為時段好」——那要假設使用者點擊時心裡在想哪個面向，是比「他對這門課有
興趣」大得多的推論跳躍，也答不出為什麼。這個映射與 `WITHDRAW_CONTENT` 落在同一軸，
一正一反語意一致。

**看了又退不算正向**：同一門課先被看、之後又被退掉，那次瀏覽不是正向表態
——退課本身已經記了負向意見。判定用「該課任何一次退課的時間晚於這次瀏覽」，
不要求緊鄰（demo 帳號的 `IECS2024` 就是這種情況：3 次瀏覽中 1 次發生在退課之前
被排除、2 次發生在最後一次退課之後被保留）。

### 4.3 三條防護

- **可重播**：事件先依 `timestamp`（同秒再依 `eventId`）排序後折疊，內部不呼叫
  `Date.now()`。`getInteractionEventsForExport()` 的記憶體 store 分支沒有
  `ORDER BY`，排序必須在純函式裡自己做。
- **有上下限（收縮）**：不另發明數學，重用 `reviewStats.js` 既有的 m-estimate
  `shrinkEasiness()`——把「強訊號 + capped 弱訊號」當一組樣本，往顯式基準收縮：
  樣本少就更靠近使用者原本設定的值，樣本多就更靠近行為方向。
- **顯式優先**：最後用 `Math.max(收縮後的值, 顯式基準)` 頂住下限，比照
  `scheduler.js` 既有的 `compactWeight = Math.max(weights.compact, ...)`——顯式
  設定只能被行為加強，不能被行為推翻。

### 4.4 資料量門檻：不足就不套用

回傳形狀：`{ modelVersion, weights, sufficiency: { status, usableEventCount,
requiredEventCount, missingAxes }, evidence }`。`sufficiency.status` 用三態
（`sufficient`／`insufficient`／`no-consent`），理由與 `#26` 的
`alternativesRejected.status`、`#27` 的 counterfactual status 相同——空值會讓
「算過但不夠」和「沒算」長得一樣。

`REQUIRED_USABLE_EVENT_COUNT = 50`：刻意設在明顯高於今天真實量級的地方，等
`#38` 真的有學生開始用，再用真實資料重新校準，不是現在猜一個好看的數字。
**`insufficient` 時 `weights` 等於（clamp 過的）顯式設定，不是半調子的學習值。**

### 4.5 存哪裡：新表，鍵用 HMAC subject_id

新增 migration `006_learned-preference-weights`，表 `Learned_Preference_Weights`，
鍵為 `subject_id`，與 `Interaction_Events` 同一個鍵空間——不能存進
`User_Profiles`（那張表以 canonical `user_id` 為鍵，`DATA_SCHEMA.md` 明文禁止把
canonical ID 與 subject_id 一起持久化）。這張表是**推導狀態**，重算整列覆寫
（`subject_id` 為主鍵），不保留歷史版本：真正的事實來源是互動事件本身，權重永遠
可以從那裡重新推導。

`privacyPolicy.js` 的 `personalization_learning.data` 早就列了
`learned_preference_weights`，這次是把承諾實作出來，因此接上既有的刪除與匯出
路徑：`DELETE /api/privacy/data` 一併刪這張表，`GET /api/privacy/export` 的
`data.learnedPreferenceWeights` 帶出目前存的那一列（從未算過為 `null`）。保存期限
沿用 `PRIVACY_RETENTION.interactionEventDays`（180 天），由 `npm run
cleanup:privacy` 一併清理（新增 `cleanupExpiredLearnedWeights()`，接進既有腳本，
不是另一支容易被忘記執行的腳本）。

`server/src/services/preferenceLearningService.js` 是純函式與儲存體之間的那一層
（比照 `interactionEventService.js` 對 `#29` 的關係）：consent 檢查重用既有的
`hasPersonalizationConsent()`，讀事件重用既有的 `getInteractionEventsForExport()`。
`recomputeLearnedWeights(identity, options)` 支援 `options.prefs` 注入
（比照 `scheduleService.generateForUser()` 的同名參數）——Profile 讀取需要對得到
`User_Course_History.user_id` 的真實 numeric identity，這個參數讓測試能用合成身分
跑，不必每個單元測試都連一次真實 MySQL。

### 4.6 這輪不接進排課

權重算出來、存起來、可追溯、可刪可匯出——但這輪不改 `scheduler.js`，
`buildPreferenceProfile()` 維持現狀。理由是 4.4 的門檻今天必然不通過，接上去等於
接一條永遠走不到的路徑，卻要承擔改動排課核心的回歸風險。`#5B` 因此仍未完成，
但它的阻塞條件解除了——權重有了、形狀確定了、門檻邏輯也有了。

## 5. 影響範圍

- 新表 `Learned_Preference_Weights`（已對共用 MySQL 套用 migration）。
- `DELETE /api/privacy/data`、`GET /api/privacy/export`：新增這張表的刪除／匯出。
- `npm run cleanup:privacy`：多清理一種過期資料。
- **排課決策本身沒有改變**——`scheduler.js` 完全沒有被這次改動觸碰。
- 未動 `client/`。

## 6. 測試與驗證結果

### 自動化

- `npm test`：**875 pass / 0 fail**（改動前 871，新增 25 項：`preferenceLearning.test.js`
  的 PL1-PL10 共 21 項、`preferenceLearningService.test.js` 的 PL7 四項）。
- `node --check` 對全部新增／修改檔案通過。
- 既有測試全數不回歸。
- **CI 抓到一項本機沒抓到的問題**：第一版在 `privacyRoutes.test.js` 加了一則
  `GET /api/privacy/export` 的匯出欄位測試，本機因為 `.env` 有真實 MySQL 憑證而
  通過，但 push 上去後 CI 回報 `500`——CI 刻意不設定 DB secret
  （見 `.github/workflows/ci.yml` 的註解），這條路由本來就需要真實 MySQL 讀
  Profile（既有限制，與這次改動無關）。已移除這個測試，改成完全不連 MySQL 的
  PL7 覆蓋同一件事的實際行為（consent 閘門、寫入、讀回、刪除），並在
  `docs/TEST_PLAN.md` 記下為什麼沒有寫成 CI 測試。修正後用
  `DB_HOST= DB_USER= DB_NAME= node --test test/privacyRoutes.test.js` 模擬 CI
  環境重新驗證過。

### 對真實 MySQL 的驗證

- 套用 migration（`--apply --confirm-shared-mysql`），確認 `Learned_Preference_Weights`
  建表成功、外鍵前置檢查通過。
- 對 demo 帳號跑一次完整管線：讀到真實 92 筆事件，`sufficiency.status` 為
  `insufficient`（`31/50`）——符合第 3 節量測的結論。
- 重播驗證：對同一批真實事件連跑兩次，結果逐位元相同（`JSON.stringify` 相等）。
- 驗證 `IECS2024`（demo 帳號真實資料裡先看後退的課）3 次瀏覽中確實 1 次被排除、
  2 次被保留，與時序判定的設計相符。
- 隱私路徑：用一個合成 subject（`TEST-PL-DELETE-0001`）手動寫入一列 → 確認
  `getStoredLearnedWeights()` 讀得到 → 呼叫 `deleteLearnedWeights()` → **直接查
  MySQL `SELECT COUNT(*)`** 確認剩餘 0 列，不只信 service 回報的數字 → 清除測試用的
  `Privacy_Subject_State` 列，沒有在共用 DB 留下垃圾。

### 一併修復的既有問題

`test/privacyRoutes.test.js` 沒有刪除 `DB_*` 環境變數（`app.js` 匯入時會載入真實
`.env`），但先前唯一的測試從未觸發任何真正打 MySQL 的呼叫，所以這個連線池從未
關閉的缺口沒被發現。實作過程中曾一度加了一則會走到 `getUserPreferences()`（真實
MySQL 讀取）的匯出測試（後來因為 CI 沒有 DB secret 而移除，見上），過程中讓
「單獨執行這個檔案時本機 process 不會結束」浮出來——加上 `closePool()`
（比照 `authRoutes.test.js`）後確認單獨執行只要 2.8 秒。這個修復保留下來：
即使目前沒有測試會連到真實 MySQL，日後這個檔案若再有人加類似案例，池子會
正確關閉。

## 7. 明確不做

- **不接進排課**——`buildPreferenceProfile()` 這輪不動，`#5B` 仍記為未完成，
  只解除阻塞。
- **不學 per-feature 權重**（教師、時段、`ragTag`…）——今天的事件量會讓絕大多數
  維度變成雜訊。
- **不讓 `course_viewed` 有翻盤的能力**：納入，但累計貢獻上限鎖在單一強訊號以下；
  看了又退掉的不計。
- **不為了讓 demo 帳號「學到東西」而調低資料量門檻**——`insufficient` 是今天的
  真實答案。
- **不做冷啟動／重設／時間衰減**——那是 `#31`，本輪只把它需要的權重與門檻結構
  備妥。
