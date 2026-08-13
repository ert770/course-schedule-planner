# Part B：候選課程課號欄位改名

## 修改日期

2026-08-13

## 修改檔案

- 後端資料映射：`server/src/db/database.js`
- 排課與分類：`server/src/skills/scheduler.js`、`server/src/skills/outsideElective.js`、`server/src/data/csCurriculum.js`
- Part A 呼叫端：`server/src/routes/graduation.js`、`server/src/data/courseHistory.js`
- 測試：`server/test/courseMappingContract.test.js`、`server/test/courseQuery.test.js`、`server/test/csCurriculum.test.js`、`server/test/outsideElective.test.js`、`server/test/scheduler.test.js`
- 文件：`docs/API_SPEC.md`、`docs/DATA_SCHEMA.md`、`docs/SCHEDULING_LOGIC.md`、`docs/COURSE_SELECTION_RULES.md`、`docs/TEST_PLAN.md`
- 變更報告：`docs/CHANGE_REPORTS/2026-08-13-catalog-course-code-rename.md`

## 主要改動

- MySQL `Courses.subid3` 實體欄位保持不變；`mapCourseRow()` 將它映射為語意清楚的
  `course.catalogCourseCode`。
- 應用程式與 API 課程物件不再輸出或接受 `course.subid3` alias。
- 同課不同班次判定、資工課程分類、系外選修難度判斷全部改讀
  `catalogCourseCode`。
- 同步更新 Part A 新增的已修課程排除：排課引擎、排除原因及畢業建議都以
  `courseHistory[].courseCode` 比對 `course.catalogCourseCode`。
- 新增資料映射契約測試，釘住 `row.subid3` 只映射至
  `catalogCourseCode`，不得重新洩漏 `subid3`。

## 影響範圍與外部呼叫端

這是零行為變更的應用層欄位改名，但對 API schema 是 breaking change。以下回應或工具
結果內嵌的課程物件都改為 `catalogCourseCode`：

- `GET /api/courses`、`GET /api/courses/:id`
- `POST /api/schedule/generate` 的課表方案、排除、關注及未排定課程
- `POST /api/schedule/validate` 接收及回傳的課程物件
- `GET /api/graduation/:studentId` 的 `recommendations[].course`
- AI Agent 的課程查詢、課程明細及排課工具結果

repository 內前端沒有讀取 `subid3`，因此不需修改。repository 外若有 API client 讀取
`course.subid3`，必須改讀 `course.catalogCourseCode`。MySQL SQL、資料庫契約測試與歷史
稽核文件中的 `subid3` 是真實 schema 名稱，刻意保留。

## 測試與驗證結果

- 修改前 API 基準：課程搜尋 16 門；排課成功、1 個方案、5 門課、14 學分、11 筆排除；
  畢業進度 118／128、1 筆建議。課程物件有 `subid3`、沒有
  `catalogCourseCode`。
- Targeted tests：99 tests passed（資料映射、課程查詢、分類、系外選修、排課、畢業）。
- 完整 `npm test`：283 tests、62 suites 全數通過。
- 前端 `npm run lint` 與 `npm run build` 通過。
- `server/src/**/*.js` 全部通過 `node --check`。
- 後端以 port 3002 冷啟動成功，驗證後已停止；未修改 MySQL 資料。
- 修改後 API A/B：課程搜尋仍為 16 門；排課仍成功、1 個方案、5 門課、14 學分、
  11 筆排除；畢業進度仍為 118／128、1 筆建議。課程搜尋、課程明細、排課與畢業
  回應均有 `catalogCourseCode`，遞迴檢查皆沒有 `subid3`。
- 瀏覽器：Dashboard 實際產生 1 個方案、5 門課、14 學分；課程搜尋頁取得 16 筆；
  畢業進度頁顯示 118／128 與建議課程。console 無 error 或 warning。

## Commit 與 Push

- Commit：是，本報告與 Part B 修改一併提交。
- Push：是，推送至 `origin/backend`。
