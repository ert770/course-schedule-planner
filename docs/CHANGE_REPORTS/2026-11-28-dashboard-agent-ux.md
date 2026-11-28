# 首頁、Agent、查詢、探索與設定頁的 10 項修改

日期：2026-11-28

## 背景

使用者 2026-11-27 列出 10 項修改。2026-11-28 另外確認：

- 學分可設最低與最高。最低不低於 12（大四 9），最高 25，超修 30。
- 「備選」只列可以直接換上的課，排除必修，課表上的每門課都有按鈕。
- 探索門檻降為 0.52。
- Agent 的目標學分以最高學分為準。
- 點範例只填進輸入框，使用者修改後自己送出。

## 修改內容

| # | 內容 | 主要檔案 |
| --- | --- | --- |
| 1 | 設定頁「排課條件」與首頁學分標籤都能改最低、最高學分（直接輸入或下拉選單）與超修；首頁儲存後立即重排；Agent 的「目標學分」改為最高學分 | `CreditRangeInput.jsx`、`CreditEditor.jsx`、`creditRange.js`、`SetupPage.jsx`、`DashboardPage.jsx`、`scheduleOptions.js`（`allowCreditOverload`、`syncCreditLimit`）、`memoryService.js`、`constraintService.js`、`promptService.js` |
| 2 | Agent 對話框顯示 3 個範例與分類好的更多範例；有對話紀錄時收成「查看範例」；點了只填進輸入框 | `agentExamples.js`、`AgentExamples.jsx`、`DashboardPage.jsx` |
| 3 | 講完排課條件就直接重排，不再問「要我現在重新排課嗎？」；明說「先不要排」才不排；範圍不明仍先問「這次／以後」 | `agentService.js`、`chatPreferenceService.js`、`promptService.js` |
| 4 | 每個課程格右下角（含時間未定清單）新增「備選」；清單只顯示課名、依分數排序，點了直接換課 | `replacementService.js`（新，Agent 共用）、`routes/schedule.js`、`scheduler.js`（`rankReplacementCandidates`）、`ScheduleGrid.jsx`、`AlternativesDialog.jsx`、`api.js` |
| 5 | 「為什麼推薦」只列符合的興趣與偏好；沒有任何符合時不顯示區塊 | `CourseDetailModal.jsx` |
| 6 | 拿掉「同步 MyFCU 修課紀錄（尚未開放）」按鈕 | `DashboardPage.jsx` |
| 7 | 拿掉首頁「使用學習到的偏好…」 | `DashboardPage.jsx` |
| 8 | 輸入框提示改「請輸入…...」；拿掉「(All)」；「只看通識課程」獨立一列、與欄位同寬 | `SearchPage.jsx`、`App.css` |
| 9 | 探索門檻 0.55 → 0.52；拿掉三句區塊說明。起點本來就可以選本系必修（查證：D1249697 的起點含 22 門必修），未改 | `explorationService.js`、`ExplorePage.jsx` |
| 10 | 刪兩句說明；「我修過的課」改「歷史修課回饋」；按鈕改「填寫回饋」 | `SetupPage.jsx`、`HistoryFeedbackModal.jsx`、`App.css` |

## 影響範圍

- 第 3 項改變聊天行為：說「以後只排通識」會存偏好並馬上重排。
- 第 4 項新增 `GET /api/schedule/alternatives`。查詢實測約 4～7 秒（開發環境第一次更久），主要時間在讀共用資料庫。
- 學分上限有兩個儲存位置，寫入時保持一致。

## 測試與驗證

- `npm test` 2,084 項：2,070 通過、0 失敗、14 略過。前端單元測試 20 項通過，lint、build、`node --check` 通過。
- 瀏覽器（本機預覽，D1249697）：
  - 1：最低填 8 顯示「不能低於 9」且儲存鈕停用；下拉選 14、輸入 12 儲存後，課表由 11 門 25 學分變 5 門 12 學分；設定頁顯示同一組值。
  - 2：首頁顯示 3 個範例（含目前課表課名），展開 5 類；點範例只填入輸入框、沒有送出。空白對話畫面是在頁面內把對話紀錄回應改成空的來檢查，沒有刪資料。
  - 3：「週三下午要打工」→「這次」後直接重排，週三沒有課；「…先不要排課」只暫存不排。
  - 4：「卓越領導力」的備選列出 8 門課名；選第一門後課表換成「地方創生戰略與人文」，學分不變。
  - 5：勾偏好後重排，詳情顯示「你指定要修這門課／符合你的偏好：學到較多內容」，沒有分數與競爭者清單。
  - 6、7、8、10：畫面確認；10 發現「填寫回饋」按鈕被拉寬，已修正。
  - 9：起點清單 39 門（含必修），三句說明消失；以「Python程式設計」為起點推出 4 門系外課（0.55 時為 3 門）。
  - console 沒有錯誤。
- 測試資料：測試時改過 D1249697 的學分上限、偏好勾選與 `scheduleOptions`，已用事前備份還原並比對一致。換課與聊天測試在 demo 帳號留下互動事件與對話紀錄，沒有刪除。

## 尚未處理

- 探索頁上方說明仍有「每個系所或通識領域只列一門」一句（不在指定刪除的三句內）。
- 「備選」查詢速度仍可再改善。

## Commit 與 push

commit 後與隊友的 `892e51b`（MyFCU 部分匯入與深色模式）合併，push 至 `origin backend`。roadmap 進度表只在 #26 加註畫面簡化；其他任務的狀態與相依沒有改變。
