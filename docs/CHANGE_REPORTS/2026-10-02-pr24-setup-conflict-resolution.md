# PR #24 設定頁衝突：保留新版收合介面並整合興趣與剩餘學期

日期：2026-10-02
分支：backend
PR：#24（backend → main）

## 問題

PR #24 與 main 的唯一合併衝突是 `client/src/pages/SetupPage.jsx`。main 已把設定頁改成單欄收合式偏好介面並加入 MBTI；backend 則在舊版版面加入主要修課路徑、興趣主題與剩餘學期。直接採用任一側都會遺失另一側的使用者功能。

## 修改內容

以 main 的新版設定頁為基礎，保留 MBTI、基本資料、偏好標籤、避開時段與收合式操作，再接入 backend 的欄位與資料流：

- 基本資料區新增剩餘學期選擇，可設 1～8 學期；留空時交由系統依年級推算。
- 收合偏好區新增主要修課路徑、候選課程主題與自訂興趣。路徑與主題由既有課程興趣選項 API 依系所、年級、班別載入，不在前端另寫固定標籤清單。
- 讀取 profile 時帶回剩餘學期、主要修課路徑、興趣主題與舊有 preferredKeywords；儲存時與 MBTI、偏好標籤及避開時段一併送出。
- 依實際設定更新收合區摘要；興趣選項載入失敗時顯示可理解的錯誤訊息。

未新增 API 或資料欄位；使用既有 profile 欄位與 `coursesAPI.getInterestOptions()`。

## 修改檔案

- `client/src/pages/SetupPage.jsx`：整合新版 UI 與剩餘學期、興趣偏好的載入、顯示及儲存。
- `docs/CHANGE_REPORTS/README.md`：加入本報告索引。
- `docs/CHANGE_REPORTS/2026-10-02-pr24-setup-conflict-resolution.md`：記錄衝突、解法、驗證與提交狀態。

## 驗證

- `client` lint：通過。
- `client` production build：通過。
- `npm test`：一般模式跑完測項後未退出，未印出摘要；改用 `node --test --test-force-exit "test/**/*.test.js"` 得到 **1353／1356 通過**。三個檔案層級失敗是既有 Windows libuv teardown 問題：`authRoutes.test.js`、`privacyRoutes.test.js`、`scheduleRoutes.test.js`；本次沒有修改後端。
- 唯讀 API 檢查：`GET /api/courses/classes` 回傳 5 個資工大三班別；選取一個班別呼叫 `GET /api/courses/interest-options`，回傳 3 條修課路徑與 16 個主題。
- 瀏覽器：在本機已登入的測試工作階段開啟新版設定頁，確認原有基本資料、MBTI、偏好標籤與避開時段仍在；剩餘學期選單提供「依年級推算」及 1～8 學期，測試選取 4 學期後重新載入，欄位回到伺服器原存值，沒有送出表單。
- 畫面 A/B：原有興趣路徑與主題有回填時，摘要顯示「興趣方向已設定」；按「目前沒有特定方向，先平均探索」後，摘要改為「興趣方向未設定」，重新載入又恢復原存選項。此測試只改瀏覽器中的未儲存表單狀態，沒有寫入 profile。
- 實機選定資工大三班別後，興趣選項 API 在畫面顯示 3 條路徑、16 個主題及候選課數；瀏覽器 console 沒有新增 warn/error。設定頁已留在本機瀏覽器供檢視。

## Git 狀態

未 commit、未 push；PR #24 尚未因本次工作更新，需將修改提交並推送至 `backend` 後，GitHub 才會重新計算合併狀態。
