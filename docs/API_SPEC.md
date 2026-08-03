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

- `keyword`
- `department`
- `category`
- `dayOfWeek`
- `credits`
- `instructor`
- `code`
- `period`
- `language`

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
    "preferEasyCourses": false
  }
}
```

`courseIds`, `selectedCourseIds`, `watchingCourseIds`, `completedCourseIds`, and `retakeCourseIds` should use section ids.

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
  "totalCredits": 18
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

## Error Response

```json
{
  "error": "錯誤訊息"
}
```
