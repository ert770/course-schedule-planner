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

**嚴重度：最高**

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

**對路線圖的影響**

`#4`（把評分方式結構化）與 `#5`（把 reviews 分數接進 `scoreCourse`）的前提需要修正。這兩項原本假設「需要新增難度甜度欄位」，實際上**資料庫已經有了**，只是因為表名錯誤而完全取不到。`easy_score` 方案的關鍵字比對（涼課關鍵字命中率 0.7%）也應直接改用 `coolness` 與 `sweetness`。

### D2 `avoid_time` 格式與排課引擎不符，封鎖時段靜默失效

**嚴重度：高**

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
| 1 | D1 評價表名稱 | 三個 API 與兩個 Agent 工具完全失效，且修好後 `#4`／`#5` 大部分已有資料可用 |
| 2 | D2 `avoid_time` 格式 | 硬約束靜默失效，使用者設定無效果且無警告 |
| 3 | D3 `department` 引號 | 阻擋 `#13` 的系所比對 |
| 4 | D7、D6 | 顯示層與資料一致性 |
| 5 | D4、D5 | 需要外部資料來源，非程式可解 |

## 是否 commit 與 push

- 本文件為稽核紀錄，未修改任何程式碼。
