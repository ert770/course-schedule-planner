# Data Schema

目前後端主要課程資料來源為 MySQL database `defaultdb`。`server/data/*.json` 仍保留給 demo 登入、聊天紀錄、已儲存課表，以及沒有對應 MySQL 表的本機資料。

## MySQL Tables

SQL 查詢必須使用真實表名與欄位名稱，並用反引號包住大小寫或特殊字元欄位。

### `Courses`

| Column | Type | API mapping |
| --- | --- | --- |
| `course_id` | varchar(45) | `course.courseId`, `course.code` |
| `name` | varchar(45) | `course.name` |
| `credits` | decimal(3,1) | `course.credits` |
| `type` | varchar(45) | `course.category`, `course.type` |
| `dept` | varchar(45) | `course.department` |
| `subid3` | varchar(45) | `course.subid3` |

### `Course_Sections`

每一筆 section 會被後端視為一門可排課項目。

| Column | Type | API mapping |
| --- | --- | --- |
| `section_id` | int | `course.id`, `course.sectionId` |
| `course_id` | varchar(45) | join `Courses.course_id` |
| `teacher` | varchar(45) | `course.instructor`, `course.teacher` |
| `room` | varchar(45) | `course.location`, `course.room` |
| `time_str` | text | `course.timeStr` and parsed schedule time |
| `time_bitmask` | varchar(64) | `course.timeBitmask` and fallback parsed schedule time |
| `year` | int | `course.year` |
| `semester` | varchar(45) | `course.semester` |
| `current_amount` | int | `course.currentAmount` |
| `rag_context` | text | `course.description`, `course.syllabus` |
| `rag_tag` | json | `course.ragTag` |
| `selection_code` | varchar(4) | `course.selectionCode` |

### `Courses_Reviews`

注意：`Courses_Reviews.Course_id` 雖然名稱叫 `Course_id`，實際上外鍵連到 `Course_Sections.section_id`。

| Column | Type | API mapping |
| --- | --- | --- |
| `Reviews_id` | int | `review.id` |
| `Course_id` | int | `review.courseId` as section id |
| `Reviews_tags(GoodOrBad)` | varchar(45) | `review.keywords[0]`, sentiment source |
| `Review_content` | varchar(45) | `review.summary` |

查詢特殊欄位時必須使用：

```sql
`Reviews_tags(GoodOrBad)`
```

### `User_Profiles`

| Column | Type | API mapping |
| --- | --- | --- |
| `user_id` | int | `profile.userId` |
| `department` | varchar(45) | `profile.department` |
| `grade_level` | int | `profile.gradeLevel` |
| `preference_tags` | json | `profile.preferenceTags`, `profile.preferredCategories` |
| `avoid_time` | json | `profile.blockedPeriods` |
| `completed_courses` | json | `profile.completedCourseIds` |
| `max_credits` | int | `profile.targetCreditsMax` |

## Local JSON Collections

The following collections remain file-backed in `server/data/*.json` because the provided MySQL schema does not include equivalent tables:

- `users`
- `chat_history`
- `saved_schedules`
- non-numeric or demo `user_preferences`

## API Course Shape

`GET /api/courses` returns section-level course objects:

```json
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
```

排課、課程詳情與評價 API 都使用 `sectionId` 作為路由與 request body 中的課程識別值。
