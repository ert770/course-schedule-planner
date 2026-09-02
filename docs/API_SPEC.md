# API Spec

Base URL:

```text
http://localhost:3001/api
```

All request and response bodies are JSON.

## Authenticated identity

登入成功後，後端以簽名的 `fcu_session` cookie 保存 canonical student ID（學號）。
cookie 設為 `HttpOnly`、`SameSite=Lax`，前端所有 API request 都使用
`credentials: include`。Profile、Schedule、Chat、Graduation、watchlist 與 saved schedules
一律從 session 取得實際操作身分，不接受 client 指定其他使用者。

相容期間若 request 仍帶 `userId`／`studentId`，其值只能是 session 中的同一個學號；
不一致回傳 `403`。未登入或 session 失效回傳 `401`。

## Data Source

Course, section, review, and numeric user profile data are read from MySQL database `defaultdb`.

- API `course.id` is `Course_Sections.section_id`.
- API `course.code` and `course.courseId` are `Courses.course_id`.
- API `course.catalogCourseCode` is MySQL `Courses.subid3`, the stable catalog course code.
  API course objects no longer expose the database-oriented name `subid3`.
- Review lookups use `Course_Reviews.selection_code` joined to `Course_Sections.selection_code`; API responses expose the joined `section_id` as `review.courseId`.
- Demo auth users and saved schedules remain backed by `server/data/*.json`. Raw Chat 不再讀寫
  `chat_history.json`；啟用 #33 後只寫入 MySQL `Chat_Messages` 的 AES-256-GCM 密文。

## Privacy and consent

啟用 `PRIVACY_ENFORCEMENT_ENABLED=true` 後，Profile、Schedule、Chat、Graduation 與
watchlist 等個人資料端點除了 session，還需要目前政策版本的 `service_processing`
同意。缺少同意回 `428`：

```json
{ "error": "尚未同意目前版本所需的資料用途", "code": "CONSENT_REQUIRED" }
```

政策版本過期時 `code` 為 `CONSENT_VERSION_OUTDATED`。`personalization_learning` 與
`aggregate_research` 都是選擇性且預設 false，不影響核心服務。

### `GET /api/privacy/policy`

公開回傳政策版本、三種用途、processor 與保存期限，不需要登入。

### `GET /api/privacy/consents`

回傳登入者目前各用途的最新 append-only 決定、`requiresAction` 與政策內容。回應不含
canonical ID 或 pseudonymous subject ID。

### `PUT /api/privacy/consents`

```json
{
  "consents": {
    "service_processing": true,
    "personalization_learning": false,
    "aggregate_research": false
  }
}
```

必要用途必須為 true 才能開始服務；三個值會以同一時間點原子寫入。

### `GET /api/privacy/export`

以 attachment JSON 串流登入者的可攜 Profile、已存課表、同意決定與**自己的互動事件**
（`data.interactionEvents`，Roadmap #2）。不包含密碼、內部 subject ID、Raw Chat 明文、
模型 thought 或研究逐筆事件；回應使用 `Cache-Control: no-store`。

匯出的事件刻意不含 `subject_id` 與 `idempotencyKey`：前者是分析用的內部假名，匯出它
等於把假名與本人身分綁在同一份檔案裡；後者是去重用的實作細節。

### `DELETE /api/privacy/chat`

刪除登入者全部加密 Raw Chat，不影響已寫入 Profile 的結構化偏好。

### `POST /api/privacy/deletion-intents`

建立 10 分鐘有效、單次使用且只屬於登入者的刪除 token。

### `DELETE /api/privacy/data`

Body 必須帶前一步的 `requestId`、`token` 與固定 `confirmationPhrase: "刪除我的資料"`。
成功後刪除服務帳號、Profile、修課歷史、已存課表、互動事件與 Raw Chat，清除 session；
最小同意與稽核記錄依政策保留 365 天。回應的 `deleted` 含 `interactionEventsDeleted`。

**執行順序：先標記撤回，再刪除。** 同意紀錄依政策保留 365 天，因此刪除後 consent 檢查
仍會通過；若不先撤回，一個已通過檢查、正在執行中的 `POST /api/interactions` 可以在刪除
完成之後才落地，讓這支 API 回報成功卻仍留下個人資料。互動事件的寫入會在同一個交易裡以
`SELECT ... FOR UPDATE` 檢查撤回狀態，已撤回的 subject 一律回 `rejected`。

## Health

### `GET /api/health`

Response:

```json
{
  "status": "ok",
  "timestamp": "2026-06-11T00:00:00.000Z"
}
```

## Auth

The provided MySQL schema does not include password data, so auth still uses the local demo `users` JSON collection.

### `POST /api/auth/login`

Request:

```json
{
  "studentId": "D1249196",
  "password": "password"
}
```

Response:

```json
{
  "success": true,
  "user": {}
}
```

### `GET /api/auth/me`

從 session 回傳目前登入的 local demo user profile（不含密碼），不接受 query student ID。

### `POST /api/auth/logout`

清除 session cookie。

### `POST /api/auth/update-watchlist`

Request:

```json
{
  "watchlist": [1, 2, 3]
}
```

`watchlist` values should be section ids.

## Courses

### `GET /api/courses`

Query params:

- `department`（必填；完整系所名稱，例如 `資訊工程學系`）
- `grade`（必填；由使用者完整班級解析出的年級，例如 `3`）
- `className`（必填；由完整班級解析出的班別尾碼，例如 `甲`）
- `keyword`
- `category`（選填：`必修`、`核心選修`、`一般選修`、`通識`、`系外選修`）
- `dayOfWeek`
- `credits`
- `instructor`
- `code`
- `period`
- `language`

`department`、`grade`、`className` 必須使用 `GET /api/profile` 回傳的
`courseSearchScope`，前端不得自行拆解完整班級名稱。API 不接受 `class` alias。
缺少任一班級範圍欄位時不會退回廣泛搜尋，而是回傳 `400`：

```json
{
  "error": "缺少班級資料，請先匯入學生班級再搜尋課程。",
  "code": "CLASS_NAME_REQUIRED"
}
```

例如完整班級 `資訊三甲` 會產生：

```text
GET /api/courses?department=資訊工程學系&grade=3&className=甲
```

後端會先以學生 scope 解析每門課的分類，再套用 category 與其他搜尋條件。未指定
category 時維持 F7，只回傳本人班級及同年級合班；明確指定 `系外選修` 或 `通識`
才會跨出本人班級範圍。通識課以正式學年度規則、MySQL `Courses.dept` 的官方領域
名稱及官方跨院認抵表分類，不以 `catalogCourseCode` 前綴猜測。

課程搜尋會保留班級資格資訊。B～F 類（共同／通識、學院綜合班、英語與國際班、
學分學程及其他特殊班級）的正式適用對象尚未由校方確認，因此仍可被明確搜尋，
但回應為 `eligibility: "unknown"`，前端顯示「資格待確認」，不得解讀成確定可修。

Response:

```json
{
  "scope": {
    "department": "資訊工程學系",
    "grade": 3,
    "className": "甲"
  },
  "appliedFilters": {
    "department": "資訊工程學系",
    "grade": 3,
    "className": "甲",
    "category": "核心選修"
  },
  "courses": [
    {
      "id": 1,
      "sectionId": 1,
      "courseId": "CS101",
      "code": "CS101",
      "catalogCourseCode": "IECS2001",
      "name": "資料結構",
      "instructor": "王小明",
      "department": "資工系",
      "credits": 3,
      "dayOfWeek": 1,
      "startPeriod": 2,
      "endPeriod": 4,
      "location": "B101",
      "category": "核心選修",
      "sourceCategory": "選修",
      "classificationSource": "cs_curriculum",
      "classGroup": "A",
      "classKind": "department",
      "eligibility": "eligible",
      "eligibilityReason": "已辨識為 A 類系所班級；其他選修限制仍依既有候選規則判定。",
      "eligibilitySource": "department-required-table:elective-default",
      "term": { "academicYear": 114, "semester": "下學期", "isActiveTerm": true },
      "scopeReason": "一般選修，可搜尋與加選。",
      "track": "技術應用類"
    }
  ],
  "total": 1
}
```

分類欄位：

| 欄位 | 說明 |
| --- | --- |
| `category` | 後端依學生範圍解析後的分類，供搜尋、排課與 UI 使用 |
| `sourceCategory` | MySQL 原始 `Courses.type`（必修／選修） |
| `classificationSource` | `mysql`、`cs_curriculum` 或 `outside_department` |
| `track` | 資工科目表對應的修課路徑，沒有資料時為 `null` |
| `outsideElective` | 系外選修的認列檢查、原因、警告及系辦確認狀態 |
| `classGroup` | 班級分類 `A`～`F`；尚未收錄的名稱為 `null` |
| `classKind` | `department`、`commonCurriculum`、`collegeWide`、`englishProgram`、`internationalProgram`、`creditProgram`、`other` 或 `unclassified` |
| `eligibility` | `eligible`、`ineligible` 或 `unknown`；是班級適用資格，不等同畢業學分認列 |
| `eligibilityReason` | 可供 UI 與 Agent 直接呈現的資格判定理由 |
| `eligibilitySource`（Roadmap #20） | `eligibility` 結論套用的規則代號，見 `server/src/skills/courseScope.js` 的 `ELIGIBILITY_SOURCE`，供追查來源用，不是給人看的文字 |
| `term`（Roadmap #20） | `{ academicYear, semester, isActiveTerm }`，這門課自己的開課學年學期，以及是否為系統目前的 active term |
| `scopeReason`（Roadmap #20） | 融合 term／類別／eligibility／系外選修認列結果的完整白話說明，可直接呈現給使用者 |

**Active term（Roadmap #20）**：所有課程搜尋、排課與 Agent 查詢只回傳
`server/src/data/activeTerm.js` 定義的 `ACTIVE_TERM`（預設 114 學年下學期）內的
sections，非本學期候選不會出現在搜尋結果中；換學期時更新 `ACTIVE_ACADEMIC_YEAR`／
`ACTIVE_SEMESTER` 兩個環境變數即可，不需改程式碼（見 `docs/SCHEDULING_LOGIC.md`
「Active Term」一節）。

通識課另有下列欄位：

| 欄位 | 說明 |
| --- | --- |
| `generalEducationDomain` | 111 以前的舊領域、112～114 的四領域；115 起固定為 `null`（不分領域） |
| `generalEducationRuleVersion` | `through-111`、`112-114` 或 `from-115` |
| `generalEducationRecognitionType` | 通識中心直接開課為 `direct`；官方跨院認抵為 `cross_college` |
| `classificationReference` | 支撐該分類的逢甲大學官方來源網址 |

通識的 `classificationSource` 為 `general_education_department` 或
`general_education_recognition`。

### `GET /api/courses/departments`

Response:

```json
{
  "departments": []
}
```

### `GET /api/courses/classes`

某系所某年級實際存在的班別。必修不得換班（見 `docs/COURSE_SELECTION_RULES.md` 第八節），
學生需指定班別，此端點提供可選清單。

Query:

| 參數 | 必填 | 說明 |
| --- | --- | --- |
| `department` | 是 | 系所全名，例如 `資訊工程學系`。缺少時回 `400` |
| `grade` | 否 | 年級 1~4。省略時回傳該系所有年級的學士班班別 |

Response:

```json
{
  "classes": ["資訊三丁", "資訊三丙", "資訊三乙", "資訊三合", "資訊三甲"]
}
```

班別清單由課程資料現場推導（`Courses.dept` 經 `parseClassName()` 解析後篩選），
只回傳學士班。前端不得複製一份系所簡稱對照表——那份對照只有
`server/src/data/departmentMapping.js` 一份，複製就會各自漂移。

### `GET /api/courses/instructors`

Response:

```json
{
  "instructors": []
}
```

### `GET /api/courses/:id`

`id` is `Course_Sections.section_id`.

## Schedule

### `POST /api/schedule/generate`

Request:

```json
{
  "courseIds": [1, 2, 3],
  "filters": {},
  "constraints": {
    "minCredits": 15,
    "maxCredits": 22,
    "blockedPeriods": [],
    "noMorningClasses": false,
    "noEveningClasses": false,
    "mustTakeCourseIds": [7],
    "preferCompact": false,
    "preferredKeywords": ["網路", "資安"],
    "interests": [],
    "preferredTrack": null,
    "preferEasyCourses": false,
    "noMidterm": false,
    "noGroupReport": false,
    "discussion": false,
    "weightDaily": false,
    "practicalExam": false,
    "finalReport": false,
    "englishTaught": false,
    "learnMore": false,
    "allowRelaxation": false,
    "timePreferencePriority": [],
    "department": "資訊工程學系",
    "gradeLevel": 3,
    "className": "資訊三甲"
  },
  "surface": "dashboard",
  "trigger": "manual_generate"
}
```

`surface`（`dashboard`｜`schedule`｜`search`｜`chat`）與 `trigger`（`initial_load`｜
`manual_generate`｜`preference_regenerate`｜`chat_tool`｜`course_search`）標記這次排課
在哪個畫面、被什麼動作觸發，只用來寫入 `recommendation_exposed` 互動事件
（Roadmap #2），**不參與候選池或排課邏輯**。省略或值不在列舉清單中時，伺服器單純
不記錄這次曝光，不會因此讓排課失敗，也不會用猜的值頂替。Chat 路徑（`run_csp_scheduler`）
固定由伺服器帶入 `surface:"chat"`／`trigger:"chat_tool"`，不接受模型指定。

`department`、`gradeLevel`、`className` 決定必修範圍。`className` 為班別——
系上不接受必修換班，未提供時必修只收斂到系所與年級，並在 `warnings` 提醒。
三者未提供時會從使用者已儲存的 profile 帶入。系統自動建立候選池時，若 profile
缺少可解析班級，不會退回全校課程，而是回傳 `CLASS_NAME_REQUIRED`。前端不需要在
schedule request 重複傳班級；route 會先依 session identity 讀取 profile，再呼叫
`searchCoursesForSchedule()`。

`courseIds`、`selectedCourseIds`、`watchingCourseIds` 與 `mustTakeCourseIds` 使用 section id。

`completedCourseIds` 已於 2026-08-13 移除——已修排除改用穩定的 `courseHistory`
課號比對（`skills/scheduler.js` 呼叫 `data/courseHistory.js` 的
`getPassedCourseCodes()`），不接受 request 傳入任何形式的已修課清單，
一律以 MySQL `User_Course_History` 映射出的 `courseHistory` 為準。詳見「限制條件合併語意」。

`courseIds` 決定候選池，同時代表「使用者明確指定的課」。route 會把它併入
`explicitCourseIds` 傳給排課引擎；`selectedCourseIds`、`mustTakeCourseIds` 同樣視為明確指定。

`retakeCourseIds` 與 `failedRequiredCourseIds` 已移除。重補修不得由 client 或 Agent
手動指定；後端只依 Profile 的 `courseHistory`，對每個 `courseCode` 取最新
`academicYear + semester` 紀錄，自動找出 `passed: false` 且
`requirementType: "必修"` 的課，再映射到本學期相同 `catalogCourseCode` 的所有 sections。
優先序固定為「本學期必修 → 不及格必修重補修 → 其他課程」。本學期未開課時，
`warnings` 會提醒使用者下學期重修。

明確指定的課程**不會被系統的推論規則剔除**，一律排入並附警告：

| 規則 | 系統自撿的候選 | 明確指定 |
| --- | --- | --- |
| 系外選修不符認列條件 | 剔除，原因記入 `excludedCourses` | 排入，標記不計入畢業學分 |
| 他班／他系的必修 | 剔除，不進候選 | 排入，警告需自行向系辦確認 |
| B～F 類或未分類、`eligibility=unknown` | 保守排除，原因記入 `excludedCourses` | 保留並排入，警告「資格待確認」 |
| 非本學期開課（`term.isActiveTerm=false`，Roadmap #20） | 保守排除，原因記入 `excludedCourses` | 保留並排入，警告「非本學期開課」 |

理由：前三條都是「依系所、年級、班別**推論**」，不是校方的選課權限；非本學期一項
同樣可能因轉系、輔系、雙主修或加簽而修得到，處理原則一致。
見 `docs/SCHEDULING_LOGIC.md` 的「明確指定的課程豁免整批排除」與「Active Term」。

**注意**：`GET /api/courses` 課程搜尋沒有「明確指定」的概念（那是排課階段才有的
語意），非本學期候選一律直接過濾，不出現在搜尋結果中——見 `docs/SCHEDULING_LOGIC.md`
「Active Term」一節。

`preferredKeywords`、`interests`、`preferredTrack`、`preferCompact`、`preferEasyCourses` 為軟性偏好，用於計算各方案的偏好符合度並決定主推方案。未提供任何一項時，主推方案改以總學分決定。

`noMidterm`／`noGroupReport`／`discussion`／`weightDaily`／`practicalExam`／`finalReport`／
`englishTaught`／`learnMore` 這 8 個「內容偏好」（Roadmap #3）**同樣是軟性偏好，不會排除課程**：
判定依據是課程描述的關鍵字比對，命中會調整候選課的排序分數，未命中維持中性（不當成負面證據）。
候選池中某個已設定旗標的關鍵字命中率過低（<5%）或過高（>95%）時，`warnings` 會附上一條「訊號
可靠度」警告，說明這個偏好目前幾乎無法有效區分課程；未觸發門檻時不會有額外警告。詳見
`docs/SCHEDULING_LOGIC.md` 的「內容偏好評分與訊號可靠度警告」。

`allowRelaxation`／`timePreferencePriority`（Roadmap #21）：opt-in 放寬階梯的開關與順序，
預設 `allowRelaxation:false`（沒有任何現行呼叫端會設定，行為與改動前完全相同）。啟用後，
若方案的選修側因 `noMorningClasses`／`lunchBreakFree`／`noEveningClasses` 排掉太多候選、
導致湊不到學分下限，會依 `timePreferencePriority`（constraintId 陣列，例如
`["LUNCH_BREAK_FREE", "NO_MORNING_CLASSES", "NO_EVENING_CLASSES"]`；未提供時採用系統預設
順序）逐一放寬並重試，成功時回應會附上 `relaxedConstraints` 並在 `warnings` 揭露。這個機制
**獨立於**正式必修對這 3 項的無條件豁免——後者永遠生效，不需要這個旗標。`blockedPeriods`
永遠不會被這個機制放寬。詳見 `docs/SCHEDULING_LOGIC.md` 的「Hard/Soft Constraint Schema
（Roadmap #21）」。

Response 頂層額外回傳 `requestId`（本次排課請求的 UUID），每個 `plans[i]` 額外回傳
`planId`（格式 `requestId:variantId`）與 `variantId`（`required_first` 等產生策略）。
這是 Roadmap #2 的曝光事件用來指認「哪一次推薦的哪一個方案」的依據——先前只有
`plan.id`（variant 名稱），五個方案在不同次排課之間無法區分。識別碼由
`services/scheduleService.js` 的 `annotateScheduleIdentifiers()` 於請求層附加，
`skills/scheduler.js` 不參與；REST 與 Chat 兩條路徑共用同一份結果物件。
成功與失敗回應都帶識別碼。屬向後相容的欄位新增，既有欄位語意不變。

**成功時，伺服器會在回應之前自己寫入一筆 `recommendation_exposed` 互動事件**
（Roadmap #2 對抗式審查修正）——用的是伺服器剛算出來的 `schedule`／`excludedCourses`，
不是事後由 client 回報。這是唯一合法的曝光寫入點：`POST /api/interactions`
一律拒絕 client 提交這個事件類型，即使格式完全合法。寫入前會檢查
`personalization_learning` consent，未同意時單純不記錄，不影響排課回應；
寫入失敗同樣不影響排課回應（fail-open，比照評價查詢失敗的既有處理方式）。

Response 除既有欄位外，無解時額外回傳 `conflictSet`（結構化的限制違規清單，取代「只回傳
第一個錯誤字串」），格式為 `[{ constraintId, severity, relaxable, source, courses, reason }]`，
附加於 `message`／`warnings` 之外，不取代它們；透過放寬階梯成功時額外回傳
`relaxedConstraints: [{ constraintId, reason, order }]`。

Roadmap #22 的 bounded backtracking repair 會在主推 greedy baseline 未通過 validator，或所有
合法 baseline 都低於最低學分時啟動。預設總預算為 2 秒（包含決策組前處理），並回傳下列附加欄位：

| 欄位 | 語意 |
| --- | --- |
| `solver.status` | `solved`／`infeasible`／`timeout`／`data-insufficient`；`timeout` 不代表已證明無解 |
| `solver.repairAttempted` | 本次是否真的啟動 repair |
| `solver.resultSource` | 正式結果來自 `greedy`、`repair`，或沒有正式結果的 `none` |
| `solver.fallbackUsed` | repair 未完成時是否退回已經 validator 驗證的 greedy baseline |
| `solver.timeoutMs`／`elapsedMs` | repair 預算與實際耗時（毫秒） |
| `solver.nodesVisited`／`prunedNodes`／`seed` | 搜尋統計與可重現 seed |
| `solver.baseline` | repair 前主推 baseline 的成功、最低學分與偏好摘要；無 baseline 時為 `null` |
| `solver.improved` | 主推正式結果是否由 repair 取代 baseline |
| `solver.optimizationComplete` | 是否完整探索所有分支；找到第一個目標解時可能為 `false`，不表示結果未驗證 |
| `draftSchedule`／`draftUnscheduledCourses` | 沒有完整合法解時供澄清用的最佳部分組合；永遠不是正式成功課表 |
| `isDraft` | 是否存在上述草稿 |
| `unmetRequirements` | 未滿足項目，含 `type`、`courseIds`、`constraintIds`、`reason`、`adjustable` |
| `clarification` | `{ required, reason, questions, adjustableConstraintIds, relatedCourseIds }`，供 Chat 逐項追問 |

若 `success:false`，正式 `schedule` 與正式學分統計維持空／零；部分結果只能讀取
`draftSchedule`。若 repair timeout 但有通過 validator 的低學分 baseline，回應仍可
`success:true` 並以 `solver.fallbackUsed:true` 揭露，`unmetRequirements`／`clarification`
則保留最低學分缺口。沒有候選或指定必要課程 ID 不存在時使用 `data-insufficient`，不得誤報
`infeasible`。

### 限制條件合併語意

request 的 `constraints` 與使用者已儲存偏好由 `server/src/services/constraintService.js` 的 `buildScheduleConstraints()` 合併，REST 與 AI Agent 兩條路徑共用同一份邏輯。

- **陣列型參數**（`preferredKeywords`、`interests`、`blockedPeriods`、`mustTakeCourseIds`）：送空陣列 `[]` 視同**未指定**，會退回已儲存偏好。要覆蓋已儲存值必須送入非空陣列。此語意是為了避免前端每次都送出空陣列而靜默清空使用者的既有設定。
- **`courseHistory`**：不適用上述合併規則，**純直通、不接受 request 覆蓋**——`constraints.courseHistory` 一律等於 MySQL `User_Course_History` 載入的 `prefs.courseHistory`。查詢成功但 0 筆是合法空歷史；查詢失敗時 Profile、Schedule、Chat 與 Graduation 回 `503 COURSE_HISTORY_UNAVAILABLE`，不得以空陣列繼續。REST 與 AI Agent 都不能提交或覆蓋歷史修課。
- **`courseReviews`**（Roadmap #4）：與 `courseHistory` 同理，**純伺服器端注入、不接受 request 覆蓋**。`scheduleService.js` 從 `getAll('reviews')` 取得 `Course_Reviews` 全表後放進 `context`，request body 與 AI Agent 的 tool 參數都不含這個欄位——沒有任何管道能讓客戶端塞入捏造的評價分數。
- **布林型參數**：`false` 是有效值，會覆蓋已儲存偏好；只有 `null` 與 `undefined` 才會退回已儲存值。
- **`selectedCourseIds`、`watchingCourseIds`、`courseStates`**：屬於本次操作的當下狀態，不從已儲存偏好回填。
- **`mondayFree`**：會展開成週一第 1~14 節的 `blockedPeriods`，並與既有封鎖時段合併。
- **`blockedPeriods` 與 `noMorningClasses`**：兩者獨立判定、取聯集。`blockedPeriods`
  接受第 1～14 節（逐格指定星期），`noMorningClasses` 只影響第 1 節但涵蓋每一天。
  兩者可重疊，不互相推導：`blockedPeriods` 含第 1 節**不會**讓 `noMorningClasses`
  變成 `true`。（2026-08-11 前 `POST /api/profile` 會對含第 1 節的 `blockedPeriods`
  回 `400`，該限制已移除。）

Response:

```json
{
  "success": true,
  "schedule": [],
  "totalCredits": 18,
  "graduationCredits": 17,
  "nonGraduationCredits": 1,
  "courseCount": 6,
  "message": "...",
  "plans": [],
  "excludedCourses": [],
  "warnings": [],
  "watchedCourses": [],
  "unscheduledCourses": [],
  "watchOnly": false,
  "preferenceProfile": { "interest": 1, "compact": 0, "easy": 0 },
  "hasExpressedPreference": true,
  "reviewDataLoaded": true,
  "draftSchedule": [],
  "draftUnscheduledCourses": [],
  "isDraft": false,
  "unmetRequirements": [],
  "clarification": {
    "required": false,
    "reason": null,
    "questions": [],
    "adjustableConstraintIds": [],
    "relatedCourseIds": []
  },
  "solver": {
    "status": "solved",
    "repairAttempted": false,
    "resultSource": "greedy",
    "fallbackUsed": false,
    "timeoutMs": 2000,
    "elapsedMs": 0,
    "nodesVisited": 0,
    "prunedNodes": 0,
    "seed": 0,
    "baseline": {},
    "improved": false,
    "optimizationComplete": true
  }
}
```

`reviewDataLoaded`（Roadmap #4）表示這次排課是否取得了任何 `Course_Reviews` 資料。為 `false`
代表接線異常（呼叫端沒帶 `courseReviews` 或資料庫回空），不是「沒有評價可用所以正常忽略」——
此時所有課程的涼度一律以中性值計算，`warnings` 會明確告知。與成功與否無關，成功與失敗回應都會帶上。

`watchedCourses` 在成功與失敗回應中都會回傳。關注課程不佔時段、不計入衝堂，因此不會因為排課失敗而消失。

所有課程物件（課程搜尋與明細、排課結果、`excludedCourses`、`watchedCourses`、
`unscheduledCourses`、畢業建議及 AI Agent 工具結果）統一使用 `catalogCourseCode` 表示
正式課號。`subid3` 是 MySQL 欄位名，不再出現在 API 回應。這是欄位改名的 breaking
change；repository 外的呼叫端若曾讀取 `course.subid3`，必須改讀
`course.catalogCourseCode`。

`unscheduledCourses` 為已排入但**尚未排定上課時間**的課程（`time_str` 節次為 `00`）。它們計入 `totalCredits` 與 `courseCount`，但不在 `schedule` 內，因此不會出現在課表格上。

### 兩個學分數

`totalCredits` 是**學期修習學分**（用於 12～25 學分上下限），`graduationCredits` 是**計入畢業的學分**。
軍訓國防科技、體育、班級活動要排進課表但依校規不計入畢業學分
（見 `docs/COURSE_SELECTION_RULES.md` 第四節），兩者因此可能不同。

`schedule[]` 與 `unscheduledCourses[]` 的每個元素另含：

| 欄位 | 說明 |
| --- | --- |
| `countsTowardGraduation` | 此課學分是否計入畢業 |
| `nonGraduationCategory` | 不計入時的類別（`軍訓國防`／`體育`／`班級活動`／`系外選修未認列`），計入時為 `null` |
| `outsideElectiveRecognized` | 僅在使用者指定、但不符合系外選修認列條件時出現，值為 `false` |
| `outsideElectiveReasons` | 同上，不認列的原因清單 |
| `category` | **對這位學生解析後**的類別（`必修`／`核心選修`／`選修`／`通識`／`系外選修`） |
| `sourceCategory` | 資料庫原始的 `Courses.type`，僅在解析結果不同時出現 |
| `track` | 修課路徑（`嵌入式系統類`／`技術應用類`／`網路與安全類`），無歸類時為 `null` |
| `classGroup`／`classKind` | 班級 A～F 分組及結構化種類 |
| `eligibility`／`eligibilityReason` | 班級適用資格及可讀原因；`unknown` 不得宣稱確定可修 |
| `eligibilitySource`（Roadmap #20） | `eligibility` 結論套用的規則代號，供追查來源 |
| `term`（Roadmap #20） | `{ academicYear, semester, isActiveTerm }`，這門課自己的開課學期 |
| `scopeReason`（Roadmap #20） | 融合 term／類別／eligibility／系外選修認列結果的完整白話說明 |
| `easinessSource`（Roadmap #10） | 排序用涼度分數的來源：`reviews`（有實際評價）／`proxy`（無評價，依課程屬性推估）／`none`（兩者皆無）。**`proxy` 不是證據**——UI 與 Agent 只能說「依課程屬性推估」，不得說涼／好拿分。它也不會進入 `reviewCoverage` 或方案層 `preferenceBreakdown.easy`。詳見 `docs/SCHEDULING_LOGIC.md` 的「涼度來源」 |
| `reviewEvidence`（Roadmap #4） | 課程評價證據物件，`null` 代表這門課沒有評價，**不是** 0 分。有值時包含 `reviewCount`、`avgSweetness`／`avgCoolness`／`avgWorkload`／`avgOverall`／`avgDifficulty`／`avgRecommend`、`positiveCount`／`negativeCount`／`neutralCount`、`easiness`（1–5，未收縮）、`adjustedEasiness`（1–5，m-estimate 收縮後）、`easyScore`（0–100，排課實際採用）、`priorEasiness`、`shrinkagePriorWeight`、`source`。詳見 `docs/SCHEDULING_LOGIC.md` 的「涼度評分與評價覆蓋率」 |
| `formallyRequired`（Roadmap #21） | 布林，永遠存在（`true`／`false`）。`true` 代表這門課是這位學生本學期正式必修（`isRequiredForStudent()===true`），且排入時已無條件豁免 3 個時段類舒適偏好（不排早八／午休保留／不排晚課）；不含封鎖時段，也不含使用者手動指定的 `mustTakeCourseIds`。詳見 `docs/SCHEDULING_LOGIC.md` 的「Hard/Soft Constraint Schema（Roadmap #21）」 |
| `corequisiteCode`（Roadmap #15） | 字串或 `null`。有配對時為對應正課／實習的 `catalogCourseCode`；`null` 代表這門課沒有配對（含 P 後綴但候選池中找不到正課的例外情況） |
| `corequisiteRole`（Roadmap #15） | `'regular'`／`'internship'`／`null`。標示這門課在共同必修配對中的角色；`null` 代表不受共同必修規則影響。`excludedCourses`／`conflictSet` 可能出現 `constraintId: 'COREQUISITE_PAIR_INCOMPLETE'`，代表配對中的一方排不進去、兩者皆不排入。詳見 `docs/SCHEDULING_LOGIC.md` 的「共同必修（Co-requisite，Roadmap #15）」 |

`category` 與 `track` 的解析見 `docs/SCHEDULING_LOGIC.md` 的「課程類別解析」；`term`／
`eligibilitySource`／`scopeReason` 見同檔案的「Active Term」與「候選課程的可追溯
metadata」兩節。

`watchOnly` 為 `true` 時表示沒有任何正式加選課程排入，課表上只有關注課程。此情境的 `success` 仍為 `true`，因為關注課程本身是合法且可顯示的結果。

每個 `plans[]` 元素另含：

```json
{
  "preferenceScore": 0.214,
  "preferenceBreakdown": { "interest": 0.21, "compact": 0.25, "easy": 0.68 },
  "reviewCoverage": { "rated": 5, "total": 8, "ratio": 0.625 }
}
```

`plans` 依 `success` → 是否達最低學分 → `preferenceScore` → `totalCredits` 排序，`plans[0]` 即為主推方案，其內容會複製到頂層 `schedule`。

`preferenceBreakdown.easy`（Roadmap #4）改為由已排入且**有評價**課程的 `adjustedEasiness` 平均而得，
不再是課程描述關鍵字命中率。**可能為 `null`**——代表這個方案排入的課全部沒有評價，無法評分，
此時該軸連同權重一起從 `preferenceScore` 的加權平均中排除，不會以 0 分拉低分數。

`reviewCoverage`（Roadmap #4）說明 `preferenceBreakdown.easy` 是由幾門課推出來的：`rated` 為方案中帶
`reviewEvidence` 的課程數、`total` 為方案總課程數、`ratio` 為兩者比值。「涼度 68%」與「涼度 68%但只
由 1／8 門課推得」是完全不同的兩件事，只讀 `preferenceBreakdown.easy` 而不看 `reviewCoverage` 會誤判
可信度。

### `POST /api/schedule/validate`

Request:

```json
{
  "courses": [],
  "constraints": {}
}
```

`constraints` 為 Roadmap #21 新增的可選欄位，省略或傳空物件 `{}`（目前唯一的實際呼叫
模式——`client/src` 尚未呼叫這支端點）皆可。

Response（`valid`／`conflicts`／`duplicates`／`totalCredits`／`graduationCredits`／
`nonGraduationCredits` 為既有欄位，語意不變）：

```json
{
  "valid": true,
  "conflicts": [],
  "duplicates": [],
  "totalCredits": 18,
  "graduationCredits": 17,
  "nonGraduationCredits": 1,
  "hardConstraintsValid": true,
  "violations": [],
  "unchecked": ["PREREQUISITE", "COREQUISITE"]
}
```

`duplicates` 為同一門課的多個班次（以 `catalogCourseCode` 課號判定），例如兩門不同老師開的「計算機演算法」。學生只能選一個班次，因此即使時段不衝突也屬不合法，`valid` 為 `false`。`conflicts` 與 `duplicates` 的元素皆為 `{ course1, course2 }`。

**Roadmap #21，2026-08-20 起一律執行**（Codex adversarial review 修正——原本只在
`constraints` 非空時才額外檢查，導致只送 `{courses}` 的呼叫完全繞過了不需要
`constraints` 就能檢查的規則，例如共同必修配對完整性）：呼叫
`server/src/skills/scheduleValidator.js` 的 `validateScheduleAgainstConstraints()`，
附加 `hardConstraintsValid`／`violations`／`unchecked` 三個欄位（不取代上述既有欄位）：

```json
{
  "hardConstraintsValid": false,
  "violations": [
    { "constraintId": "CREDIT_CEILING", "severity": "hard", "relaxable": false,
      "source": "user:numeric-limit", "confidence": 1, "courses": [], "reason": "課表共 28 學分，超過上限 25 學分" }
  ],
  "unchecked": ["PREREQUISITE", "COREQUISITE"]
}
```

這個檢查涵蓋衝堂、重複班次、學分上限、資格／學期／系外選修／已修過的 metadata 複查、
4 個時段類硬性限制、必修涵蓋率、共同必修配對完整性（Roadmap #15），比既有的 `valid`
（只查衝堂與重複班次）範圍更完整。

`unchecked` 永遠包含 `PREREQUISITE`／`COREQUISITE`（先修／共修，見 Roadmap #21）——這
兩項專案裡完全沒有資料來源可查。**`COREQUISITE_PAIR_INCOMPLETE`（Roadmap #15）只在
送入的課程物件完全沒有任何一門帶 `corequisiteRole` 欄位時才會出現在 `unchecked`
裡**——這個欄位只由 `generateSchedule()` 產出的課表天生帶著；外部直接組出來、沒有這
個欄位的原始課程物件無法讓 validator 安全判斷哪些課「應該」有搭檔（`catalogCourseCode`
的 `P` 後綴規則有真實例外，見 `docs/DATA_SCHEMA.md`），因此**不會**用課號猜測配對關
係，寧可誠實回報未檢查，也不假裝檢查過而誤判合法課表。只要把 `generateSchedule()`
產出的課表（或至少保留其 `corequisiteRole`／`corequisiteCode` 欄位）原樣送回
`/validate`，這項規則就會確實執行。

此檢查**不套用**正式必修對時段偏好的無條件豁免（沒有 scope 可用）；只有課程物件已帶
`formallyRequired: true` 標記（來自 `generateSchedule()` 自己產出的課表）時才會豁免，
外部直接提供的課表一律照嚴格規則檢查。詳見 `docs/SCHEDULING_LOGIC.md` 的「Hard/Soft
Constraint Schema（Roadmap #21）」與「共同必修（Co-requisite，Roadmap #15）」。

### `POST /api/schedule/save`

Request:

```json
{
  "name": "我的課表",
  "schedule": [],
  "totalCredits": 18
}
```

Saved schedules remain local JSON data.

### `GET /api/schedule/saved`

Returns locally saved schedules for the session user.

## Chat

### `POST /api/chat`

Request:

```json
{
  "message": "幫我排課"
}
```

Response:

```json
{
  "reply": "...",
  "intent": "run_csp_scheduler",
  "data": {}
}
```

| 欄位 | 說明 |
| --- | --- |
| `reply` | 要顯示給使用者的文字。 |
| `intent` | 這次請求中**最後一個成功**的工具名稱；沒有任何工具成功時為 `general_chat`，呼叫模型本身失敗時為 `error`。 |
| `data` | 最後一個成功的**可渲染**工具結果（`query_course_db`、`search_dcard_reviews`、`run_csp_scheduler`、`get_easy_courses`），否則為 `null`。 |

**工具被拒絕時不會出現在 `intent` 或 `data` 裡。** Agent 的工具有伺服器端驗證
（例如 `record_schedule_feedback` 會對照推薦曝光紀錄），被拒時只回一個 `{ error }`
給模型自行修正。若這兩個欄位照樣帶上該工具名稱，等於對呼叫端宣稱一件沒有發生的事
——例如顯示「已記錄你的回饋」，但資料庫裡一筆都沒有。因此
`agentService.applyToolOutcome()` 只在工具成功時更新它們。

`data` 帶的是**完整、未經任何信封包裝的原始結果**——Roadmap #25 新增的
tool result 信封（`schemaVersion`／`dataSource`／`term`／`warnings`／`errorCode`）
**只包在送給模型的那一份**，不影響這個欄位。送進模型的是投影後再包信封的版本
（見 `docs/PROMPT_DESIGN.md` 的「排課結果必須先投影」與「工具結果信封」）。

## Profile

### `GET /api/profile`

從 session 的 canonical student ID 讀取 `User_Profiles`。Response 固定包含
`schemaVersion: 1`；資料庫 migration 尚未套用時，後端會把既有 v0 row 正規化成 v1 response。

回應保留完整 `className`，並由後端共用 `parseClassName()` 產生課程搜尋範圍：

```json
{
  "schemaVersion": 1,
  "studentId": "D1249697",
  "className": "資訊三甲",
  "courseSearchScope": {
    "department": "資訊工程學系",
    "grade": 3,
    "className": "甲"
  }
}
```

完整班級缺少或無法解析時，`courseSearchScope` 的三個欄位均為 `null`。

### `POST /api/profile`

只更新 session 使用者的 `User_Profiles` 支援欄位。request 不需也不應傳 `userId`。

`department` 若有帶，必須是**非空字串**（去除包裹引號與空白後仍有內容）。物件、陣列、數字、布林或空字串一律回 `400`：

```json
{
  "error": "department 必須是非空字串"
}
```

正規化不是型別轉換層：`{}` 會變成 `"[object Object]"`、`["資訊工程學系","電機工程學系"]` 會變成 `"資訊工程學系,電機工程學系"`，寫入後在資料庫與 API 回應中都像一般字串，但所有系所比對都會失敗。資料層另有一道防線，會丟棄型別錯誤的 `department` 而非寫入。

## Reviews

### `GET /api/reviews/easy?limit=10`

Returns courses ranked by derived easiness score from `Course_Reviews`.

排序依據（Roadmap #4）是 **`adjustedEasiness`**（m-estimate 收縮後的分數），**不是**
`easiness`（未收縮的原始加權平均）。兩者皆會回傳：

| 欄位 | 說明 |
| --- | --- |
| `easiness` | 未收縮，1–5 尺度。單一課程自己的評價原始算出來的分數，不管評論數多寡 |
| `adjustedEasiness` | 收縮後，1–5 尺度。排序實際採用；評論數少的課會被拉向母體平均 |
| `reviewCount` | 該課評論數（加權後，非資料列數） |

**這是一次行為變更**：舊版直接用 `easiness` 排序，樣本數少的課（例如剛好 4 則評論全 5 分）
會穩定壓過樣本數更多、更可信的課（例如 8 則評論平均 4.5 分）。改用 `adjustedEasiness` 後，
這份排行榜與排課引擎「涼課與高分優先」方案採用同一套邏輯（`courseReviewStats.js`），不會再
出現「涼課排行榜第一名沒被排進涼課方案」的不一致。

### `GET /api/reviews/:courseId`

`courseId` is `Course_Sections.section_id`.

Response:

```json
{
  "reviews": [],
  "sentiment": {
    "courseId": 1,
    "sentiment": "positive",
    "summary": "..."
  }
}
```

## Interactions

### `POST /api/interactions`

批次上報互動事件（Roadmap #2）。需要登入身分。

Request：

```json
{ "events": [ { "eventType": "course_withdrawn", "requestId": "...", "actionId": "...", "course": { "catalogCourseCode": "IECS3002", "sectionId": 101 }, "term": { "academicYear": 114, "semester": "下學期" }, "source": "explicit_selection", "feedbackReason": "time" } ] }
```

事件本體為 `InteractionEvent v1`（見 `docs/DATA_SCHEMA.md`）。`userId`、`eventId`、
`timestamp`、`schemaVersion`、`idempotencyKey` 與 `versionSnapshot` 的
`profileSchemaVersion`／`modelVersion` 一律由 server 產生，client 送同名欄位會被覆寫。
單次最多 50 筆。

**來源驗證（Roadmap #2 對抗式審查修正）**：

- `eventType: "recommendation_exposed"` **一律拒絕**，即使格式完全合法——這個事件類型
  只由伺服器在產生排課結果時自己寫入（見 `POST /api/schedule/generate`），不接受這支
  端點提交，回 `rejected` 並附錯誤訊息，不寫入。
- `eventType: "recommendation_accepted"`，以及 `source: "system_recommendation"` 的
  `course_withdrawn`，會對照這位使用者、這個 `requestId` 底下伺服器實際寫過的曝光紀錄：
  接受的 `plan.planId` 必須是當時真的顯示過的方案，退選的 `course.sectionId` 必須出現在
  當時曝光的 `displayedSet` 裡。對不上（含 `requestId` 查無曝光紀錄）一律回 `rejected`。
  格式驗證只證明「像一個事件」，不證明「這件事真的發生過」——這個檢查固定在
  `recordInteractionEvents()` 本身，任何呼叫端都繞不過去，不只是 Agent tool 那條路徑。
- 其餘 event type（`course_viewed`／`course_favorited`／`course_selected` 等）沒有可對照的
  伺服器端事實可驗證，維持格式驗證即可寫入。

Response：

```json
{ "recorded": 2, "results": [ { "actionId": "...", "eventType": "course_withdrawn", "status": "append" } ] }
```

`status` 為 `append`｜`duplicate`｜`conflict`｜`rejected`（`rejected` 另帶 `errors`）。

**未同意 `personalization_learning` 時回 `200 { "recorded": false, "reason": "CONSENT_NOT_GRANTED" }`，
不是 `428`。** 這是可選用途，預設關閉是完全合法的狀態，回 428 等於把使用者推到同意牆前面。
此時**一列都不會寫入**，滿足 #33 的驗收標準。詳見 `docs/DECISIONS.md` ADR-018。

| 狀態碼 | 情境 |
| --- | --- |
| 200 | 已處理（含未同意而未記錄） |
| 400 | `events` 不是陣列或超過 50 筆 |
| 401 | 未登入 |
| 403 | 嘗試操作其他使用者的資料 |
| 429 | 節流（`RATE_LIMITED`，每分鐘超過 20 次）或每日事件量配額（`DAILY_QUOTA_EXCEEDED`，24 小時內超過 2000 筆） |
| 500 | 儲存體暫時無法使用 |

呼叫端必須把這支端點視為**旁路**：失敗時不得影響加選、移除、排課或聊天。
前端 `client/src/services/interactionLog.js` 一律 fire-and-forget 並吞掉錯誤，
`logInteraction()` 回傳的 promise 永不 reject，只在結果裡帶真實狀態
（確認列會依此決定文案，不會謊報「已記錄」）。

## Graduation

### `GET /api/graduation/me`

Uses the authenticated session identity. Legacy `/api/graduation/:studentId` 暫時保留，
但 path student ID 必須與 session 相同，否則回傳 `403`。

畢業學分要求**依 `program + degree + admissionYear` 解析版本化規則**
（`server/src/data/graduationRuleVersions.js` 的 `resolveGraduationRule()`），沒有全校通用的
預設值（總學分有 128／130／131／134／156 五種）。

Response:

```json
{
  "courseHistoryAvailable": true,
  "courseHistoryMessage": null,
  "totalRequired": 128,
  "totalEarned": 118,
  "required": { "required": 63, "elective": 28, "general": 28, "external": 9, "unspecified": 0 },
  "earned": { "required": 61, "elective": 22, "general": 24, "external": 11, "unspecified": 0 },
  "gaps": { "required": 2, "elective": 6, "general": 4, "external": 0, "unspecified": 0 },
  "attribution": {
    "required": {
      "credits": 61,
      "courses": [
        {
          "courseCode": "IECS1005", "courseName": "計算機概論", "credits": 2,
          "academicYear": 112, "semester": 1, "requirementType": "必修",
          "ruleVersion": "114",
          "ruleSource": "https://registration.fcu.edu.tw/news/...",
          "needsVerification": false,
          "attributionSource": "course_history_category"
        }
      ]
    }
  },
  "admissionYear": 112,
  "ruleVersion": "114",
  "ruleSource": "https://registration.fcu.edu.tw/news/...",
  "ruleCoverage": { "from": 114, "to": null },
  "appliedFallbackVersion": true,
  "warnings": ["目前只有 114 學年度必選修科目表，112 學年度入學適用的版本尚未取得，已套用 114 學年度規則；此結果僅供參考。"],
  "recommendations": [
    {
      "type": "suggestion",
      "title": "補足本系選修",
      "message": "行動應用程式開發（3 學分）可計入本系選修，目前尚缺 6 學分。",
      "course": { "id": 1295, "name": "行動應用程式開發", "credits": 3 },
      "fillsGap": "elective",
      "gapLabel": "本系選修",
      "gapBefore": 6,
      "credits": 3,
      "ruleVersion": "114",
      "ruleSource": "https://registration.fcu.edu.tw/news/..."
    }
  ],
  "watchlist": [],
  "skillTree": [],
  "overallScore": 80,
  "overallScoreMax": 100
}
```

| 欄位 | 說明 |
| --- | --- |
| `courseHistoryAvailable` | 是否已有可供計算畢業進度的歷史修課資料；必須同時具備總學分及分類學分彙總，只有課程 ID／名稱清單仍視為不足 |
| `courseHistoryMessage` | 缺少歷史修課資料時的使用者提示；資料可用時為 `null` |
| `required` | 該系所的畢業學分要求。`general` 為通識基礎與通識選修之和，`unspecified` 為未列明學分（通常是自由選修） |
| `earned` | 使用者已修學分，key 與 `required` 一致 |
| `gaps` | 每類的缺口，不會小於 0 |
| `attribution` | **逐門認列追溯**（roadmap #23）：每個分類列出湊出這些學分的課程，各帶課號、課名、學分、修課學年度／學期、規則版本、規則出處、是否待人工複核與認列來源。各分類的 `credits` **恆等於** `earned` 的對應值（與 `getEarnedCredits()` 共用同一組篩選，由 G10 測試釘住）。`courseHistoryAvailable` 為 `false` 時為 `null` |
| `admissionYear` | 學生入學學年度（民國）。來自 `User_Profiles.admission_year`，未知時為 `null`，**不從年級推導** |
| `generalEducation` | **通識拆成基礎必修／選修兩個缺口**（roadmap #23）。`gaps.general` 維持總數不變（向後相容），這裡是額外細分——先前系統只知道「通識共缺 N」，不知道缺在哪一邊。含 `basic`／`elective`（各有 `earned`／`required`／`gap`）、`ruleVersion`／`ruleSource`、`coreRequired`（要求／已完成／未完成的課號）、`disagreements`（兩個判定來源不一致、需人工確認的課）、`unverifiableRules`（有官方出處但目前無資料可執行的規則及其阻塞原因）、`notes`。`courseHistoryAvailable` 為 `false` 時為 `null` |
| `recommendations[].needsEligibilityConfirmation` | 這門課的正式適用對象尚未確認（目前只有通識會是 `true`）。`message` 裡也會明講，前端不得只靠旗標 |
| `ruleVersion`／`ruleSource`／`ruleCoverage` | 這次實際套用的畢業規則版本、官方出處與該版本涵蓋的入學年度範圍 |
| `appliedFallbackVersion` | 是否因為該入學年度沒有對應版本而退回最新一版。為 `true` 時 `warnings` 會含說明——**目前只有 114 學年度一版真實資料**，因此 112／113 入學生一律為 `true` |
| `warnings` | 查不到系所對照、該系資料標記為待人工複核、或規則版本退回時的說明。**查無對照時不會用臆測的數字填補** |
| `recommendations[].fillsGap` | 這門課會補到哪一類缺口（`required`／`elective`／`general`／`external`）。**每筆推薦都已驗證該分類的 `gaps` 大於 0**；補不了任何缺口的課（例如 0 學分的班級活動、體育、國防科技）不會出現 |
| `recommendations[].gapLabel`／`gapBefore` | 缺口的中文標籤與推薦前的缺口學分數，供前端直接顯示 |

**補學分推薦的候選範圍**：本人班級課程 ＋ 通識 ＋ 系外選修的聯集，三者皆由
`courseQuery.js` 的 `filterCategorizedCourses()` 取得（與搜尋、排課、Agent 同一套班級規則）。
先前只撈本系開的課，因此 `general`／`external` 缺口實務上永遠推不出東西。

**判定順序**：排除已修過並通過的課 → 排除不計入畢業學分的課
（`countsTowardGraduation()`）→ 排除 `ineligible`；`unknown` 一律排除，
**唯一例外是通識**（官方明載四大領域「不是班級，適用全校學生」，見
`docs/COURSE_SELECTION_RULES.md`），放行時標記 `needsEligibilityConfirmation` 並在
`message` 講明 → 對映到缺口分類 → 只留該分類缺口大於 0 者 → 排序（缺口大者優先 →
學分高者優先 → 課號）→ 同一 `catalogCourseCode` 只留一筆 → **每個有缺口的分類各先取
一門，再用剩餘名額輪流補**，總共 3 筆。

最後那條是必要的：單純取前 3 名會讓最大的缺口吃光名額（實測本系選修缺 6、通識缺 4 時，
三個名額全被本系選修佔滿），缺通識的使用者永遠看不到通識建議。所有缺口都補滿或
`gaps` 為 `null` 時回傳空陣列，不硬推一門。

**查不到系所對照表**（`getGraduationRequirement()` 回傳 `null`）時，`required`、
`totalRequired`、`gaps` 皆為 `null`，`warnings` 固定含 `此系所不存在，請檢查是否輸入錯誤`。
2026-08-13 前這裡會退回 `users.json` 上使用者自帶的 `requiredCredits`／`totalRequired`
（那正是必修60／選修40／通識20／系外8這批沒有出處的捏造數字混進畫面的路徑），
該後備已移除——查不到就是查不到，不再猜。此情境與 `courseHistoryAvailable`
互相獨立：即使已修學分正常顯示，系所對照查不到時 `required`／`totalRequired`／`gaps`
仍為 `null`。

當 `courseHistoryAvailable` 為 `false` 時，`totalEarned`、`earned` 與 `gaps` 均為 `null`，前端不得將缺少資料解讀為已修 0 學分或據此顯示學分缺口與補課建議。

## Error Response

```json
{
  "error": "錯誤訊息"
}
```
