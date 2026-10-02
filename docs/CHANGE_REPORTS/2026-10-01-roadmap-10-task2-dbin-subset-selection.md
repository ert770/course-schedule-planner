# Roadmap #10 任務 2：以 D_bin 目標取代暫時的方案挑選器

日期：2026-10-01
分支：`backend`

> **一句話**：採用 Danna & Woodruff (2009) 的 D_bin 目標，並對本系統的小型受限問題以窮舉
> 精確求解。**沒有**實作論文的整數規劃，線上 K=1 下也**不是**「從大候選池挑選」——見第 3 節。

## 1. 為什麼要改

`generateMilpPlans()` 原本的「暫時挑選器」依主軸順序累積選取：每條主軸取 Dinkelbach 比值最高、
且與所有已選方案 `replacementDistance ≥ 2` 的候選。它有三個問題：

1. **順序偏差**。兩條主軸的候選彼此太像時，永遠捨棄排在後面的那條，不管捨棄哪一條能讓整組
   方案更多樣。`SCHEDULING_LOGIC.md` 自己寫明這是暫時做法、任務 2 會取代。
2. **說錯原因（一）**。因「與已選方案太像」被捨棄時，回報的是 `insufficient-difference`，
   畫面文案是「無法在品質下限內換進、換出至少兩門課」。那描述的是求解失敗；實情是這條主軸
   **排得出**合法方案，只是與另一份太像。
3. **說錯原因（二）**。候選全部沒通過 validator／`checkMilpPlan` 時，程式落到
   `axisResult.reason || axisResult.status || 'insufficient-difference'`——對求解成功的主軸，
   這會吐出一個與實情無關的代碼。

任務 2 原本卡在 Danna & Woodruff 的付費全文。全文（E. Danna, D. L. Woodruff, *How to select a
small set of diverse solutions to mixed integer programming problems*, Operations Research
Letters 37 (2009) 255–260）已由使用者提供，6 頁全部讀過。

## 2. 論文 → 實作對照

| 項目 | 論文 | 本系統 |
| --- | --- | --- |
| 問題 | MIPDIV(p, q, D)：`max D(S)`，`\|S\| = p`，解在最佳值 q% 內（§2.1） | 同一個目標，外加第 3 節的產品限制 |
| 品質篩選 | 候選池已是最佳值 q% 內的解（§2.3） | 任務 1 的 87% 品質保留下限；S₀ 是 greedy 不是最佳（任務 1 既有偏離） |
| 量度 | `D_bin(S) = 2/(\|S\|(\|S\|−1)) Σ_{j<k} d_bin`，`d_bin = (1/b) Σ_{i∈B} \|xᵢʲ − xᵢᵏ\|`，B 為模型全部二元變數（§2.2） | 同一式，但 B 只取競爭課號的 `z_k` |
| 精確解法 | 線性化整數規劃，δⱼ／γⱼₖ，式 (1)–(5)（§3.1） | **未實作**。改用窮舉：線上 ≤ 2³ ＝ 8、benchmark ≤ 4³ ＝ 64 種組合 |
| 啟發式 | 局部搜尋、sequential screening（§4） | 不需要——論文用它們是因為池子大到精確解跑不動 |
| D_all／D_CV | 給一般整數與連續變數（§2.2） | 不用（決策變數全為二元） |

## 3. 與論文的偏離（全部照實列出）

1. **B 只含課號變數 `z_k`**，不含班次變數 `s_j` 與集中排課的日變數 `y_d`。論文的 D_bin 是對
   模型**全部**二元變數計算的；只取課號是配合「比較課程集合」的產品需求（與既有
   `replacementDistance` 的課號口徑一致）。後果：兩份方案若只差班次，`d_bin = 0`。
2. **每個 archetype 至多一份**。論文挑的是匿名的解；我們是具名方案（輕鬆或挑戰／興趣／集中），
   純 D_bin 最大化可能挑出兩份集中、零份興趣，方案名稱就對不上。
3. **S₀ 必選**。綜合平衡方案一定顯示。
4. **兩兩 `replacementDistance ≥ 2`** 是限制，不進目標。
5. **`|S|` 不固定，採字典序**：先最大化方案數，再最大化 D_bin。論文固定 `|S| = p`；我們的主軸
   可能因 no-signal 或不可行而消失。D_bin 是平均值，不同 `|S|` 的值不可比——直接比會讓
   「兩份差很多」贏過「四份」，使用者看到的方案反而變少。
6. **搜尋法是窮舉**，不是論文的 IP。對這個規模，窮舉就是受限問題的精確最佳。
7. **線上 K=1 是退化情形**。論文假設池子有上百到上千份、挑 p ≤ 10。線上每主軸 1 個候選，
   池子最多是 S₀ 加 3 份，「挑選」實際上只剩「候選彼此太像時該捨棄哪一條」。候選之間沒有衝突
   時，結果與舊挑選器**完全相同**（第 6 節有實測）。只有 benchmark 的 K=3 才會依 D_bin 在同一
   主軸的多個候選之間做選擇。**因此不能宣稱「套用 Danna & Woodruff 從大候選池挑選方案」。**

## 4. 修改內容

### 新增 `server/src/skills/optimization/diverseSubsetSelector.js`

純函式 `selectDiverseSubset({ baseSelection, axes, b })`，只看課號集合、不碰 I/O。距離計算重用
`diversePlanSolver.js` 的 `compareCourseSets()`。

字典序（所有 tie-break 只看固定常數 `CANONICAL_ARCHETYPE_ORDER = easy, challenge, interest,
compact`，不看輸入陣列順序）：

1. 方案數多者勝。
2. D_bin 大者勝——**直接比整數 `pairwiseHammingSum`**。方案數相同時 `|S|` 與 `b` 都是常數，
   順序等價；不用浮點容差，因為「差距小於 ε 視為平手」不具傳遞性，會讓結果取決於比較順序。
3. 依 canonical 順序比「有沒有選這條主軸」。
4. 逐主軸比被選候選的 Dinkelbach 比值（只在同一主軸內互比；各主軸的比值單位不同，不相加）。
5. 逐主軸比 `candidateId`。

`candidateId` ＝排序後的課號集合 ＋ `|` ＋ 排序後的班次 ID 集合，由呼叫端算出。同課號集合、
同比值、只差班次的候選也分得出來；輸出用 `candidateId` 而不是陣列索引，所以打亂輸入順序
結果不變。

邊界：

| 情況 | 行為 |
| --- | --- |
| 只有 S₀ | 公式分母為 0，`dBin` 回 `null`（未定義），不回 0 |
| `b = 0` 且沒有候選 | 正常回傳，`dBin: null` |
| 有候選但 `b` 不是正數 | 丟 `RangeError`；`generateMilpPlans()` 接住後退回只有 S₀，原因寫進 `subsetSelection.error` |
| 主軸候選為空 | 不列入 `dropped`，原因由呼叫端依求解狀態回報 |

`b` 是**不重複的競爭課號數**：`inputs.competitive` 按班次列，同課號多班次在 MILP 裡是同一個
`z_k`，用 `.length` 會讓多開班的課把 D_bin 稀釋。

### `server/src/skills/scheduler.js`

- `generateMilpPlans()` 改為三階段：逐候選 materialize 與檢查 → 選擇器 → 組裝與原因。
- 主軸未產出方案的原因：

  | 狀況 | `reason` | `detail` |
  | --- | --- | --- |
  | 資料沒有訊號 | `no-signal` | 照舊 |
  | 求解器沒給候選 | 求解器回報的原因 | 照舊 |
  | 有候選但全部沒通過檢查 | `candidate-check-failed`（新） | `validator-rejected`／`model-check-rejected`／`mixed` |
  | 有合法候選、與已選組合太像 | `insufficient-difference` | `too-similar-to-selected`（新），另帶 `conflictsWith` |

- `buildPlanDiversity()`：`collapsed[].conflictsWith` 是已解析好的 `[{ variantId, title }]`
  （S₀ 讀 base plan 的實際 id 與標題），只在 `too-similar-to-selected` 時出現。
  `solver.method` 維持 `dinkelbach-milp`（候選的**產生**方法），挑選步驟另記在
  `solver.subsetSelection`（`method`、`objective`、`b`、`evaluated`、`feasible`、`elapsedMs`、
  `rejectedCandidates`、`error?`）。
- 使用者看得到的 warning 句子：太相似時是「與「○○方案」換課不到兩門，幾乎相同；已保留整組
  差異較大的組合」。

### `client/src/components/Schedule/PlanSwitcher.jsx`

同步新增 `candidate-check-failed`、`selection-error` 的文案，以及 `too-similar-to-selected`
帶方案名稱的句子。

### 與核准計畫的出入（三項，都要講）

1. **多了 `reason: 'selection-error'`**。計畫只寫「try/catch 退回只有 S₀ ＋
   `subsetSelection.error`」，沒有定義此時各主軸要回報什麼代碼。不補的話這些主軸會被誤記成
   `candidate-check-failed`。
2. **多了一個測試接縫 `runtimeOptions.diverseCandidatesHook`**。計畫寫「沿用既有 MILP 測試的
   fake solve 手法」，實際上既有的整合測試用的是真的 HiGHS，沒有 fake solve 可沿用。接縫在
   「求解之後、檢查與挑選之前」讓測試改寫候選；正式路徑的兩個呼叫端（`scheduleService.js`、
   `agentService.js`）都不傳 `runtimeOptions`，使用者輸入碰不到它。
3. **輸出順序沒有變**。計畫預期新順序為 canonical 而可能與舊版不同；實際上 `selectedPlans`
   之後仍由既有的 `comparePlans` 重新排序，前後順序完全一致。

## 5. 修改檔案

- 新增：`server/src/skills/optimization/diverseSubsetSelector.js`
- 新增：`server/test/diverseSubsetSelector.test.js`、`server/test/planSubsetSelectionIntegration.test.js`
- 修改：`server/src/skills/scheduler.js`、`client/src/components/Schedule/PlanSwitcher.jsx`
- 修改：`docs/SCHEDULING_LOGIC.md`、`docs/API_SPEC.md`、`docs/TEST_PLAN.md`
- 修改：`server/test/reports/plan-diversity-acceptance-latest.json`（重跑 benchmark 的產物）
- 修改：`docs/CHANGE_REPORTS/README.md`、`2026-08-01-personalization-roadmap.md`

未修改資料欄位，`docs/DATA_SCHEMA.md` 不需更動。未修改 tool call 格式。

## 6. 測試與驗證

### 單元與整合測試

- `diverseSubsetSelector.test.js`：23 項全過。D_bin 手算對照、邊界、字典序、300 組隨機小池對照
  獨立暴力實作、打亂輸入順序 40 次結果不變（含 D_bin 平手、比值平手、只差班次、近似平手）。
- `planSubsetSelectionIntegration.test.js`：4 項全過（真的用 HiGHS）。`b` 測試先斷言
  `competitive.length` 為 9、`b` 為 8，確認測到的是「班次數 ≠ 課號數」。
- 不啟動 `app.js` 的測試檔全部：**1275／1275 通過**，約 30 秒。內含 `scheduler.test.js` 的
  S1–S10。
- 啟動 `app.js` 的 4 個測試檔：60／60 通過。
- `node --check` 掃過 `server/src/**/*.js` 全部通過。
- `client`：`npm run build`、`npm run lint` 通過。

### 回歸：真實資料上新舊挑法是否等價

以唯讀方式（不寫事件、不寫權重）對真實 MySQL 課程在改動前後各跑一次 `generateSchedule()`，
比對「方案集合＋推薦方案」的雜湊。為避免求解時間抖動污染比較，這個腳本把求解預算放寬到 60 秒。

| 對象 | K | 候選池 | 改動前後 | 搜尋空間／可行 | 方案數 | D_bin |
| --- | :---: | ---: | :---: | :---: | ---: | ---: |
| 「D1249697」（見第 7 節更正） | 1 | 365 | **相同** | 4／4 | 3 | 0.0268 |
| 「D1249697」（見第 7 節更正） | 3 | 365 | 不同 | 16／16 | 3 | 0.0298 |
| persona 1 | 1 | 362 | **相同** | 4／4 | 3 | 0.0587 |
| persona 1 | 3 | 362 | 不同 | 16／16 | 3 | 0.0646 |
| persona 2 | 1 | 362 | **相同** | 1／1 | 1 | —（`null`） |
| persona 2 | 3 | 362 | 相同 | 1／1 | 1 | —（`null`） |
| persona 3 | 1 | 362 | **相同** | 4／4 | 3 | 0.0420 |
| persona 3 | 3 | 362 | 不同 | 16／16 | 3 | 0.0450 |

讀法：

- **線上設定（K=1）四位全部相同**，顯示順序與推薦方案也相同。這符合第 3 節第 7 點：沒有衝突時
  新舊等價。
- **「搜尋空間」與「可行」每一列都相等，代表真實資料上沒有任何一個案例發生候選衝突。**
  所以這次修改在今天的真實資料上，線上**不會改變任何人看到的方案**。它改變的是：衝突發生時
  捨棄誰、以及怎麼跟使用者說明。這兩件事由單元測試與整合測試驗證，不是由真實資料驗證。
- K=3 的三個「不同」不是衝突造成的，而是選擇規則本身不同：舊版在同一主軸內取比值最高者，
  新版取使整組 D_bin 最大者。新組合的 D_bin 依定義不低於舊組合。

### Benchmark（`npm run bench:plan-diversity -- --markdown`，K=3）

| case | 改動前 | 改動後 | 方案數 | min quality | median Jaccard | 挑中的候選 |
| --- | :---: | :---: | ---: | ---: | ---: | --- |
| persona-compact | PASS | PASS | 3 | 1 | 0.1176 | 輕鬆主軸換了一個（對 S₀ 的換課數 8 → 7） |
| no-preference-control | PASS | PASS | 3 | 1 | 0.1176 | 集中主軸換了一個（對 S₀ 的換課數 7 → 4） |
| persona-challenge | FAIL | FAIL | 1 | — | — | 沒有候選，與本次修改無關 |
| persona-easy | PASS | PASS | 3 | 0.9159 | 0.3571 | 相同 |
| fixed-courses-control | PASS | PASS | 2 | 1 | 0 | 相同 |

- 通過數 **4／5，與改動前相同**；未通過的仍是挑戰 persona（任務 1 既有的主軸可行性問題）。
- **五個 case 中實際發生候選衝突的：0 個。**
- 有兩個 case 挑中的候選不同。注意 no-preference-control 的集中方案對 S₀ 的換課數從 7 降到 4：
  D_bin 看的是**整組兩兩距離的總和**，不是單看與 S₀ 的距離——新候選離 S₀ 較近，但離輕鬆方案
  較遠。驗收表上的指標（品質保留、中位 Jaccard）兩者沒有差別。
- 選擇器本身耗時 0.09～0.68 ms，不影響 2.5 秒預算；`generationMs` 前後差距在 2% 內。

### 瀏覽器

見第 7 節。

## 7. 瀏覽器驗收（2026-10-02，使用者本人登入 D1249697）

操作：首頁按「套用偏好排課」，讀 PlanSwitcher 與 `POST /api/schedule/generate` 的回應；
接著把 `scheduler.js` 與 `PlanSwitcher.jsx` 暫時 stash 回改動前、等伺服器重載後以同一個登入
狀態、同一個請求再打一次，比對後還原。

| | 改動前（stash） | 改動後 |
| --- | --- | --- |
| 方案 | 只有「個人化綜合方案」（班次 1300、3024，5 學分） | 相同 |
| 輕鬆導向 | `no-signal`／`threshold-unreachable` | 相同 |
| 興趣導向 | `hierarchy-parity-infeasible` | 相同 |
| 集中排課 | `credit-parity-infeasible` | 相同 |
| warnings | — | 逐字相同 |
| `solver.subsetSelection` | 沒有這個欄位 | `planCount: 1`、`dBin: null`、`evaluated: 1` |

方案、推薦方案、塌縮原因、學分與 warnings 的 JSON 比對結果為**完全相同**；畫面上 PlanSwitcher
的說明文字也相同。console 的錯誤只有登入前的 401 與 stash／還原時伺服器重載造成的 502，
沒有來自前端程式的新錯誤。

**這次驗收能證明的只有「沒有弄壞既有行為」。** 這個帳號三條主軸都是求解器沒給候選，選擇器
拿到的是空的候選集合（DS-B1 的邊界情形：只有 S₀、`dBin` 為 `null`）。新的「幾乎相同」與
「未通過課表規則檢查」文案在這個帳號上觸發不了，只由 SS2／SS3 整合測試驗證，沒有造假資料
湊畫面。

### 更正：第 6 節回歸表的「D1249697」那兩列不是這個帳號的真實輸入

回歸腳本用 `canonicalId: 'D1249697'` 查偏好，得到 3 個方案、候選池 365 門；瀏覽器實際登入後
只有 1 個方案、5 學分。兩者輸入不同——腳本的身分沒有對到這個帳號真正的 profile 與修課紀錄。
那兩列仍是有效的「改動前後同輸入比對」（結論不變），但**不能讀成 D1249697 的線上結果**；
這個帳號的真實前後對照以上表為準。

### 順帶觀察（既有行為，與本次修改無關）

這個帳號目前只排出 5 學分、低於最低 12 學分，而且只有 1 個方案。改動前後相同，所以不是任務 2
造成的；原因未在本次調查範圍內，需要另外看。

## 7b. 其他

- （已補完）啟動 `app.js` 的 4 個測試檔（`authRoutes`、`privacyRoutes`、`scheduleRoutes`、
  `interactionEvents`）：**60／60 通過**。合計 1275 ＋ 60 ＝ 1335 項全過。

## 8. 是否 commit 與 push

2026-10-02 依使用者指示 commit 並 push 至 `origin backend`。

提交時 roadmap 與 `README.md` 工作區內另有其他 session 尚未提交的修改（連到尚未進版控的
專題報告與 3B 計畫文件）。本次只提交任務 2 自己的那幾處，其餘修改原樣留在工作區。
