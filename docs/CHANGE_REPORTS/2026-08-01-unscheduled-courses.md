# 2026-08-01 修復無時間課程被無限排入（#14）

## 修改日期

2026-08-01

## 修改檔案清單

- `server/src/skills/scheduler.js`
- `client/src/pages/DashboardPage.jsx`
- `docs/SCHEDULING_LOGIC.md`
- `docs/API_SPEC.md`
- `docs/TEST_PLAN.md`

## 問題

`time_str` 節次為 `00`（例如 `(一)00`）代表課程**尚未排定上課時間**，解析後 `timeBlocks` 為空陣列。

`getTimeBlocks()` 對這類課程回傳 `[]`，因此：

- `timeConflict()` 恆為 `false`，與任何課都不衝堂
- 不受封鎖時段、早八、晚課、午休限制
- `getUsedDays()` 回空集合，單日課程數上限不計入

貪婪迴圈的提前中止條件為：

```js
remaining.some(next => plan.totalCredits + next.credits <= plan.maxCredits)
```

0 學分課程使其恆為真，迴圈會跑到候選清單耗盡。

**實測基準（3560 筆真實課程）**

| 指標 | 修復前 |
| --- | ---: |
| 主推方案總門數 | 86 |
| 其中**無時間課程** | **65（76%）** |
| 真正有時間的課程 | 21 |
| 全校無時間課程 | 226（其中 65 門為 0 學分） |

課表格上顯示 21 門，但門數與學分卻按 86 門計算，兩者對不起來。

## 主要改動內容

依先前確認的原則，**不排除 0 學分課程**（班級活動與論文屬必要課程，實習搭配同名正課），問題在於「無有效時間」的處理方式。

- 新增 `hasScheduledTime(course)` 判定。
- `addCourseToPlan()` 將無時間課程放入新的 `plan.unscheduledCourses`，不進入 `plan.schedule`，避免與有時段的課程混在課表格上。學分照常計入。
- 貪婪填充階段的候選集**排除無時間課程**。它們不受任何限制，若可自由填入會被無限累積；僅在被明確指定為必要課程（`mustTakeCourseIds` / `retakeCourseIds` / `selectedCourseIds` 或必修）時才排入。
- 提前中止條件改為只計入**還能推進學分**的課程：

  ```js
  remaining.some(next => (next.credits || 0) > 0
    && plan.totalCredits + next.credits <= plan.maxCredits)
  ```

- `plan.courseCount` 改為 `schedule.length + unscheduledCourses.length`，與 `totalCredits` 的計算基礎一致。
- `plan.success` 與 `watchOnly` 納入 `unscheduledCourses`：只有無時間課程也是合法結果，不應判定為失敗。
- 排入無時間課程時發出警告，列出去重後的前 3 種課名與總數。
- 回應訊息補上門數組成說明，修正「21 門課，共 25 學分」這種門數只算課表格、學分卻含表格外課程的內部矛盾。現在顯示「21 門課（另有 65 門時間未定），共 22 學分」。
- 前端 `buildScheduleNotice()` 納入 `unscheduledCourses`，提示橫幅新增可展開清單，顯示課名、學分與班級。

## 影響範圍

- `POST /api/schedule/generate` 與 `POST /api/chat` 的排課工具。
- 回應新增 `unscheduledCourses` 欄位（向後相容的新增）。
- **行為變更**：`schedule` 不再包含無時間課程，`courseCount` 改為含之。先前產生的課表若含無時間課程，重新排課後 `schedule` 內容會不同。

## 測試與驗證結果

**排課測試案例**：S1-S10、M1-M4、W1-W3 加上新增的 U1-U6，**22 項全數通過**。

新增案例：

| 編號 | 情境 | 結果 |
| --- | --- | --- |
| U1 | `schedule` 內每門課都有排定時間 | 通過 |
| U2 | 貪婪填充不主動加入無時間課程 | 通過 |
| U3 | 被指定的無時間課程仍會排入 `unscheduledCourses` | 通過 |
| U4 | 排入後發出警告 | 通過 |
| U5 | `courseCount` 含無時間課程 | 通過 |
| U6 | 50 門 0 學分課程不會讓迴圈跑到耗盡 | 通過 |

**真實資料驗證（3560 筆）**

| 指標 | 修復前 | 修復後 |
| --- | ---: | ---: |
| `schedule`（課表格） | 86 | **21** |
| 其中無時間課程 | 65 | **0** |
| `unscheduledCourses` | — | 65 |
| `courseCount` | 86 | 86 |
| 排課耗時 | 0.2s | 0.17s |

**瀏覽器實機驗收**

儀表板載入後提示橫幅正確顯示：

- 訊息：「21 門課（另有 65 門時間未定），共 22 學分」
- 警告：「有 65 門課尚未排定上課時間，不會顯示在課表格上：碩士論文、博士論文、畢業論文(一)」
- 可展開清單：「有 65 門課時間未定，查看清單」，逐筆顯示課名、學分與班級

- `node --check` 對 `server/src/**/*.js` 全數通過。
- `npm run lint`、`npm run build`：通過。

## 未解決的相關問題

那 65 門無時間課程**仍然會被排入**，因為它們的 `category` 是 `必修`，在必修階段就被加入。這是 `#13`（必修範圍錯誤：全校必修被當成每位學生的必修）的問題，不在本次範圍。

本次修復確保的是：它們不再污染課表格、不再讓貪婪迴圈失控、且使用者看得到它們的存在。

## 是否 commit 與 push

- 已 commit 並 push 至 `origin claude/personalized-schedule-algorithm-6324a3`。
