# F13 畢業進度缺少歷史修課資料提示

## 修改日期

2026-08-06

## 修改檔案

- `server/src/routes/graduation.js`
- `client/src/pages/GraduationPage.jsx`
- `client/src/App.css`
- `docs/API_SPEC.md`
- `docs/CHANGE_REPORTS/2026-08-06-graduation-history-data-warning.md`

## 主要改動

- 畢業 API 新增 `courseHistoryAvailable` 與 `courseHistoryMessage`。
- 只有同時具備總已修學分及分類學分彙總時，才把歷史修課資料視為可供計算進度；只有課程 ID 或名稱清單仍不足以顯示分類學分進度。
- 缺少歷史修課資料時，`totalEarned`、`earned` 與 `gaps` 回傳 `null`，不再以 0 代表未知資料。
- 缺資料時略過不必要的課程 MySQL 查詢及補課建議，確保提示可獨立回傳。
- 畢業頁缺資料時以警示卡取代總進度與分類缺口，顯示「缺少歷史修課資料，請至 MyFCU 擷取歷史修課資料並匯入。」
- 有完整歷史修課彙總時維持原本的進度與分類缺口畫面。

## 影響範圍

- `GET /api/graduation/:studentId` 的成功回應格式。
- 畢業學分進度頁的總學分及分類缺口顯示。
- 未修改正式 MySQL schema、資料內容、登入流程或歷史資料匯入流程。
- 本次未處理 API 失敗時的前端 mock fallback。

## 測試與驗證

- `node --check server/src/routes/graduation.js`：通過。
- `cd client && npm run lint`：通過。
- `cd client && npm run build`：通過。
- `npm test`：225 項全部通過。
- 實際 API 驗證：本機無歷史資料 profile 回傳 `courseHistoryAvailable=false`，三個進度欄位為 `null`，並包含 MyFCU 匯入提示。
- 瀏覽器 A/B 驗證（受控 API 回應）：
  - 無歷史資料：只顯示「無法顯示修課進度」與 MyFCU 匯入提示，不顯示 0 學分、總進度或分類缺口。
  - 有歷史資料：正常顯示 107/128 與各分類缺口。
  - 兩個情境的瀏覽器 console 均無 error 或 warning。

## Commit 與 Push

- Commit：依使用者指示，隨本次 F13、個人修課資料與 F7 變更一併提交。
- Push：依使用者指示推送至 `origin main`。
