# Roadmap #10 任務 1 修正：主軸訊號判定（評價下限、可達範圍、no-signal 與不可行的界線）

## 修改日期

2026-09-20

## 問題

2026-09-19 的任務 1 實作在主軸訊號判定上有兩個問題，兩者都會讓「誠實回報」失真：

1. **評價數下限被寫成 `max(2, S₀ 有評價課數)`。** 這等於要求替代方案的評價覆蓋率不得
   低於 S₀，主軸還沒開始比較就先被這條限制擋掉。2026-09-19 使用者已決定改為
   `max(2, ⌈S₀ 有評價課數 ÷ 2⌉)`，但後續改動把它改了回去。
2. **主軸門檻的可達範圍檢查被移除。** 主軸限制是「整份方案的平均興趣／涼度要比 S₀ 好
   `minGain`」。當 S₀ 已經是候選池裡最涼（或最硬、最合興趣）的組合時，這個門檻在資料上
   就不可能達成，卻會一路送進 MILP，求解器回不可行，系統就把它說成
   `axis-threshold-infeasible`／`rating-coverage-infeasible`——把「資料上做不到」講成
   「限制組合有衝突」。實測 D1249697 帳號就是這樣：候選池最涼的課是 0.72，S₀ 已經是
   0.72，門檻卻是 0.742。

## 解法

- 評價數下限恢復為 `max(2, ⌈S₀ 有評價課數 ÷ 2⌉)`。
- 興趣、輕鬆、挑戰三個主軸都恢復可達範圍檢查，並且以**實際使用的門檻**
  （`baseline ± minGain`）判斷，不另設一套數字。
- 可達範圍取「競爭課 ∪ 固定課」的極值。主軸限制算的是整份方案（含固定課）的平均值，
  平均值不可能高於池中最大值、也不可能低於最小值；只看競爭課會把「固定課本來就能把
  平均拉上去」的案例誤判成沒有訊號。
- 界線說清楚：**資料上不可能改善 → `no-signal`；有改善空間但與學分、換課、品質或階層
  限制組合後無解 → 求解後的診斷（`axis-threshold-infeasible`／`combined-constraints` 等）**。
  可達範圍只是必要條件，不保證有解。
- no-signal 另外記錄 `detail`（第一個不成立的條件）：`no-interest-keywords`、
  `no-easiness-baseline`、`insufficient-rating`、`flat-scores`、`threshold-unreachable`、
  `single-day`、`fixed-days-blocked`，一路帶到 API 的 `collapsed[].detail` 與
  `solver.axes[].detail`。前端文案仍以 `reason` 為準，`detail` 只用於診斷與報告。
- 求解預算恢復使用者 2026-09-19 的決定並**把線上與 benchmark 拆成兩組設定**：線上
  `DEFAULT_DIVERSE_OPTIONS` 為 K=1、共用 2.5 秒、單次 0.8 秒；`BENCHMARK_DIVERSE_OPTIONS`
  只覆寫 K=3，供 bench 量完整候選池。先前兩者共用一組常數，被改成 K=3／1.2 秒／0.2 秒時
  線上也跟著變了；分開之後改一邊不會默默動到另一邊，bench 報告也會記下
  `solverOptions.profile`。
- 文案：`detail` 說得出更精確的話時優先用 `detail`。`threshold-unreachable` 顯示
  「綜合方案已達目前課程資料可改善的界線，無法再產生有意義的主軸改善」，其餘 `no-signal`
  才顯示「候選課缺少可區分的資料」。方案切換列（前端）與 `warnings` 的塌縮說明（後端
  `describePlanCollapse()`）都改掉，後者原本直接把 `no-signal` 這種代碼印給使用者看。
  兩份文案表因前後端不共用程式碼而各存一份，互相以註解指認。
- 未更動：87% 同階層偏好品質下限、跨年級／系外門數與 S₀ 相同的硬限制、雙向換課至少
  2 門、學分不少於 S₀、`minGain = 0.02`。

## 修改檔案

### 後端

- `server/src/skills/scheduler.js`：`buildMilpAxes()` 重寫訊號判定（評價下限、可達範圍、
  `detail`）；`describePlanCollapse()` 改輸出中文說法（新增 `COLLAPSE_REASON_TEXT`／
  `COLLAPSE_DETAIL_TEXT`）；`_mipInputs.featureSummary` 新增 `fixedInterestMax`／`fixedEasyMax`／
  `fixedEasyMin`，讓可達範圍能把固定課算進去；`detail` 併入 `collapseReasons` 與
  `planDiversity.solver.axes`。
- `server/src/skills/optimization/diversePlanSolver.js`：no-signal 的 axis 結果帶上 `detail`；
  線上預設恢復 K=1／2.5 秒／0.8 秒，另外匯出只覆寫 K=3 的 `BENCHMARK_DIVERSE_OPTIONS`。
- `server/scripts/planDiversityAcceptanceReport.js`：明確帶入 `BENCHMARK_DIVERSE_OPTIONS`，
  並把實際使用的求解設定寫進報告的 `solverOptions`。

### 前端

- `client/src/components/Schedule/PlanSwitcher.jsx`：合併說明優先採用 `detail` 的文案。

### 測試

- `server/test/milpAxisSignal.test.js`：改測 `max(2, ⌈S₀ ÷ 2⌉)`、三個主軸的可達範圍
  （含「固定課把平均拉上去就仍有訊號」）、各項 `detail`。
- `server/test/diversePlanSolver.test.js`：線上預設改測 K=1／2.5 秒／0.8 秒，並加一項
  「benchmark 設定只覆寫 K=3、不得影響線上設定」。

### 文件

- `docs/SCHEDULING_LOGIC.md`：改寫第 5 點（no-signal 條件、可達範圍定義、與不可行的界線、
  新的評價數下限）。
- `docs/API_SPEC.md`：新增 `collapsed[].detail`／`solver.axes[].detail` 契約與可能值。
- `docs/TEST_PLAN.md`：更新 `milpAxisSignal.test.js` 的涵蓋範圍。
- `docs/CHANGE_REPORTS/2026-08-01-personalization-roadmap.md`：更新 #10 狀態與實作結果段。

## 驗證

### 單元測試

- `node --test test/milpAxisSignal.test.js`：7/7 通過。
- `npm run lint --prefix client`：無警告。
- 相關套件（`diversePlanSolver`、`scheduleMipModel`、`planDiversityAcceptance`、
  `planDiversityDiagnostics`、`planStrategies`）：36/36 通過。
- `scheduler.test.js` 與 `personalizationBaseline.test.js`：196/196 通過。
- 全套 `node --test --test-force-exit "test/**/*.test.js"`：1162 項中 1159 通過。3 項失敗都是
  **檔案層級**的 `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), src\win\async.c:76`
  （`authRoutes`、`privacyRoutes`、`scheduleRoutes`），檔案內的測項全數通過；這是 Windows
  libuv 的既有問題，與本次修改無關。另外 `interactionEvents.test.js` 39/39 全通過，但程序在
  測試結束後不會自行退出（有未關閉的 handle），必須加 `--test-force-exit` 才會結束——
  這也是既有問題，本次未處理。

### 真實資料驗收（唯讀 MySQL，5 case）

`npm run bench:plan-diversity`（benchmark 設定 K=3、2.5 秒；報告的 `solverOptions.profile`
為 `benchmark`）。**4 case 通過（修正前為 3）**：

| case | 結果 | 實際方案數 | 最低保留品質 | 合併原因 |
| --- | --- | ---: | ---: | --- |
| `persona-compact` | 通過 | 3 / 3 | 1.00 | 興趣：`no-interest-keywords` |
| `no-preference-control` | 通過 | 3 / 3 | 1.00 | 興趣：`no-interest-keywords` |
| `persona-easy` | 通過 | 3 / 3 | 0.92 | 興趣：`no-interest-keywords` |
| `fixed-courses-control` | 通過 | 2 / 2 | 1.00 | 輕鬆：`no-easiness-baseline`；集中：`fixed-days-blocked` |
| `persona-challenge` | **未通過** | 1 / 2 | — | 挑戰：`no-easiness-baseline`；興趣：`no-interest-keywords`；集中：`axis-threshold-infeasible` |

未通過的 `persona-challenge` 沒有違反品質、學分或安全限制：難度與興趣主軸是資料本身沒有
訊號，集中主軸則在「少一天 ＋ 87% 品質 ＋ 階層門數相等」同時成立時無解——診斷的
`resolvedBy` 是 `axis`／`quality`／`hierarchy`，任一條放寬都能解開，所以這是三者的取捨，
不是訊號判定的問題。

### `minGain` 對照

同一份資料改跑 `--axis-min-gain=0.05`：一樣 4 case 通過，但 `no-preference-control` 與
`persona-easy` 的涼度主軸落在可達範圍外（`no-signal`／`threshold-unreachable`），實際方案數
由 3 降為 2。因此保留校準後的 0.02。（附帶一提，因為 no-signal 不計入分母，0.05 的驗收
「通過」但方案更少——這正是為什麼方案數要跟驗收率分開看。）

### 瀏覽器 A/B

真實帳號 D1249697（資訊三乙，偏好：盡量集中排課、不排早八；互動資料 31/50 筆未達門檻，
未套用學習權重），前後端本機啟動，使用者本人登入後執行一次排課。

| 項目 | 修正前 | 修正後 |
| --- | --- | --- |
| 實際方案數 | 1 | **3**（集中排課、興趣導向、個人化綜合） |
| 輕鬆主軸 | `no-signal` | `no-signal`（`detail: threshold-unreachable`） |
| 興趣主軸 | `axis-threshold-infeasible` | 產生方案（9 門 25 學分，品質保留 100%） |
| 集中主軸 | `axis-threshold-infeasible` | 產生方案（9 門 25 學分，4 天，品質保留 100%） |

- **no-signal 不再被誤報成不可行**：修正前興趣與集中兩軸都被報成「無法達到主軸改善門檻」，
  實際上是可以做到的；現在兩軸都排得出方案，唯一合併的輕鬆主軸如實標為資料上做不到。
- **文案走到新的那句**：畫面顯示「輕鬆導向方案：綜合方案已達目前課程資料可改善的界線，
  無法再產生有意義的主軸改善」，代表 `detail` 已從後端傳到前端並優先採用。
- **切換方案後課程集合真的不同**（逐一點選三個分頁後讀取課表）：
  - 個人化綜合（S₀，10 門）：安全程式設計、數位系統設計實驗、行動應用程式開發、
    人工智慧自然語言導論、嵌入式系統、軟體框架設計、程式語言、資訊實務案例探討、
    資訊安全管理、華語教學實習(二)
  - 集中排課（9 門）：換掉 5 門、換入系統安全、電腦視覺與擴增實境、智慧物聯網實務應用、
    法文(二)；上課 4 天（S₀ 為 5 天）
  - 興趣導向（9 門）：換掉 5 門、換入跨域導向程式設計、系統安全、電腦視覺與擴增實境、
    智慧物聯網實務應用
  - 集中與興趣之間也互換 2 門（安全程式設計、法文(二) ↔ 跨域導向程式設計、資訊安全管理），
    符合方案間至少換 2 門的規則。
  - 三者學分同為 25；偏好符合度 34%／27%／26%，評價涵蓋率 11%／22%／10%。
- **console 無新增錯誤**：只有登入前兩次 `/api/auth/me` 的 401（預期行為），登入後所有
  API 皆為 200，後端 log 無錯誤。

第二輪（改完 `describePlanCollapse()` 後重新登入、重排一次）確認聊天區提示句為：
「輕鬆導向方案：綜合方案已達目前課程資料可改善的界線，無法再產生有意義的主軸改善，因此
未能保留為獨立方案。目前提供 3 種方案。可競爭的課程共 224 門；系統已保留實際原因，沒有把
標題或排序差異當成新方案。」畫面上已無任何原始代碼；三個方案與課程集合與第一輪相同。

註：`server/.env` 未設定 `SESSION_SECRET`，後端每次熱重啟都會讓登入 session 失效——
第二輪中間出現的 401／502 是這個原因，不是本次修改造成的，重新登入後所有 API 皆為 200。
