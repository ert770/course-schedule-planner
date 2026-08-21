# 2026-08-20 修復共同必修（Roadmap #15）的 adversarial review 發現（3 項）

## 修改日期

2026-08-20

## 修改檔案清單

**新增**：

- `docs/CHANGE_REPORTS/2026-08-20-corequisite-adversarial-review-fixes.md`（本檔）
- `server/test/scheduleRoutes.test.js`

**修改**：

- `server/src/skills/scheduler.js`
- `server/src/skills/scheduleValidator.js`
- `server/src/routes/schedule.js`
- `server/test/scheduler.test.js`
- `docs/SCHEDULING_LOGIC.md`
- `docs/API_SPEC.md`
- `docs/CHANGE_REPORTS/README.md`

## 背景

對 roadmap #15（實習課程需與同名正課一併排入）尚未提交的 working tree diff 跑了一次
Codex adversarial review，結果標成 `needs-attention`，列出 3 項發現（2 個 high、1 個
medium），且提供了具體重現步驟。本次逐一修復；這 3 項發現都圍繞同一個根因——「正課
必須與實習一併排入」這條規則，原本分散在排課引擎的三個獨立進入點各自實作了一份
（本學期必修排入迴圈、貪婪填充、不及格必修重補修），其中重補修那一份漏接了規則，
另外兩份也共用同一個「多班次逐一嘗試」的既有 bug。

## 主要改動內容

### 1. 多個候選實習班次逐一嘗試時，前面失敗的嘗試會污染後面的成功（high）

**問題**：正課帶著共同必修的實習時，若同一門實習開了多個班次，排課引擎會用
`.some()` 逐一嘗試每個班次，直到某個班次讓整組成功排入。但原本的
`addCorequisitePairToPlan()` 每次呼叫失敗（不論是快照回滾前，還是回滾後）都會立刻
把 `COREQUISITE_PAIR_INCOMPLETE` 的排除紀錄與必要課程失敗訊息寫進 `plan`。若第一個
班次因衝堂失敗、第二個班次成功排入，`plan.schedule` 裡確實同時有正課與第二個班次，
但第一個班次留下的失敗訊息仍然殘留，導致 `generateSchedule()` 的內部自我檢查
（`validateScheduleAgainstConstraints()`）把整組誤判成不完整，最終回應 `success:false`
且頂層 `schedule` 為空——即使排課引擎內部其實已經成功排出一份合法課表。

**修復**：把原本「試一次就順便寫訊息」的 `addCorequisitePairToPlan()` 拆成兩層：

- `attemptCorequisitePair()`：只做「快照 → 嘗試 → 失敗就靜默回滾」，失敗時**不**寫入
  `excludedCourses`／`failures`，避免中途失敗的嘗試留下任何痕跡。
- `placeCourseWithCorequisite()`：對候選實習班次逐一呼叫 `attemptCorequisitePair()`，
  任一班次成功就立即回傳成功，不再嘗試後續班次；只有**全部候選班次都試過且全部
  失敗**時，才在這裡統一寫入一次排除紀錄與（若必要課程）失敗訊息。

### 2. 不及格必修重補修完全沒有接上共同必修的配對邏輯（high）

**問題**：`buildPlan()` 的「不及格必修重補修」迴圈原本直接呼叫 `addCourseToPlan()`
排入重修的正課，沒有檢查它是否帶共同必修。若這門重修正課恰好有對應實習開課，實習
因為「不得單獨排入」的既有規則被貪婪填充排除在候選之外，最終排出「重修正課排入了、
對應實習卻缺席」的不合法課表——而新增的 `checkCorequisitePairs()` 驗證器（roadmap #15
自身新增的內部自我檢查）正確地把這個內部矛盾攔下來，讓一個原本可以成功排出的請求
變成整批失敗。

**修復**：重補修迴圈的每個候選班次改為先檢查 `corequisiteRole`：

- `'regular'`（重修的正課帶共同必修）：改用 `placeCourseWithCorequisite()`，與本學期
  必修排入迴圈、貪婪填充共用同一套「整組原子排入、逐一嘗試候選實習班次」的邏輯。
- `'internship'`：一律不單獨嘗試排入（比照另外兩個排入路徑的既有規則，永遠由對應
  正課那一側帶動），避免「學生恰好把 0 學分實習本身列為不及格歷史」這種極端邊界
  情境下被單獨排入。
- 其他情況：與改動前相同，直接呼叫 `addCourseToPlan()`。

三個排入路徑因此共用同一個 `placeCourseWithCorequisite()`，不再各自維護一份規則，
未來若要調整配對邏輯只需要改一處。

### 3. `/validate` 端點在唯一實際呼叫形狀下完全繞過新規則（medium）

**問題**：`POST /api/schedule/validate` 原本只在請求帶有非空 `constraints` 時才額外
呼叫 `validateScheduleAgainstConstraints()`。但文件記載、也是目前唯一的實際呼叫形狀
是只送 `{courses}`（`client/src` 尚未呼叫這支端點）。這代表：即使把
`generateSchedule()` 產出的一組配對課表拿掉其中一半再送回來驗證，回應仍會是舊版
`valid`（只查衝堂與重複班次），完全不會觸發新增的 `COREQUISITE_PAIR_INCOMPLETE` 檢查。

Codex 同時指出更深一層的問題：外部直接組出來、從未經過 `generateSchedule()` 的原始
課程物件，天生不帶 `corequisiteRole`／`corequisiteCode` 這兩個欄位（它們只由
`prepareCandidates()` 附加），`checkCorequisitePairs()` 因此無從得知「這門課應該有
搭檔」。

**修復**（分兩部分，刻意不做全部）：

- **一律執行**：`schedule.js` 的 `/validate` route 移除「只在 `constraints` 非空時才
  跑」的條件，改成無條件呼叫 `validateScheduleAgainstConstraints()`，`hardConstraintsValid`／
  `violations`／`unchecked` 三個欄位永遠出現在回應裡。
- **誠實回報覆蓋率、不猜配對關係**：`checkCorequisitePairs()` 改成先檢查送入的課表
  裡是否**有任何一門課帶 `corequisiteRole`**；完全沒有時回傳 `checked:false`，讓
  `COREQUISITE_PAIR_INCOMPLETE` 被列進 `unchecked`，誠實回報「沒有可信的配對資訊，
  這項規則沒有被檢查」，而不是悄悄回傳 `valid:true` 讓呼叫端誤以為配對規則有效。
  **刻意不做**的部分：不會憑 `catalogCourseCode` 的 `P` 後綴自行猜測配對關係——
  `BUS1121P`／`HY2073P` 這兩門真實例外（P 後綴但完全沒有對應正課，見
  `docs/DATA_SCHEMA.md`）若被字串規則誤判，反而會把合法課表判成違規。真正的解法
  （呼叫端可靠地知道任意課號是否有共同必修搭檔）需要伺服器端查詢完整課程目錄，
  這是比本次修復範圍更大的變更，留待未來需要時再做——**目前 `client/src` 完全沒有
  呼叫這支端點**，這個限制的實際影響面是零。

## 測試

- `node --check` 對所有變更檔案全數通過。
- `server/test/scheduler.test.js`：新增 Y10-Y12（原 Y1-Y9 全數不變）：
  - Y10：兩個候選實習班次，第一個衝堂失敗、第二個成功排入，確認 `success:true`
    且不殘留任何 `COREQUISITE_PAIR_INCOMPLETE` 排除紀錄（迴歸釘住發現 1）。
  - Y11：重修必修正課帶共同必修，確認正課與實習一併排入、`success:true`（迴歸釘住
    發現 2）。
  - Y12：重修必修正課的實習衝堂排不進去時，重修正課也一併不排入（補齊發現 2 的
    失敗路徑覆蓋）。
  - `node --test test/scheduler.test.js`：105/105 通過，零回歸。
- 新增 `server/test/scheduleRoutes.test.js`（3 個測試，`app.listen(0)` 起真實 HTTP
  server 呼叫 `POST /api/schedule/validate`）：只送 `{courses}` 時，(a) 帶配對標記但
  缺搭檔的課表正確回傳 `hardConstraintsValid:false` 與對應 violation（迴歸釘住發現
  3）；(b) 課表完全沒有共同必修課程時，`COREQUISITE_PAIR_INCOMPLETE` 誠實列在
  `unchecked`；(c) 完整配對的課表不觸發違規、也不列進 `unchecked`。
- `npm test`（完整 server 測試套件）：461/461 通過，零回歸（較修復前的 455 增加 6：
  Y10-Y12 三個 + 新測試檔 3 個）。
- 本次未修改 `client/src`、未變更任何使用者可見畫面，依專案慣例跳過前端 build／lint
  與瀏覽器實測；`/validate` route 的行為改動已由上述路由層級測試直接對真實 HTTP
  server 驗證，不依賴瀏覽器操作即可確認正確性。

## 明確排除在本次範圍外

- `/validate` 端點對「外部直接提供、從未經過 `generateSchedule()` 的原始課程物件」
  仍無法檢查共同必修配對完整性——這需要伺服器端查詢完整課程目錄才能可靠判斷任意
  課號是否有搭檔，範圍明顯大於本次的 review 修復，且 `client/src` 目前完全不呼叫
  這支端點，實際影響面為零。回應會誠實地把這種情況列進 `unchecked`，不會誤導呼叫端。
