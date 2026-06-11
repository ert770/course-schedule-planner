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
- Review lookups use `Courses_Reviews.Course_id` as a section id.
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
    "mustTakeCourseIds": [],
    "preferCompact": false
  }
}
```

`courseIds`, `selectedCourseIds`, `watchingCourseIds`, `completedCourseIds`, and `retakeCourseIds` should use section ids.

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
  "warnings": []
}
```

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
  "totalCredits": 18
}
```

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

## Reviews

### `GET /api/reviews/easy?limit=10`

Returns courses ranked by derived easiness score from `Courses_Reviews`.

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
