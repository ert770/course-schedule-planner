# 2026-06-11 MySQL Database Access

## 修改日期

2026-06-11

## 修改檔案清單

- `.env.example`
- `docs/API_SPEC.md`
- `docs/ARCHITECTURE.md`
- `docs/DATA_SCHEMA.md`
- `docs/DECISIONS.md`
- `server/package.json`
- `server/package-lock.json`
- `server/src/app.js`
- `server/src/db/database.js`
- `server/src/db/mysql.js`
- `server/src/db/seed.js`
- `server/src/routes/auth.js`
- `server/src/routes/courses.js`
- `server/src/routes/graduation.js`
- `server/src/routes/profile.js`
- `server/src/routes/reviews.js`
- `server/src/routes/schedule.js`
- `server/src/services/agentService.js`
- `server/src/services/memoryService.js`
- `server/src/skills/courseQuery.js`
- `server/src/skills/reviewSearch.js`

## 主要改動內容

- 新增 `mysql2` dependency。
- 新增 MySQL connection pool，支援 `DB_HOST`、`DB_PORT`、`DB_USER`、`DB_PASSWORD`、`DB_NAME`、`DB_SSL_CA_PATH`。
- 將 `Courses` + `Course_Sections` 映射成既有 API course shape。
- 將 `course.id` 定義為 `Course_Sections.section_id`，`course.code` / `course.courseId` 定義為 `Courses.course_id`。
- 將 `Courses_Reviews.Course_id` 視為 section id，並用反引號查詢 `` `Reviews_tags(GoodOrBad)` ``。
- 將課程、評價、profile、排課、Agent tool call 相關呼叫改成 async/await。
- `User_Profiles` 支援 numeric `userId` 的 profile 讀取與部分欄位更新。
- 保留 demo auth、chat history、saved schedules 使用本機 JSON。
- 更新資料結構、API、架構與決策文件。

## 影響範圍

- `/api/courses`
- `/api/courses/departments`
- `/api/courses/instructors`
- `/api/courses/:id`
- `/api/reviews/easy`
- `/api/reviews/:courseId`
- `/api/profile`
- `/api/schedule/generate`
- `/api/chat` 中的課程查詢、評價查詢與排課工具
- `/api/graduation/:studentId`

## 測試與驗證結果

- `node --check` for all `server/src/**/*.js`：通過。
- `cd client && npm run build`：通過。
- MySQL course smoke test：通過，讀到 3560 筆 section-level courses。
- MySQL first course sample：`id=1`、`code=AS00100-00739`、`name=虛擬實境建築空間創新應用`。
- MySQL profile smoke test：通過，`userId=1` 可讀到 `User_Profiles`。
- MySQL review smoke test：SQL 查詢通過，目前 `Courses_Reviews` 回傳 0 筆資料，因此 `/api/reviews/easy` 目前會回傳空陣列。

## 是否 commit 與 push

- 未 commit。
- 未 push。
