# 2026-08-23 變更報告：補齊 PR #3 有效 UI/UX

## 修改日期

2026-08-23

## 修改檔案

- `client/src/pages/SearchPage.jsx`
- `client/src/pages/LoginPage.jsx`
- `client/src/pages/DashboardPage.jsx`
- `client/src/pages/SchedulePage.jsx`
- `client/src/pages/GraduationPage.jsx`
- `client/src/hooks/useClickOutside.js`
- `client/src/App.css`
- `docs/TEST_PLAN.md`
- `docs/CHANGE_REPORTS/README.md`
- `docs/CHANGE_REPORTS/2026-08-23-pr3-ui-ux-alignment.md`

## 主要改動

1. 搜尋結果中的已選課程改為紅色「取消加選」，直接呼叫共用課表 context 的
   `removeCourse()`；移除後同一卡片回到藍色「加入課表」，重新加入仍先通過既有後端驗證。
2. 新增「❤️ 我的關注」頁籤。關注清單仍只由後端使用者資料保存 section ID，前端進入頁籤時
   透過既有 `GET /api/courses/:id` 還原課程卡片；部分 ID 失效時保留可載入課程並顯示警告。
   未新增 LocalStorage 關注資料源。
3. 「依系所查詢」及「依條件查詢」皆新增可辨識的重設按鈕。前者只清除修別與關鍵字，
   保留 Profile 派生且不可任意修改的系所、年級與班級；後者清空全部使用者輸入條件。
4. 登入期間停用學號、密碼、顯示密碼與提交按鈕，提交按鈕呈現 spinner 與
   `aria-busy=true`。密碼顯示按鈕恢復鍵盤可達性，並依狀態切換「顯示密碼／隱藏密碼」名稱；
   登入錯誤使用 `role=alert`。
5. 新增共用 `useClickOutside` hook，Dashboard、排課、搜尋及畢業進度的使用者選單皆支援
   點擊外部或按 Escape 關閉，現有選單項目不刪減。

## 影響範圍

- 課程搜尋頁的加退選、關注集中管理與條件重設。
- 登入送出期間的狀態提示與鍵盤／螢幕閱讀器操作。
- 四個登入後頁面的使用者選單關閉方式。
- 未修改後端 API、資料 schema、課表演算法、Profile、隱私規則或 Chat。
- `removeCourse()` 仍修改尚未儲存的共用課表草稿；是否持久化仍由使用者按「儲存課表」決定。

## 測試與驗證

### 自動驗證

- `cd client && npm run lint`：通過。
- `cd client && npm run build`：通過，Vite 轉換 1755 modules。
- `npm test`：481 項通過，0 failed、0 skipped。
- `git diff --check`：通過；僅顯示既有 LF／CRLF 轉換提示。

### 瀏覽器 A/B

使用隔離 fixture `server/test/fixtures/browser-without-failed` 的 `BROWSER01` 帳號驗收搜尋功能；
臨時環境使用 server `3004`、client `5177`，避免與原本已占用且資料來源不同的 `3001` 程序衝突。

1. 加退選：搜尋結果原本顯示紅色「取消加選」的「計算機結構學」，點擊後變為藍色
   「加入課表」並顯示移除成功；重新加入通過驗證後恢復紅色「取消加選」。未按儲存課表。
2. 關注持久化：「❤️ 我的關注」初始為 0 筆；關注「行動應用程式開發」後顯示 1 筆完整課程卡，
   重新整理並再次進入頁籤仍為 1 筆；取消關注後立即回到 0 筆。fixture 已還原，沒有保留 watchlist。
3. 重設：依系所表單的關鍵字與核心選修被清空，系所／年級仍為資訊工程學系／大三；
   依條件表單的代號、課名、星期、節次與語言全部由已填值恢復為空值。
4. 選單：Dashboard、排課、搜尋及畢業進度四頁皆驗證開啟後點擊頁面外可關閉；搜尋頁另驗證
   Escape 可關閉。
5. 登入 loading：以不寫資料、延遲 1.2 秒的本機驗收端點做 A/B。送出前四個控制皆可用；
   送出期間四個控制皆停用、提交文字為「登入中...」且 `aria-busy=true`；失敗回應後恢復可用，
   錯誤訊息為 alert。密碼按鈕由 password 切換為 text，名稱由「顯示密碼」改為「隱藏密碼」。
6. Console：上述 app 與登入流程均為 0 error、0 warning。
7. 驗收後已關閉 `3002–3005` 與 `5174–5178` 臨時程序，只保留原有 `3001` 及標準前端 `5173`。

## Commit 與 Push

- 本次變更依使用者指示 commit。
- 本次變更推送至 `origin/codex/fix-pr3-course-search-schedule-sync`。
- 既有 `server/data/users.json`、`server/data/saved_schedules.json` 執行期修改未納入也未覆寫。
