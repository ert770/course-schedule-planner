# 2026-08-01 統一評價統計與星期顯示

## 修改日期

2026-08-01

## 背景

`/codex:adversarial-review` 對分支變更提出兩項 medium 發現，均成立。兩者是同一類問題：**改了資料層卻沒同步所有消費端**。

## 修改檔案清單

- `server/src/skills/reviewStats.js`（新增）
- `server/src/skills/reviewSearch.js`
- `server/src/skills/courseQuery.js`
- `client/src/utils/courseTime.js`（新增）
- `client/src/components/CourseCard/CourseCard.jsx`
- `client/src/pages/DashboardPage.jsx`
- `client/src/pages/SchedulePage.jsx`
- `client/src/pages/SearchPage.jsx`

## 問題一：評價統計未一致加權

`Course_Reviews` 的一列代表彙總後的多則評價，`review_count` 才是實際評論數。`reviewSearch.js` 已改為加權計算，但 `courseQuery.js` 的 `getCourseDetail()` 仍以資料列數為評論數、以列數平均分數。

**後果**：同一門課從 `/api/courses/:id` 與 `/api/reviews/:courseId` 會得到不同的評論數、平均分與情緒統計。例如「總體經濟學」實際 6 則評論僅 1 列，課程詳情會回報 `reviewCount: 1`。

**根因**：加權邏輯是 `reviewSearch.js` 的私有函式，`courseQuery.js` 無從沿用，兩者必然漂移。

**修法**：抽出 `server/src/skills/reviewStats.js` 共用模組，提供 `getReviewWeight`、`getTotalReviewCount`、`weightedAverageScore`、`countBySentiment`、`calculateEasinessFromAverages`、`roundScore`，以及給兩個 API 共用的 `summarizeReviews()`。`reviewSearch.js` 與 `courseQuery.js` 皆改為引用，移除重複實作。

## 問題二：星期顯示未支援週六日

後端已解析週六與週日課程、`ScheduleGrid` 已擴為七欄，但其餘顯示路徑仍硬編五天陣列。

**受影響位置**

| 檔案 | 原本寫法 |
| --- | --- |
| `CourseCard.jsx:1` | `DAYS = ['', '一', '二', '三', '四', '五']` |
| `DashboardPage.jsx` 匯出課表 | `'一二三四五'[c.dayOfWeek-1]` |
| `DashboardPage.jsx` 聊天課表摘要 | 同上 |
| `SchedulePage.jsx` 課程詳情彈窗 | `['', '一', '二', '三', '四', '五'][dayOfWeek]` |
| `SearchPage.jsx` 搜尋結果 | `'一二三四五'[course.dayOfWeek-1]` |

`dayOfWeek` 為 6 或 7 時全部顯示「週undefined」。未排定時間的課程（`dayOfWeek` 為 `null`）同樣顯示 undefined。

**修法**：新增 `client/src/utils/courseTime.js`，提供 `formatDayOfWeek()` 與 `formatCourseTime()`。後者支援七天、多時段（逐段列出）、以及未排定時間（顯示「時間未定」）。五處全部改為引用。

## 影響範圍

- `GET /api/courses/:id` 的 `stats` 數值改變（改為加權後的正確值），並新增 `avgCoolness`、`avgSweetness`、`avgWorkload`、`avgOverall`。
- 前端所有顯示課程時間的位置，週末與多時段課程的顯示內容改變。

## 測試與驗證結果

**評價統計一致性**

以 `getEasyCourses(3)` 取樣三門課，逐一比對 `/api/courses/:id` 與 `/api/reviews/:courseId`：

| 課程 | 資料列數 | 加權後評論數 | 兩 API 是否一致 |
| --- | ---: | ---: | --- |
| 總體經濟學 | 1 | 6 | ✅ |
| 政府會計 | 1 | 5 | ✅ |
| 商用英文會話(二) | 1 | 6 | ✅ |

修復前 `reviewCount` 會是「資料列數」欄的值。

**星期顯示（瀏覽器實機）**

以真實資料驗證，搜尋「跨領域畢業專題(一)」取得 8 張卡片，涵蓋週日課程與未排定時間課程：

| 情境 | 修復前 | 修復後 |
| --- | --- | --- |
| 週日課程 `(日)06-08` | 週undefined | **週日 第6-8節** |
| 未排定時間 `(一)00` | 週undefined | **時間未定** |
| 課程詳情彈窗 | 週undefined | **⏰ 週日 第6-8節** |

卡片與彈窗皆確認無 `undefined` 字串。

**其他**

- 全專案掃描已無殘留的五天硬編陣列（僅 `courseTime.js` 註解中作為說明保留）。
- `node --check` 對 `server/src/**/*.js` 全數通過。
- `npm run lint`、`npm run build`：通過。
- Console：全新載入後無任何錯誤。
- 截圖因 Browser pane 未顯示而失敗，屬環境限制；驗證以 DOM 量測為準。

## 是否 commit 與 push

- 已 commit 並 push 至 `origin claude/personalized-schedule-algorithm-6324a3`。
