# 課程主題摘要與保存後重排

修改日期：2026-11-24

## 修改檔案

| 檔案 | 改動 |
| --- | --- |
| `client/src/pages/SetupPage.jsx` | 將 Profile 隨附的主題摘要交給問答元件，保存成功後交由首頁重排。課程主題未調整時省略 `interestSelections`，避免重跑候選池驗證。 |
| `client/src/components/Profile/InterestQuestionnaire.jsx` | 直接顯示已保存的方向及正規化後的具體主題，開始作答時再查方向在本學期的可用性。 |
| `client/src/pages/DashboardPage.jsx` | 首頁側欄暫存勾選，按保存時一次寫入，並與設定頁共用排課及方案呈現流程。 |
| `server/src/routes/profile.js`、`server/src/services/interestQuestionnaireService.js` | 由既有標籤目錄組成 `interestSummary`，與 Profile 同一次回應傳回。 |
| `server/test/interestQuestionnaireService.test.js` | 覆蓋查目錄摘要、舊版方向、未知標籤及跨組重複主題。 |
| `docs/API_SPEC.md`、`docs/DATA_SCHEMA.md`、本報告 | 記錄新增的回應欄位與保存、重排行為。 |

## 影響範圍

課程興趣頁按本系、通識與系外列出已保存方向，具體主題顯示目錄中的正規化名稱，同一個標籤只顯示一次。摘要隨 `GET /api/profile` 傳回，開啟頁面即可顯示。課程範圍和選項資格仍使用既有問答候選池。

已完成設定的使用者保存變更後，首頁以 `preference_regenerate` 觸發一次後端排課。首頁「我的排課偏好」接受多項勾選，按保存後使用同一流程。首頁使用後端回傳的課表、方案名稱、門數、學分及方案說明。首次設定與進行中的探索沿用原路徑。已保存的星期一排空由後端限制服務套用，本次避開與手動加選仍一併傳入排課請求。

保存失敗時保留待保存的勾選供重試。偏好已保存而重排失敗時，畫面提示課表未更新，使用者可用「套用偏好排課」重試。推薦課表沿用獨立的儲存流程。

## 驗證結果

- 前端 build、lint、`server/src/**/*.js` 語法檢查與修改檔案的 `git diff --check` 通過。
- `npm test` 共 1,960 項，1,946 通過、14 跳過、0 失敗。
- 本環境未提供 `preview_start`。以前端 Vite、後端 Express 啟動本機系統，確認 `/setup` 與代理 `/api/health` 可連線。
- Chrome 使用固定 API 驗收資料，主題摘要由正式目錄的摘要函式產生。進入「課程興趣」即顯示「軟體開發」，開場的額外摘要請求為 0。
- 用同一個驗收帳號比較前後。開啟設定及首頁勾選偏好尚未保存時，保存與重排次數維持原值。設定頁保存「星期一排空」後新增 1 次保存、1 次排課，首頁顯示「個人化綜合方案」、「4 門・10 學分」和可收合的「方案說明」。從首頁移除「星期一排空」並勾選「不排早八」後，一次保存並重排一次，兩次排課取得不同的已保存偏好與課表格位置。
- 模擬保存失敗時未送重排；模擬保存成功但排課失敗時看見提示，重試只發排課請求。Chrome 主控台未出現 JavaScript 錯誤或警告。瀏覽器流程使用固定驗收資料。

## Git 狀態

移轉至 `backend` 後再次通過前端 build、lint、後端語法檢查與相同的 Chrome 驗收。該分支的完整 `npm test` 含 golden set，共 1,832 項，1,813 通過、19 跳過、0 失敗。

本報告隨功能變更提交至 `backend`，推送目標為 `origin/backend`。
