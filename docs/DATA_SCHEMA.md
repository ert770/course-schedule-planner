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
| `completed_courses` | json | `profile.completedCourseIds` |
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
| 2 | `user_preferences.json` 的 `className` | MySQL 使用者，但 `users.json` 沒有對應列 |
| 3 | `users.json` 的 `className` | demo 登入使用者（`studentId` 或 `id` 對得到） |

`users.json` 的對照方式：`studentId`（demo 登入用，例如 `D1249697`）與 `id`
（對應 `User_Profiles.user_id`）都建索引，兩者都能對到同一筆 profile。

**第 2 順位不可省略**：只寫 `users.json` 的話，存在於 `User_Profiles` 但沒有 `users.json`
對應列的使用者，班別會被「儲存成功」地丟掉——`updateMysqlUserPreference()` 沒有欄位可寫、
卻仍回傳成功的 profile，本機寫入又被提早 `return` 跳過，下一次排課直接退回系所 + 年級。
`upsertByField()` 因此在這個情況下不提早返回，先把班別寫進本機 profile 再回傳。

## Local JSON Collections

The following collections remain file-backed in `server/data/*.json` because the provided MySQL schema does not include equivalent tables:

- `users`
- `chat_history`
- `saved_schedules`
- non-numeric or demo `user_preferences`

### `users.json` 的職責

`users.json` **只負責登入身分與 demo 展示資料**（`studentId`、`password`、`name`、
`completedCredits`、`watchlist`、`skillTree`…），以及班別的後備儲存（見下方 `className`）。

歷史修課 demo 資料使用以下欄位：

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| `completedCredits` | number | 計入畢業的已修總學分，不包含體育、國防科技等不計畢業學分課程 |
| `completedCourseIds` | array | section id 清單；無法由歷史資料可靠對應當期 section 時必須留空，不得填入模擬 ID |
| `completedCourseCodes` | string[] | 歷史修課的正式課程編碼 |
| `completedCourseNames` | string[] | 歷史修課科目名稱，順序與 `completedCourseCodes` 相同 |
| `earnedCredits` | object | 畢業分類學分彙總：`required`、`elective`、`general`、`external` |
| `courseHistory` | object[] | 完整歷年修課與成績明細，欄位定義如下 |

`courseHistory` 項目：

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| `academicYear` | number | 學年度，例如 `112` |
| `semester` | number | 學期，例如 `1`、`2` |
| `courseCode` | string | 正式課程編碼，例如 `IECS2001` |
| `courseName` | string | 科目名稱 |
| `score` | number | 百分制成績 |
| `letterGrade` | string | 等第成績 |
| `credits` | number | 修習學分 |
| `requirementType` | string | 成績資料中的修習別：`必修` 或 `選修` |
| `generalEducationCategory` | string \| null | 原始通識類別，例如 `(M)`、`(N)`；未標示時為 `null` |
| `graduationCategory` | string | 畢業分類：`required`、`elective`、`general`、`external` 或 `nonGraduation` |

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
