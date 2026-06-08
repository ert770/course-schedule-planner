# API 規格

Base URL:

```text
http://localhost:3001/api
```

所有 request / response 預設使用 JSON。

## Health

### `GET /api/health`

回傳後端狀態。

Response:

```json
{
  "status": "ok",
  "timestamp": "2026-06-08T00:00:00.000Z"
}
```

## Auth

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

取得使用者資料。

### `POST /api/auth/update-watchlist`

Request:

```json
{
  "studentId": "D1249196",
  "watchlist": [1, 2, 3]
}
```

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
  "courses": [],
  "total": 0
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

取得課程詳情與評價統計。

## Schedule

### `POST /api/schedule/generate`

Request:

```json
{
  "userId": "D1249196",
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

Response:

```json
{
  "success": true,
  "schedule": [],
  "totalCredits": 18,
  "courseCount": 6,
  "message": "..."
}
```

Future response should also include:

```json
{
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
  "userId": "D1249196",
  "name": "我的課表",
  "schedule": [],
  "totalCredits": 18
}
```

### `GET /api/schedule/saved?userId={userId}`

取得已儲存課表。

## Chat

### `POST /api/chat`

Request:

```json
{
  "userId": "D1249196",
  "message": "幫我排一個不要早八的課表"
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

取得使用者偏好。

### `POST /api/profile`

更新使用者偏好。

## Reviews

### `GET /api/reviews/easy?limit=10`

取得涼課/高推薦課程。

### `GET /api/reviews/:courseId`

取得課程評價與情緒統計。

## Graduation

### `GET /api/graduation/:studentId`

取得畢業學分狀態、缺口與推薦。

## Error Response

錯誤格式：

```json
{
  "error": "錯誤訊息"
}
```

