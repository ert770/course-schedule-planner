# Roadmap #10 任務 3A：Choice Perceptron 的資料層與 shadow learner

## 修改日期

2026-09-20 ～ 2026-09-21（跨日，瀏覽器驗收在 09-21）

## 範圍

任務 3 有兩篇論文。**3A 只做第 14 篇（Dragone et al. 2018 的 Choice Perceptron）的資料蒐集與
shadow 學習器，完全不改變正式推薦結果**；第 13 篇（Viappiani/Faltings/Pu 2006 的評語式詢問）
與正式啟用（3B）都不在本次範圍。

計畫全文：`C:\Users\yamat\.claude\plans\snoopy-tinkering-papert.md`。

## 1. 論文閱讀紀錄（3A-1）

**主要依據**：Paolo Dragone, Stefano Teso, Andrea Passerini,
《Constructive Preference Elicitation over Hybrid Combinatorial Spaces》, AAAI 2018
（arXiv:1711.07875v2, 2018-05-07，8 頁全文已逐節閱讀）。
Frontiers in Robotics and AI 4:71 的同團隊文章只作背景（它介紹的是 SetMargin、
Preference Perceptron、Critiquing Perceptron），**Choice Perceptron 的公式一律以 AAAI／arXiv 為準**。

| 待確認項 | 論文怎麼說（位置） |
| --- | --- |
| 更新式 | Algorithm 1 第 7 行與式 (1)：`w_{t+1} ← w_t + η·Δ_t`，`Δ_t := φ(x_t, ȳ_t) − (1/(k−1))·Σ_{y∈Q_t, y≠ȳ_t} φ(x_t, y)`。**是「選中減去其餘方案的平均」**，不是減整個 query 的平均，也不是減目前模型的 argmax |
| 初始值 | Algorithm 1 第 2 行：`w₁ ← 0` |
| `η` | 式 (1) 下方：「`η` is a constant step-size」。但〈Empirical Evaluation〉明載實驗採**自適應** step size：`t ≥ 3` 起每輪從 `{0.1, 0.2, 0.5, 1, 2, 5, 10}` 以 cross-validation on the collected feedback 選出，「found to work well empirically」 |
| user response model | 〈Theoretical Analysis〉的 *reasonable user* 定義：`P_{x_t}(ȳ_t = y|Q_t)` 是真實效用 `u*` 的非遞減單調變換。由 Bradley-Terry、Thurstone-Mosteller、Plackett-Luce 蘊含，且比它們任一個都寬鬆。**允許雜訊選擇** |
| query strategy 的角色 | footnote 1：「The CP algorithm is independent from the particular query selection strategy used.」〈Query selection strategy〉再次明載 bound 對任何策略成立，只透過 `α`（informativeness）、`β`（affirmativeness）、`M`（expected uninformative 次數）三個常數依賴它 |
| regret bound | Theorem 2：`E[REG_T] ≤ (√(2β/η + 4R²‖w*‖) / α)·(1/√T) + 2R‖w*‖·M/T`，即 `O(1/√T)` |
| φ 的要求 | `u*(x,y) = ⟨w*, φ(x,y)⟩` 為線性效用；`φ: X×Y → R^d`；`‖φ(x,y)‖ ≤ R`（有界）。**φ 明確可依 context `x`** |
| k（query set 大小） | `k ≥ 2` 皆適用。較大的 k「imply more conservative updates, mitigating the deleterious effect of uninformative choices」 |
| 缺值處理 | **論文沒有**。φ 被假設為完整且有界 |
| 論文自己的 query 策略 | 最大化 `γδ + (1−γ)µ`（`δ` 是選項間的 L1 距離和，`µ` 是與最佳的接近程度），硬性要求 `y₁` 是當前 `u_t` 的最佳解，實驗設 `γ = 1/t`。**本系統不採用這個策略**，見下方偏離表 |

### 與本系統的對應

| 論文 | 本系統 |
| --- | --- |
| context `x_t` | 一次排課請求（候選池 ＋ 該次的顯式限制） |
| query set `Q_t` | 同一 `requestId` 曝光時實際顯示的方案集合 |
| 使用者選擇 `ȳ_t` | `plan_chosen` 指向的方案 |
| `φ(x_t, y)` | 方案的 `preferenceBreakdown = {interest, compact, easy}`（`scheduler.js:812`） |
| `w` | 三軸偏好權重 |

`interest` 量的是「方案符合**這一次輸入**的興趣關鍵字的程度」，是 request-scoped 的。論文的
`φ(x, y)` 本來就允許依 context，因此**這一點不是偏離**；但也因為它依 context，
`deriveExplicitProfile()` 沒有東西可以當它的初始值，本階段取 `w₁.interest = 0`。

### 本系統對論文的四項偏離（誠實標註）

| 偏離 | 本系統 | 論文 | 後果 |
| --- | --- | --- | --- |
| 初始值 | `w₁ = deriveExplicitProfile(prefs)`（顯式偏好當起點） | `w₁ = 0` | Theorem 2 的推導未涵蓋非零起點 |
| 時間衰減 | `w_raw = w₁ + Σ_t η·decay_t·Δ_t`（120 天半衰期、跨學期 ×0.5） | 無 | 更新量不再等量，bound 的推導失效 |
| 值域投影 | 全部累加完才 `clip(·, −2, 2)` 一次（**逐軸 clipping，不是 L2 normalization**） | 無 | 以 `‖w‖` 為前提的推導失效 |
| 缺值遮罩 | 某軸只要 query set 中任一方案缺值就本輪不更新該軸 | 無（假設 φ 完整） | 各軸在不同的事件子集上更新 |

### 本系統不宣稱 regret bound 的理由

論文的 bound 對任何 query strategy 成立，**所以「我們的 query 策略不是論文那個」本身不是理由**。
真正的理由是：

1. 沒有證明本系統 query strategy 的 α-informativeness（論文的策略硬性要求 `y₁` 為當前最佳解並最大化選項間距離，本系統的 `buildDiverseArchetypes()` 與 `buildMilpAxes()` 兩者都不做）；
2. 上表四項延伸都不在 Theorem 2 的前提內；
3. 本系統的方案排序含缺值排除與 `comparePlans()` 的 tie-breaker，與純 `⟨w, φ⟩` 不完全一致（見下節）；
4. 三維 φ 很可能無法線性表示真實偏好，論文的 `u*(x,y) = ⟨w*, φ(x,y)⟩` 前提未必成立。

### 與現行排序函式的關係

`evaluatePreference()`（`scheduler.js:811-841`）展開後是
`score = ( ⟨w, φ⟩ + Σ_{a: w_a<0} |w_a| ) / Σ_a |w_a|`。
**當所有方案的 φ 都完整時，這是 `⟨w, φ⟩` 的正仿射變換，排序一致**。錯配只有三處：
(1) `easy = null` 讓不同方案排除不同的軸，分母與常數項隨方案改變；
(2) `comparePlans()` 還有 `success`、學分下限、總學分等 tie-breaker；
(3) query set 的產生不看學習後的方向（3B 才處理）。

## 2. 3A-5：`useLearnedPreference` 的真實 round-trip（一次性腳本）

`user_preferences` 是 MySQL-only collection（`database.js` 的 `assertMysqlAvailable()`），
沒有 JSON fallback 可以拿來寫自動化的寫入測試，因此照既有慣例（見
`preferenceLearningService.test.js` 檔首說明）以一次性腳本對 demo 帳號 D1249697 實測，
腳本不進版控，跑完在 `finally` 還原：

| 步驟 | 結果 |
| --- | --- |
| 原始 `preferences_json.values` 的鍵 | `interests`、`preferredTrack`、`preferredKeywords`（9 筆興趣） |
| 原始 `useLearnedPreference` | `true`（欄位不存在 → 預設值） |
| 寫入 `false` 後讀回 | `false`，且 9 筆興趣完全保留 |
| 之後只更新興趣 | 開關仍為 `false`（沒有被洗掉） |
| 寫回 `true` | `true` |
| 還原後 | 鍵與 9 筆興趣與原始狀態相同，開關回到預設 `true` |

自動化測試則覆蓋純函式層（`personalizationPreferences.test.js`，6 項）與
「3A 還沒有消費這個開關」（`preferenceLearningService.test.js`，排課權重在開關
true／false 下逐位元相同）。3B 接上開關時那個測試會失敗，那是提醒該改它了。

## 3. 3A-6：離線重播與校準

`npm run bench:choice-perceptron --prefix server -- --markdown`
（`scripts/choicePerceptronReplay.js` ＋ `scripts/lib/choiceReplayFixture.js`）。
只用種子化的合成資料與正式的純函式，不寫 MySQL；`--real-data` 另外唯讀查詢 demo 帳號。

**素材**：4 個 persona × 100 回合 × seed 1／7／42，每回合 2～4 個方案。
切分 training 60／validation 20／test 20；**η 與 choice 門檻只用 validation 選，test 只評估一次**。
每回合同時產生 `plan_chosen`（CP 讀）與 `recommendation_accepted` ＋ `planPolicies`（v2 讀），
兩個引擎讀的是同一次互動。

### 四方對照（test set，accuracy = 猜中使用者所選方案的比例）

| 對照組 | test accuracy |
| --- | ---: |
| trivial（永遠選主推） | 0.096 |
| explicit-only（只用勾選的偏好） | 0.271 |
| current-v2（現行正式引擎） | 0.650 |
| **choice-perceptron** | **0.804** |

逐 persona 看比平均更有意義：

| persona | explicit-only | current-v2 | choice-perceptron |
| --- | ---: | ---: | ---: |
| `compact-seeker`（勾集中、行為一致） | 0.80～1.00 | 0.55～0.90 | 0.60～0.90 |
| `challenge-seeker`（**勾涼課、行為相反**） | 0.05～0.10 | 0.05～0.10（三個 seed 全部 insufficient） | **0.65～0.80** |
| `noisy`（20% 隨機） | 0.05～0.10 | 0.75～0.85 | 0.85～0.90 |
| `null-easy`（easy 軸整批缺值） | 0.00～0.10 | 0.85～1.00 | 0.60～1.00 |

- **CP 的優勢集中在 `challenge-seeker`**：顯式勾選與實際行為相反時，v2 連門檻都跨不過去
  （它的投票要靠「被接受方案的某一軸 policy 權重嚴格大於其他方案」，而這位使用者
  的行為與他勾的方向相反），CP 則直接把 `w.easy` 學成負的。這正是本輪決定
  （顯式只當初始值）要解的情況。
- **CP 不是全面較好**：`compact-seeker` 在 seed 7 是 explicit-only 0.95、v2 0.90、CP 0.60——
  顯式設定本來就正確時，CP 反而可能被自己的探索帶偏。這是 3B「未達門檻維持 v2 權重」
  這條冷啟動規則的實證理由，不是可以略過的雜訊。

### 第一版跑出來的數字是錯的，已修正

最初用 training 40，結果 `current-v2` 的 accuracy 與 `explicit-only` **一模一樣**（0.262）。
原因是 v2 的門檻是 50 筆可用事件，40 回合永遠達不到，於是整批退回顯式偏好——
那個對照測到的是 v2 的退路，不是 v2 的學習。training 改成 60 之後 v2 才真的學得動
（0.65），CP 的領先幅度也從「看起來壓倒性」回到「在特定情況下明確較好」。

穩定點的量法同樣修過一次：原本要求「validation 的逐題預測完全不再變動」，任何一題
翻面就重算，結果永遠等於 training 長度——那不是資訊，是量錯了。改成「準確率與最終值
的差距 ≤ 0.05」的平台期定義。

### η 與 choice 門檻

- **η = 0.2**，由**跨全部 seed × persona 的 validation 平均**一次選出（網格就是論文實驗用的
  `{0.1, 0.2, 0.5, 1, 2, 5, 10}`）。第一版是每個 seed 各自選一個 η（0.2／0.5／0.2）再把
  test 結果平均——那等於報告了一個上線時不存在的模型，正式環境只會有一個固定的 η。
  改成單一 η 後平均 test accuracy 由 0.800 變成 **0.804**，結論沒有被推翻，但流程必須修正。
- **`REQUIRED_CHOICE_COUNT` 無法只憑合成資料定案。** 穩定所需的 choice 次數
  中位數為 36／9／20（各 seed），最大值 60／35／52，其中 seed 1 的 `null-easy` 到第 60 次
  （training 上限）都還沒進入平台期。（這組數字是改用單一 η = 0.2 之後重跑的；
  先前每個 seed 各自選 η 時為 36／26／20 與 60／45／52。）合成 persona 的偏好是固定不變的，真實使用者不是，
  所以這組數字只能當參考上限。程式碼裡的暫定值 10 **低於合成資料的中位數**，也就是
  偏寬鬆；要等真實 choice 累積後重算，`sufficiency.calibrated` 在那之前一律為 false。

### 合成資料的已知限制（影響上面每一個數字）

1. 方案的產生方式是「每個非主推方案放大一軸」（對應 `planStrategies.js` 的 archetype），
   因此三軸之間是**負相關**的——選了集中度高的方案通常就意味著興趣分數較低。
   真實候選池沒有這個結構性保證。
2. persona 的偏好固定不變且（除 `noisy` 外）無雜訊，真實使用者的偏好會漂移。
3. `trivial` 只有 0.096，代表這個合成世界裡主推方案很少是使用者最想要的——
   真實系統的主推是經過品質與學分限制挑出來的，不會這麼差。

### 真實資料 dry-run（唯讀，`--real-data`）

對 demo 帳號 D1249697（2026-09-21 重跑）：事件總數 169、`plan_chosen` 原始筆數 0、
**可用於學習的 choice 0 筆**、被跳過的原因無（沒有可跳過的）、帶方案特徵的曝光 4 筆。

「可用數量」由**正式 learner** 判定（`sufficiency.choiceCount`），不是數 `eventType`——
曝光遺失、版本不支援、只顯示一個方案、特徵不完整的 `plan_chosen` 都寫得進事件表卻一筆都
學不了，拿原始筆數當門檻會把不可學的資料算進 3B 的 go/no-go。腳本同時輸出 `skipped` 的
原因統計與逐軸更新次數。

`plan_chosen` 這個事件型別是 3A 才新增的，要等 3A 部署之後才開始蒐集，所以這個 0 是
**結構上必然**的結果，不是模型表現不好。

## 4. 3A 的結論：no-data（等待資料），不是 no-go

| 判定 | 依據 |
| --- | --- |
| **no-data** | 真實可用 `plan_chosen` = 0。尚無法判定 CP 在真實使用者身上是否優於 v2。 |

合成資料顯示 CP 在「顯式與行為相反」時明顯較好、在「顯式本來就正確」時可能較差，
但那是合成的，不能當成上線依據。流程照計畫：3A commit、push、部署後開始蒐集，
達到預定資料量或觀察期後重跑 `bench:choice-perceptron --real-data`，用那一次的
真實數字才決定要不要進 3B。


## 5. 3A-7：瀏覽器驗收（2026-09-21）

**事件隔離**：後端以 `PRIVACY_STORE=memory` 啟動（暫存啟動腳本，不進版控），互動事件
寫進記憶體 store，程序結束即消失，**共用 MySQL 的 `plan_chosen` 仍然是 0 筆**（驗收後以唯讀腳本
覆核：事件總數 166 → 167，多的那一筆是換回正常設定後頁面重新排課產生的 `recommendation_exposed`，
屬於系統正常寫入，不是驗收的選擇事件）；課程資料仍走
`DB_*` 正常讀取，所以排課結果是真的。`privacyService.js:78` 明文禁止 production 使用這個
設定，因此不存在「驗收設定被帶上線」的風險。代價是同意狀態也在記憶體，使用者要重新
點一次同意——這是預期行為。驗收後已停掉該程序、刪除暫存腳本，後端換回正常設定。

### 使用者操作（本人執行）

同意「提供排課與 AI 對話服務」與「從互動持續改善個人化」→ 排課 → **切換到非主推的
「個人化綜合方案」** → 按「符合」。後端回應：

```json
{"recorded":2,"results":[
  {"eventType":"recommendation_accepted","status":"append"},
  {"eventType":"plan_chosen","status":"append"}]}
```

`plan_chosen` 能 `append` 本身就是整條來源驗證通過的證據：曝光存在、
`planFeatureVersion` 受支援、顯示過 2 個以上方案、被選方案在 `displayedPlanIds` 內、
被選方案有特徵、特徵覆蓋整組方案——任一條不成立都會是 `rejected`。

### 一次詢問只學一次（以同一個 session 對真實 HTTP API 重播）

requestId `befd7dc7-71ee-433f-b285-37cfb744e9ab`（三個方案：集中／興趣／綜合）：

| 送出內容 | 結果 |
| --- | --- |
| 第一次選「興趣導向方案」 | `append` |
| 完全相同再送一次 | **`duplicate`** |
| 同 requestId 改選「個人化綜合方案」 | **`conflict`** |
| 選一個沒顯示過的 planId | `rejected`：「planId 不是該次推薦實際顯示過的方案之一」 |
| 用不存在的 requestId | `rejected`：「沒有對應的推薦曝光紀錄」 |

三次送出的 `actionId` **完全相同**（`adbe67df-5538-484c-8d2f-f5f020939738`），即使前端每次
都送不同的隨機 UUID——證明 actionId 由後端依 requestId 推導。獨立計算
`sha256("plan-chosen:" + requestId)` 轉成 UUID 形狀的結果與它逐字元相同。

### console

本次頁面載入之後的 API 請求**沒有任何 4xx／5xx**
（`performance.getEntriesByType('resource')` 過濾 `responseStatus >= 400` 為空陣列）。
面板 console 裡的 401／502 是更早之前（換 `SESSION_SECRET`、重啟後端那段）留下的，
不是本次驗收產生的。

### 這一步證明了什麼

「切換到非主推方案再按符合」這條路徑**確實會產生合格的 set-wise choice 資料**。
這是 3A 能不能成立的前提——若這條路徑產不出資料，後面的學習器再正確也沒有輸入。


## 6. 第二輪審查的四項修正（2026-09-21）

使用者覆核 commit `5abd86b` 後指出四項問題，全部屬實，已修正：

| # | 問題 | 修正 |
| --- | --- | --- |
| P1 | 真實資料報告數的是原始 `plan_chosen` 筆數，沒有排除不可學習的事件 | 改呼叫正式 learner，以 `sufficiency.choiceCount` 為可用數量，並輸出 `skipped` 原因統計與逐軸更新次數 |
| P1 | shadow learner 只檢查 `planFeatureVersion` 存在與否 | 改用 schema 匯出的 `isSupportedPlanFeatureVersion()`；實測 `plan-feature-v999` 原本會被算成一筆 choice 並更新三軸，現在整筆跳過。重播 fixture 也改成直接引用正式常數，避免版本漂移 |
| P2 | 報告的平均值混用了各 seed 各自選出的 η | 改成先跨全部 seed × persona 的 validation 平均選出**單一 η = 0.2**，再用它評估所有 test。平均 accuracy 0.800 → **0.804**，結論未變 |
| P2 | `useLearnedPreference` 的布林限制可經 `preferencesJson` 繞過 | 公開 API **不再接受整包 `preferencesJson`**（回 400，指向專屬欄位）。整包覆寫除了繞過型別檢查，也會洗掉 `values` 裡的其他鍵。同時刪掉 `profileSchema.js` 裡重複的 `normalizePreferencesJson()`，canonical shape 只留 `interestPreferences.js` 一份 |

新增測試：`choicePerceptron.test.js` 的未知版本案例，以及 `POST /api/profile` 輸入驗證的測試（一開始寫成 route 測試，後來改成純函式測試，見第 7 節）。

（這裡原本記錄「新增的 route 測試讓檔案層級失敗由 3 個變成 4 個」——已於第 7 節處理掉。）


## 7. 第三輪審查的三項收尾（2026-09-21）

### 7.1 清除驗收在 demo 帳號留下的資料

瀏覽器 A/B 的最後一步在 `User_Profiles.preferences_json.values` 寫入了
`useLearnedPreference: true`。那等於預設值，但它是**驗收產生的資料、不是使用者的設定**，
已用一次性腳本只刪除這一個鍵（腳本不進版控）。執行結果：

| | 鍵 |
| --- | --- |
| 清除前 | `interests`、`preferredTrack`、`preferredKeywords`、`useLearnedPreference` |
| 清除後 | `interests`、`preferredTrack`、`preferredKeywords` |

`useLearnedPreference` 已不存在（讀取時回到預設 `true`）；9 筆興趣、`preferredTrack`
（技術應用類）與 `preferredKeywords` 原封不動。

### 7.2 兩個過期數字

- roadmap 總覽的 `choice-perceptron 0.800` → **0.804**（改用單一 η 之後的值）。
- 本報告的穩定所需 choice 次數 `36／26／20`、`60／45／52` → **`36／9／20`、`60／35／52`**，
  並註明前者是「每個 seed 各自選 η」時的舊數字。

### 7.3 新增測試不該永久多一個已知失敗

`profileRoutes.test.js` 的四項斷言會通過，但程序不會結束（單獨執行超過 40 秒仍需中斷），
並讓全套的檔案層級失敗由 3 個變成 4 個。

先嘗試修 teardown：以 `process.getActiveResourcesInfo()` 觀察到 `server.close()` 之後仍殘留
`TCPServerWrap` 與數個 `TCPSocketWrap`。試過 `server.closeAllConnections()`、關閉 Node 內建
`fetch`（undici）的全域連線池，socket 數從 4 降到 1，**但程序依然不結束**——殘留的是
`authRoutes`／`privacyRoutes`／`scheduleRoutes` 也有的同一個既有問題，不是這個檔案造成的。

因此改採第二條路：**把輸入驗證抽成純函式** `data/profileUpdateValidation.js`，用一般單元
測試 `profileUpdateValidation.test.js`（6 項）釘住規則，刪掉 `profileRoutes.test.js`。
路由確實有接上這些規則，由真實帳號的瀏覽器實測證明（同一個 session 對真實後端送出：
整包 `preferencesJson` → 400、頂層字串 → 400、合法布林 → 200 並讀得回來）。

這麼做的附帶好處是驗證規則不再埋在路由 handler 裡；代價是「路由有沒有接上」這件事
靠的是實測紀錄而不是自動化測試——這一點如實寫在這裡，不假裝兩者等價。

**全套的檔案層級失敗回到 3 個**（`authRoutes`／`privacyRoutes`／`scheduleRoutes`），
與本輪開始前相同。那三個是既有缺陷，另行處理。

