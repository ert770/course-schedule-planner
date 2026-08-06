# API Spec

Base URL:

```text
http://localhost:3001/api
```

All request and response bodies are JSON.

## Data Source

Course, section, review, and numeric user profile data are read from MySQL database `defaultdb`.

- API `course.id` is `Course_Sections.section_id`.
- API `course.code` and `course.courseId` are `Courses.course_id`.
- Review lookups use `Course_Reviews.selection_code` joined to `Course_Sections.selection_code`; API responses expose the joined `section_id` as `review.courseId`.
- Demo auth users, chat history, and saved schedules remain backed by `server/data/*.json`.

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

### `GET /api/auth/me?studentId={studentId}`

Returns the local demo user profile without password.

### `POST /api/auth/update-watchlist`

Request:

```json
{
  "studentId": "D1249196",
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
- `category`
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

Response:

```json
{
  "courses": [
    {
      "id": 1,
      "sectionId": 1,
      "courseId": "CS101",
      "code": "CS101",
      "name": "資料結構",
      "instructor": "王小明",
      "department": "資工系",
      "credits": 3,
      "dayOfWeek": 1,
      "startPeriod": 2,
      "endPeriod": 4,
      "location": "B101",
      "category": "必修",
      "timeStr": "星期一 2-4"
    }
  ],
  "total": 1
}
```

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
  "userId": "1",
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
    "department": "資訊工程學系",
    "gradeLevel": 3,
    "className": "資訊三甲"
  }
}
```

`department`、`gradeLevel`、`className` 決定必修範圍。`className` 為班別——
系上不接受必修換班，未提供時必修只收斂到系所與年級，並在 `warnings` 提醒。
三者未提供時會從使用者已儲存的 profile 帶入。

`courseIds`, `selectedCourseIds`, `watchingCourseIds`, `completedCourseIds`, and `retakeCourseIds` should use section ids.

`courseIds` 決定候選池，同時代表「使用者明確指定的課」。route 會把它併入
`explicitCourseIds` 傳給排課引擎；`selectedCourseIds`、`mustTakeCourseIds`、
`retakeCourseIds` 同樣視為明確指定。

明確指定的課程**不會被系統的推論規則剔除**，一律排入並附警告：

| 規則 | 系統自撿的候選 | 明確指定 |
| --- | --- | --- |
| 系外選修不符認列條件 | 剔除，原因記入 `excludedCourses` | 排入，標記不計入畢業學分 |
| 他班／他系的必修 | 剔除，不進候選 | 排入，警告需自行向系辦確認 |

理由：這兩條都是「依系所、年級、班別**推論**」，不是校方的選課權限。
見 `docs/SCHEDULING_LOGIC.md` 的「明確指定的課程豁免整批排除」。

`preferredKeywords`、`interests`、`preferredTrack`、`preferCompact`、`preferEasyCourses` 為軟性偏好，用於計算各方案的偏好符合度並決定主推方案。未提供任何一項時，主推方案改以總學分決定。

### 限制條件合併語意

request 的 `constraints` 與使用者已儲存偏好由 `server/src/services/constraintService.js` 的 `buildScheduleConstraints()` 合併，REST 與 AI Agent 兩條路徑共用同一份邏輯。

- **陣列型參數**（`preferredKeywords`、`interests`、`blockedPeriods`、`mustTakeCourseIds`、`completedCourseIds`、`retakeCourseIds`）：送空陣列 `[]` 視同**未指定**，會退回已儲存偏好。要覆蓋已儲存值必須送入非空陣列。此語意是為了避免前端每次都送出空陣列而靜默清空使用者的既有設定。
- **布林型參數**：`false` 是有效值，會覆蓋已儲存偏好；只有 `null` 與 `undefined` 才會退回已儲存值。
- **`selectedCourseIds`、`watchingCourseIds`、`courseStates`**：屬於本次操作的當下狀態，不從已儲存偏好回填。
- **`mondayFree`**：會展開成週一第 1~14 節的 `blockedPeriods`，並與既有封鎖時段合併。

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
  "hasExpressedPreference": true
}
```

`watchedCourses` 在成功與失敗回應中都會回傳。關注課程不佔時段、不計入衝堂，因此不會因為排課失敗而消失。

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
| `category` | **對這位學生解析後**的類別（`必修`／`核心選修`／`選修`／`系外選修`） |
| `sourceCategory` | 資料庫原始的 `Courses.type`，僅在解析結果不同時出現 |
| `track` | 修課路徑（`嵌入式系統類`／`技術應用類`／`網路與安全類`），無歸類時為 `null` |

`category` 與 `track` 的解析見 `docs/SCHEDULING_LOGIC.md` 的「課程類別解析」。

`watchOnly` 為 `true` 時表示沒有任何正式加選課程排入，課表上只有關注課程。此情境的 `success` 仍為 `true`，因為關注課程本身是合法且可顯示的結果。

每個 `plans[]` 元素另含：

```json
{
  "preferenceScore": 0.214,
  "preferenceBreakdown": { "interest": 0.21, "compact": 0.25, "easy": 0 }
}
```

`plans` 依 `success` → 是否達最低學分 → `preferenceScore` → `totalCredits` 排序，`plans[0]` 即為主推方案，其內容會複製到頂層 `schedule`。

### `POST /api/schedule/validate`

Request:

```json
{
  "courses": []
}
```

Response:

```json
{
  "valid": true,
  "conflicts": [],
  "duplicates": [],
  "totalCredits": 18,
  "graduationCredits": 17,
  "nonGraduationCredits": 1
}
```

`duplicates` 為同一門課的多個班次（以 `subid3` 課號判定），例如兩門不同老師開的「計算機演算法」。學生只能選一個班次，因此即使時段不衝突也屬不合法，`valid` 為 `false`。`conflicts` 與 `duplicates` 的元素皆為 `{ course1, course2 }`。

### `POST /api/schedule/save`

Request:

```json
{
  "userId": "1",
  "name": "我的課表",
  "schedule": [],
  "totalCredits": 18
}
```

Saved schedules remain local JSON data.

### `GET /api/schedule/saved?userId={userId}`

Returns locally saved schedules for the user.

## Chat

### `POST /api/chat`

Request:

```json
{
  "userId": "1",
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

## Profile

### `GET /api/profile?userId={userId}`

For numeric `userId`, reads `User_Profiles.user_id` from MySQL when present.

回應保留完整 `className`，並由後端共用 `parseClassName()` 產生課程搜尋範圍：

```json
{
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

For numeric `userId`, updates supported `User_Profiles` fields when the row exists. Demo or non-numeric users are saved to local JSON.

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

## Graduation

### `GET /api/graduation/:studentId`

Uses local demo users when available, otherwise uses numeric MySQL `User_Profiles.user_id` for basic profile data.

畢業學分要求**依學生系所查 `server/src/data/graduationRequirements.js`**，沒有全校通用的預設值（總學分有 128／130／131／134／156 五種）。

Response:

```json
{
  "courseHistoryAvailable": true,
  "courseHistoryMessage": null,
  "totalRequired": 128,
  "totalEarned": 107,
  "required": { "required": 63, "elective": 28, "general": 28, "external": 9, "unspecified": 0 },
  "earned": { "required": 50, "elective": 31, "general": 16, "external": 10 },
  "gaps": { "required": 13, "elective": 0, "general": 12, "external": 0, "unspecified": 0 },
  "warnings": [],
  "recommendations": [],
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
| `warnings` | 查不到系所對照、或該系資料標記為待人工複核時的說明。**查無對照時不會用臆測的數字填補** |

`totalRequired` 在查不到系所對照且使用者資料也沒有時為 `null`。

當 `courseHistoryAvailable` 為 `false` 時，`totalEarned`、`earned` 與 `gaps` 均為 `null`，前端不得將缺少資料解讀為已修 0 學分或據此顯示學分缺口與補課建議。

## Error Response

```json
{
  "error": "錯誤訊息"
}
```
