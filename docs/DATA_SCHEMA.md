# 資料格式規格

目前資料儲存在 `server/data/*.json`，由 `server/src/db/database.js` 讀寫。`schema.sql` 是參考設計，實際運作以 JSON 檔案為準。

## Course

來源：`server/data/courses.json`

| 欄位 | 型別 | 必填 | 說明 |
| --- | --- | --- | --- |
| `id` | number | yes | 課程 ID |
| `name` | string | yes | 課程名稱 |
| `code` | string | yes | 課程代碼 |
| `instructor` | string | yes | 授課教師 |
| `department` | string | yes | 開課系所 |
| `credits` | number | yes | 學分數 |
| `dayOfWeek` | number | yes | 星期，1-5 |
| `startPeriod` | number | yes | 起始節次 |
| `endPeriod` | number | yes | 結束節次 |
| `location` | string | no | 教室 |
| `capacity` | number | no | 名額 |
| `category` | string | yes | 必修、核心選修、選修、通識、系外選修等 |
| `description` | string | no | 課程描述 |
| `language` | string | no | 授課語言 |

Future fields:

- `track`: 嵌入式系統類、技術應用類、網路安全類。
- `digitalCredits`: 是否計入數位課程門檻。
- `examType`: 期中、期末、報告、實作。
- `gradingTags`: 高分、涼課、重報告、重考試等。

## User

來源：`server/data/users.json`

| 欄位 | 型別 | 必填 | 說明 |
| --- | --- | --- | --- |
| `id` | number | yes | 使用者 ID |
| `studentId` | string | yes | 學號 |
| `password` | string | yes | 密碼，目前為 MVP 測試用 |
| `name` | string | no | 姓名 |
| `department` | string | no | 系所 |
| `completedCredits` | number | no | 已完成學分 |
| `completedCourseIds` | number[] | no | 已完成課程 |
| `watchlist` | number[] | no | 關注課程 |
| `requiredCredits` | object | no | 各類別需求學分 |
| `earnedCredits` | object | no | 各類別已得學分 |

## User Preferences

來源：`server/data/user_preferences.json`

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| `userId` | string | 使用者 ID 或學號 |
| `displayName` | string | 顯示名稱 |
| `completedCredits` | number | 已完成學分 |
| `targetCreditsMin` | number | 當學期最低目標學分 |
| `targetCreditsMax` | number | 當學期最高目標學分 |
| `blockedPeriods` | array | 封鎖時段 |
| `preferredCategories` | array | 偏好類別 |
| `mustTakeCourses` | array | 必修或指定課 |
| `avoidInstructors` | array | 避開教師 |
| `preferCompact` | boolean | 是否偏好集中排課 |
| `noMorningClasses` | boolean | 是否不上早課 |
| `noEveningClasses` | boolean | 是否不上晚課 |
| `preferencesJson` | object | 其他偏好 |

Future fields:

- `preferredTrack`
- `freeDayPreference`
- `courseStateMap`
- `digitalCreditsNeeded`
- `retakeCourseIds`

## Review

來源：`server/data/reviews.json`

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| `id` | number | 評價 ID |
| `courseId` | number | 課程 ID |
| `sentiment` | string | positive / negative / neutral |
| `summary` | string | 評價摘要 |
| `keywords` | string[] | 關鍵字 |
| `difficultyRating` | number | 難度 |
| `recommendScore` | number | 推薦分數 |
| `source` | string | 來源 |

## Saved Schedule

來源：`server/data/saved_schedules.json`

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| `id` | number | ID |
| `userId` | string | 使用者 ID |
| `name` | string | 課表名稱 |
| `scheduleData` | array | 課表課程 |
| `totalCredits` | number | 總學分 |
| `createdAt` | string | 建立時間 |

## Course State

未來排課邏輯需新增課程狀態：

| 狀態 | 說明 | 是否判斷衝堂 |
| --- | --- | --- |
| `watching` | 關注，只顯示於課表預覽 | no |
| `selected` | 加選，正式佔用時段 | yes |

