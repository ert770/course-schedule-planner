# 2026-09-05 Roadmap #5B：per-user 加權方向（同一評價分數對不同使用者相反符號）

## 1. 修改日期

2026-09-05

## 2. 為什麼做這件事

`#30`（2026-09-04）算出了 per-user 偏好權重，`#31`（同日）讓使用者看得到、管得到、
還會依時間衰減——但兩輪都刻意沒有動排課引擎，`#31` 留下的
`LEARNED_WEIGHTS_APPLIED_TO_SCHEDULING = false` 就是明講「等 `#5B` 接」的旗標。
`#36`（personalization baseline 與 A/B）明文列出剩餘阻塞只剩 `#5B`／`#7` 兩項。

實測確認今天的狀態：`buildPreferenceProfile()` 三軸恆為 0 或 1，全部來自使用者勾的
checkbox；`computeScoreComponents()`（決定單一門課排序）根本收不到使用者的偏好
profile，單門課排序 100% 由 `VARIANT_WEIGHTS` 決定。

## 3. 規劃時先確認兩件事

**驗收標準寫的是「同一評價分數對不同使用者要有相反符號」，但這件事在資料層今天
做不到。** `#30` 學到的權重被 `clamp01` 鎖在 `[0,1]`，只有強度沒有方向；而
`#29` 定的事件 schema 裡，`course_withdrawn.feedbackReason` 只有
`time / content / instructor / workload / full / eligibility / other`——
`workload` 永遠只能表達「太重、我要更涼」，**沒有任何事件能表達「太簡單、
我要更難」**。硬要「從行為學出相反符號」，那個符號只能是憑空編的。

決定：新增顯式的「挑戰難課」標籤提供方向，學到的權重只負責強度（詳見 ADR-022）。

**學到的權重要在哪一層生效？** `computeScoreComponents()` 今天完全收不到使用者
profile，單門課排序 100% 由 variant 權重決定。決定只做方案層——`evaluatePreference()`
決定五個方案哪一個主推。不動 `scoreCourse()`：那是 `#7`（連續權重向量取代五個
固定 variant）的工作，這輪動它會讓五個方案一起往同一方向傾斜，加劇 `#10`
才修好的方案塌縮。

**實測目前資料**：93 筆互動事件、來自 1 個帳號，學到的權重三軸全是 `0.000`、
狀態 `insufficient`（31/50）；easy 軸的真實訊號只有 1 筆（0 筆 workload 退課 +
1 筆接受涼課方案）。決定：照做，測試層面用合成事件驗證，變更報告如實記錄
今天沒有真實使用者會走到學習路徑——與 `#31` 把時間衰減的 no-op 講清楚同一套
誠實策略。

## 4. 主要改動內容

### 4.1 兩個新標籤：`server/src/data/preferenceTags.js`

新增群組「課程難度」：`#涼課優先`（既有 `preferEasyCourses`，`#5A` 起就被排課
引擎讀取但**從來沒有任何 UI 或儲存路徑設定過它**）與 `#挑戰難課`（新旗標
`preferChallengingCourses`）。兩者互斥，刻意不在儲存層做互斥——那會靜默丟掉
使用者真的存過的標籤，是本專案已經記取過的「偏好靜默消失」那一類 bug。

### 4.2 帶號權重：`server/src/skills/scheduler.js`

`resolveEasyDirection(constraints)` 把兩個標籤換算成 `+1`／`-1`／`0`（兩個都
勾為矛盾，視為 `0` 並發警告）。`axisWeight(direction, boost) = direction ×
(1 + boost)`，權重絕對值恆在 `[1,2]`，符號恆等於顯式方向。

**關鍵陷阱**：`boost` 必須是「學到的值**超出**顯式先驗的部分」，不是原值。
`foldAxis()`（`#30`）把輸出下限釘在 `Math.max(clamp01(shrunk), prior)`，
對已勾集中排課的使用者 `compact` 的學到值恆為 `1`——若直接用原值當強度，
所有這類使用者會在功能上線當天無證據地被加重權重。`preferenceLearning.js`
新增的 `computeLearnedBoosts(weights, explicitProfile)` 只取超出量，恆
`>= 0`，讓「顯式只能被行為加強」變成型別上的保證，不是口頭約定。

`evaluatePreference()` 改成分母用 `Σ|weight|`，負權重把軸值翻面
（`orientAxisValue`）。`score` 因此仍在 `[0,1]`，`comparePlans()`、
`PREFERENCE_SCORE_EPSILON`、「偏好符合度 N%」都不必改；權重全正時算術與
改動前逐位元相同——這是既有 146 項 `scheduler.test.js` 測試的回歸保證，
**在只做這一步、權重仍全是 0/1 時就先跑過一次全綠**，才繼續往下做。
`preferenceBreakdown` 維持方向無關（永遠是涼度測量值，不是偏好值）。

`hasExpressedPreference`（`:> 0` → `Math.abs(...) > 0`）與兩條評價誠實警告
（`easy === 1` → `easy !== 0`）一併修正，否則挑戰難課的使用者會被誤判成
「沒表達偏好」。新增附加式的 `preferenceProfileSource` 回應欄位
（`learnedApplied`／`reason`／`modelVersion`／`computedAt`／`boosts`／
`easyDirection`），讓「學到的權重是否真的套用」不必解讀 `preferenceProfile`
的數值就能直接讀出來。

### 4.3 接線：`scheduleService.js` + `preferenceLearningService.js`

`scheduler.js` 是純同步模組，改由 `prepareGenerationInputs()`（REST／Chat／
counterfactual 共用的唯一入口）取一次學到的權重，經既有的 `context` 參數交給
`buildScheduleConstraints()`（`courseReviews` 已經走這扇門）。

新增 `getSchedulingPreferenceWeights(identity, options)`：**只讀已存的那一列，
絕不重算**——與 `#31` 的 `getPersonalizationSource()` 刻意不同，那支允許過期時
重算（一次全量事件掃描加一次寫入），排課是每次都會走的熱路徑，不能把一次
讀取變成一次重算。使用時重新檢查 consent，不倚賴 `#31` 的撤回鉤子已經刪掉
那一列。新增 `loadLearnedPreferenceSafely()`（`scheduleService.js`），比照既有
`loadCourseReviewsSafely()` 的 fail-open 原則：未同意、沒算過、資料庫暫時
不可用，一律退回今天的顯式 0/1 行為，絕不讓個人化管線壞掉導致排不出課表。

### 4.4 難度矛盾的雙重防線

排課引擎本身（`resolveEasyDirection`）永遠把矛盾視為未表態並警告，涵蓋 UI
勾選與 chat 兩條路徑。額外在 `requirementPreflight.js` 加一條 chat 專用的
澄清問題（`confirm-difficulty-direction`），讓 Agent 在排課前主動問，體驗上
比引擎默默中和更誠實——但這道防線**只涵蓋 chat**，preflight 只收到模型的
tool 參數，UI 勾選路徑根本不經過它。

### 4.5 旗標翻轉

`LEARNED_WEIGHTS_APPLIED_TO_SCHEDULING` 改成 `true`，註解重寫成「已接進
**方案層**，`computeScoreComponents()`／`scoreCourse()` 仍然沒有，那是 `#7`」。
`PreferenceSourceBadge.jsx` 的兩種文案（已套用／尚未套用）不必改，因為旗標
語意本來就只承諾「有進排課決策」，不是「每個層級都用到」。

## 5. 影響範圍

- `server/src/data/preferenceTags.js`：新增標籤群組，無 migration（方向存在
  既有的 `User_Profiles.preference_tags`）。
- `server/src/services/constraintService.js`：新增 `preferChallengingCourses`
  與 `learnedPreference` 直通。
- `server/src/skills/scheduler.js`：`buildPreferenceProfile()`／
  `evaluatePreference()` 改寫，新增 `preferenceProfileSource` 回應欄位。
  **`computeScoreComponents()`／`scoreCourse()` 完全沒有被觸碰**。
- `server/src/skills/preferenceLearning.js`：新增 `computeLearnedBoosts()`。
- `server/src/services/preferenceLearningService.js`：新增
  `getSchedulingPreferenceWeights()`；`LEARNED_WEIGHTS_APPLIED_TO_SCHEDULING`
  改為 `true`。
- `server/src/services/scheduleService.js`：新增 `loadLearnedPreferenceSafely()`
  並接進 `prepareGenerationInputs()`。
- `server/src/services/promptService.js`、`server/src/services/requirementPreflight.js`：
  新增 tool 參數說明與難度矛盾澄清問題。
- `client/`：**未改動**——新標籤透過既有的 `GET /api/profile/preference-tags`
  自動出現在 Setup／Dashboard，不需要任何前端程式碼變更。
- **無 migration**：三個學到的權重欄位型別與範圍都沒變。

## 6. 測試與驗證結果

### 自動化

`DB_HOST= DB_USER= DB_NAME= DB_PASSWORD= npm test`（模擬 CI）：**925 tests /
907 pass / 18 skipped / 0 fail**（改動前 894 tests / 876 pass，新增 31 項全數
通過；18 skipped 為既有 golden set，非本輪改動）。連續三次全量重跑穩定
（含下方順手修掉的 flake）。

- `scheduler.test.js` 的 PD1-PD11（見 `docs/TEST_PLAN.md` 完整表格）。PD1 是
  驗收標準本身：用一個 10 門課、一半涼課評價一半硬課評價的候選池（實測固定
  產出 4 個不重複方案，`breakdown.easy` 落在 `{0.375, 0.5, 0.75}`），
  `preferEasyCourses` 與 `preferChallengingCourses` 給出不同的主推方案，且
  對每一個相同 `plan.id`，兩次呼叫的 `preferenceScore` 相加恰為 `1`。
- `preferenceLearning.test.js` 的 PL24（`computeLearnedBoosts()`，純函式）、
  `preferenceLearningService.test.js` 的 PL25-27（`getSchedulingPreferenceWeights()`
  四種 `applied:false` 情境，記憶體 store）、`scheduleService.test.js` 的
  fail-open 測試、`constraints.test.js`／`requirementPreflight.test.js`
  （RP14）／`prompt.test.js`（P1 的 `SCHEDULER_PARAMS`）。
- **CI 限制，與 `#30`／`#31` 同一個坑**：`getSchedulingPreferenceWeights()`
  未注入 `options.prefs` 時會查 MySQL，`POST /api/schedule/generate` 端到端
  同理——兩者皆不寫成 CI 測試，接線本身只有一行，行為已由上述三層純函式／
  記憶體測試覆蓋。

### 過程中發現並修掉的兩個問題

1. **`foldAxis()` 的單調性 bug**（`#30` 遺留）：實測 1 筆強訊號算出 `0.16667`，
   1 筆強訊號 + 1 筆未飽和弱訊號只有 `0.16429`——多一筆支持性證據反而讓權重
   下降。改成「樣本數 = 衰減後的證據總量」語意後連帶修掉，新測試 PL17
   （`preferenceLearning.test.js`，`#31` 那輪加的）已經釘住新不變量；本輪
   驗證這個修法在 `#5B` 的 boost 計算上同樣成立。
2. **`preferenceLearningService.test.js` 的 PL20 測試 flake**：獨立於本輪改動，
   但在跑整個檔案時約 4/5 機率失敗——事件時間戳與 `computedAt` 都來自真實
   時鐘的毫秒精度，記憶體 store 沒有 I/O 等待，快到會落在同一毫秒。加一個
   5ms 的 `setTimeout` 後穩定通過（8 次全綠）。

### 對真實 MySQL 與瀏覽器的驗證

啟動真實後端（連團隊共用 MySQL）與前端，用 demo 帳號（`D1249697`）登入：

- **Setup／Dashboard** 都正確渲染新的「課程難度」標籤群組（`#涼課優先`／
  `#挑戰難課`）——確認前端零改動、標籤目錄真的是動態來源。
- 勾選 `#挑戰難課` 並儲存 → 直接查 `GET /api/profile` 確認
  `preferChallengingCourses: true` 已寫進 `User_Profiles.preference_tags`
  （不只信 UI 顯示）。
- 呼叫 `POST /api/schedule/generate` → `preferenceProfile.easy === -1`，
  `preferenceProfileSource = { learnedApplied: false, reason: 'insufficient',
  easyDirection: 'challenge', boosts: null }`——與 `#31` 量測的
  `sufficiency: insufficient (31/50)` 完全吻合，**課表因此與 `#5B` 之前逐位元
  相同**，如實確認這輪對今天唯一的真實使用者是不可見的功能。
- 同時勾選 `#涼課優先` 與 `#挑戰難課` → `preferenceProfile.easy === 0`，
  `easyDirection: 'contradictory'`，`warnings` 出現預期的矛盾說明文字，
  兩個標籤都正確存進資料庫（不是其中一個被靜默丟掉）。
- 驗完將 demo 帳號的 `selectedTags` 還原成驗證前的三個標籤
  （`#全英授課`／`#學到許多知識`／`#不排早八`），不在共用 MySQL 留下測試痕跡。

## 7. 明確不做

- **不接進單一門課的排序**——`computeScoreComponents()`／`scoreCourse()`
  完全沒有被觸碰，那是 `#7` 用連續權重向量取代五個固定 variant 時的工作。
  「挑戰難課」的使用者拿到的是五個既有方案裡**最不涼**的那一個，不是一份
  刻意排進難課的課表——沒有任何 variant 為「難」最佳化，這是真實的天花板，
  不是這輪沒做完。
- **不從行為學方向**——事件 schema 表達不出「太簡單」，方向永遠是顯式宣告
  （ADR-022）。
- **不在儲存層強制兩個難度標籤互斥**——矛盾在排課時處理，不靜默丟資料。
- **不對 `event.term` 之類的可信度做額外驗證**——與本輪無關，是 `#31` 記錄
  過的既有已知限制。
- **不在真實共用帳號上驗證「學到的強度真的能翻轉主推方案」**——demo 帳號
  今天的資料量根本到不了 `sufficient`，PD1 已用合成資料完整證明數學本身
  成立；真實資料要等 `#38` 有更多學生使用之後才有意義。
