# 2026-08-29 移除退課原因略過選項並完成 Roadmap #21 責任交接

## 修改日期

2026-08-29

## 修改檔案清單

- `client/src/components/Schedule/RemoveReasonDialog.jsx`
- `client/src/contexts/ScheduleContext.jsx`
- `docs/CHANGE_REPORTS/2026-08-01-personalization-roadmap.md`
- `docs/CHANGE_REPORTS/README.md`
- `docs/CHANGE_REPORTS/2026-08-29-remove-withdrawal-skip-option.md`（本檔）

## 主要改動內容

1. 移除退課原因對話框的「略過，直接移除」按鈕；使用者啟用個人化學習時，需從七個正式原因中
   選擇，或取消本次移除。
2. 保留 `removeCourse()` 對 `feedbackReason:null` 的底層相容性，供未啟用個人化或舊呼叫端表示
   「未蒐集原因」；事件格式與後端 enum 均未改動。
3. Roadmap #21 改標為完成：hard／soft schema、獨立 validator、放寬階梯與 conflict set 均已交付。
   廣義先修／共修只在 schema 建模；資料來源及強制執行歸 #8，在 #8 完成前 validator 持續回報
   `unchecked`，文件不宣稱系統已完成該項檢查。
4. 將 `scoreCourse()` 動態消費正式 schema／版本化權重的 scorer 重構交接給 #7；#30 仍只負責產生
   可重播的 per-user 權重。
5. 現行 `maxCoursesPerDay` 保持不可放寬的硬上限。若未來出現偏好型每日上限需求，先由 #24 釐清
   hard／soft 語意並建立獨立欄位，再另行開發；#24 的前置相依 #18、#21 已完成，狀態同步改為
   「可開始」。

## 影響範圍

- 前端退課原因對話框的可見按鈕。
- 個人化推薦 roadmap 的 #7、#21、#24 狀態與責任邊界。
- 未修改後端 API、資料格式、排課器、constraint schema 或 validator 執行邏輯。

## 測試與驗證結果

- `npm run lint`：通過。
- `npm run build`：通過；Vite 產出 production bundle。
- `npm test`：522/522 通過，113 個 suites，0 failure。
- 瀏覽器 A/B（搜尋頁的「計算機結構學」退課流程）：
  - 修改前：原因對話框顯示七個正式原因、「略過，直接移除」及取消。
  - 修改後：同一對話框只顯示七個正式原因及取消，`略過，直接移除` 按鈕數量為 0。
  - 選擇「時間衝突／時段不合」後，對話框關閉並顯示「已將『計算機結構學』從課表移除」。
  - Browser console 無新增 warning 或 error。
- 為在隔離測試帳號未持久化 personalization consent 的情況下觸發指定畫面，驗收期間曾暫時強制
  搜尋頁走詢問原因分支；A/B 完成後已還原，最終 diff 不含該測試鉤子。

## Commit 與 Push

- 未 commit。
- 未 push。
