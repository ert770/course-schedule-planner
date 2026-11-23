# 整合隊友的學生註冊與 MyFCU 歷史修課匯入（ADR-034）

日期：2026-11-23｜分支：`feature/integrate-myfcu-history`（自最新 main）

## 背景

隊友交付 `feature/myfcu-session-import`（commit `1d9db09`，bundle 與說明文件）。只讀盤點結果：

- 與團隊 repo 沒有共同歷史；來源 476 檔、團隊 674 檔，共同檔案中 92 個不同，大多因來源底稿較舊。
- migration 010～015 在共用 MySQL **已全部套用**，整合不需執行任何 DDL。
- 3 個衝突：demo／Persona 帳號登不進去、匯入的修課紀錄進不了推薦、跨學期同名同分被合併。

使用者決定（2026-11-23）：A(1) 沒有密碼雜湊時非 production 退回 users.json；B(a) 讀取時補分類；C 學期不同不合併；D `1804…` 帳號與受試流程先不處理。

## 修改檔案

### 新增（自來源移植，共 94 個）

- 後端：`accountService.js`、`db/userIdAllocator.js`、`routes/courseHistoryImport.js`、`routes/courseHistory.js`、`routes/controlledBrowser.js`、匯入／快照／MyFCU 擷取相關服務、`server/src/myfcu/*`、`server/scripts/` 的 MyFCU 診斷與啟動腳本、`server/migrations/010～015`（僅紀錄）。
- 前端：`RegisterPage.jsx`、`CourseHistoryImportPage.jsx`、`CourseHistoryPage.jsx`、`ControlledHistoryMockPage.jsx`、`utils/historyNameDedup.js` 等。
- 測試：約 30 個測試檔與虛構 fixtures（已掃描，沒有金鑰或真實學號）。
- 文件：`docs/AIVEN_HISTORY_MIGRATION_RUNBOOK.md`。未移植來源的 `GITHUB_DELIVERY_CHECKLIST.md`（來源私人交付用）與其變更報告。

### 合併

| 檔案 | 內容 |
| --- | --- |
| `server/src/routes/auth.js` | 註冊、註冊選項、MySQL 優先登入（argon2id）；**新增：沒有雜湊時非 production 退回 users.json** |
| `server/src/services/identityService.js` | 依 `student_id` 查 MySQL；**改：`legacyAuthEnabled()` 非 production 預設開啟，`ALLOW_LEGACY_JSON_AUTH=false` 關閉** |
| `server/src/app.js` | 掛 3 組 route、2MB body 限制、本機 MyFCU 環境防護、listen host |
| `server/src/db/database.js` | **新增 `isUsableHistoryRow()`、`fillMissingHistoryCategories()`：略過無課號／成績無法判讀的列，NULL 分類依科目表補** |
| `client/src/utils/historyNameDedup.js` | **改：課名＋學年＋學期才合併** |
| `client/src/App.jsx`、`AuthContext.jsx`、`LoginPage.jsx` | 註冊、匯入、歷史修課路由；「建立學生帳號」連結 |
| `client/src/services/api.js` | `register`、`courseHistoryAPI`、`controlledBrowserAPI`、`courseHistoryImportAPI`，請求可關閉 401 自動導向 |
| `client/src/pages/DashboardPage.jsx` | 匯入摘要、「歷史修課紀錄」入口、開發模式同步按鈕；**改：設定查詢 404 視為未開放，不顯示錯誤** |
| `client/src/App.css` | 歷史修課與註冊頁樣式 |
| `server/test/historyTrace.test.js`、`registration.test.js` | 依決定 C、A 改寫兩個測試 |
| `server/test/importedHistoryCategories.test.js`（新增） | 讀取時補分類與略過規則 |
| `docs/API_SPEC.md`、`docs/DATA_SCHEMA.md`、`docs/DECISIONS.md` | 新增端點、migration 010～015 現況與讀取規則、ADR-034 |

`server/package.json` 未加 `playwright`：只有真實 MyFCU 擷取會 lazy require，執行時另外安裝，避免本次下載與改動鎖檔。

## 影響範圍

- 登入流程改為 MySQL 優先；有雜湊的帳號只驗雜湊。
- 歷史修課讀取不再因匯入列的 NULL 欄位整份失敗。
- 首頁多了「歷史修課紀錄」與「同步 MyFCU 修課紀錄（尚未開放）」按鈕；登入頁多了註冊連結。
- 不影響排課、探索、畢業計算的規則本身。

## 測試與驗證

- `npm test`：1949 項，1935 通過、0 失敗、14 略過（13 個需要 Playwright 的新測試、1 個既有略過）。
- 前端 lint、build 通過；`node --check` 全部 `server/src/**/*.js` 通過；新增與合併的後端模組逐一 import 成功。
- 唯讀查證（共用 MySQL）：
  - 隊友匯入的帳號（user 2，55 筆）：main 的讀取會因 NULL 欄位丟出錯誤；新讀取得到 39 筆可用紀錄（16 筆無課號略過），分類為必修 18、通識 5、選修 4、未分類 12。
  - demo 帳號 D1249697：53 筆，與原本一致。
- 瀏覽器（本機，D1249697）：
  - 登入：正確密碼走 users.json 退回成功；錯誤密碼 401；不存在的學號 401。
  - 首頁：課表自動產生（6 門）；新按鈕出現；修正後不再顯示「本機同步設定查詢失敗」（修正前每次載入都打 404 並顯示錯誤）。
  - 歷史修課紀錄頁：列出 53 筆。
  - 註冊頁：系所選項由後端載入；空白送出被前端擋下（「非正常學號」），**沒有實際建立帳號**（會寫入共用 DB）。
  - 探索（兩種模式）與畢業進度 API 回 200。
- **沒有驗證**：實際註冊一個帳號、MyFCU 模擬擷取頁、真實 MyFCU 擷取、快照與交易匯入的端到端流程。

## Commit 與 push

已 commit 並 push 至 `feature/integrate-myfcu-history`，開 PR 合入 main。`docs/CHANGE_REPORTS/README.md` 只提交本報告的索引一行。
