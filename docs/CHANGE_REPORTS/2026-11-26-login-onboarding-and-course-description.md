# 登入引導與課程詳情

修改日期為 2026-11-26。涵蓋使用者第 13、14 項。

## 變更

- 首次登入依序完成隱私同意、MyFCU 修課匯入、排課偏好及首次排課。已有修課紀錄時跳過 MyFCU。環境未開放匯入時可先設定偏好。
- 註冊時保存首次引導進度。保存偏好後進入排課步驟。課表成功生成並保存後才進首頁；失敗可重試，重新登入可接續排課。
- 課程詳情移除與課名完全相同的開頭標題，加粗「先修條件」和「課程說明」。

## 修改檔案

- 前端路由與狀態｜`App.jsx`、`AuthContext.jsx`、`ScheduleContext.jsx`。
- 前端畫面｜`LoginPage.jsx`、`PrivacyPage.jsx`、`HistoryOnboardingPage.jsx`、`ControlledHistoryMockPage.jsx`、`SetupPage.jsx`、`FirstSchedulePage.jsx`、`DashboardPage.jsx`、`InterestExplorationPage.jsx`、`PreferenceJourneySteps.jsx` 和其 CSS。
- 課程詳情｜`CourseDetailModal.jsx`、`courseDescription.js`。
- 後端｜`auth.js`、`accountService.js`、`memoryService.js`、`profileSchema.js`、`profileUpdateValidation.js`。
- 驗證及規格｜`registration.test.js`、`profileSchema.test.js`、`API_SPEC.md`、`DATA_SCHEMA.md`。

## 驗收

- Chrome 使用隔離帳號確認隱私同意前不讀修課資料、預設進 MyFCU、匯入後進偏好，以及已有修課時跳過匯入。
- 首次排課失敗先留在引導頁。重試成功後，先保存新課表，再進首頁。重新整理後仍顯示新課表。也確認重新登入可接續尚未完成的首次排課。
- 課程詳情保留「本課程⋯⋯」正文，移除「課程：永續發展與碳淨零工程。」，兩個小標均使用粗體。
- 暫存版本前端 lint、build 通過。154 個後端檔案語法檢查通過。完整測試 2030 通過、14 跳過、0 失敗。瀏覽器驗收使用隔離資料。

依使用者指示提交至 `backend` 並推送至 `origin backend`，發布結果以 Git 紀錄為準。
