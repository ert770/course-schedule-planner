# 2026-09-07 Roadmap #35：排課引擎 feasibility／constraint violation benchmark

## 修改日期

2026-09-07

## 背景

排課引擎（`scheduler.js`）與獨立 validator（`scheduleValidator.js`）已被
`scheduler.test.js` 的大量 case（含 roadmap #22 的 Z1-Z7）釘住，但那些都是
2-3 門課的最小合成情境——只證明個別情境正確，答不出「在接近真實選課規模的
候選池下，這個引擎多常真的找到解、找到的解有沒有違反硬性限制、要花多久」。
這次補上跨科系／年級／班級的量測題庫與可比較的量化報告。

規劃過程中用獨立 validator 反過來檢查排課引擎本身，確認了一個既有落差：
`DAILY_COURSE_CAP`（每日課程數上限）在 `constraintSchema.js` 標
`enforced: true`，但 `scheduleValidator.js` 從來沒有對應檢查、也不在
`unchecked` 清單裡——一份違反每日上限的課表會被誤判為 `valid: true`。這會讓
#35 的核心指標「hard violation count」對每日上限盲目，已決定順手修好。

## 修改檔案清單

- `server/src/skills/scheduler.js`（export `getUsedDays`）
- `server/src/skills/scheduleValidator.js`（新增 `checkDailyCourseCap`）
- `server/src/skills/schedulerBenchmark.js`（新增）
- `server/scripts/schedulerBenchmarkReport.js`（新增）
- `server/test/fixtures/schedulerBenchmarkCases.json`（新增）
- `server/test/schedulerBenchmark.test.js`（新增）
- `server/test/scheduler.test.js`（新增 X17／X18）
- `server/test/reports/scheduler-benchmark-latest.json`（新增，成績單）
- `server/package.json`
- `docs/TEST_PLAN.md`
- `docs/CHANGE_REPORTS/2026-08-01-personalization-roadmap.md`
- `docs/CHANGE_REPORTS/README.md`

## 主要改動內容

### 1. 修好 `DAILY_COURSE_CAP` 驗證缺口

`scheduleValidator.js` 新增 `checkDailyCourseCap(schedule, constraints)`，
邏輯重用 `scheduler.js` 的 `getUsedDays()`（本次一併 export）——與
`evaluateCoursePlacement()` 排入當下用的是同一套「多時段課程算進它佔用的每
一天」邏輯，不在 validator 端另外實作一份可能微妙不一致的版本。沒有設
`maxCoursesPerDay` 時比照 `buildPlan()` 的 `?? Infinity` 語意，不檢查。

**這是行為改變**：任何呼叫 `validateScheduleAgainstConstraints()` 的地方
（`generateSchedule()` 每次成功回應前的自我檢查、`/validate` route 在請求帶
`constraints` 時）現在都會多抓到這一類違規。原本會被誤判為合法的課表——排入
同一天超過使用者設定的每日上限——現在會被正確標記為違規。

新增 X17／X18（`scheduler.test.js`）釘住修法本身，並用手動組出的違規課表在
修法前後各跑一次腳本驗證：修法前 `valid: true`（誤判）、修法後
`valid: false`（正確攔下，且 `DAILY_COURSE_CAP` 確認不落入 `unchecked`）。

### 2. 跨科系／年級／班級題庫（`schedulerBenchmarkCases.json`，7 case）

比照 #34／#36 的 JSON fixture 模式，橫跨資訊工程學系、電機工程學系、企業
管理學系、應用數學系四個系所，涵蓋 roadmap 文件列出的五類情境：

| case | 類別 | 涵蓋情境 |
| --- | --- | --- |
| `cs-junior-realistic-load` | feasible | 20 門課的候選池、明確指定課程、正課/實習配對、無時間課程、週末課程 |
| `ee-sophomore-required-conflict` | infeasible | 兩門系必修時段衝堂，真無解 |
| `business-senior-greedy-trap` | greedy-trap | 貪婪法卡在單一高分課，repair 撤銷後找到更高學分組合 |
| `cs-freshman-timeout-with-fallback` | timeout（有解） | 貪婪基準線合法但未達學分目標，`maxNodes:1` 讓 repair 逼近逾時，回退已驗證的貪婪結果 |
| `math-junior-timeout-no-solution` | timeout（無解） | 兩門必排課衝堂，`maxNodes:2` 逼近逾時，搜尋還沒跑完就被打斷 |
| `transfer-student-data-insufficient` | data-insufficient | 指定一門候選池裡查不到的課 |
| `cs-senior-retake-and-history` | feasible | courseHistory 驅動的重補修（不及格必修自動排入）與已修排除（已通過課程不能再選） |

**實作時踩到、且值得記下來的三個陷阱**（誠實記錄，供日後擴題參考）：

1. **`course.department` 的語意是「這堂課屬於哪個班級」，不是「開課系所全
   名」。** 第一版題庫用「資訊工程學系」這類系所全名，導致
   `resolveCourseEligibility()` 判定成「非本系班級課程」，`eligibility` 全部
   落為 `unknown` 而被保守排除——`cs-junior-realistic-load` 因此只排出 3 學分
   （單靠明確指定的那一門），而不是預期的 15-25 學分。改成班級名稱（例如
   `資訊三甲`）才正確解析。
2. **貪婪陷阱案例若混入「逃生用」的替代課，貪婪法會直接繞過陷阱。**
   `business-senior-greedy-trap` 第一版放了 5 門課（陷阱本體 + 2 門組合替代
   + 2 門不衝堂的額外選項），結果貪婪法直接靠額外選項湊到目標學分，根本沒
   卡進陷阱，repair 因此從未真正被需要。改成只留陷阱本體與組合替代（3 門
   課，比照 Z1 的最小結構）才重現陷阱。
3. **timeout-with-fallback 案例若候選池太大，`shouldAttemptRepair()` 根本不會
   觸發。** 第一版放了 5 門課，貪婪基準線直接達標且驗證通過，repair（連帶
   timeout 風險）從未被觸發。`shouldAttemptRepair()` 只在 baseline 學分不足
   或驗證失敗時才啟動——改成只有 1 門課（學分必然不足）才能穩定重現。

這三個陷阱的共同教訓：「跨科系／年級的覆蓋面要擴大」不等於「每個 case 的
候選池都要大」——greedy-trap／timeout 這類情境反而需要刻意收斂到「只有這條
路能達標」的最小候選池，題庫規模與陷阱純度是兩件事。

### 3. 量測邏輯（`schedulerBenchmark.js`）

比照 `personalizationExperiment.js` 的形狀：純函式、吃 case 定義、跑
`generateSchedule()`，用既有的 `summarizeExperiment(rows)`
（`personalizationMetrics.js`）彙總，不重寫一份 rows/pass/passRate 邏輯。

每個 case 依 `expectedCategory` 分別判定：

- `feasible`：`success === true` 且獨立於排課邏輯之外的第二把尺
  （`validateScheduleAgainstConstraints`）複驗零違規——不能只信任
  `result.success` 自己說沒問題，正是這道複驗抓到了上面的 `DAILY_COURSE_CAP`
  缺口。
- `infeasible`：`success === false`、`solver.status === 'infeasible'`、
  `conflictSet` 非空。
- `greedy-trap`：**兩件事都驗證**——純 greedy 基準線確實比較差，repair 後
  確實達標且零違規。只驗證其中一個會漏掉「repair 其實沒有生效，只是這題
  本來就簡單」這種偽陽性。
- `timeout`：依題庫標注區分「有已驗證的 fallback 解」與「真的沒找到解」
  兩種子情況，不把兩者混為一談。
- `data-insufficient`：`solver.status === 'data-insufficient'`。

**驗證判定邏輯本身不是永遠綠燈**：實作時對真正無解的 case 故意標成
`expectedCategory: 'feasible'`、對真正可行的 case 標成 `'infeasible'`，確認
都會正確回報 FAIL；過程中也抓到一個真實的健壯性 bug——`judgeInfeasible` 對
一份成功排課結果讀取 `result.conflictSet.length` 會丟出 `TypeError`（
`conflictSet` 只在特定失敗路徑才存在於回傳物件上，成功結果上是
`undefined` 不是空陣列），已修正為 `result.conflictSet ?? []`。

### 4. 正確性斷言（`schedulerBenchmark.test.js`，SB 系列）

不塞進已經兩千多行的 `scheduler.test.js`——題庫用的是幾十門課的候選池，跟
現有最小合成情境的測試風格不同，分開比較看得清楚。留在 `npm test`：排課是
純本地運算，不打模型、不連資料庫，沒有 roadmap #34 那種 API 成本考量，跟其他
排課測試一樣無條件執行。

### 5. 量測報告（`schedulerBenchmarkReport.js` + `npm run bench:scheduler`）

`bench:personalization`（只印 stdout）與 roadmap #34 的
`agentGoldenSetReport.js`（只寫檔）兩種模式合併：這裡兩者都要，因為驗收標準
明講「Benchmark 可在固定環境重現並產出比較報告」——比較報告需要能跨執行對照
所以要寫檔，同時保留 `--markdown` 的即時可讀輸出。

寫入 `server/test/reports/scheduler-benchmark-latest.json`（進版控、只保留
最新一份，`.gitignore` 已確認不擋這個目錄，`server/test/reports/` 已有 #34
的先例）。記錄內容：

- `versions.constraintsAndSolverDefaults`：`sha256Hex({ constraints: CONSTRAINTS,
  solverDefaults: {...} })`——排課引擎真正的「行為版本」是它遵守的限制規則與
  solver 預設值，不是原始碼逐行 diff，這是對應 #34「prompt+tools hash」的
  等價物。用既有的 `sha256Hex`（`src/utils/hash.js`），不自己排序鍵。
- `versions.fixture`：題庫 hash，沒有它分不清「引擎變壞」與「題目變難」。
- `totals.feasibleSolutionRate`／`infeasibleCorrectRate`／`timeoutRate`：各類
  情境的正確率。
- `totals.hardViolationCases`：**只看 `feasible`／`greedy-trap` 類**——這是
  實作時發現並修正的設計：第一版把所有 case 的違規都算進來，導致
  `infeasible`／`data-insufficient` 類 case（本來就會因為排不出完整課表而
  觸發 `REQUIRED_COURSE_COVERAGE`）把這個欄位變成「永遠非空」的雜訊，稀釋掉
  它該示警的真正訊號（「成功方案不該有違規」）。
- `runtime`：`min`／`max`／`mean`／`p95`（毫秒）。

`package.json` 新增 `"bench:scheduler": "node scripts/schedulerBenchmarkReport.js"`。

## 影響範圍

- `scheduleValidator.js` 的行為改變（見上），會影響 `generateSchedule()` 自我
  檢查與 `/validate` route——這是刻意的修正，不是意外副作用。
- 新增的量測模組與腳本不影響任何生產路徑，`agentService.js`／`promptService.js`
  等 API 層完全未動。
- client 未改動。

## 測試與驗證結果

- `node --check`：所有改動的 `server/src/**/*.js` 全部通過。
- `cd server && npm test`：**1032/1032 通過**（改動前 1018，新增 X17／X18
  與 SB 系列共 14 題，全數維持通過，特別確認 C1-C6、既有 Z1-Z7 沒有因
  `DAILY_COURSE_CAP` 修法而意外變紅）。
- `npm run bench:scheduler`：7/7 通過，`feasibleSolutionRate: 1`、
  `infeasibleCorrectRate: 1`、`timeoutRate: 0.29`，`hardViolationCases: []`。
- **刻意驗證修法生效**：手動組一份「同一天排 3 門課、`maxCoursesPerDay: 2`」
  的課表餵進 `validateScheduleAgainstConstraints()`，改動前 `valid: true`
  （誤判），改動後 `valid: false`（正確攔下，且確認 `DAILY_COURSE_CAP` 不落
  入 `unchecked`）。
- `cd client && npm run build && npm run lint`：通過（client 未改動）。
- **瀏覽器驗收**（`preview_start` server:3001＋client:5173，demo 帳號
  `D1249697`，真實 MySQL）：這次**需要**瀏覽器驗收，不能像 #34 那樣略過——
  `scheduleValidator.js` 的改動會透過 `generateSchedule()` 的自我檢查與
  `/validate` route 真的影響 API 回應內容。
  - **A 組（正常路徑）**：demo 帳號登入後正常排課（8 門課、23 學分），
    確認課表正常產生、console 與 network 都沒有新增錯誤。
  - **B 組（daily-cap 修法）**：`POST /api/schedule/validate` 沒有對應的
    前端表單控制項（`client/src` 從未呼叫這支端點，僅是文件記載的公開
    契約），所以直接在已登入的頁面用瀏覽器的 `fetch()` 打真正在跑的伺服器：
    送一份「同一天排 3 門課、`maxCoursesPerDay: 2`」的課表，回應確認
    `hardConstraintsValid: false`、`violationIds: ["DAILY_COURSE_CAP"]`，
    且 `DAILY_COURSE_CAP` 沒有落入 `unchecked`——證明修法在真正在跑的伺服器上
    透過真實 HTTP 路徑生效，不是只在單元測試裡成立。這與稍早在 Node 腳本
    做的修法前後對照（`git stash` 切換）互補：腳本證明「行為真的改變了」，
    瀏覽器證明「改變在真正的伺服器與 API 路徑上可達」。

## 明確證明不了什麼

- 題庫仍是手寫的合成資料，不是真實選課紀錄的抽樣——涵蓋的是「已知會出錯的
  組合」，不保證涵蓋所有真實情境的分佈。
- `softUtility`（`preferenceScore`）沒有客觀「多少算好」的標準，只能跨執行
  比較同一批 case 的相對變化。
- runtime 數字受執行機器影響，不同機器之間不能直接比較——這份報告跟 #34
  一樣，是「同一台機器跟自己比」，不是絕對效能保證。

## Commit 與 push

未 commit，未 push（依標準流程，完成並驗證後先回報，commit／push 需使用者明確指示）。
