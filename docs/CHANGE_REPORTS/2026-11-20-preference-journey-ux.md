# 首次偏好導覽與課程探索改版

修改日期：2026-11-20（台北時間）

## 修改範圍

| 檔案 | 內容 |
| --- | --- |
| `client/src/components/Layout/PreferenceJourneySteps.jsx`、`PreferenceJourneySteps.css` | 共用三階段進度、返回按鈕、清楚的狀態與響應式樣式。 |
| `client/src/pages/OnboardingPage.jsx` | 分開必要用途與三個可選用途，保存後更新畫面所使用的同意狀態。保留協同推薦對個人化學習的依賴以及既有已存選項。 |
| `client/src/pages/SetupPage.jsx` | 首次設定分成基本資料、課程興趣、排課條件。既有使用者可直接切換區塊。可在保存前確認主題細項並查看摘要。首次走完設定後先進探索，再由首頁產生課表。 |
| `client/src/components/Profile/InterestFollowupDialog.jsx` | 增加從課程興趣前往排課條件的確認與略過操作，保留保存及手動調整；避免 React 開發模式重掛載時重複送出追問。 |
| `client/src/pages/InterestExplorationPage.jsx`、`InterestExplorationPage.css` | 突顯課名、標籤及回饋，將授課資訊移入可展開區。區分略過單張、結束探索和返回設定續做，並提供載入失敗後的重新載入操作。 |
| `docs/UX_FLOW.md` | 更新首次及再次使用的操作流程。 |

影響範圍為前端首次導覽、偏好設定及初始探索。後端、同意契約、興趣模型與排課器沿用既有實作。探索進度仍存在同一瀏覽器，未新增跨裝置同步。

## 驗證

- `npm run build --prefix client`、`npm run lint --prefix client` 通過。
- `CI=true npm test` 在允許本機 loopback 的環境跑完，1745 項通過，1 項依 CI 規則略過。預設 sandbox 的首次測試因本機 HTTP 連線 `EACCES` 失敗，重跑後解決。
- Chrome 透過 Vite `127.0.0.1:5173` 串接隔離的本機 HTTP fixture。這次驗收比較請求內容及順序，資料為模擬，沒有用 MySQL 或呼叫 GPT。

| 情境 | 結果 |
| --- | --- |
| 同意選項 | 首次進頁面三個可選項均未勾選。開啟個人化後可勾協同推薦，取消個人化會同時清除並停用協同推薦。保存後立即可使用修課喜好入口。 |
| A：選日語、同意學習 | 追問在保存前發生，回上一頁還保留日語。最後重跑中一次追問保存 `tag_japanese`，探索內送出一筆「有興趣」。第一個排課請求在該筆回饋之後，fixture 讀到 1 筆前置回饋。 |
| B：沒有選主題、未同意學習 | 追問與回饋請求均為 0。略過單張後前往課表，收到首個排課請求。 |
| 續做 | 從第 2 張返回設定，再選擇繼續探索，仍顯示同一張及 `2 / 2`。重新整理探索頁也保留進度。 |
| 回來修改設定 | 已完成設定的帳號直接進排課條件，開啟「星期一排空」。保存的請求及後續排課均帶此設定，首頁也顯示勾選。 |
| 手機及 console | 390px 寬度下檢查興趣及探索畫面，沒有橫向溢出。Chrome 驗收紀錄未出現新增的應用錯誤或警告。 |

本次未 commit 或 push。
