# Data Schema

目前後端主要課程資料來源為 MySQL database `defaultdb`。`server/data/*.json` 仍保留給 demo 登入、聊天紀錄、已儲存課表，以及沒有對應 MySQL 表的本機資料。

## 未設定 `DB_*` 時的行為

`courses` 與 `reviews` **只存在於 MySQL**——種子資料已於 2026-08-02 移除，
`server/data/` 沒有對應的 JSON 檔。未設定 `DB_HOST` / `DB_USER` / `DB_NAME` 時，
`database.js` 會**丟出明確錯誤**，而不是回傳空陣列。

先前的行為是靜默回傳 `[]`（檔案根本不存在），排課因此回報「找不到符合條件的候選課程」
——看起來像篩選條件太嚴，實際上是資料庫沒接上。這是最難查的一種失敗。

`user_preferences` 不在此限：它有合法的本機 demo 資料，未接資料庫時仍可運作。

## MySQL Tables

SQL 查詢必須使用真實表名與欄位名稱，並用反引號包住大小寫或特殊字元欄位。

### `Courses`

| Column | Type | API mapping |
| --- | --- | --- |
| `course_id` | varchar(45) | `course.courseId`, `course.code` |
| `name` | varchar(45) | `course.name` |
| `credits` | decimal(3,1) | `course.credits` |
| `type` | varchar(45) | `course.category`, `course.type`（見「必修的意義」） |
| `dept` | varchar(45) | `course.department`，實際存的是**班級名稱**（見 `docs/DEPARTMENT_MAPPING.md`） |
| `subid3` | varchar(45) | `course.subid3`，**真正的課號**（見下方說明） |

#### `course_id` 不是課程識別碼，`subid3` 才是

`course_id` 是「班級 + 課程」的組合，同一門課在不同班級有不同的 `course_id`：

| `course_id` | `subid3` | 課名 | 班級 | 教師 |
| --- | --- | --- | --- | --- |
| `CE07131-28010` | `IECS3002` | 計算機演算法 | 資訊三甲 | 許芳榮 |
| `CE07132-28010` | `IECS3002` | 計算機演算法 | 資訊三乙 | 黃秀芬 |
| `CE07133-28010` | `IECS3002` | 計算機演算法 | 資訊三丙 | 黃秀芬 |
| `CE07134-28010` | `IECS3002` | 計算機演算法 | 資訊三丁 | 許懷中 |

**判斷「是否為同一門課」必須用 `subid3`。** 一門課可能由不同老師開在不同班次，學生只能選一個；用 `course_id` 或 `section_id` 比對會讓同一門課的多個班次同時排進課表。

`subid3` 的 `P` 後綴代表實習（`MATH1005P` 對應正課 `MATH1005`），兩者是不同課號、本來就該一起修（路線圖 `#15`）。

#### 必修的意義

`type = '必修'` 是「**某個班級**的必修」，不是「**這位學生**的必修」。全校 2094 筆必修 section 分屬不同系所與年級，判定方式見 `docs/SCHEDULING_LOGIC.md` 的「必修範圍」。

### `Course_Sections`

每一筆 section 會被後端視為一門可排課項目。

| Column | Type | API mapping |
| --- | --- | --- |
| `section_id` | int | `course.id`, `course.sectionId` |
| `course_id` | varchar(45) | join `Courses.course_id` |
| `teacher` | varchar(45) | `course.instructor`, `course.teacher` |
| `room` | varchar(45) | `course.location`, `course.room` |
| `time_str` | text | `course.timeStr`、`course.timeBlocks`，以及 `dayOfWeek` / `startPeriod` / `endPeriod` |
| `time_bitmask` | varchar(64) | `course.timeBitmask`，僅在 `time_str` 無法解析時作為後備 |
| `year` | int | `course.year` |
| `semester` | varchar(45) | `course.semester` |
| `current_amount` | int | `course.currentAmount` |
| `rag_context` | text | `course.description`, `course.syllabus` |
| `rag_tag` | json | `course.ragTag` |
| `selection_code` | varchar(4) | `course.selectionCode` |

### `Course_Reviews`

課程評價存放於 `Course_Reviews`，並透過 `selection_code` 對應到 `Course_Sections.selection_code`。
API 回傳的 `review.courseId` 是 join 後的 `Course_Sections.section_id`，不是課程主檔的 `Courses.course_id`。

| Column | Type | API mapping |
| --- | --- | --- |
| `Reviews_id` | int | `review.id` |
| `selection_code` | varchar(4) | `review.selectionCode`, join `Course_Sections.selection_code` |
| `Reviews_tags` | text | `review.keywords[]` |
| `Review_content` | text | `review.summary` |
| `sweetness` | int | `review.sweetness` |
| `coolness` | int | `review.coolness` |
| `workload` | int | `review.workload`, `review.difficultyRating` |
| `value` | int | `review.value` |
| `overall` | int | `review.overall`, `review.recommendScore` |
| `review_count` | int | `review.reviewCount` |
| `source` | varchar | `review.source` |
| `url` | text | `review.url` |
| `scraped_at` | datetime | `review.createdAt` |

情緒判定由 `overall` 推導：4 分以上為 positive，2 分以下為 negative，其餘為 neutral。

### `User_Profiles`

| Column | Type | API mapping |
| --- | --- | --- |
| `user_id` | int | `profile.userId` |
| `department` | varchar(45) | `profile.department`（見下方說明） |
| `grade_level` | int | `profile.gradeLevel` |
| `preference_tags` | json | `profile.preferenceTags`, `profile.preferredCategories` |
| `avoid_time` | json | `profile.blockedPeriods`（見下方說明） |
| `completed_courses` | json | **已停用**（2026-08-13）。本專案不再讀寫此欄位——已修排除改用 `users.json` 的 `courseHistory`，理由與遷移細節見 `docs/CHANGE_REPORTS/2026-08-13-part-a-course-history-scheduling-data.md`。欄位本身仍存在於共用表，本專案不自行 `ALTER TABLE`，清理需與組員協調 |
| `max_credits` | int | `profile.targetCreditsMax` |

**`class_name` 欄位尚未新增**（待組員加上）。見下方「`className`（班別）」。

### `className`（班別）

資工系不接受必修換班，必修範圍必須收斂到班別（`資訊三甲`／`資訊三乙`…），
見 `docs/COURSE_SELECTION_RULES.md` 第八節。

**目標欄位**：

```sql
ALTER TABLE `User_Profiles` ADD COLUMN `class_name` varchar(45) NULL;
```

本專案**不自行執行**這道 DDL——該表與組員共用。程式已具備此欄位的完整讀寫：

| 路徑 | 位置 |
| --- | --- |
| 欄位偵測 | `database.js` 的 `hasUserProfileClassNameColumn()`（`SHOW COLUMNS`，結果快取） |
| 讀取 | `getMysqlUserPreferences()` 依偵測結果決定是否 SELECT `class_name`；`mapUserProfileRow()` 映射成 `profile.className` |
| 寫入 | `updateMysqlUserPreference()` 依偵測結果決定是否 UPDATE `class_name` |
| 位置決策 | `pickClassNameTarget()`（純函式，有測試） |

**欄位一新增就自動改走 SQL，不需要再改任何程式**；偵測結果快取於行程內，
新增欄位後需重啟後端才會生效（`npm run dev:server` 使用 `node --watch`）。

`class_name` 不會被無條件寫進 SQL：欄位不存在時把它加進 `SELECT` 會讓整個查詢失敗，
等於所有 profile 一起壞掉。

#### 欄位到位前的後備順序

讀取優先度與寫入目標一致：

| 順位 | 位置 | 適用 |
| ---: | --- | --- |
| 1 | `User_Profiles.class_name` | 欄位存在時的唯一真相來源 |
| 2 | `users.json` 的 `className` | demo 登入使用者（`studentId` 或 `id` 對得到） |

`users.json` 的對照方式：`studentId`（demo 登入用，例如 `D1249697`）與 `id`
（對應 `User_Profiles.user_id`）都建索引，兩者都能對到同一筆 profile。

**兩者都沒有時班別無處可存。** `pickClassNameTarget()` 回傳 `null`，
`upsertByField()` 據此拋錯。這是刻意的：先前的第 3 順位是
`user_preferences.json`，該檔已於 2026-08-11 刪除（同一份 profile 存兩處必然漂移）。
寧可讓寫入失敗，也不能像最早那個 bug 一樣「儲存成功」地把班別丟掉——
`updateMysqlUserPreference()` 沒有欄位可寫卻仍回傳成功的 profile，
下一次排課就無聲地退回系所 + 年級。

## Local JSON Collections

The following collections remain file-backed in `server/data/*.json` because the provided MySQL schema does not include equivalent tables:

- `users`
- `chat_history`
- `saved_schedules`

`user_preferences` **不在此列**。`server/data/user_preferences.json` 已於 2026-08-11
刪除，profile 的唯一儲存體是 `User_Profiles`；未設定資料庫連線時
`getAll('user_preferences')` 與 `upsertByField()` 都會拋出明確錯誤，
不再靜默回空陣列或把檔案長回來。集合名稱 `user_preferences` 保留為這個
store 的邏輯名稱。

### `users.json` 的職責

`users.json` **只負責登入身分與 demo 展示資料**（`studentId`、`password`、`name`、
`watchlist`、`skillTree`…），以及班別的後備儲存（見下方 `className`）。

**歷史修課只有 `courseHistory` 一個欄位。** 2026-08-11 前這裡另外存了
`completedCredits`、`completedCourseIds`、`completedCourseCodes`、
`completedCourseNames`、`earnedCredits` 五個衍生欄位——全部是 `courseHistory`
逐門加總／篩選就能算出來的東西，同一份資料存六份必然漂移。已修課號、
已修學分、分類學分彙總一律呼叫 `server/src/data/courseHistory.js` 的
`getPassedCourseCodes()`／`getEarnedCredits()`／`getTotalEarnedCredits()`
當場算，**不得**在 `users.json` 或任何 profile 物件上重新造出這幾個名字的
派生欄位（`server/test/courseHistory.test.js` 的 H3 有回歸測試釘住這件事）。

`courseHistory` 項目：

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| `academicYear` | number | 學年度，例如 `112` |
| `semester` | number | 學期，例如 `1`、`2` |
| `courseCode` | string | 正式課程編碼，例如 `IECS2001`。與 `Courses.subid3` 同一值域、同一格式（已實測：兩側皆無前後空白、無非大寫、無空值），排課引擎比對時不做正規化 |
| `courseName` | string | 科目名稱 |
| `score` | number | 百分制成績 |
| `letterGrade` | string | 等第成績 |
| `credits` | number | 修習學分 |
| `passed` | boolean | 是否通過（`score >= 60`），於資料匯入時一次寫入，不由消費端各自用 `score` 現算——及格門檻是校規，未來可能有例外（抵免、停修等），收斂成單一欄位比讓每個呼叫端各自判斷不容易漂移 |
| `requirementType` | string | 成績資料中的修習別：`必修` 或 `選修` |
| `generalEducationCategory` | string \| null | 原始通識類別，例如 `(M)`、`(N)`；未標示時為 `null` |
| `graduationCategory` | string | 畢業分類：`required`、`elective`、`general`、`external` 或 `nonGraduation`。`nonGraduation`（體育、國防科技、班級活動等）不計入畢業學分，但**仍視為已修過**——`getPassedCourseCodes()` 不排除它，`getEarnedCredits()` 才排除其學分，兩者是不同的判定 |

**不得**在此存放 `department` 與 `grade`。這兩個欄位的真相來源是
`user_preferences`／`User_Profiles.grade_level`；同一份資料存兩處只會各自漂移——
先前 `graduation.js` 讀 `users.json`、排課讀 `user_preferences`，兩邊可以依不同的系所
計算而毫無跡象，且手改 `users.json` 的年級完全不生效（見稽核報告 F16）。

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
  "timeStr": "(一)02-04",
  "timeBlocks": [
    { "dayOfWeek": 1, "startPeriod": 2, "endPeriod": 4 }
  ],
  "ragTag": ["資料結構", "演算法"]
}
```

### 課程時段欄位

`time_str` 的實際格式為 `(二)06-08`，同一門課可能含多個以空白分隔的時段，例如 `(四)01-04 (四)06-09 (五)01-04`。節次 `00` 代表尚未排定。

- `timeBlocks`：完整時段清單，每個元素含 `dayOfWeek`（1=週一 … 7=週日）、`startPeriod`、`endPeriod`。**衝堂與時間類限制判定必須使用此欄位。**
- `dayOfWeek` / `startPeriod` / `endPeriod`：`timeBlocks[0]` 的內容，僅供相容用途。無法解析時為 `null`。

### `avoid_time` 的兩種格式

同一欄位可能存在兩種格式，讀取時必須都支援：

| 來源 | 格式 | 範例 |
| --- | --- | --- |
| 外部匯入 | 時間字串陣列 | `["08:00"]` |
| 本系統寫回 | 排課引擎格式 | `[{ "day": 1, "period": 3 }]` |

排課引擎只認 `{ day, period }`。`server/src/utils/periods.js` 的 `normalizeBlockedPeriods()` 負責統一轉換，`database.js`（讀取已儲存偏好）與 `constraintService.js`（合併 request）兩處共用。

時間字串沒有星期資訊，視為**每天的該節次都要避開**，展開為 7 筆。時間對應節次採「第一個尚未結束的節次」，例如 `08:00` 對應第 1 節、`13:05` 對應第 6 節。

#### `avoid_time` 與 `#不排早八` 的分工

`avoid_time` 保存**第 1～14 節**，讀寫兩端都不篩掉任何節次。它與 `#不排早八`
標籤**不是同一件事，可以重疊，排課時取聯集**：

| 設定 | 涵蓋範圍 | 語意 |
| --- | --- | --- |
| `avoid_time` | 第 1～14 節，逐格指定星期 | 「星期三第 1 節我不要」 |
| `#不排早八` | 只有第 1 節，但跨整週 | 「每天第一節我都不要」 |

聯集是現成行為：`scheduler.js` 的 `hardConstraintReason()` 分別判定
`noMorningClasses`（`startPeriod <= 1`）與 `blockedPeriods`，互不干涉。

2026-08-11 前曾規定「第 1 節只能用標籤設定，`avoid_time` 只管第 2～14 節」，
讀寫時都把第 1 節剝掉，`POST /api/profile` 還會對含第 1 節的寫入回 `400`。
那是錯的：使用者可能只想避開某一天的早八，剝除等於讓他無法表達這個需求。
讀取時把 `avoid_time` 的第 1 節反推成 `#不排早八` 標籤同樣有害——那會把
「星期三第 1 節」放大成「每天第一節」，而且偏好面板上會出現使用者沒勾過的標籤。

### `department` 的引號正規化

匯入資料中 `User_Profiles.department` 曾存為 `'資訊工程學系'`——**包含字面單引號字元本身**，導致所有字串比對失敗（D3）。掃描全庫 19 個文字欄位後確認**只有此欄位**有此問題，屬單一欄位的匯入缺陷；`Courses.dept` 等課程端欄位皆乾淨。

`server/src/utils/text.js` 的 `normalizeDepartment()` 負責去除成對的包裹引號（半形 `'` `"` `` ` `` 與全形 `‘’` `“”` 「」 『』）並修剪空白，於三處套用：

| 路徑 | 位置 |
| --- | --- |
| MySQL 讀取 | `database.js` 的 `mapUserProfileRow()` |
| 本機 JSON 讀取 | `database.js` 的 `readCollectionBySource()` |
| 寫入（兩種來源共用） | `database.js` 的 `upsertByField()` |

只有真正成對時才剝除，因此 `O'Brien` 這類單邊引號不會被誤刪。資料庫中該筆資料已於 2026-08-02 清理。

**正規化不做型別轉換。** `normalizeDepartment()` 只接受字串，其餘型別一律回傳 `null`。若改用 `String(value)` 強制轉換，`{}` 會變成 `"[object Object]"`、`["資訊工程學系","電機工程學系"]` 會變成 `"資訊工程學系,電機工程學系"`、`123` 會變成 `"123"`——全都是看起來正常、實際上讓所有系所比對失敗的髒值。

寫入端有兩道檢查：

1. `POST /api/profile` 對非字串或空字串回 `400`。
2. 資料層 `upsertByField()` 丟棄型別錯誤的 `department` 並寫入警告，避免其他呼叫路徑繞過 API 檢查。

讀到需正規化的值時會寫入 `logger.warn`，不靜默修正。**去重鍵是「`user_id` + 原始值」**：只用 `user_id` 的話，同一位使用者第一次警告後，後續任何髒值都會被靜默處理，看不出上游匯入是否仍在寫入髒資料。日誌並附上本行程的累計正規化次數與相異髒值種類數。

### `ragTag`

`Course_Sections.rag_tag` 的 JSON 主題標籤陣列，資料庫中 100% 有值，例如 `["機器學習","圖像處理","物件偵測"]`。排課引擎的興趣比對會使用此欄位。

排課、課程詳情與評價 API 都使用 `sectionId` 作為路由與 request body 中的課程識別值。
