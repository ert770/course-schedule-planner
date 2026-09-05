# 2026-09-04 Roadmap #31：冷啟動、偏好重設、時間衰減與資料不足策略

## 1. 修改日期

2026-09-04

## 2. 為什麼做這件事

`#30`（2026-09-04 同日稍早完成）算出了 per-user 偏好權重、存進
`Learned_Preference_Weights`、並且在資料不足時誠實回退成顯式設定——但那一輪刻意只做
「算得出來」，沒做「使用者管得到」。實測當時的狀態：

- `recomputeLearnedWeights()` **在正式環境沒有任何呼叫端**。
- `sufficiency.status`（`sufficient`／`insufficient`／`no-consent`）**沒有接到任何
  UI**，`client/src` 全域 grep 為零命中——使用者看不到自己現在用的是顯式、學習還是
  沒資料。
- 沒有「只重設學習權重、保留顯式 Profile」的入口；唯一會清掉權重的是整個帳號刪除。
- 使用者取消「從互動持續改善個人化」的同意後，已存的權重列**完全不會被動到**，
  `GET /export` 還讀得到。
- `preferenceLearning.js` 對所有歷史事件一視同仁，`timestamp` 只用來排序，
  **沒有任何時間衰減**。

`#31` 要補的就是這四個缺口，也是 `#36`（personalization baseline／A-B）明文列出的
剩餘阻塞之一（`#5B`、`#7` 是另外兩項，各自獨立進行）。

## 3. 規劃時先量測

用戶要求的三個決定都先看過真實資料再定案：

**時間衰減會不會在今天的真實資料上看得出差異？** 查詢團隊共用 MySQL：

| 量測項目 | 結果 |
| --- | --- |
| 互動事件總數 | 92 筆 |
| 時間跨度 | 4 天（2026-08-30 → 2026-09-03） |
| 來源帳號數 | 1 個 |
| 學期戳記 | 全部 114 學年下學期（即當前學期） |

**結論：不管半衰期還是跨學期降權，套在今天的真實資料上都是數學上的 no-op**——
4 天遠遠小於任何合理的半衰期，衰減係數必然接近 1；全部事件都標記當前學期，跨學期
降權完全不會觸發。這件事在動工前就跟使用者講清楚，並得到「照做，測試層面用合成
事件驗證，變更報告如實記錄今天沒有可見效果」的指示——與 `#30` 把門檻設在明顯高於
現有資料量的做法是同一套誠實策略。

**UI 放哪裡？** 現況是沒有掛路由的 Profile 頁（`ProfilePage.jsx`/`ProfileForm.jsx`
是死碼），使用者決定放在隱私中心（`/privacy`，與 `personalization_learning` 同意
勾選同一個頁面，語意最一致）與 Dashboard 側欄「我的排課偏好」區塊（使用者排課時
就近看得到）。

**撤回同意時，已存的學到權重要怎麼辦？** 實測當時的行為：完全不會動它，撤回後
`GET /export` 還讀得到那一列。使用者決定改成撤回即刪除已存權重——與重新開啟同意後
「從零開始重新累積」的直覺一致。

## 4. 主要改動內容

### 4.1 修掉一個 `#30` 遺留的單調性 bug（時間衰減的前置條件）

`foldAxis()` 原本讓弱訊號通道不管衰減與否，都在樣本數（`sampleSize`）上固定貢獻
整數 1，但在原始加總（`rawSum`）上只貢獻它的實際值——分子被稀釋、分母卻整數增加。
實測：

| 證據 | 原本算出的權重 |
| --- | ---: |
| 1 筆強訊號 | 0.16667 |
| 1 筆強訊號 + 1 筆未飽和弱訊號 | **0.16429**（比什麼弱訊號都沒有還低） |

**多一筆支持性證據反而讓權重下降。** 這在 `#30` 是邊緣個案（弱訊號幾乎總是飽和
cap），但時間衰減會讓小數樣本變成常態，把這個邊緣個案放大成系統性問題，因此在加
時間衰減之前必須先修。

改寫成「證據總量」語意：每一票都指向同一個方向，折疊的是**衰減後的證據總量**，
不是方向平均——raw value 恆為 1，`effectiveSampleSize = strongMass + weakMass`
（`weakMass` 在衰減之後才 cap）。這個寫法讓「10 筆衰減 0.5 的證據」與「5 筆全新
證據」產生完全相同的結果，而且讓「多一筆同軸弱訊號，權重不得下降」變成精確成立的
不變量（新測試 PL17 釘住）。既有 PL2/PL3/PL4/PL8/PL9/PL10 的斷言方向全數不變
（弱訊號飽和 cap 或不存在時，新舊公式結果相同）。

### 4.2 時間衰減：半衰期 + 跨學期降權

`server/src/skills/preferenceLearning.js` 新增：

```js
export const PREFERENCE_LEARNING_MODEL_VERSION = 'preference-learning-v2'; // v1 → v2
export const PREFERENCE_DECAY_HALF_LIFE_DAYS = 120;   // 約一個授課學期
export const STALE_TERM_DECAY_FACTOR = 0.5;
```

`decayFactorFor(event, { now, activeTerm })` = 半衰期衰減 × 學期降權：

- **半衰期**：`0.5 ^ (ageDays / 120)`。搭配 `PRIVACY_RETENTION.interactionEventDays`
  = 180 天的保存上限，衰減係數被夾在 `[0.5^1.5, 1] = [0.354, 1]`——事件在被衰減壓到
  接近零之前就已經因保存期限到了而被刪除，整套機制因此是**有界的重新加權，不是
  抹除**。
- **跨學期降權**：固定係數 0.5，不隨學期距離複合（半衰期已經處理連續老化，這裡只
  表達「規劃標的換了」這個離散事實）。`isStaleTerm()` 只在「`activeTerm` 有提供」
  且「事件學期明確早於它」時才降權，缺資料一律不降權——沿用 `activeTerm.js` 既有
  的立場。
- **時鐘純度**：`now`／`activeTerm` 皆為 `options` 參數，省略即不衰減／不做學期
  降權，模組內不出現 `Date.now()`。可重播的敘述因此變嚴格：同一批事件 **＋ 同一個
  `now` ＋ 同一個 `activeTerm`** 才保證逐位元相同（PL1 對應更新）。
- **分類看 `strength` 不看數值**：衰減後的強訊號（例如 0.3）不會被誤判成弱訊號
  掃進 cap（PL14 釘住這個陷阱）。

回傳形狀新增頂層 `decay` 欄位（半衰期常數、`appliedAt`、`activeTerm`、
`effectiveSampleSize`、`staleTermEventCount`、事件時間範圍），`evidence[axis][]`
每筆多一個 `decay`（四捨五入到小數三位）。`usableEventCount`**刻意不受衰減影響**
——它是「資料量夠不夠格開始學」的整數量閘，若讓它衰減，使用者會在沒有任何操作下
看到「還差 N 筆」倒著數。

### 4.3 重設：連互動事件一起刪，不是只刪推導出的權重

`preferenceLearningService.js` 新增 `resetPersonalization(identity, options)`：

```js
export async function resetPersonalization(identity, { requestId = null } = {}) {
  const subjectId = deriveSubjectId(identity.canonicalId);
  const learned = await deleteLearnedWeights(subjectId);
  const events = await deleteInteractionEvents(subjectId);
  const deleted = { ...learned, ...events };
  await writeAudit(subjectId, 'delete', 'learned_preference_weights', 'success', deleted, requestId);
  return { ...deleted, profilePreserved: true };
}
```

**設計上最關鍵的判斷**：權重是事件的純推導。若只刪推導出的那一列，而讀取端
（`getPersonalizationSource()`，見 4.4）在過期時會自動重算，**下一次載入頁面就會
用一模一樣的事件重新算出一模一樣的值**——一個看得到自己復原的「重設」比沒有這個
功能更糟，直接違反「重設後 learned weights 確實清除」這條驗收標準。連事件一起刪
在政策上也站得住腳：`privacyPolicy.js` 的 `personalization_learning.data` 本來就
同時列了 `pseudonymous_interaction_events` 與 `learned_preference_weights`，兩者
是同一個 consent 涵蓋的資料。`User_Profiles`（偏好標籤、避開時段、學分上限）完全
不在這個函式的觸及範圍內。

路由：`DELETE /api/privacy/personalization`，只掛 `requireIdentity`（不需要
`personalization_learning` 同意——刪除自己已學到的東西不該被「你必須先同意學習」
擋住）。不設確認詞（那個儀式屬於整個帳號刪除），前端用 `window.confirm` 講清楚
後才送出。

### 4.4 來源標示：已存 + 精確過期判定，不是每次都重算

`getPersonalizationSource(identity, options)` 回傳
`{ source, appliedToScheduling, explicitProfileEmpty, weights, explicitProfile,
sufficiency, modelVersion, computedAt }`。`source` 為
`no-consent`／`insufficient`／`explicit`／`learned` 四選一。

**重算策略**：只讀已存的會讓正式環境每個人永遠是 `null`（沒有任何東西主動觸發過
`recomputeLearnedWeights()`）；每次都重算又讓一次 GET 付出全量事件掃描的代價。改用
精確過期判定：從沒算過、`modelVersion` 不是現行版本（`v1` → `v2` 升版後的舊列）、
有比已存 `computedAt` 新的事件、或已存結果超過一天沒更新（純時間衰減即使沒有新事件
也會讓結果隨時間改變，一天遠低於 120 天半衰期，成本可忽略）——任一成立才重算並覆寫。
新增 `interactionEventService.getLatestInteractionEventTime()`：一次帶索引的
`SELECT MAX(occurred_at)`，比 Dashboard 掛載時已經會發的 `GET /api/profile` 還便宜。

**最大的誠實風險，以及強制對策**：`scheduler.js` 的 `buildPreferenceProfile()`
目前完全不讀學到的權重（`#5B` 尚未完成）。若來源標示寫「目前使用：學習」，那會是
一句關於課表如何產生的**假話**。因此新增：

```js
export const LEARNED_WEIGHTS_APPLIED_TO_SCHEDULING = false;
```

以 `appliedToScheduling` 回傳，前端在 `false` 時一律顯示「已學到偏好，但目前排課
仍只用你的顯式設定」。`#5B` 完成時把這個常數翻成 `true` 即可，呼叫端不必再改。

### 4.5 撤回同意 = 硬性暫停

改動點在路由 `PUT /api/privacy/consents`（不是 `recordConsentChoices()`本身，避免
`preferenceLearningService.js` ↔ `privacyService.js` 形成真的循環 import）：

```js
const status = await recordConsentChoices(req.identity, req.body?.consents, ...);
const learning = status.consents?.[PRIVACY_PURPOSES.PERSONALIZATION_LEARNING];
const stillGranted = Boolean(learning?.granted && learning.policyVersion === PRIVACY_POLICY_VERSION);
if (!stillGranted) await resetPersonalization(req.identity, { requestId: requestId(req) });
```

判定用**寫入後的權威狀態**（含 `policyVersion` 比對），不是 `req.body`，與
`hasPersonalizationConsent()` 用同一個標準——舊版政策下同意過不算現在仍然同意。
前端 `save()` 在 granted→false 的轉換上強制 `window.confirm`，講清楚會刪除什麼、
且無法復原，才送出請求；沒有這一步就不能上線這個後端改動。

### 4.6 前端：徽章 + 重設按鈕，兩個獨立呼叫端共用一個元件

新增 `client/src/components/Profile/PreferenceSourceBadge.jsx`：自己抓
`privacyAPI.getPersonalization()`，也接受已載入的 `personalization` prop 讓
`PrivacyPage` 不必重複打 API。`variant="compact"`（Dashboard 側欄「我的排課偏好」）
／`"detail"`（隱私中心，緊接在三個同意勾選之後）。文案依 `source` /
`explicitProfileEmpty` / `appliedToScheduling` 決定，六種狀態涵蓋冷啟動
（`尚未表達偏好`）、資料不足、顯式、已學到但尚未套用、已套用、未同意。

`PrivacyPage.jsx` 新增「重設學到的偏好」按鈕與撤回同意的確認守衛（見 4.5）；
`client/src/services/api.js` 的 `privacyAPI` 新增 `getPersonalization()` /
`resetPersonalization()`。

## 5. 影響範圍

- **不需要新的 migration**——理由見下方「明確不做」。唯一持久化的形狀變化是
  `evidence_json` 多了 `decay` 欄位（`JSON` 欄位可以直接容納），以及
  `model_version` 的值從 `v1` 變成 `v2`。
- `server/src/routes/privacy.js`：`PUT /consents` 新增撤回鉤子；新增
  `GET`／`DELETE /api/privacy/personalization`。
- `server/src/services/interactionEventService.js`：新增
  `getLatestInteractionEventTime()`。
- `server/src/services/preferenceLearningService.js`：`recomputeLearnedWeights()`
  新增 `now`／`activeTerm` 覆寫；新增 `resetPersonalization()`、
  `getPersonalizationSource()`、`LEARNED_WEIGHTS_APPLIED_TO_SCHEDULING`、測試專用
  的 `seedStaleModelVersionForTests()`。
- `server/src/skills/preferenceLearning.js`：`foldAxis()` 改寫（修掉單調性 bug）、
  新增時間衰減與跨學期降權、`modelVersion` 升版。
- `client/`：新增 `PreferenceSourceBadge.jsx`，`PrivacyPage.jsx`／
  `DashboardPage.jsx`／`App.css`／`services/api.js` 各自小幅擴充。
- **排課決策本身沒有改變**——`scheduler.js` 完全沒有被這次改動觸碰，
  `buildPreferenceProfile()` 仍然不讀學到的權重。

## 6. 測試與驗證結果

### 自動化

- `DB_HOST= DB_USER= DB_NAME= DB_PASSWORD= npm test`（模擬 CI 環境）：
  **894 tests / 876 pass / 18 skipped / 0 fail**（改動前 875 tests / 857 pass /
  18 skipped / 0 fail，新增 19 項全數通過）：
  - `preferenceLearning.test.js`：PL11–PL17（純函式，衰減與單調性），PL1 補一個
    「給定 `now`／`activeTerm` 時也逐位元相同」的案例。
  - `preferenceLearningService.test.js`：PL18–PL21（重設、四態來源分類、過期判定、
    版本過期），既有 PL7 的「重算兩次逐位元相同」測試改傳固定 `now`（否則
    `decay.appliedAt` 會因真實時鐘幾毫秒的差異而不相等——這是加上時間衰減後
    必然要處理的既有測試調整，已在跑 CI 前修好）。
  - `privacyRoutes.test.js`：PL22（`DELETE /personalization`）、PL23（`PUT
    /consents` 撤回連帶刪除）——兩者都刻意避開會走到 `getUserPreferences()`／
    MySQL 的路徑，斷言改用 service 層的讀取函式直接查證，不透過會碰 MySQL 的
    `GET /api/profile`。
  - 18 個 skipped 為既有的 golden set（`#34`，CI 環境下明確略過，非本輪改動）。
- `node --check` 對全部新增／修改的 server 檔案通過；`node --check` 掃過全部
  `server/src/**/*.js` 無語法錯誤。
- `cd client && npm run lint`：無錯誤。
- `cd client && npm run build`：成功（`vite build`，1776 modules transformed）。

### 對真實 MySQL 與瀏覽器的驗證

啟動真實後端（`preview_start` name=`server`，連團隊共用 MySQL）與前端
（name=`client`），用 demo 帳號（`D1249697`）登入：

- **Dashboard 側欄**：`PreferenceSourceBadge` 顯示「尚未表達偏好／目前沒有任何
  偏好可用，課表只保證合法，個人化程度有限。」——與這個帳號的真實顯式設定
  （沒有勾 `#盡量集中排課`，因此 `explicitProfile` 三軸皆為 0）完全吻合，確認
  `explicitProfileEmpty` 的判定邏輯在真實資料上正確。
- **隱私中心**：三個同意勾選之後正確渲染「目前的個人化來源」區塊，含徽章、說明
  文字與「重設學到的偏好」按鈕；`personalization_learning` 已是這個帳號先前就
  同意過的狀態（`granted: true`），與 `#30` 量測時記錄的 92 筆真實互動事件一致。
- **重設按鈕的確認守衛**：用 `window.confirm = (msg) => { record(msg); return false; }`
  的方式 stub，點擊按鈕後確認彈出的文字與程式碼一致，且**沒有任何
  `DELETE /api/privacy/personalization` 請求被送出**（`read_network_requests`
  確認）——證明取消時不會誤刪。
- **撤回同意的確認守衛**：同樣的 stub 方式，取消勾選 `personalization_learning`
  並點擊儲存後，確認彈出的文字與程式碼一致，且**沒有任何新的
  `PUT /api/privacy/consents` 請求被送出**；事後直接查
  `GET /api/privacy/consents` 確認 `personalization_learning.granted` 仍為
  `true`，未受影響。
  **這兩項刻意只驗證「取消時不觸發刪除」，不驗證「確認後真的刪除」**——這個帳號
  的 92 筆互動事件是跨多個開發階段累積的真實行為資料，`resetPersonalization()`
  與撤回同意都會真的刪除它，而這類刪除已經在 PL18／PL22／PL23 用拋棄式合成
  subject 在自動化測試裡驗證過「確認後資料真的消失」，不需要在共用 MySQL 上
  用真實帳號的資料重複驗證同一件事、卻要付出資料回不來的代價。
- 對真實資料額外驗證衰減本身：對 demo 帳號的 92 筆真實事件套用 `learnPreferenceWeights()`
  時間衰減，衰減係數全數 > 0.977（4 天前的事件相對 120 天半衰期）、學期係數皆為
  1（全部標記當前學期）；權重到小數第三位與不套用衰減時完全相同——確認第 3 節
  量測的結論在完整管線裡同樣成立，時間衰減今天是可驗證但不可見的功能。

## 7. 明確不做

- **不接進排課**——`scheduler.js`／`buildPreferenceProfile()` 這輪不動，`#5B`
  仍記為未完成；`LEARNED_WEIGHTS_APPLIED_TO_SCHEDULING` 恆為 `false`，來源標示
  UI 因此正確地說「尚未套用」而非宣稱一件還沒發生的事。
- **不做真正的重設水位線／版本歷史**——重設直接刪除輸入事件，比保留事件加一個
  `reset_at` 標記更簡單、也更直接滿足驗收標準，不需要新 migration。
- **不加新的「暫停」欄位或狀態機**——暫停就是 `Privacy_Consents` 裡
  `personalization_learning` 那一列，它已經有完整歷史與稽核。
- **不在真實共用帳號上驗證刪除真的發生**——理由見第 6 節；用拋棄式合成資料在
  自動化測試裡驗證過，不用真實帳號的 92 筆資料冒險。
- **不對 `event.term` 的可信度加額外驗證**——它目前只做形狀驗證（`interactionEventSchema.js`
  的 `normalizeTerm`），理論上一個惡意 client 可以把每筆事件的學期都宣告成當前
  學期以規避跨學期降權。影響有界：這樣做最多只能讓自己的降權係數維持在 1（不會
  超過），不會影響其他使用者，也不會繞過 50 筆的資料量門檻或顯式設定下限。本輪
  記錄這個已知限制，不在這輪加強制。
