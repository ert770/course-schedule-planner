# A3 排課引擎依課號排除已通過課程

## 修改日期

2026-08-12

## 修改檔案

- `server/src/skills/scheduler.js`
- `server/test/scheduler.test.js`
- `client/src/pages/DashboardPage.jsx`
- `docs/CHANGE_REPORTS/2026-08-12-a3-exclude-passed-courses-by-code.md`

## 主要改動內容

- 排課器透過 `getPassedCourseCodes(constraints.courseHistory)` 當場取得已通過課號。
- 已修排除由 section id 改為 `course.subid3` 精確字串比對，使同一課號的所有班次及跨學期不同 section id 都能正確排除。
- 每個被排除的班次都會加入 `excludedCourses`，原因為「已修過並通過（課號 XXX）」，不再靜默消失。
- 課號比對不做 `trim`、大小寫轉換或其他正規化，也不沿用具有課名 fallback 的 `getCourseKey()`。
- 不新增重補修豁免；`passed: false` 的課號本來就不會進入已通過集合，可沿用既有 `retakeCourseIds` 流程。
- Dashboard 在成功排課但仍有 `excludedCourses` 時也會顯示提示，讓使用者能展開查看已修排除原因。

## 影響範圍

- 所有透過 `generateSchedule()` 產生的課表方案都會排除 `courseHistory` 中 `passed: true` 的課程。
- 同一課號的一課多班次會逐一留下排除紀錄。
- 沒有 `subid3` 的候選課程不會被誤判；課名相同也不作為已修判斷依據。
- 本次僅完成 Step 2 計畫的 A3，不包含 A4～A9。

## 測試與驗證結果

- 修改前合成基準：同課號 `IECS3002` 的兩個候選班次仍排入 section `101`，section `202` 只因「同一門課其他班次」被排除，沒有任何已修紀錄。
- 修改後同組資料：section `101`、`202` 均未排入，兩筆皆記錄「已修過並通過（課號 IECS3002）」。
- `cd server && node --test test/scheduler.test.js`：通過，45 項測試全數成功；其中 A3 新增 5 項案例。
- 根目錄 `npm test`：通過，275 項測試全數成功，0 項失敗。
- `server/src/**/*.js` 逐檔執行 `node --check`：全部通過。
- 根目錄 `npm run lint`：通過。
- 根目錄 `npm run build`：通過。
- 後端冷啟動成功，API 位於 `http://localhost:27151/api`；前端成功啟動並以瀏覽器驗收 Dashboard。
- 真實使用者排課 API：候選池中的 6 個已修班次均回傳已修排除原因，包含計算機結構學、計算機演算法、專題研究（一）及人工智慧導論 3 個班次；這三門已修必修均未出現在課表。
- Dashboard 實機結果：8 門、23 學分；成功結果顯示「8 門課未被排入」提示，展開後可直接看見已修課名、課號與原因。
- Browser console：無新增 error 或 warning。

## Commit 與 Push

- Commit：否。
- Push：否。
