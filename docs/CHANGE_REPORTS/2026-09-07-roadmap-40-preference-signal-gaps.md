# Roadmap #40：補齊個人化學習訊號缺口

## 背景

`#36`（2026-09-06）的固定 persona 實驗量出三個學習訊號缺口：`recommendation_accepted`
在 `#7` 把排課方案改成混合權重之後完全不再投票、`compact` 軸一旦使用者顯式設定已經
打到頂就學不到任何增量、`interest` 軸只能靠最弱的 `course_viewed` 訊號、且系統本身
把弱訊號的份量鎖得很低。這三項在 roadmap 上被明確立案為「學習訊號設計問題，不在
`#36` 的量測任務裡偷改演算法」，這次是對應的修法。

規劃時直接讀了 `preferenceLearning.js`／`scoringPolicy.js`／`planStrategies.js`／
`interactionEventSchema.js`／`scheduleService.js`／client 端 `ScheduleContext.jsx`
的實際程式碼，並用一輪 Plan agent 紅隊對抗設計——過程中推翻了初版設計的一個關鍵
假設：原本以為「接受方案」的對照歸因可以還原出使用者從未表態過的軸，實際讀
`planStrategies.js` 才確認每個 `personalized_${axis}` 方案只在該軸已經非零（使用者
已經表態）時才會被產生，對照歸因因此只能在「使用者已經打開的幾個軸之間分高下」，
不能無中生有——這跟 `scoringPolicy.js` 既有的「boost 只能放大已表態方向」安全原則
完全一致，不是意外，是同一條原則在兩個檔案裡各自成立。完整設計見
`C:\Users\yamat\.claude\plans\review-ship-delegated-quasar.md`。

## 檔案變更

- `server/src/skills/preferenceLearning.js`：三個修法皆在此檔案，純函式邏輯不變的
  部分（`decayFactorFor()`／`sortEvents()`／時間衰減與跨學期降權）完全未動。
- `server/test/preferenceLearning.test.js`：新增 `PL28`／`PL29`／`PL30`（`PL25-27`
  已被 `preferenceLearningService.test.js` 使用，這次的新增改用未被佔用的編號）。
- `docs/TEST_PLAN.md`：新增本次三個修法的驗收對照。
- 本檔案與 `docs/CHANGE_REPORTS/README.md` 索引。
- `docs/CHANGE_REPORTS/2026-08-01-personalization-roadmap.md`：`#40` 狀態更新、
  進度總覽表核對、「現在可以動工的任務」重新排序。

**沒有改動**：client 端任何檔案（`course_favorited`／`course_selected` 事件本來就已經
送到後端，這次只是後端開始讀它們）；`server/src/skills/scoringPolicy.js`（「boost
只能放大已表態方向」的既有安全閘門，這次刻意不動）；
`server/src/services/preferenceLearningService.js`（新增的 `axisSignal` 診斷欄位不
持久化，不需要 migration）；任何隱私／consent 相關檔案（確認是既有的
`personalization_learning` 這個統一 purpose gate，涵蓋所有事件類型，不需要新的
consent 類別）。

## 主要改動內容

### 1. `recommendation_accepted` 在混合權重下的對照歸因

`collectVotes()` 原本只要曝光的 `exposureContext.planPolicies` 有資料，或
`variantId` 以 `personalized` 開頭，就整批不投票——這正是「#7 之後接受方案不再投票」
這個缺口的成因。改為：先找出被接受方案自己在這次曝光裡的權重
（`policies.find(p => p.planId === event.plan.planId)`），若找得到，逐軸比較它跟
「這次曝光顯示過的其他每一個方案」——若某一軸的權重（取絕對值，因為這裡量的是
「在乎這個軸的強度」，不是方向；方向永遠只由顯式設定決定，這裡沒有改變這件事）嚴格
大於其他每一個方案，代表使用者持續在這個已表態的方向上做出取捨，記一票強訊號
（新規則代號 `ACCEPT_VARIANT_CONTRAST`）。找不到被接受方案自己的權重資料時（真正的
舊事件、或曝光紀錄本身有缺口），才退回舊的 `VARIANT_AXIS` 靜態表——這條路徑只服務
`#7` 以前留下的資料重播，現行排課引擎產生的 `personalized*` 方案一定有對應權重。

這個設計的必然限制（不是沒做完，是延續既有安全原則的結果）：只可能在使用者已經
打開的軸之間分高下，不能替一個完全沒表態過的軸生出偏好——因為 `planStrategies.js`
的 `personalized_${axis}` 變體本來就只在該軸非零時才會被產生，所有方案在「沒打開」
的軸上恆為 0，永遠平手，不會誤判成有偏好。

### 2. 收藏／手動選課成為 interest 的強訊號

`course_favorited`（收藏）與 `source: explicit_selection` 的 `course_selected`
（使用者自己找、自己加的課，非必修、非系統推薦）本來就已經由
`client/src/contexts/ScheduleContext.jsx` 的 `toggleWatchlist()`／`addCourse()` 送到
後端，`interactionEventService.js` 也已依 `#29` schema 收下——只是 `collectVotes()`
從未讀過這兩種事件類型。這次接上，列為強訊號（不受 `WEAK_VOTE_AXIS_CAP` 限制），
`source: required`／`system_recommendation` 的手動選課不算興趣表態（那是必修或
系統既有推薦，說明不了使用者在乎什麼）。

既有「看了又退」排除邏輯（`findExcludedViewEventIds()`）泛化為
`findExcludedPositiveEventIds()`，涵蓋所有正向表態事件：`course_viewed`／
`course_selected` 被同課程之後的 `course_withdrawn` 排除；`course_favorited` 另外
多一種撤銷路徑——被同課程之後的 `course_withdrawn` 或 `course_unfavorited` 排除
（取消收藏代表使用者自己撤回了那個表態，跟討厭與否無關，但確實不該再算數）。

已知、刻意不處理的殘留噪音：`courseSource()` 判斷 `explicit_selection` 是用「不在
目前這次請求的系統推薦清單裡」倒推，先手動加課、或加的課曾出現在較舊推薦裡，仍會
被標成 `explicit_selection`——這次把它的下游後果從「純紀錄」升級成「會影響學習
權重」。這個殘留風險被三層既有安全機制夾住（`usableEventCount` 未達 50 筆前不套用；
`foldAxis()` 的 m-estimate 收縮壓低小樣本影響；`scoringPolicy.js` 的 boost 只放大
已表態方向），這次不修 `courseSource()` 本身。

### 3. `axisSignal` 診斷欄位

`learnPreferenceWeights()` 新增頂層欄位 `axisSignal: { interest, compact, easy }`，
每軸回報 `AXIS_SIGNAL_STATUS` 之一：`no-evidence`（完全沒有投票）、
`learned-increment`（行為證據真的把數值推高於顯式基準）、
`explicit-ceiling-with-evidence`（有持續行為證據，但顯式基準已經頂到這批證據能
達到的上限）。用衰減／收縮後但未套用 `insufficient` 回退的原始學習值分類，獨立於
`sufficiency.status` 這個整體門檻——即使整體資料量不足，個別軸只要有證據仍如實
回報，不連帶回報 `no-evidence`。

刻意不寫進 `Learned_Preference_Weights` 表（`preferenceLearningService.js` 目前的
固定欄位沒有對應位置，這次不新增 migration），也不改變 `scoringPolicy.js` 如何用
`weights` 排課——只在 `learnPreferenceWeights()` 這個純函式的回傳值裡驗證得到。正式
落地（存表、透過畫面呈現、餵給 `#39` 的 rollout 決策）留給之後的隱私與產品決策，
對應 roadmap 上「正式 rollout 仍需隱私邊界決策」那句話。

## 影響範圍

會改變**已經有足量真實行為資料、且至少打開一個偏好軸**的使用者的排課排序（接受
方案的對照歸因現在真的會投票）；也會讓已經在流動、先前被忽略的
`course_favorited`／`course_selected` 事件開始對 `interest` 軸產生實際效果。對
`#36` 既有的 3 個 synthetic persona（無顯式偏好或探索式訊號為主）沒有觀察到影響
（見下方驗證）。`axisSignal` 是全新欄位，不影響任何既有讀者。

## 測試與驗證結果

- `node --check` 全部通過。
- `server/test/preferenceLearning.test.js`：48/48（含新增 `PL28`／`PL29`／`PL30`
  共 12 個新測試），既有 `PL1`-`PL24` 全數維持通過，包含 `PL24` 釘住的
  「顯式先驗已飽和（prior=1）時 boost 為 0」不回歸案例。
- `cd server && npm test`：1044/1044 全數通過。過程中 `agentGoldenSet.test.js` 的
  `no-invented-constraints`（呼叫真實模型的測試，`#34`／`#35` commit-push 時都各
  出現過一次同樣的間歇性失敗）第一次執行時失敗一次，與這次改動的
  `preferenceLearning.js` 完全無關（該測試呼叫的是 Agent 對話流程，這次沒有動
  `agentService.js`／`promptService.js` 任何一行）；依使用者指示重跑一次，
  1044/1044 全數通過，確認是已知的間歇性模型行為，不是本次改動引入的回歸。
- `npm run bench:personalization`：3/3 通過，`wide_pool` 三組 persona 的
  `baselineUtilityDelta` 仍是 `0.182`，跟 `#36` 交付時記錄的數字逐位元相同——這三組
  synthetic persona 都沒有可競爭的 `personalized_${axis}` 對照組（各自只投單軸弱／
  強訊號，不涉及方案切換列的多方案比較）也沒有收藏／手動選課事件，因此沒有觀察到
  差異，符合預期，不是驗證無效。
- `cd client && npm run build && npm run lint`：client 完全沒有改動，這次仍按
  `commit-push` 規則執行，確認未受影響（略）。
- 瀏覽器 A/B（demo 帳號 `D1249697`，真實 MySQL）：登入後先用既有正常路徑生成一次
  課表（`POST /api/schedule/generate` 200，觸發 `preferenceLearningService.js` 用
  這個帳號的真實歷史事件跑新版 `learnPreferenceWeights()`，無 console 新增錯誤、
  伺服器無錯誤 log）；接著在搜尋頁對「計算機演算法」按收藏（`POST /api/interactions`
  200，`eventType: course_favorited`）、手動把「人工智慧導論」加入課表
  （`POST /api/interactions` 200，`eventType: course_selected`）；再重新自動排課一次
  （第二次 `POST /api/schedule/generate` 200），畫面正常渲染 8 門課 23 學分、無新增
  console 錯誤、伺服器無錯誤 log。此帳號目前「未表達偏好」，三軸顯式基準皆為 0，
  Part A／B 的新訊號因此還沒有可見的排序效果（`directions[axis]=0` 時 boost 恆為 0
  ——這正是三、明確證明不了什麼裡說明的必然限制），這次驗證證明的是「新程式碼路徑
  接上真實資料不會壞」，不是「這個帳號的排序已經改變」。

## 明確證明不了什麼

- 對照歸因只能在使用者已經打開的軸之間分高下，不能替完全沒表態過的軸生出偏好。
- `courseSource()` 的 `explicit_selection` 分類噪音沒有被修正，只是下游後果從
  「純紀錄」變成「會影響學習權重」。
- `axisSignal` 只證明「算得出來、可重播、單元測試與離線 replay 通過」，不證明拿去
  正式影響排課排序或使用者看到的畫面會有什麼效果。
- 三個修法都建立在既有 synthetic fixture 與這次的手動瀏覽器操作上，跟 `#36`／`#38`
  一樣，不能取代真實去識別互動樣本才能證明的「效果」。

## Commit 與 push

尚未 commit、尚未 push——依專案慣例，等使用者明確要求再執行 `/commit-push`。
