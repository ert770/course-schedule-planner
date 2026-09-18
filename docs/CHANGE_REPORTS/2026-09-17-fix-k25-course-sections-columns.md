# 2026-09-17 修復 K25／P0-0：`getMysqlCourses()` 欄位名稱與共用資料庫不符

## 修改日期

2026-09-17

## 為什麼做這件事

建立 `docs/application-portfolio/` 時，直接查詢共用 Aiven MySQL 發現 `server/src/db/database.js` 的 `getMysqlCourses()` 查詢寫的欄位名稱是 `current_amount`／`limit_amount`，但共用資料庫的 `Course_Sections` 表實際欄位是 `current_student`／`limit_student`（研判是共用這個資料庫的其他組把欄位改名，本 repo 的程式碼沒有跟著更新）。`getAll('courses')`（呼叫到這個函式）是 `courseQuery.js`、`graduation.js`、`agentService.js`、`reviewSearch.js`、`scheduleService.js` 共用的課程資料入口，只要設定了 `DB_HOST`／`DB_USER`／`DB_NAME`（`server/.env` 就是這樣），課程搜尋、排課、Agent、畢業頁整條路徑都會直接失敗（`ER_BAD_FIELD_ERROR`）。這件事已記錄在 `docs/application-portfolio/01_目前已完成/07_已知限制.md` 的 K25 與 `05_推甄前預計完成/01_P0必要工作.md` 的 P0-0（自排的最高優先項目）。本人指示先用 plan mode 規劃再修，確認修復範圍只改欄位名稱、不加防護層後動手。

## 修改檔案清單

- `server/src/db/database.js`：
  - `getMysqlCourses()` 的 SQL：`cs.\`current_amount\`` → `cs.\`current_student\``；`cs.\`limit_amount\`` → `cs.\`limit_student\``。
  - `mapCourseRow()`：`capacity: normalizeNullableNumber(row.limit_amount)` → `row.limit_student`；`currentAmount: normalizeNumber(row.current_amount, 0)` → `row.current_student`；同時更新一段提到舊欄位名稱的過時註解。
- `docs/application-portfolio/`（13 個檔案）：把 K25／P0-0 的狀態從「待修復」更新成「已修復」，含新的 18/18 測試結果與瀏覽器實測證據——`01_目前已完成/07_已知限制.md`（K25 本體刪除，header 補說明）、`00_功能完成度總表.md`、`02_系統設計圖/05_ER_Diagram.md`、`05_推甄前預計完成/00_Roadmap.md`、`01_P0必要工作.md`、`04_風險與替代方案.md`、`07_測試與評估/09_測試結果摘要.md`、`09_展示素材/08_備用Demo計畫.md`、`00_專題基本資料/04_團隊分工.md`、`06_專題時程.md`、`07_待確認與待補清單.md`、`10_專題完整報告/專題完整報告.md`、`README.md`。
- `docs/application-portfolio/07_測試與評估/evidence/`：新增 `database-contract-fixed-2026-09-17.txt`（修復後 18/18 的完整輸出）、`backend-test-run-post-k25fix-2026-09-17.txt`（全套測試 1,055/1,058）。

## 主要改動

- 只改了兩個欄位名稱（SQL 與對應的 JS 屬性讀取），沒有改變任何回傳給前端／Agent 的欄位名稱（`capacity`、`currentAmount` 這兩個 app 層欄位名稱本身沒有變，只是它們現在能正確讀到值）。
- 討論後決定**不**比照 `getMysqlUserPreferences()` 的 `hasUserProfile*Column()` 動態偵測模式加防護層：`capacity`／`currentAmount` 經全 repo 搜尋，目前沒有任何呼叫端消費（`scheduler.js`、`courseQuery.js`、路由、Agent 都沒有讀取），改名不影響任何下游行為；而且這個防護模式原本是為了「本 repo 自己 migration 陸續加的選填欄位」設計的，語意上不完全適用「必填但被外部改名」的情境。風險（共用資料庫可能再被改名）記錄在 R1，沒有消除。
- 修復過程中意外發現：`capacity`／`currentAmount` 這兩個欄位原本文件（含程式碼註解）都寫「全庫仍是 NULL」，但查詢修好之後看到真實非 NULL 資料（例如 `capacity:60, currentAmount:13`）——代表資料庫在被改名的同時也把資料填進去了，只是程式一直讀錯欄位名稱所以完全看不到。已在 `07_已知限制.md`、`05_ER_Diagram.md`、`01_P0必要工作.md` 記錄這個發現。

## 測試與驗證

- `node --test-force-exit test/database-contract.test.js`：修復前 15/18（3 個因 `ER_BAD_FIELD_ERROR` 失敗），修復後 **18/18**（見 evidence）。
- `node --test test/scheduler.test.js`：165/165 全過，確認排課核心測試（全部用記憶體資料）不受影響。
- `CI=true node --test --test-force-exit "test/**/*.test.js"`：1,058 個測試，1,055 通過、3 fail，3 個 fail 都是既有的 Windows libuv file-level 問題（`authRoutes`、`privacyRoutes`、`scheduleRoutes`），與本次修改無關，跟修復前最早一次的全套測試結果一致。
- **瀏覽器驗收**：啟動 `server`／`client` 兩個 dev server，用 Persona C（userId 4）登入。Setup 頁的「完成設定，生成推薦課表」按鈕觸發 `POST /api/schedule/generate`，因為這個 demo 帳號本地資料缺 `class_name` 而回 400（`CLASS_NAME_REQUIRED`，與 K25 無關的既有資料缺口，不在本次修復範圍）。為了直接驗證 `getMysqlCourses()` 本身，改用瀏覽器直接呼叫 `GET /api/courses?department=資訊工程學系&gradeLevel=4&className=資訊四合`，回傳 200 與真實課程列表（`capacity:60, currentAmount:13` 等），不再是 500／`ER_BAD_FIELD_ERROR`。檢查 server log 沒有新增錯誤。
- 重新用 `@mermaid-js/mermaid-cli` 驗證全部 17 個 Mermaid 圖（含本次編輯過的 `00_Roadmap.md`、`05_ER_Diagram.md`），確認仍能解析。

## 影響範圍

- 只有 `server/src/db/database.js` 一個功能檔案被修改，前端沒有變動（`git diff --stat -- client` 為空）。
- 修復後，MySQL 模式下的課程搜尋／自動排課／Agent／畢業頁四條路徑理論上都恢復正常；已直接驗證課程搜尋，排課／Agent／畢業頁走同一個 `getAll('courses')` 入口，邏輯上同時修復，但沒有逐一在瀏覽器裡把另外三個路徑跑過。
- Persona C 這個 demo 帳號本地缺 `class_name`（`CLASS_NAME_REQUIRED`）是另一個既有、與本次修改無關的資料缺口，沒有一併處理。

## 是否 commit 與 push

未 commit，等待使用者指示。
