# 2026-08-20 建立 hard/soft constraint schema、獨立 validator、放寬階梯、conflict set（Roadmap #21）

## 修改日期

2026-08-20

## 修改檔案清單

**新增**：

- `server/src/data/constraintSchema.js`
- `server/src/skills/scheduleValidator.js`
- `docs/CHANGE_REPORTS/2026-08-20-hard-soft-constraint-schema.md`（本檔）

**修改**：

- `server/src/skills/scheduler.js`
- `server/src/services/constraintService.js`
- `server/src/routes/schedule.js`
- `server/test/scheduler.test.js`
- `docs/SCHEDULING_LOGIC.md`
- `docs/API_SPEC.md`
- `docs/DATA_SCHEMA.md`
- `docs/DECISIONS.md`（新增 ADR-012～014）
- `docs/TEST_PLAN.md`
- `docs/CHANGE_REPORTS/README.md`
- `docs/CHANGE_REPORTS/2026-08-01-personalization-roadmap.md`（#21 狀態更新）

## 主要改動內容

### 問題

`docs/CHANGE_REPORTS/2026-08-01-personalization-roadmap.md` 的 #21 指出：`hardConstraintReason()`
把「盡量不要」條件當成直接排除，系統無法區分不可違反與可以放寬的需求，也沒有獨立 validator
證明最終結果合法，無解時只回傳第一個錯誤字串。#21 的前置條件（所有現有偏好已分類成 hard
constraint 或 soft preference）已由 #3 滿足，本次交付 #21 自己要求的正式 schema。

### 實作範圍與交付內容

1. **正式 hard/soft schema**（`server/src/data/constraintSchema.js`）：`CONSTRAINTS` 表，每個
   既有限制類型一筆，補上 `weight`／`relaxable`／`source`／`confidence` 4 個欄位，外加
   `exemptForRequiredCourses`（必修是否無條件豁免）與 `enforced`（validator 是否真的檢查得到）。
   純資料表，不改變任何現行排除／評分行為——`hardConstraintReason()`／`scoreCourse()` 的機制
   完全不變。

2. **明確規範各層級**：3 個時段類舒適偏好（`NO_MORNING_CLASSES`／`LUNCH_BREAK_FREE`／
   `NO_EVENING_CLASSES`）標為 `relaxable:true`；`BLOCKED_PERIODS`（真實外部不可用時段）與其餘
   既有硬性條件（衝堂、資格、已修、學分上限、他班必修、非本學期、系外選修不符、每日上限）標為
   `relaxable:false`。explicit selection 的既有繞過機制（`explicitIds.has(...)`）正式化為
   `overridableBy` 欄位。先修／共修定義為 `enforced:false` 的層級——專案裡完全沒有這方面的資料
   來源（已用 grep 確認 `server/src` 與 `docs/DB_AUDIT_REPORT_2026-08-05.md` 皆無先修表），
   validator 誠實回報未檢查，不強制執行、不捏造資料模型。

3. **與方案產生器分離的獨立 validator**（`server/src/skills/scheduleValidator.js`）：
   `validateScheduleAgainstConstraints(schedule, constraints)`，檢查衝堂、重複班次、學分上限、
   資格／學期／系外選修／已修過的 metadata 複查、4 個時段類硬性限制、必修涵蓋率，回傳
   `{ valid, violations, unchecked }`。`generateSchedule()` 每次成功回應前都會對主推方案呼叫一次
   作為內部自我檢查，落實「所有成功方案經 validator 驗證 hard constraint violation 為 0」這條
   驗收標準——不是口頭宣稱，是每次實際執行一次。`/api/schedule/validate` 在請求帶有非空
   `constraints` 時額外呼叫，回應以附加欄位（`violations`／`unchecked`／`hardConstraintsValid`）
   呈現，既有欄位（`valid`／`conflicts`／`duplicates`／學分數）完全不變；已用 grep 確認
   `client/src` 目前沒有呼叫這支端點，沒有既有呼叫方會被破壞。

4. **opt-in 放寬階梯**：`constraints.allowRelaxation`（預設 `false`）。啟用時，若方案的選修側
   因時段偏好排掉太多候選、導致湊不到學分下限，依 `constraints.timePreferencePriority`
   （使用者自訂的 constraintId 陣列，未提供時退回 schema 預設順序）逐一放寬 3 個可放寬的時段
   偏好並重試，成功時回應附上 `relaxedConstraints` 並在 `warnings` 揭露，絕不靜默改動。

5. **結構化 conflict set**：無解時除既有的 `message`／`warnings`（維持不變、附加而非取代）外，
   額外回傳 `conflictSet`——依 `constraintId` 與課程 id 去重後的違規清單，取代「只回傳第一個
   錯誤字串」。

### 兩個使用者主導的設計決策（非路線圖文件原文，來自規劃階段的澄清問答）

**正式必修無條件豁免時段偏好，但不豁免封鎖時段**：正式必修課（`isRequiredForStudent(course,
scope) === true`）對 `noMorningClasses`／`lunchBreakFree`／`noEveningClasses` 無條件豁免——
必修課本學期一定要修，這 3 項是使用者比較希望的事，不是外部事實。`BLOCKED_PERIODS`（真實的
外部不可用時段，例如工作）**永遠不豁免**，即使是必修課。此豁免範圍**嚴格限定**於
`isRequiredForStudent()`，**不含** `mustTakeCourseIds`／`selectedCourseIds`（使用者手動指定的
必排課）——後者維持現行行為不變，S10 測試完全不受影響（另有 X14 從相反方向釘住這條邊界）。
豁免發生時一律在 `warnings` 附上揭露訊息。詳見 `docs/DECISIONS.md` ADR-013。

**放寬階梯獨立於必修豁免，且順序由使用者決定**：opt-in 放寬階梯是另一套獨立機制，只處理
「選修側因時段偏好排不出課表」這種情境，必修豁免永遠生效、不需要任何旗標。放寬順序透過
`timePreferencePriority` 讓使用者自訂，不是系統寫死的固定順序。詳見 `docs/DECISIONS.md`
ADR-014。

### 順帶修復

`addCourseToPlan()` 的每日課程數上限排除分支，先前即使 `options.required === true` 也不會推入
`plan.failures`，跟其他每個排除分支不一致，導致被每日上限擋掉的必排課會靜默消失而不回報失敗
原因。本次修復並補上 X10 測試釘住。

### 明確排除在本次範圍外

- **先修／共修的強制執行**：只定義層級（`enforced:false`），不實作檢查邏輯——沒有資料來源，
  屬 roadmap #8（尚未開始）的負責範圍。
- **`scoreCourse()` 動態讀 schema 表**：內建評分算式維持逐位元組不變，`weight` 欄位僅供文件
  說明，不接線。
- **`maxCoursesPerDay` 重新分類為可放寬**：沒有明確需求驅動，維持現行 `relaxable:false`。

## 測試

- `node --check` 對所有變更檔案（`constraintSchema.js`／`scheduleValidator.js`／
  `scheduler.js`／`constraintService.js`／`routes/schedule.js`）與 `server/src/**/*.js` 全數通過。
- `node --test test/scheduler.test.js`：93/93 通過，含 S1-S10（逐項行為與改動前完全一致）、
  N1-N15（roadmap #3 精確回歸，未受影響）、新增的 X1-X14（放寬階梯、獨立 validator、每日上限
  修復、必修豁免範圍）。
- `npm test`（整個 server 測試套件）：442/442 通過，零回歸，含 `constraints.test.js`（驗證
  `allowRelaxation`／`timePreferencePriority` 的新增合併邏輯未破壞既有 4 個合併輔助函式的語意）。
- 實作過程中發現並修復一個真實的自我檢查誤判：`validateScheduleAgainstConstraints()` 最初不知道
  `explicitCourseIds`／`selectedCourseIds`／`mustTakeCourseIds` 的既有「明確指定可繞過資格／學期
  排除」機制，導致 `generateSchedule()` 的自我檢查把 #13B／#20 既有測試的正常結果（使用者明確
  指定資格待確認或非本學期課程）誤判為內部不一致而降級成失敗；修復後改為讀取
  `collectExplicitCourseIds()`（新增匯出）跳過這類課程的複查。另發現尚未排定時間的必要課程
  （`unscheduledCourses`）若不併入自我檢查的課程清單，`REQUIRED_COURSE_COVERAGE` 會誤判為
  缺漏（U2／U3 測試曾因此回歸），已修復為自我檢查同時檢查 `schedule` 與
  `unscheduledCourses`。這兩個修復過程本身即是「先實作、跑既有回歸測試、依失敗訊息找出設計
  疏漏」的直接證據，不是憑空宣稱。
