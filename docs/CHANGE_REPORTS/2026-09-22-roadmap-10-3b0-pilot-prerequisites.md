# Roadmap #10 任務 3B-0（第一段）：pilot 的兩個阻塞前提與 CP sufficiency codec

日期：2026-09-22
分支：`backend`

> **這一段完全不啟用 Choice Perceptron。** 預設 `PREFERENCE_LEARNER_MODE=v2`，
> CP 不是任何使用者的 active engine，不寫入 `Learned_Preference_Weights`，不回傳給 scheduler。
> 3B-0 的其餘部分（合成 persona、多使用者 readiness runner）尚未完成，見第 6 節。

## 1. 為什麼要先做這兩件事

`2026-09-22-roadmap-10-choice-perceptron-3b-plan.md` 的設計逐項對過程式碼後**數字與現況
描述全部正確**，但有兩個缺口會讓 pilot 一開就壞。兩者在預設模式下都是 no-op，卻都必須在
任何 pilot 之前就位。

### P1：CP 的負權重會讓曝光事件寫入失敗，反而斷掉自己的訓練資料

`interactionEventSchema.js` 對 `planPolicies[].weights` 的值域是
`value >= (axis === 'easy' ? -3 : 0) && value <= 3`——**只有 `easy` 允許負值**。
v2 的公式（`directions[axis] * (1 + clamp(boosts, 0, 1))`）恆滿足它，所以今天沒問題。

但 Choice Perceptron 三軸都帶號。**今天的 bench 就跑出 `cpWeights.compact = -0.209`**
——不是假設，是現況。而權重會一路流進曝光事件：

```text
resolveScoringPolicy()  →  scheduler.js  generationPolicy
                        →  scheduleService.js  planPolicies
                        →  validateInteractionEvent()  ← 這裡擋下來
```

後果是連鎖的：曝光被拒 → `plan_chosen` 依 `requiresExposureProof()` 失去佐證 →
**CP 一啟用就切斷自己的資料來源**。

### P2：單一 model version 比對無法讓兩個引擎並存

`preferenceLearningService.js` 的 stale 判定與 `absent('stale-model-version')` 都拿
**一個常數** `PREFERENCE_LEARNING_MODEL_VERSION` 比。未來 CP 成為某些人的 active engine 時，
那個常數會變成 CP 版本，於是**每位非 pilot 使用者的 v2 列都被判 stale**，掉回顯式偏好
——與「其他人維持 v2」的承諾正好相反。

### P2′：一人一列，CP 一寫入就會改變正式排課（本段採取的最重要防線）

`Learned_Preference_Weights` 的 `subject_id` 是 PRIMARY KEY——**每人只有一列**。
而 `getSchedulingPreferenceWeights()` 回的是
`boosts: computeLearnedBoosts(stored.weights, explicitProfile)`，`scoringPolicy.js` 再
`clamp(boosts, 0, 1)`。

所以只要 CP 權重被寫進那一列，**即使完全不動 `scheduler.js`**，CP 的 signed weight 也會被
當成 v2 的原始權重 → 負值 clamp 成 0、+2 壓成 1 → 正式排課靜默改變。

因此本段的模型狀態只有一種，並且是被測試釘住的：

```text
所有使用者：activeEngine = v2、shadowEngine = choice-perceptron | null
shadow 名單不得影響 Learned_Preference_Weights 的任何讀寫。
```

## 2. 做法

### 2.1 P1：signed weight 的休眠契約（v2 形狀完全不變）

`planPolicies[]` 新增**選填**的 `weightMode`：

| `weightMode` | 值域 |
| --- | --- |
| **缺席**（v2，今天唯一的情況） | `easy ∈ [-3, 3]`、`interest`／`compact ∈ [0, 3]` |
| `signed` | 三軸皆 `[-2, 2]`（`CHOICE_WEIGHT_LIMIT` 的投影界線） |

關鍵是**條件展開**：正規化若寫成 `weightMode: asTrimmedString(item?.weightMode)`，v2 會拿到
`weightMode: null`，而 `resolveScoringPolicy()` 的回傳同時出現在課表 API 的
`generationPolicy` 與曝光事件的 `planPolicies`——多一個 key 兩邊都不再與改動前 deep-equal。

`signed` 需要三項條件**同時**成立：

```text
weightMode === 'signed'
＋ planPolicies[].version === 'personalized-scoring-v3-signed'
＋ source.modelVersion === 'choice-perceptron-v1'
```

三個版本軸互不相干（policy 版本管權重契約、`modelVersion` 管 learner、`planFeatureVersion`
管特徵格式），**不可互相代用**——特別是不用 `isSupportedPlanFeatureVersion()` 判 signed。
`personalized-scoring-v3-signed` 目前是休眠版本，`resolveScoringPolicy()` 不會產生它。

明確寫 `weightMode: 'boost'` **也拒絕**。這樣「v2 不得出現這個 key」才是可以被強制的不變式，
而不是靠自律。呼叫端也無法自稱是 CP：曝光事件只有伺服器寫得進來（`allowExposureWrite`）。

### 2.2 P2：per-user resolver（本段只有 v2 是 active）

新增 `resolveExpectedPreferenceModel({ subjectId })`，回
`{ activeEngine, activeModelVersion, shadowEngine }`。stale 判定與
`absent('stale-model-version')` 都改走它，語意從「和唯一常數相同嗎」變成
「這一列的引擎，是不是**這位使用者**的 `activeEngine`」。

- **`activeEngine` 本段恆為 `v2`，沒有實作 CP active 分支。**
  `PREFERENCE_LEARNER_MODE` 設成別的值只會記一筆警告，然後照樣用 v2——不靜默套用一個
  還沒實作的路徑。
- shadow 名單只收 **HMAC 後的 `subject_id`**（`deriveSubjectId()` 的輸出），設定檔不放學號。
- 名列其中只會讓未來的 readiness runner 多算一份離線結果，**不影響權重列，也不影響排課**。

因為 `activeEngine` 恆為 v2，本段的實際結果與改動前逐位元相同；差別只在留下一個未來可以
安全擴充的接縫。**這一段的定位是「建立未來 pilot 的安全 resolver 基礎」，不宣稱已完成
CP active 共存。**

### 2.3 P3：CP sufficiency 的向後相容 codec（只讀，不寫）

`rowToWeights()` 原本只還原 `status`／`usableEventCount`／`requiredEventCount`，
`calibrated` 與 `choiceCountByAxis` 都掉了。漏掉的後果是靜默的：CP 會**永遠**被
`calibrated !== true` 擋住，而現象看起來像「gate 還沒過」而不是 bug。

**只作用在 CP 列**（`model_version` 以 `choice-perceptron` 開頭）。理由很具體：
`getPersonalizationSource()` 會把 `sufficiency` 直接回給 API，舊的 v2 列若多出
`calibrated: false`，API 回應就不再 deep-equal。所以 v2 的 `sufficiency` 維持三個欄位，
一個字都沒動。

未來 CP 列的 evidence envelope：

```json
{
  "schemaVersion": 1,
  "trails": { "interest": [], "compact": [], "easy": [] },
  "sufficiency": {
    "calibrated": false, "choiceCount": 0, "requiredChoiceCount": 10,
    "choiceCountByAxis": { "interest": 0, "compact": 0, "easy": 0 }
  }
}
```

缺 metadata 時保守回 `calibrated: false`——寧可擋住 CP，也不要讓沒校準的權重上線。
**本段 CP 不寫任何列，所以這條路徑只有合成測試列會走到；這是相容 codec，
不是「CP persistence 已接通」。**

## 3. 驗證

### 3.1 「什麼都沒變」的直接證據

用**真實課程資料**跑完整排課，再把結果餵進 `buildExposureDraft()`，對
「scoring policy ＋ 整個 `exposureContext` ＋ 課程集合 ＋ 每個方案的 `generationPolicy`」
取 SHA-256。把本次三個原始碼改動 `git stash` 之後用同一支腳本再跑一次：

| | HASH | 長度 | 含 `weightMode` |
| --- | --- | ---: | --- |
| 改動前 | `0c6cc65f720c083da2c616e8c3a2deab71f53f6f1185a53238df766c4d9535d3` | 1952 | false |
| 改動後 | `0c6cc65f720c083da2c616e8c3a2deab71f53f6f1185a53238df766c4d9535d3` | 1952 | false |

**逐位元相同。** 這比點過一次 UI 更強，也可重跑。

### 3.2 自動化測試

- 新增 `signedWeightContract.test.js`（10 項）：`resolveScoringPolicy()` 的 key 清單與
  改動前相同且不含 `weightMode`；正規化後的 v2 policy 連這個 key 都不存在
  （`JSON.stringify` 不含該字串）；缺席即 boost 且 `interest`／`compact` 的負值仍被拒
  （**這正是 CP 會踩到的那條線**）；signed 三軸收 `[-2, 2]`、超界被拒；
  scoring policy version 不符被拒；learner modelVersion 不符被拒；
  只送 `weightMode` 而版本還是 v2 被拒；明確寫 `boost` 被拒；
  `NaN`／`Infinity`／字串／`null` 在兩種 mode 都被拒。
- 新增 `preferenceModelResolver.test.js`（9 項）：`activeEngine` 恆為 v2；
  `PREFERENCE_LEARNER_MODE=choice-perceptron` 也不會讓它變 active；
  **shadow 名單只改 `shadowEngine`，A 與 B 的 active 結果完全相同**；名單解析容忍空白；
  沒有 `subjectId` 時不查名單；**v2 列的 `sufficiency` 維持三個欄位且不含 `calibrated`**；
  CP 列還原三個欄位；CP 列缺 metadata 回 `calibrated: false`；
  evidence 為 JSON 字串時也能解析。
- 既有測試**一個都沒有修改**。

### 3.3 指令

- `node --check`：`server/src` 全部 **92 個檔案**通過。
- 快速測試集（70 個不起 `app.js` 的檔案）：**1242／1242 通過**，0 失敗。
  基準從先前紀錄的 1213 變成 1242，是因為期間 `7f90c7a` 也進了樹，不全是本次新增的 19 項。
- `npm run bench:choice-perceptron -- --real-data --markdown`（唯讀）：與計畫文件的數字一致
  （demo 帳號事件 288、`plan_chosen` 4 筆、可用 4 筆、逐軸 4／4／3、跳過 0、帶特徵曝光 45）。
- **未修改 `client/src/**`**，因此未跑 `npm run build`／`npm run lint`。
- **未修改 `scheduler.js` 的排課邏輯**；S1–S10 隨 `scheduler.test.js` 在測試集內執行。

### 3.4 瀏覽器（部分完成，如實記錄）

本段不做 CP 啟用的 A/B（gate 未過）。要驗的是「什麼都沒變」。

- 前端可正常載入，**全新分頁的 console 無任何錯誤**。
- **登入後的畫面驗收沒有做**：session 已過期而我不輸入密碼，需要由使用者本人登入。
  第 3.1 節的雜湊對照涵蓋了同一個主張（排課結果、`generationPolicy`、整個
  `exposureContext` 逐位元相同），而且比 UI 點擊更精確；但「登入後實際操作一次」這一步
  確實沒有補上。

## 4. 修改的檔案

- `server/src/data/interactionEventSchema.js`：`PLAN_POLICY_WEIGHT_MODES`、signed 版本集合、
  `planPolicyWeightRange()`、`normalizePlanPolicies()` 的條件展開、值域驗證改為 mode-aware。
- `server/src/services/preferenceLearningService.js`：`PREFERENCE_ENGINES`、
  `resolveExpectedPreferenceModel()`、`matchesActiveModel()`、CP-only sufficiency codec、
  `rowToWeightsForTests()`。
- `.env.example`：`PREFERENCE_LEARNER_MODE`、`PREFERENCE_SHADOW_SUBJECT_IDS`。
- `docs/DATA_SCHEMA.md`：`weightMode` 的休眠契約與「v2 不輸出這個 key」的理由。
- 新增 `server/test/signedWeightContract.test.js`、`server/test/preferenceModelResolver.test.js`。

## 5. 刻意沒有同步的文件（如實記錄）

`docs/CHANGE_REPORTS/README.md` 的索引與 roadmap 進度表**這次沒有更新**。
兩個檔案目前都有**另一個工作階段尚未提交的修改**（新增 `2026-09-22` 區段、
`專題報告` 與 `3B 計畫` 兩筆索引，以及 roadmap 的 23 行改動）。要加入本報告的索引就得一併
把那些未完成的修改放進這個 commit，那會把別人在飛的工作收進來。

因此本次只提交自己的檔案，索引與 roadmap 狀態留待那一份工作落地後補上。

## 6. 3B-0 還沒完成的部分

- **合成 persona A／B**（`readinessPersonas.js`、`readinessPersonasSeed.js`）。
- **`SYNTHETIC_READINESS_SUBJECTS` registry**：必須同時排除既有三位 `DEMO_PERSONAS`
  （各有 50 筆 seed 互動，不是自然操作資料）與新的 A／B。
- **多使用者 readiness runner**：依 `requestId` 重建 choice round 後再切 60/20/20、
  依 `subjectId` 的唯讀評估入口、以使用者為群組的 hierarchical bootstrap、
  v2 sufficiency 分列、run-local 匿名代碼。

### 一個必須先裁決的問題：catalog 驗證規則無法照字面成立

計畫寫「persona 的所有課號必須先在真實 catalog 查到；查不到就讓 dry-run 失敗」。實測：

```text
User_Course_History 221 列 → 只有 158 列（71%）在目前 catalog 裡
```

`Courses` 只有**當學期**開課資料，而修課歷史講的是過去學期。`離散數學`、`作業系統(一)`、
`通訊與網路概論`、`線性代數`、`邏輯設計`、`微積分` 這些真實修過的課這學期沒開，所以查不到。
照字面執行會讓**任何寫實的 persona 歷史都 dry-run 失敗**。

建議改成兩層驗證（保留「不得憑空捏造課號」的原意）：課號必須在**目前 catalog** 或
**既有 `User_Course_History` 語料**其中之一查得到；查得到的 `course_name` 與 `credits`
必須相符；兩邊都查不到則 dry-run 失敗；dry-run 逐列標示每個碼是從哪一層驗到的。

A／B 需要的課號已經全部從真實資料查出備妥（`程式設計(I) IECS1006`、`離散數學 IECS2007`、
`作業系統(一) IECS3001`、`微處理機系統 IECS2012`、`物件導向設計 IECS2073` 等），
沒有任何一個是編造的。待這條規則確認後才會動工。
