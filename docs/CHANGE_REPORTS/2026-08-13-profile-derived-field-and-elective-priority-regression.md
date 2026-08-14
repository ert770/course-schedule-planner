# Profile 衍生欄位與一般選修優先度回歸修正

## 修改日期

2026-08-13

## 問題背景

`courseHistory` 已在 A1 整併為修課歷史的唯一來源，課號與學分應由
`server/src/data/courseHistory.js` 當場計算，不得再把衍生結果放回 profile。
然而 `mapUserProfileRow()` 仍殘留 `completedCredits: 0`，造成
`GET /api/profile` 對實際已有 53 筆歷史修課的示範使用者回傳錯誤的零學分。

另一項審查意見指出 scheduler 的 `一般選修` 優先度會影響排序。Git 歷史確認這項
邏輯來自 2026-08-07 的 `f1dc3d5`，屬於 #12A 課程分類一致化，不是 A1-A9
整併時新增的改動。該 mapping 符合 `docs/SCHEDULING_LOGIC.md`，因此保留行為並補上
精準的排課回歸測試。

## 修改檔案

- `server/src/db/database.js`
  - 移除 MySQL profile 映射中的 `completedCredits: 0` 合成值。
- `server/test/databaseProfileContract.test.js`
  - 禁止 profile 資料層出現修課歷史可衍生的舊欄位名稱。
- `server/test/scheduler.test.js`
  - 驗證一般選修使用優先度 2，不落到未知類別預設值 5。
  - 驗證非系所班級的必修在學生範圍可判定時，降為一般選修優先度。
- `docs/CHANGE_REPORTS/2026-08-13-profile-derived-field-and-elective-priority-regression.md`
  - 記錄問題來源、影響、修正與驗證結果。

## 影響範圍

- Profile API 不再回傳假的 `completedCredits: 0`。需要總學分的呼叫端應由
  `courseHistory` 呼叫 `getTotalEarnedCredits()` 即時計算。
- 排課排序邏輯沒有改動；新增測試固定既有且有規格依據的類別優先度。
- 不修改 MySQL schema，也不寫入任何使用者偏好或歷史修課資料。

## 測試與驗證結果

- 修正前 API 基準：`GET /api/profile?userId=D1249697` 回傳
  `completedCredits: 0`，同時帶有 53 筆 `courseHistory`。
- 修正後 API 對照：相同使用者、相同資料庫與相同請求不再含
  `completedCredits`，53 筆 `courseHistory` 保持不變；在 3001 與 27151
  兩個本機後端埠結果一致。
- 針對性測試：`databaseProfileContract.test.js` 與 `scheduler.test.js`
  共 49 項，全數通過。
- 完整後端測試：`npm test` 共 282 項、61 suites，全數通過。
- 後端語法檢查：`server/src/**/*.js` 全數通過 `node --check`。
- 前端 build：在 `client/` 執行 `npm run build` 通過。
- 瀏覽器驗證：在已登入的 Dashboard 實際按下「套用偏好排課」，成功產生
  1 個方案、5 門課、14 學分；畫面顯示 11 門未排入課程的提示。
- 瀏覽器 console：沒有新增 error 或 warning。
- 排課 A/B 由可重現的純函式測試固定：一般選修相對未知類別會優先排入；
  非系所班級的必修不再以必修優先度壓過一般選修。

## Commit 與 Push

- Commit：是，與本報告同一提交。
- Push：是，目標 `origin/backend`。
