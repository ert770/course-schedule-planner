# 設定頁移除避開特定時段的大型時段格

日期：2026-10-02

## 修改內容

- 從新版設定頁移除「避開特定時段」標題與 14 節 × 7 天的時段選擇格。
- 移除該頁讀取與送出 `blockedPeriods` 的前端程式。設定頁更新其他欄位時不會送出空陣列覆寫既有 `avoid_time`；資料庫資料與後端排課行為不變。
- 保留「上課時間」下的 `#不排早八` 等既有偏好標籤。
- 更新收合摘要，移除不再提供編輯的避開時段狀態文字。

## 修改檔案

- `client/src/pages/SetupPage.jsx`：移除時段格、元件引用、對應狀態與表單欄位。
- `docs/CHANGE_REPORTS/README.md`：加入本報告索引。
- `docs/CHANGE_REPORTS/2026-10-02-remove-avoid-periods-settings-ui.md`：記錄本次修改與驗證。

## 驗證

- 前端 lint：通過。
- 前端 production build：通過；只有既有 Vite plugin timing 資訊警告。
- 瀏覽器實機確認設定頁已沒有「避開特定時段」及大型時段格；主要修課路徑、興趣主題、剩餘學期與 `#不排早八` 等既有偏好標籤仍正常顯示，console 沒有 warn/error。
- 未送出設定表單。前端不再讀取或送出 `blockedPeriods`；後端只在請求包含該欄位時才更新 `avoid_time`，因此這次修改不會清除已存資料。未修改後端程式。

## Git 狀態

未 commit、未 push；其他既有工作區變更未納入本次修改。
