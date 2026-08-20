# #20：Active Term 過濾與候選課程可追溯 metadata

## 修改日期

2026-08-15

## 範圍

本輪明確限定為 roadmap #20 的三項：(1) 系統層級 active term 設定與過濾，(2)
`eligibilitySource`／`scopeReason`／`term` 三個附加欄位，(3) 把既有「可搜尋／可加選／
本人必修／可計入畢業學分」四種判定整理成文件化對照。

明確排除：#13C（B～F 正式適用規則，等系辦／校方書面規則）、#13D（學制／學程欄位，
等 Profile schema 擴充）、任何使用者可切換學期的介面或 per-request term 覆寫——term
是系統常數，所有查課與排課 API 共用同一個值。

## 修改檔案清單

**新增**

- `server/src/data/activeTerm.js`
- `server/test/activeTerm.test.js`
- `server/test/courseCategory.test.js`
- `docs/CHANGE_REPORTS/2026-08-15-active-term-and-eligibility-metadata.md`（本檔）

**修改（程式）**

- `server/src/skills/courseScope.js`
- `server/src/skills/courseCategory.js`
- `server/src/skills/courseQuery.js`
- `server/src/skills/scheduler.js`

**修改（測試）**

- `server/test/courseScope.test.js`
- `server/test/courseQuery.test.js`
- `server/test/scheduler.test.js`
- `server/test/database-contract.test.js`

**修改（文件）**

- `docs/API_SPEC.md`
- `docs/ARCHITECTURE.md`
- `docs/SCHEDULING_LOGIC.md`
- `docs/TEST_PLAN.md`
- `docs/CHANGE_REPORTS/2026-08-01-personalization-roadmap.md`
- `docs/CHANGE_REPORTS/README.md`

## 主要改動內容

### Active term（系統常數）

`server/src/data/activeTerm.js` 新增 `ACTIVE_TERM`（預設 114 學年下學期，可用
`ACTIVE_ACADEMIC_YEAR`／`ACTIVE_SEMESTER` 環境變數覆寫，換學期不需改程式碼；預設值
須與 `generalEducationCatalog.js` 的 `RECOGNIZED_GENERAL_EDUCATION_COURSES_114_2` 保持
一致，兩處日後須同步調整）、`isActiveTermCourse()`、`annotateTerm()`、
`normalizeSemesterLabel()`。學年學期皆缺的候選視為本學期（不新增排除），相容既有
無 term 資料的測試與資料。

過濾分兩層，沿用專案既有的「系統自撿排除＋原因、使用者明確指定保留＋警告」模式：

- **Tier 1**（`courseQuery.js` 的 `filterCategorizedCourses()`）：無條件過濾非本學期
  候選，涵蓋 `GET /api/courses`、Agent 查課、與排課主要候選來源
  （`searchCoursesForSchedule()`）。搜尋沒有「明確指定」的語意，不設例外。
- **Tier 2**（`scheduler.js` 的 `prepareCandidates()`）：處理繞過 `courseQuery.js`、
  直接查 `getAll('courses')` 的兩條路徑（明確 `courseIds`、#19 重補修查找），排在
  unknown-eligibility 檢查之前（term 是更外層閘門）。

驗證了一個容易忽略的副作用：#19 重補修查找若唯一對到的 section 是舊學期資料，
先前會被誤當成本學期已開課而靜默滿足重補修，壓下「本學期沒有開課，請下學期記得
重修」警告；Tier 2 過濾後該 section 被排除，原本該出現的警告正確觸發——這是本次
過濾的正確副作用，已新增 regression test 釘住。

### `eligibilitySource`（courseScope.js）

`resolveCourseEligibility()` 5 個分支各自附上固定代號（`ELIGIBILITY_SOURCE`
常數）：`UNCLASSIFIED`、`UNCONFIRMED_RULES`、`REQUIRED_SCOPE_UNRESOLVED`、
`REQUIRED_TABLE`、`ELECTIVE_DEFAULT`。純附加欄位，`eligibility`／`eligibilityReason`
既有邏輯與文字未變動。

### `scopeReason`（courseCategory.js）

新增 `buildScopeReason()`，把 term／類別／eligibility 結論融合成一句白話說明，
優先序：非本學期 → `eligibility=unknown` → 必修判定（本人／他人）→ 通識 → 系外選修
→ 一般選修。系外選修的精修文字（不計入畢業學分／須系辦確認／符合認列條件）由
`refineOutsideElectiveScopeReason()` 提供，在 `courseQuery.js`、`scheduler.js`
兩個**既有**呼叫 `evaluateOutsideElective()` 的地方事後覆寫——刻意不搬動
`evaluateOutsideElective()` 的呼叫方式，降低回歸風險。

### 四種判定的正式對照

不新增第四個頂層欄位（會與 `eligibility`／`outsideElective.eligible` 重複），改為在
`docs/SCHEDULING_LOGIC.md` 新增文件化對照表，把「可搜尋／本人必修／可加選／可計入
畢業學分」各自對應到現有程式位置。

## 影響範圍

- `GET /api/courses`、`POST /api/schedule/generate`、`POST /api/chat` 的排課／查課
  工具。回應為向後相容的欄位新增（`eligibilitySource`、`term`、`scopeReason`）。
- **行為變更**：非本學期候選課程不再出現在搜尋結果或自動排課候選中（此前完全沒有
  active term 概念，會混入所有學年學期的資料）。
- 未修改 `server/src/services/constraintService.js`、`server/src/services/scheduleService.js`
  與任何 `client/` 檔案——term 是系統常數，不經 request 覆寫。

## 測試與驗證結果

- `npm test`：本輪開始前基準 322 tests / 73 suites，完成後 **365 tests / 86 suites**，
  全數通過，零回歸。
- 新增 `activeTerm.test.js`（16）、`courseCategory.test.js`（15）；`courseScope.test.js`
  （+5 `eligibilitySource`）、`courseQuery.test.js`（+4，含 Tier 1 過濾與 scopeReason
  精修）、`scheduler.test.js`（+3，含 Tier 2 過濾與 #19 互動 regression）、
  `database-contract.test.js`（+1，對真實本機 MySQL 驗證 `ACTIVE_TERM` 與現行資料
  相符）。
- `node --check` 對所有修改的 `server/src/**/*.js` 全數通過。
- 本次未修改任何前端檔案，未執行瀏覽器驗收。

## 已知限制（留給後續任務）

- B～F 班級的正式適用對象規則仍待 `#13C`（系辦／校方書面規則）。
- 學制、學程與特殊身分欄位仍待 `#13D`（Profile schema 擴充）。
- Active term 目前是單一系統常數；若未來需要「查詢歷史學期資料」（例如成績單、
  課程歷史瀏覽）等不受 active term 限制的用途，需另立獨立端點或參數，不應繞過
  這裡的硬性過濾。

## 是否 commit 與 push

- 尚未 commit。
- 尚未 push。
