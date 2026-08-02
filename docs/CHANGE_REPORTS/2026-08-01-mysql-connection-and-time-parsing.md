# 2026-08-01 接上 MySQL 並修復課程時間解析

## 修改日期

2026-08-01

## 修改檔案清單

- `server/src/db/database.js`

未進版控但為執行所需（皆由 `.gitignore` 排除）：

- `server/.env`（自主專案 `C:/Users/yamat/Agent_project/server/.env` 複製）
- `server/ca.pem`（同上）

## 背景

worktree 內原本沒有 `.env`，`isMysqlConfigured()` 回傳 false，後端整個退回讀取 `server/data/*.json`（55 筆示範課程）。主專案的 `server/.env` 與 `server/ca.pem` 因 `.gitignore` 排除而不會被 worktree 繼承，複製後才連得上。

連上之後暴露兩個只有對真實資料庫才會出現的缺陷。

## 缺陷一：JOIN 校對規則衝突

連線成功但所有課程查詢失敗：

```text
ER_CANT_AGGREGATE_2COLLATIONS
Illegal mix of collations (utf8mb4_0900_ai_ci,IMPLICIT)
and (utf8mb4_unicode_ci,IMPLICIT) for operation '='
```

查 `information_schema` 確認：

| 資料表 | 欄位 | 字元集 | 校對規則 |
| --- | --- | --- | --- |
| `Courses` | `course_id` | utf8mb4 | `utf8mb4_0900_ai_ci` |
| `Course_Sections` | `course_id` | utf8mb4 | `utf8mb4_unicode_ci` |

字元集相同但校對規則不同，`=` 無法比較。

**修法**：在 `getMysqlCourses()` 的 JOIN 條件兩側明確指定共同校對規則，不更動資料庫結構。

```sql
INNER JOIN `Courses` c
  ON c.`course_id` COLLATE utf8mb4_unicode_ci = cs.`course_id` COLLATE utf8mb4_unicode_ci
```

## 缺陷二：課程時間解析完全失效

`parseTimeFromText()` 只比對 `星期一` / `週一` / `周一` / `禮拜一` 等寫法，但學校系統的實際格式是 **`(二)06-08`**——括號內單一個中文數字。沒有任何 pattern 命中，因此全部落到 `parseTimeFromBitmask()`，而該路徑產出的是錯誤結果。

**修復前後對照（3560 筆）**

| 指標 | 修復前 | 修復後 |
| --- | --- | --- |
| `dayOfWeek` 分佈 | 只有 `1`（2455）與 `null`（1105） | 1~7 合理分佈：744 / 747 / 680 / 635 / 439 / 81 / 9，`null` 225 |
| `startPeriod` 分佈 | 只有 1~5 | 1~14 完整分佈 |
| `(二)06-08` | `day=1, period=1-1` | `day=2, period=6-8` |
| `(四)11-12` | `day=1, period=1-3` | `day=4, period=11-12` |
| `(一)00`（未排定） | 落入 bitmask 產生錯誤值 | `null`，正確視為未排定 |

**影響**：修復前每一門課都被判定在週一，2455 門課擠在同一天且節次錯亂，衝堂判定與整個排課結果對真實資料完全不可用。

**修法**：新增 `parseTimeBlocks()`，以正規表示式解析 `(D)NN-NN` 與 `(D)NN` 格式，支援全形括號，節次 `00` 視為未排定。原有的中文星期比對邏輯保留作為後備。

## 附帶改動

`course` 物件新增 `timeBlocks` 陣列欄位，保留完整時段清單。單一組 `dayOfWeek` / `startPeriod` / `endPeriod` 仍取第一段以維持相容，排課引擎尚未使用 `timeBlocks`。

## 影響範圍

- `/api/courses` 與所有課程查詢：資料來源由 55 筆本機 JSON 改為 3560 筆 MySQL section
- `/api/schedule/generate`：候選課程與時間資訊全面改變
- `/api/chat` 的排課與課程查詢工具
- `/api/reviews/*`、`/api/profile`（numeric userId）

## 測試與驗證結果

- `node --check server/src/db/database.js`：通過。
- MySQL 課程讀取：3560 筆，與 `2026-06-11-mysql-database-access.md` 記載的數量一致。
- 時間解析：逐筆比對 `time_str` 與解析結果，格式樣態涵蓋 `(D)NN-NN`、`(D)NN`、多時段與 `未決定`。

**瀏覽器實機驗收**

| 操作 | 結果 |
| --- | --- |
| `/api/courses?keyword=程式` | 212 筆，欄位完整 |
| `/schedule` 搜尋「演算法」 | 44 筆，顯示「週三 2-4節」「週二 11-13節」「週一 2-4節」等正確時間 |
| 系所下拉 | 563 個系所（原本 5 個） |
| 選 2 門課後自動排課 | 產生 2 門 6 學分，正確渲染於課表格，提示橫幅顯示方案訊息 |

## 新發現的問題（已另立追蹤）

**多時段課程**：330 筆（9%）課程含多個時段，例如 `(四)01-04 (四)06-09 (五)01-04`。目前資料模型只容納第一段，`timeConflict()` 會漏判衝堂。已解析並存於 `timeBlocks`，但排課引擎尚未使用。

**週末課程**：90 筆課程排在週六（81）或週日（9），但 `schema.sql` 的 `CHECK(day_of_week BETWEEN 1 AND 5)`、`scheduler.js` 的 `WEEK_DAYS = 5` 與 `ScheduleGrid` 只支援週一至週五。這些課程會進入課表資料但在畫面上看不見，導致學分數與課表格內容對不起來。

兩者都需要先決定產品行為再實作，不在本次範圍。

## 是否 commit 與 push

- 已 commit 並 push 至 `origin claude/personalized-schedule-algorithm-6324a3`。
- `.env` 與 `ca.pem` 未進版控。
