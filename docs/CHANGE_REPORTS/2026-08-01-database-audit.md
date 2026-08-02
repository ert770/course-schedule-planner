# 2026-08-01 資料庫完整稽核

## 文件性質

一次性稽核紀錄。讀過 `defaultdb` 的所有資料表與欄位後，列出程式碼與資料庫不一致之處。

## 稽核日期

2026-08-01

## 資料庫概況

| 資料表 | 筆數 | 校對規則 |
| --- | ---: | --- |
| `Courses` | 3086 | `utf8mb4_0900_ai_ci` |
| `Course_Sections` | 3560 | `utf8mb4_unicode_ci` |
| `Course_Reviews` | 181 | `utf8mb4_unicode_ci` |
| `User_Profiles` | 1 | `utf8mb3_general_ci` |

三種不同的校對規則混用，已導致一次 JOIN 失敗（見 `2026-08-01-mysql-connection-and-time-parsing.md`）。

## 發現

### D1 評價資料表名稱錯誤，評價功能完全失效

**嚴重度**：🔴 嚴重　**狀態**：✅ 已完成

`server/src/db/database.js:328` 查詢 `Courses_Reviews`，但資料庫中的表名是 **`Course_Reviews`**（單數 Course）。

```text
Table 'defaultdb.Courses_Reviews' doesn't exist
```

**受影響範圍**

- `GET /api/reviews/easy`
- `GET /api/reviews/:courseId`
- `GET /api/courses/:id`（`getCourseDetail()` 內部呼叫 `getAll('reviews')`）
- AI Agent 的 `search_dcard_reviews` 與 `get_easy_courses` 工具

以上全部拋出例外。

**欄位也完全不同**

程式碼假設的欄位（`Course_id`、`Reviews_tags(GoodOrBad)`）在真實表中不存在。真實結構為：

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| `Reviews_id` | int | 主鍵 |
| `selection_code` | varchar(4) | **關聯鍵**，對應 `Course_Sections.selection_code` |
| `sweetness` | int | 甜度 1–5 |
| `coolness` | int | 涼度 1–5 |
| `workload` | int | 作業量 1–5 |
| `value` | int | 值得度 1–5 |
| `overall` | int | 整體 1–5 |
| `review_count` | int | 評論則數 |
| `Reviews_tags` | text | 文字標籤，如「人很少,沒作業,兩個報告」 |
| `Review_content` | text | 評論內容 |
| `source` / `url` / `scraped_at` | — | 來源資訊（`1111opt`） |

**五個評分欄位皆為 1–5 且零空值**，`selection_code` 與 `Course_Sections` **181/181 完全對得上**。

**驗收**

- `getAll('reviews')` 必須查詢真實存在的 `Course_Reviews`。
- 評價資料必須透過 `selection_code` 對應到 `Course_Sections.section_id`，讓既有 API 仍可用 section id 查評價。
- `GET /api/reviews/easy` 不再依賴關鍵字猜測涼課，而是使用 `coolness`、`sweetness`、`workload`、`overall` 結構化分數。
- `GET /api/reviews/:courseId` 與 AI Agent 評價工具不能再因表名或欄位名錯誤而直接失敗。

### 修復（2026-08-01）

**修改檔案**

- `server/src/db/database.js`
- `server/src/skills/reviewSearch.js`
- `docs/API_SPEC.md`
- `docs/DATA_SCHEMA.md`
- `docs/ARCHITECTURE.md`
- `docs/DECISIONS.md`
- `docs/CHANGE_REPORTS/2026-08-01-fix-course-reviews-d1.md`
- `docs/CHANGE_REPORTS/2026-08-01-database-audit.md`

**實際修法**

- `database.js` 將評價查詢來源由不存在的 `Courses_Reviews` 改為 `Course_Reviews`。
- 評價 join 改為 `Course_Reviews.selection_code = Course_Sections.selection_code`，並把 join 後的 `section_id` 映射為 `review.courseId`，維持既有 API 使用 section id 查詢的契約。
- `course_id` 與 `selection_code` join 改用 `BINARY` 精確比較，修正實機驗證時發現的 `Illegal mix of collations` 錯誤。
- `mapReviewRow()` 改映射真實欄位：`Reviews_tags`、`Review_content`、`sweetness`、`coolness`、`workload`、`value`、`overall`、`review_count`、`source`、`url`、`scraped_at`。
- 情緒判定改由 `overall` 推導：4 分以上為 positive，2 分以下為 negative，其餘為 neutral。
- `reviewSearch.js` 的涼課排序改用結構化評分：`coolness`、`sweetness`、`6 - workload`、`overall` 的平均值，而不是舊的 `difficultyRating`／`recommendScore` 推估式。
- 保留 `difficultyRating = workload` 與 `recommendScore = overall` 的相容欄位，避免既有課程詳情統計與前端消費端破壞。
- 評價摘要補回可讀中文與新增平均欄位：`avgCoolness`、`avgSweetness`、`avgWorkload`、`avgOverall`。
- adversarial review 發現 `review_count` 是彙總評論數，不能以資料列數當成評論數；`count`、正負評數、`positiveRatio`、涼課清單 `reviewCount` 與所有平均分數已改用 `reviewCount || 1` 加權計算。
- API、資料結構、架構與 ADR 文件同步改為 `Course_Reviews` 與 `selection_code` 關聯說明。

**測試與驗證結果**

- `node --check server/src/db/database.js`：通過。
- `node --check server/src/skills/reviewSearch.js`：通過。
- `node --check server/src/app.js`：通過。
- `reviewSearch.js` 模組 import 測試：通過，確認 `getEasyCourses`、`getReviewsByCourse`、`getSentimentSummary`、`searchReviews` 均可載入。
- active docs 掃描：`docs/API_SPEC.md`、`docs/DATA_SCHEMA.md`、`docs/ARCHITECTURE.md`、`docs/DECISIONS.md` 已無舊表 `Courses_Reviews` 或舊欄位 `Reviews_tags(GoodOrBad)` 的錯誤描述。
- 實機驗證第一次發現代碼欄位 join 仍受 collation 差異影響，已改用 `BINARY` 精確比較後重測。
- `GET /api/health`：通過。
- `GET /api/reviews/easy?limit=3`：通過，回傳含 `avgCoolness`、`avgSweetness`、`avgWorkload`、`avgOverall` 的課程清單。
- `GET /api/reviews/:courseId`：通過，使用 easy courses 第一筆 section id 查到評價與 sentiment summary。
- `review_count` 加權驗證：通過，`reviewCount` / `count` 使用資料庫彙總評論數加總，平均欄位使用 `review_count` 加權。
- Chrome 驗證：嘗試開啟 `localhost:3001` 與 `127.0.0.1:3001` 的本機 API 頁面，Chrome browser extension 均回報 `net::ERR_BLOCKED_BY_CLIENT`；瀏覽器層無法讀取頁面，功能驗證以同一 URL 的 HTTP API 回應為準。

**對路線圖的影響**

`#4`（把評分方式結構化）已不需要新增難度甜度欄位，因為 `Course_Reviews` 已提供 `sweetness`、`coolness`、`workload`、`value`、`overall`。`#5`（把 reviews 分數接進 `scoreCourse`）仍需另外處理排課引擎加權，但資料取得前提已解除。`easy_score` 的關鍵字比對缺陷也已在評價查詢層改為使用 `coolness` 與 `sweetness` 等結構化欄位。

### D2 `avoid_time` 格式與排課引擎不符，封鎖時段靜默失效

**嚴重度**：🟠 高　**狀態**：✅ 已完成（2026-08-02）——詳見 [修復 avoid_time 格式不符](./2026-08-02-avoid-time-format.md)

`User_Profiles.avoid_time` 的實際內容為時間字串陣列：

```json
["08:00"]
```

但 `server/src/skills/scheduler.js` 的 `hardConstraintReason()` 期待的是：

```json
[{ "day": 1, "period": 3 }]
```

`normalizeBlockedPeriods()`（`database.js:256`）只是原樣回傳陣列，未做格式轉換。因此 `bp.day` 為 `undefined`，比對 `block.dayOfWeek !== bp.day` 恆為真而跳過，**使用者設定的避開時段完全不生效，且沒有任何錯誤或警告**。

### D3 `User_Profiles.department` 含字面單引號

**嚴重度：高**

實際儲存值為 `'資訊工程學系'`——**包含單引號字元本身**，不是 SQL 引號。

任何字串比對（包含 `#13` 要做的系所對照）都會失敗，除非先去除引號。需釐清這是資料匯入時的缺陷，還是所有欄位都有此問題。

### D4 `current_amount` 全為 0

**嚴重度：中**

3560 筆 section 的 `current_amount` **全部為 0**（min=0、max=0、無空值）。此欄位對應 API 的 `course.currentAmount`，原意應為修課人數或餘額，目前無任何資訊量。

若要支援「選課人數」「是否已額滿」等功能，需要另外的資料來源。

### D5 資料規模限制，數項路線圖任務目前無資料可用

**嚴重度：中**

| 資料 | 現況 | 影響 |
| --- | --- | --- |
| `User_Profiles` | **僅 1 筆** | `#6`（協同過濾）需要 user-item 交互矩陣，單一使用者無法建立 |
| `year` / `semester` | 全部為 `114` / `下學期` | `#8`（多學期路徑規劃）沒有跨學期資料 |
| `completed_courses` | 唯一一筆為 `null` | 無法推估已修學分與畢業進度 |
| `max_credits` | 唯一一筆為 `null` | 學分上限只能用預設值 |

`#6` 與 `#8` 在取得更多使用者與跨學期資料前無法實作，應調整優先順序。

### D6 教師與教室有缺漏

**嚴重度：低**

| 欄位 | 空值筆數 | 佔比 |
| --- | ---: | ---: |
| `teacher` | 87 | 2.4% |
| `room` | 153 | 4.3% |
| `time_str` | 0 | — |
| `rag_context` | 0 | — |
| `rag_tag` | 0 | — |

`teacher` 與 `room` 為 `NOT NULL` 但存了空字串。前端課程卡片會顯示「👤 」空白，需決定顯示「未定」或隱藏。

### D7 `preference_tags` 的值不在應用程式的偏好清單內

**嚴重度：低**

唯一一筆使用者的 `preference_tags` 為 `["#不點名"]`，但 `client/src/pages/SetupPage.jsx` 的 `PREFERENCE_TAGS` 共 12 個選項中沒有「#不點名」。資料庫的偏好值與前端可選項目不一致，需確認來源。

## 資料完整性檢查（正常項目）

以下項目檢查後無異常，記錄供後續參考：

- `Courses.course_id` 3086 筆全部唯一，無重複主鍵。
- `Course_Sections` 對 `Courses` **無孤兒**，JOIN 完整。
- `Course_Sections.selection_code` 3560 筆全部唯一。
- `rag_context` 與 `rag_tag` **零空值**，`rag_tag` 為結構化主題標籤陣列。

## 建議處理順序

| 順序 | 項目 | 理由 |
| ---: | --- | --- |
| ✅ | D1 評價表名稱 | 已修復：三個 API 與兩個 Agent 工具的資料取得前提已恢復，`#4`／`#5` 可接續使用結構化分數 |
| ✅ | D2 `avoid_time` 格式 | 已修復：時間字串正規化為 { day, period }，兩條路徑共用轉換 |
| 2 | D3 `department` 引號 | 阻擋 `#13` 的系所比對 |
| 3 | D7、D6 | 顯示層與資料一致性 |
| 4 | D4、D5 | 需要外部資料來源，非程式可解 |

## 是否 commit 與 push

- 本次更新僅修改本稽核追蹤文件。
- 未 commit。
- 未 push。
