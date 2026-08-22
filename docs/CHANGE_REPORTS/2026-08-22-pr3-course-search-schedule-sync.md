# 2026-08-22 變更報告：選擇性整合 PR #3 的搜尋與課表功能

## 修改日期

2026-08-22

## 背景與處理方式

PR #3 具備搜尋頁加選、關注與多時段搜尋等可用方向，但不能直接合併：原實作沒有等待
非同步驗證、送出錯誤的 `{ schedule }` request、驗證失敗時 fail-open，並把 boolean／Promise
當成衝突課程物件讀取。PR #10 又在此基礎上加入與既有後端持久化重複的 LocalStorage。

本次在 `backend` 最新狀態上建立 `codex/fix-pr3-course-search-schedule-sync`，只重作 PR #3
有價值的功能，不合併 PR #10，也不新增 LocalStorage 課表／關注資料源。

## 修改檔案清單

- `client/src/contexts/ScheduleContext.jsx`
- `client/src/contexts/ScheduleContextValue.js`
- `client/src/contexts/useSchedule.js`
- `client/src/App.jsx`
- `client/src/pages/DashboardPage.jsx`
- `client/src/pages/SchedulePage.jsx`
- `client/src/pages/SearchPage.jsx`
- `client/src/App.css`
- `server/src/skills/courseQuery.js`
- `server/test/courseQuery.test.js`
- `docs/TEST_PLAN.md`
- `docs/CHANGE_REPORTS/README.md`
- `docs/CHANGE_REPORTS/2026-08-22-pr3-course-search-schedule-sync.md`

## 主要改動

1. 新增登入者 scoped 的共用課表 context，Dashboard、排課頁與搜尋頁不再各自持有互不相通的課表。
2. `addCourse()` 先序列化快速連點，再 `await scheduleAPI.validate(proposed)`；既有 API wrapper
   固定送出 `{ courses }`。只有 legacy `valid` 與 extended `hardConstraintsValid` 都明確為
   `true` 才加入，HTTP／網路失敗一律拒絕。
3. 驗證失敗優先顯示 `violations[0]` 的 `constraintId`、`reason` 與結構化課程；相容既有
   `conflicts`／`duplicates` 形狀，不再對 boolean 或 Promise 讀 `.name`。
4. Dashboard 與排課頁新增明確的「儲存課表」與「從課表移除」。儲存接既有
   `scheduleAPI.save()`，登入與必要同意確定後由 `scheduleAPI.getSaved()` 載入最新版本。
   自動產生、搜尋加選與移除不會每次都 append 一份 saved schedule。
5. 搜尋頁關注按鈕接 `authAPI.updateWatchlist()`；內部只保存 section id，兼容舊使用者資料中
   的課程物件形狀。
6. 登出／切換帳號立即清空共用狀態；所有 saved schedule 載入、加選驗證與關注回應都帶帳號
   generation guard，舊帳號的晚到 response 不得覆寫新帳號畫面。
7. 課程搜尋改以完整 `timeBlocks` 判斷。day 與 period 必須命中同一區塊，避免「星期命中
   區塊 A、節次命中區塊 B」的假結果；時間未定課程在有時間條件時排除。
8. 條件搜尋的授課語言預設改為「全部」。只有使用者明確選取中文或英文才套用語言條件，
   避免未標註 language 的正式課程讓星期／節次搜尋固定得到 0 筆。

## 影響範圍

- 搜尋結果的加選、重複／衝堂提示與關注操作。
- Dashboard、排課頁、搜尋頁之間的課表同步。
- 已儲存課表的載入與明確儲存流程。
- 星期／節次搜尋多時段課程的結果。
- 登出、重新登入與切換帳號時的前端狀態隔離。
- 未修改 scheduler 的排課策略、MySQL schema、InteractionEvent schema、Raw Chat 或隱私保存規則。
- 未採用 PR #10 的 LocalStorage 或 runtime JSON 變更。

## 測試與驗證結果

### 自動驗證

- `npm run lint`：通過。
- `npm run build`：通過（Vite 1754 modules transformed）。
- 首次 `npm test`：481 項全數通過，0 failed；包含新增的 3 項多時段搜尋測試與既有
  `/api/schedule/validate` route 測試。
- 最終 `npm run verify`：lint、build 皆通過；480 項測試通過，唯一失敗是既有 MySQL
  資料契約查詢等待約 7 分鐘後收到 `ECONNRESET`，不是 assertion mismatch。隨即單獨重跑
  `node --test --test-name-pattern="同一 subid3" test/database-contract.test.js`，1/1 通過
  （約 1 秒），確認為暫時資料庫連線重設。
- `git diff --check`：通過；僅 PowerShell 顯示既有 LF／CRLF 轉換提示。

### 瀏覽器 A/B（localhost:5173，隔離帳號 `BROWSER01`）

1. 課表儲存：9 門、25 學分課表按「儲存課表」後顯示成功；重新整理仍為 9 門且不顯示
   自動排課 loading，證明載入 explicit saved version。
2. 儲存邊界：移除「嵌入式系統」並加入「行動應用程式開發」但不再儲存；重新整理後
   未儲存的新課消失、明確儲存的「嵌入式系統」恢復。
3. 加選 A/B：空出 3 學分後加入「行動應用程式開發」成功；改加「人工智慧導論」另一班次
   時顯示後端結構化原因「排入了同一門課的兩個班次」，按鈕仍可用且課程未加入。
4. 關注：關注「行動應用程式開發」後重新整理並重搜，按鈕維持「已關注」。
5. 多時段 A/B：「系統安全」的第二個時段為星期四第 8 節；day=4、period=8 查到 2 筆且
   包含該課，改成 day=4、period=3 為 0 筆，沒有跨兩個 time block 假命中。
6. 帳號生命週期：登出導向 `/login`；重新登入與完成既有 setup gate 後載入先前儲存的
   9 門課表，不殘留未儲存版本。
7. Console：上述流程沒有 error 或 warning。
8. 驗收造成的 fixture `watchlist` 與 `saved_schedules.json` 副作用已只針對本次產生內容清除；
   `server/data` 與 Chat 未修改。

## Commit 與 Push

- 本報告與上述程式、測試及文件變更一併 commit。
- Push 目標：`origin codex/fix-pr3-course-search-schedule-sync`。
- `server/data/users.json`、`server/data/saved_schedules.json` 的執行期變更不納入 commit。
