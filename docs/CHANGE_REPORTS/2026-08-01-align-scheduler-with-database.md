# 2026-08-01 排課演算法與資料庫對齊

## 修改日期

2026-08-01

## 修改檔案清單

- `server/src/skills/scheduler.js`
- `server/src/db/database.js`
- `server/src/db/schema.sql`
- `client/src/components/Schedule/ScheduleGrid.jsx`
- `client/src/App.css`
- `docs/SCHEDULING_LOGIC.md`
- `docs/DATA_SCHEMA.md`
- `docs/TEST_PLAN.md`

## 背景

接上 MySQL 後（見 `2026-08-01-mysql-connection-and-time-parsing.md`），以 3560 筆真實課程重新檢視排課演算法的資料假設。原則：**演算法參數與資料庫不一致時，以資料庫為準。**

## 一、關鍵字命中率重測

`2026-08-01-frontend-backend-alignment-audit.md` 的背景章節記錄了一份關鍵字命中率實測，該實測是以 `server/data/courses.json` 的 55 筆示範資料（描述平均 21 字）進行。真實資料庫的描述平均 161 字且 100% 有內容，結論需修正。

| 偏好 | 示範資料（55 筆） | 真實資料（3560 筆） | 判定方式 | 修正後結論 |
| --- | ---: | ---: | --- | --- |
| `noMidterm` | 0 | 3（0.1%） | 命中即排除 | **仍近乎無效**，等於靜默的假承諾 |
| `noGroupReport` | 0 | 196（5.5%） | 命中即排除 | 已可運作 |
| `discussion` | 0 → 全滅 | 1741（48.9%） | 未命中即排除 | **不再全滅**，約保留一半課程 |
| `weightDaily` | 0 → 全滅 | 59（1.7%） | 未命中即排除 | **仍近乎全滅**，開啟後只剩 59 門 |
| `practicalExam` | 3 | 1189（33.4%） | 未命中即排除 | 已可運作 |
| `finalReport` | 1 | 434（12.2%） | 未命中即排除 | 偏嚴但可運作 |
| `learnMore` | 5 | 3473（97.6%） | 未命中即排除 | **形同無效**，97.6% 命中等於不篩選 |
| 涼課關鍵字 | 0 | 26（0.7%） | 命中才加分 | **仍幾乎無效**，`easy_score` 方案依舊近乎失效 |
| `englishTaught` | 1 | 249（7.0%） | — | `language` 欄位 3560 筆全為 `undefined`，僅靠描述含「英文」判定 |

**結論修正**：原報告「八個偏好開關全部失效」的說法對真實資料不成立。實際情況是三類：

1. **仍近乎全滅**：`weightDaily`（1.7%）
2. **仍形同無效**：`noMidterm`（0.1%）、`learnMore`（97.6%）、涼課關鍵字（0.7%）
3. **已可運作**：`discussion`、`practicalExam`、`finalReport`、`noGroupReport`

`docs/CHANGE_REPORTS/2026-08-01-personalization-roadmap.md` 的 `#3`（硬過濾改軟懲罰）與 `#4`（結構化評分欄位）仍然成立且必要，但急迫性的排序依據應改用上表。

## 二、演算法參數與資料庫的落差

| 資料庫實際狀況 | 演算法原本的假設 | 處置 |
| --- | --- | --- |
| `rag_tag` JSON 主題標籤，**100% 有值** | `getInterestScore` 完全未使用 | 納入興趣比對 |
| 課程分佈於週一至**週日** | `WEEK_DAYS = 5`、`ScheduleGrid` 只畫五天、`schema.sql` CHECK 1–5 | 全面改為七天 |
| **9%** 課程含多個時段 | `timeConflict` 只比對第一段 | 改為比對所有時段 |
| `Courses.type` 只有 `必修` / `選修` | `CATEGORY_PRIORITY` 有五階 | 保留對映（未出現的類別回傳預設優先序），不強制對齊，待資料補齊 |
| **422 筆 0 學分**課程 | 貪婪迴圈以學分成長作為中止依據 | 已知問題，另行追蹤 |
| 無 `track`、`digitalCredits` 欄位 | 排課引擎會讀取 | 維持現狀，已有警告機制 |

## 三、主要改動內容

### 多時段支援

- 新增 `getTimeBlocks(course)`：優先使用 `course.timeBlocks`，無則退回單一時段，皆無則回傳空陣列。
- `timeConflict()` 改為對兩門課的時段取笛卡兒積，任一組重疊即為衝堂。
- `hardConstraintReason()` 的不上早八、不上晚課、封鎖時段、午休保留改為檢查所有時段。
- `addCourseToPlan()` 的單日課程數上限對課程佔用的每一天分別計算。
- `scoreCourse()` 的集中排課加分與 `getCompactness()` 改用所有時段涵蓋的天數。
- `ScheduleGrid` 逐時段渲染，一門多時段課程會在課表上出現多個區塊。

### 週末支援

- `WEEK_DAYS` 由 5 改為 7。
- `ScheduleGrid` 由五欄改為七欄，`.schedule-grid` 的 `grid-template-columns` 同步調整。
- `schema.sql` 的 `CHECK(day_of_week BETWEEN 1 AND 5)` 放寬為 `1 AND 7`。
- `parseTimeFromBitmask()` 的日期過濾由 `<= 5` 放寬為 `<= 7`。

### 興趣比對

- `getInterestScore()` 的比對字串納入 `course.ragTag`。

### 附帶修正

`ScheduleGrid` 原本在 `PERIODS.map()` 內回傳裸的 `<>` fragment 而未提供 key，持續產生 React 警告。改用 `<Fragment key={...}>`，此即前後端稽核報告的 F15。

## 影響範圍

- `POST /api/schedule/generate` 與 `POST /api/chat` 的排課工具：衝堂判定結果會改變，先前被判定為不衝堂的多時段課程組合現在會正確判定為衝堂。
- 課表顯示：多時段課程與週末課程現在都會出現在課表上。
- **行為變更**：先前產生的課表可能含實際互相衝堂的課程，重新排課後結果會不同。

## 測試與驗證結果

**排課測試案例**：`docs/TEST_PLAN.md` 的 S1-S10 加上新增的 M1-M4、W1-W3，**18 項全數通過**。

**真實資料驗證**

| 項目 | 結果 |
| --- | --- |
| 多時段課程數 | 330（9.3%） |
| 漏判實例 | `建築設計(二) (四)01-04 (四)06-09 (五)01-04` 與 `循環經濟 (四)06-07`：只比第一段判定為不衝堂，比對全部時段正確判定為衝堂 |
| 週末課程 | 90 筆可正常排入，佔用第 6、7 天 |
| `ragTag` 興趣比對 | 以「機器學習」為關鍵字，主推方案中命中該標籤的課程可被正確加分 |

**瀏覽器實機驗收**

| 操作 | 結果 |
| --- | --- |
| `/schedule` 課表格 | 顯示星期一至星期日共七欄，`grid-template-columns` 為 8 欄（含時間欄） |
| 搜尋並排入 `建築設計(二)`（多時段） | 1 門課 4 學分，課表上渲染 **3 個區塊、佔用 12 格**，對應三個時段 |
| Console | 全新分頁載入後無任何錯誤，React key 警告已消失 |

- `node --check` 對 `server/src/**/*.js` 全數通過。
- `npm run lint`、`npm run build`：通過。

## 待處理

**0 學分課程**：422 筆課程學分為 0（班級活動、實習、碩士論文等）。這些課程不會使 `plan.totalCredits` 成長，因此貪婪迴圈的提前中止條件 `remaining.some(next => plan.totalCredits + next.credits <= plan.maxCredits)` 恆為真，會持續塞入 0 學分課程直到候選清單耗盡。需決定是否將這類課程排除於自動排課之外。

**類別不完整**：資料庫只有 `必修` / `選修`，沒有 `通識`、`核心選修`、`系外選修`。`docs/REQUIREMENTS.md:49-55` 的六類畢業學分要求目前無法由課程資料支撐。`Courses.subid3` 的前綴（如 `GEID`、`GEH1`）可能可用於推導通識類別，需進一步確認。

## 是否 commit 與 push

- 已 commit 並 push 至 `origin claude/personalized-schedule-algorithm-6324a3`。
