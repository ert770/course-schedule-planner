# 2026-08-01 修正 D1 評價資料表串接

## 修改日期

2026-08-01

## 修改檔案清單

- `server/src/skills/reviewSearch.js`
- `docs/ARCHITECTURE.md`
- `docs/API_SPEC.md`
- `docs/DATA_SCHEMA.md`
- `docs/DECISIONS.md`
- `docs/CHANGE_REPORTS/2026-08-01-fix-course-reviews-d1.md`

## 主要改動內容

- 將評價查詢服務的涼課排名改為使用 `Course_Reviews` 既有的 `coolness`、`sweetness`、`workload`、`overall` 結構化分數。
- 修正 `Courses.course_id` 與 `Course_Sections.course_id`、`Course_Reviews.selection_code` 與 `Course_Sections.selection_code` join 的 collation mismatch；代碼欄位改用 `BINARY` 精確比較，避免 MySQL 拋出 `Illegal mix of collations`。
- 修正 adversarial review 發現的統計誤差：`review_count` 代表彙總評論數，`count`、`positiveRatio`、正負評數與所有平均分數皆改用 `reviewCount || 1` 加權計算。
- 修正評價摘要中的中文回覆文字，避免出現不可讀亂碼。
- 保留既有欄位 `difficultyRating` 與 `recommendScore` 的相容性，同時輸出 `avgCoolness`、`avgSweetness`、`avgWorkload`、`avgOverall`。
- 更新 API、資料結構、架構與 ADR 文件，說明評價表為 `Course_Reviews`，並透過 `selection_code` 對應 `Course_Sections.section_id`。

## 影響範圍

- `GET /api/reviews/easy`
- `GET /api/reviews/:courseId`
- `GET /api/courses/:id` 中的評價統計
- AI Agent 的 `search_dcard_reviews` 與 `get_easy_courses` 工具

## 測試與驗證結果

- 通過：`node --check server/src/db/database.js`
- 通過：`node --check server/src/skills/reviewSearch.js`
- 通過：`node --check server/src/app.js`
- 通過：`GET /api/health`
- 通過：`GET /api/reviews/easy?limit=3`
- 通過：`GET /api/reviews/:courseId`（使用 easy courses 回傳的第一筆 section id）
- 通過：API 回應中的 `reviewCount` / `count` 使用 `review_count` 加總，平均欄位使用 `review_count` 加權。
- Chrome 驗證：嘗試開啟 `http://localhost:3001/api/reviews/135`、`http://localhost:3001/api/health` 與 `http://127.0.0.1:3001/api/health`，Chrome browser extension 均回報 `net::ERR_BLOCKED_BY_CLIENT`。因此本輪瀏覽器層無法讀取本機 API 頁面，改以同一 URL 的 HTTP API 回應作為功能驗證依據。

## 是否 commit 與 push

- 未 commit。
- 未 push。
