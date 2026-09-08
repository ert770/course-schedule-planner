# Roadmap #36（二輪）：修正 preference sensitivity sweep 的量測方法

## 背景

`#36` 狀態一直是 🟡 部分完成，roadmap 文件明講尚未完成的有兩件事：一是 synthetic
fixture 不能替代真實去識別互動樣本（外部資料阻塞，這次不處理）；二是「正向改善
尚未在所有 persona／軸上成立」——2026-09-06 交付的五軸 preference sensitivity
sweep 裡，`compact` 軸量到 `utilityDelta = -0.098666`（方向錯誤），`avoid-time`
軸量到 `0`（沒有效果），當時的變更報告誠實記錄為「observe，未達預期」。這次處理
的是第二項，屬於可以現在動工的工程問題。

規劃時直接用 `node --input-type=module -e` 呼叫既有的 `runAxisSweep()`／
`buildAxisConditions()`／`generateSchedule()`，把兩個軸的數字拆解到
`preferenceBreakdownDelta` 逐分量檢視，找到兩個各自獨立的根因，並在改法定案前
用同樣的方式空跑驗證數字改變的方向與幅度，才落成程式碼——不是先猜一個解釋。

## 修改檔案

- `server/src/skills/personalizationExperiment.js`
- `server/test/fixtures/personalizationCases.json`
- `server/test/personalizationBaseline.test.js`
- `docs/TEST_PLAN.md`
- `docs/CHANGE_REPORTS/README.md`
- `docs/CHANGE_REPORTS/2026-08-01-personalization-roadmap.md`
- `docs/CHANGE_REPORTS/2026-09-06-roadmap-36-personalization-baseline-ab.md`（訂正
  一行過期敘述，見「順手修正」）

## 主要改動內容

### 1. 評分尺自相矛盾（`compact` 軸方向錯誤的根因）

`runAxisSweep()` 原本用 `caseDefinition.baseConstraints`（題庫裡「每一軸都設到
最強」的固定設定，含 `preferChallengingCourses: true`）當作 off／on 共用的評分
尺。這直接跟 `easy` 軸要測的 `preferEasyCourses` 方向相反；`compact` 軸因為自己
就是 `preferCompact`，`buildAxisConditions()` 把保底用的 carrier flag 換成
`preferChallengingCourses`（避免 off／on 兩邊都整批回退成無個人化模式），評分尺
因此又被這個代打旗標污染一次。直接印出 `preferenceBreakdownDelta` 證實：`compact`
軸自己的分量確實是 `+0.5`（方向對），但 `interest` 分量被拖累到 `-0.55`，兩者
加總才變成整體 `utilityDelta` 的假性下降——不是集中排課本身沒有效果，是評分尺
本身內部自相矛盾。

改成用**這一軸自己的 `on` 條件**當評分尺，off／on 仍共用同一把固定尺（比較才有
意義），但不再跟被測方向互相矛盾。`buildAxisConditions()`（負責產生 off／on 兩組
排課條件）完全沒有改動，`personalizationBaseline.test.js` 的 PB11（比對
`buildCounterfactuals()`）測的正是這條路徑，不受影響。

### 2. `avoid-time` 軸量錯指標（外加候選池本身沒有考題）

`noMorningClasses` 是硬性排除規則（`scheduler.js` 直接把早八課從候選池濾掉），
根本不是 `evaluatePreference()` 打分公式的一個分量——`interest`／`compact`／
`easy` 才是。用 `utilityDelta` 判定這一軸有沒有效果，量到的從來不是這個功能真正
該回答的問題。`compareRuns()` 其實已經算好對應的 `morningCoursesDelta`，只是
`runAxisSweep()` 從沒讀過它。`AXIS_DEFINITIONS` 新增可選的 `metric` 欄位（預設
`utilityDelta`，其餘四軸行為不變），`avoid-time` 指定成 `morningCoursesDelta`。

修好指標之後空跑發現第二個問題：候選池的 12 門課沒有一門排在早八
（`startPeriod` 全是 3 或 7），不管開不開這個偏好都沒有課可以濾掉，
`morningCoursesDelta` 恆為 0——不是這個功能沒有效果，是題庫本身沒有一題會用到
「不排早八」這個知識點。不新增第 13 門課（會連帶要改好幾處寫死 `12` 的既有斷言，
且新課吸引力難以精準控制，實測會意外干擾其他四軸），改成把題庫裡原本就會被排進
課表的「專案管理」（`id: 112`）原地搬到同一天的早八時段（`startPeriod/endPeriod`
從 `7/8` 改成 `1/2`，其餘欄位不動）。已驗證：對集中排課指標沒有影響（同一天內
搬時段不改變用了幾天）；對興趣、涼度、依評價優先三軸沒有影響（吸引力沒變）；
對 `avoid-time` 軸則終於能觀察到真實效果：`off` 會排進這門早八課，`on` 會把它
濾掉，`morningCoursesDelta` 從 `0` 變成 `-1`。

### 3. 測試

`personalizationBaseline.test.js` 的 PB8-PB10 原本只斷言
`Number.isFinite(utilityDelta)`——這是這次回歸沒被任何既有測試擋下的直接原因，
「有算出數字」不等於「方向正確」。補上 `sweep.directionCheck.pass === true` 的
迴圈斷言；另新增 PB13（`avoid-time` 真的排除早八課：`off.morningCourses ≥ 1`、
`on.morningCourses = 0`、`morningCoursesDelta < 0`）與 PB14（`compact` 自己的
`preferenceBreakdownDelta.compact > 0`，確認不是靠其他分量蓋過去碰巧過關）。

### 4. 順手修正

`docs/CHANGE_REPORTS/2026-09-06-roadmap-36-personalization-baseline-ab.md` 結尾
寫「未 commit，未 push」，但這份檔案實際上已經在 `9f35707` commit 並推送過（`git
log` 已核對）——這是先前對話中曾點名過的同一類「commit 後沒回頭訂正報告」疏漏，
這次一併修正這一行，不影響其他內容。

## 影響範圍

修改全部在量測程式碼（`personalizationExperiment.js`）與測試 fixture，不動
`scheduler.js`／`scoringPolicy.js`／任何 production 排課邏輯或 API。`+0.182`
（B0→B1 utility delta）這個已公開記錄的 baseline 數字經驗證逐位元不變——
`runPersonalizationCase()`（B0/B1/P 用的路徑）完全沒有改動，這次只動
`runAxisSweep()`（五軸 sweep 專用）。不影響任何使用者可見行為。

## 測試與驗證結果

- `node --check server/src/skills/personalizationExperiment.js`：通過。
- `node --test server/test/personalizationBaseline.test.js server/test/personalizationMetrics.test.js`：
  19/19 通過（含新增 PB13、PB14）。
- `npm run bench:personalization`：3 個 persona 的 `baselineUtilityDelta` 仍是
  `0.182`，跟先前記錄逐位元相同；五軸 sweep 全部 `directionCheck.pass: true`——
  `compact` 從 `-0.098666` 變成 `+0.127`，`avoid-time` 從 `0`（無效果的空對照）
  變成 `-0.166667`（`morningCoursesDelta = -1`，真實可觀察的效果），不再需要
  額外文字註記「observe，非成功」。
- `npm test`（server 全量）：1046/1046 通過，無回歸。
- 純量測程式碼與測試 fixture 修改，不影響使用者可見行為，比照 `#35`／`#40`
  對純離線 benchmark 部分的先例，不需要瀏覽器驗收。

## 明確證明不了什麼

- 這次修的是「單一軸的方向量測方法」，不是「個人化真的對真實學生有效果」——
  `#36` 的另一半（真實去識別互動樣本）維持外部阻塞，這次沒有、也不能推進它。
- `easy` 軸自己的 `preferenceBreakdownDelta.easy` 分量在驗證中仍是小幅負值
  （聚合 `utilityDelta` 因為 compact／interest 分量增加而維持正向、真正通過），
  推斷是 12 門課這個小候選池在 `preferCompact`（進位旗標）與 `preferEasyCourses`
  同時作用下，排課引擎在特定候選組合裡真的發生了 easy 分量的權衡取捨，不是量測
  方法的錯誤——這次不強行讓每一個細部分量都轉正，如實記錄。

## Commit 與 push

尚未 commit、尚未 push——依專案慣例，等使用者明確要求再執行 `/commit-push`。
