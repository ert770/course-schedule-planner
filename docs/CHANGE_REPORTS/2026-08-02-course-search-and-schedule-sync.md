# 🚀 課表規劃助手 - 開發進度報告 (2026-08-02)

## 📝 總結 (Summary)
本日完成了系統核心的「選課與排課連動」機制，打通了前端 React 與後端 Node.js 的資料流。從 `LoginPage` 的登入驗證，到 `SearchPage` 的複雜條件檢索，再到 `DashboardPage` 的即時課表渲染，目前系統已具備完整且流暢的選課體驗，並加入了防呆與衝堂檢查機制。

---

## ✨ 詳細功能實作 (Features Implemented)

### 1. 全域狀態管理與課表同步 (Global State Management)
* **新增 `useSchedule.jsx` (Context API)**：
  * 徹底解決跨頁面狀態無法共享的問題。
  * 實作 `schedule` (已選課表) 與 `watchlist` (關注清單) 的全域狀態。
  * 達成 **「搜尋頁加選 ➡️ 首頁課表即時更新」** 的無縫體驗，無須重新整理頁面。

### 2. 智慧防衝堂與加退選系統 (Conflict Detection)
* **衝堂檢查演算法**：
  * 在 `useSchedule` 內建 `checkConflict` 邏輯。
  * 自動比對欲加選課程與既有課表的 `dayOfWeek` (星期) 與 `startPeriod` / `endPeriod` (節次區間)。
  * 若偵測到時間重疊，系統會阻擋加選並彈出紅色的「衝堂警告」提示 (例如：`衝堂警告！與已選的【資料結構】時間重疊`)。
* **動態加退選按鈕 (Toggle)**：
  * 課程卡片的按鈕會根據當前狀態動態切換：未選時顯示藍色「加選」，已選時顯示紅色「取消加選」。
  * 在首頁 (`DashboardPage`) 的課程詳細資訊 Modal 中，加入「從課表中移除」的快捷功能。

### 3. 課程檢索功能大幅升級 (SearchPage UI/UX & Logic)
* **雙模式搜尋介面**：實作「依系所查詢」與「依條件查詢」雙頁籤。
* **❤️ 關注清單 (Watchlist)**：
  * 於課程卡片右上角加入「愛心」圖示，點擊可將課程加入/移除關注清單。
  * 左側新增「❤️ 我的關注」專屬頁籤，方便使用者集中檢視與管理口袋名單。
* **前端 API 請求優化 (Payload Cleansing)**：
  * 使用 Functional Programming (`Object.fromEntries` + `filter`) 自動過濾掉值為 `null` 或空字串的搜尋條件，確保傳遞給後端的 URL Parameters 乾淨準確。
  * 修復「授課語言」預設值問題（加入「全部 (All)」選項），避免過濾掉無語言標記的課程。
* **視覺與無障礙優化 (UI & A11y)**：
  * 拔除 Emoji，全面導入 `lucide-react` 專業圖示 (`User`, `Clock`, `MapPin`, `Building`)。
  * 表單 `<label>` 完整綁定 `htmlFor` 與輸入框 `id`。
  * 加入完善的 Error / Success 狀態提示訊息 (Toast UI)。

### 4. 首頁儀表板整合 (DashboardPage)
* **即時課表網格 (ScheduleGrid)**：成功串接全域 `schedule` 狀態，視覺化呈現排課結果。
* **UI 防滾動與版面鎖定**：優化版面結構，將左側偏好設定、中間課表、右側 AI 聊天室設定為「獨立滾動區」，鎖死外層視窗高度 (`100vh`)，提升桌面端操作體驗。
* **右上方使用者選單**：實作點擊外部自動關閉 (Click Outside to Close) 的隱形遮罩邏輯。

### 5. 🛠️ 後端 API 邏輯修復 (Backend Fixes - `routes/courses.js`)
* **修復「單一節次搜尋」Bug (區間比對演算法)**：
  * 原本後端採用「完全相等 (===)」比對，導致搜尋「第 5 節」時，無法搜出「第 3-5 節」的跨節次課程。
  * **解決方案**：在 `routes/courses.js` 中攔截 `period` 參數，改用區間判斷：
    ```javascript
    targetPeriod >= course.startPeriod && targetPeriod <= course.endPeriod
    ```
  * 同步將前端傳來的 `dayOfWeek` 與 `period` 強制轉型為 `Number`，避免字串比對造成的錯誤，達成 100% 精準檢索。

---

## ⚠️ 待辦事項與後續規劃 (Next Steps)
1. **資料持久化 (Persistence)**：將 `useSchedule` 中的資料透過 API 存入資料庫，讓使用者下次登入時課表與關注清單不會消失。
2. **AI 排課串接**：將首頁的聊天室生成的排課結果，與現有的全域 `schedule` 做更深度的資料綁定。

---
**Reviewer 注意事項**：
@吳心樂 測試時請記得 **重新啟動後端伺服器 (Restart Node server)**，因為本次 PR 包含了 `routes/courses.js` 的核心邏輯修改！