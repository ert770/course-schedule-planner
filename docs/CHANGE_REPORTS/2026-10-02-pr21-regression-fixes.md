# PR #21 合併後回歸修正

修改日期：2026-10-02

## 修改檔案

- `client/src/pages/DashboardPage.jsx`
- `client/src/components/CourseCard/CourseDetailModal.jsx`
- `client/src/components/Profile/SkillTreeModal.jsx`
- `client/src/components/Schedule/RemoveReasonDialog.jsx`
- `client/src/pages/OnboardingPage.jsx`
- `client/src/pages/SchedulePage.jsx`
- `client/src/pages/SearchPage.jsx`
- `client/src/services/privacyConsentAdapter.js`
- `client/src/services/privacyConsentAdapter.test.js`
- `client/vite.config.js`
- `server/data/saved_schedules.json`
- `docs/CHANGE_REPORTS/2026-10-02-fix-onboarding-consent-contract.md`
- `docs/CHANGE_REPORTS/2026-10-02-pr21-regression-fixes.md`

## 主要修改

- 首頁與課程詳情恢復 main 原有的多方案切換、方案比較、排課提示與失敗訊息，課程推薦理由採用結構化 `recommendationReason`。
- 技能樹視窗只依本學期課表的課名及說明列出命中課程，不再宣稱能力程度、歷年成績或固定分數。
- 退課原因改用互動事件 API 接受的單選值且可不填；未同意個人化學習時，首頁、排課頁及搜尋頁直接移除，不顯示原因視窗。
- onboarding 使用後端正式 consent purpose ID 讀寫選擇；讀取或儲存失敗時不以預設值覆寫既有設定。
- Vite API proxy 預設值恢復為 `http://localhost:27151`。
- `saved_schedules.json` 清回空陣列，排除 PR 帶入的個人課表快照。

## 影響範圍

修正 PR #21 合併後的首頁與課程詳情回歸、退課回饋契約、onboarding 隱私同意契約及本機 API 代理設定；不修改後端排課演算法或資料庫 schema。

## 測試與驗證

- client lint：通過。
- client production build：通過，轉換 1,780 個模組。
- `node --check server/src/app.js`：通過。
- onboarding adapter 3/3、privacy routes 3/3、interaction event schema 11/11 通過。
- `node --test test/accountIsolation.test.js`：6/6 通過。初次失敗原因是 sandbox 阻止測試專用 fixture 寫入（`EPERM`）；允許該隔離寫入後通過。
- `CI=true npm test`（server）：1,060 項中 1,042 通過、18 項依 CI 規則略過、0 失敗、0 取消。golden set 因需真實 OpenAI 模型呼叫而由 CI 規則略過。
- `git diff --check`：通過。
- 瀏覽器對照：修正前 onboarding 顯示同意用途錯誤；修正後頁面能載入伺服器保存的同意狀態，原錯誤不再出現。唯讀首頁檢查確認仍有方案切換與方案比較；使用者先前已自行完成 onboarding 並到達首頁。未替使用者變更隱私選項。
- 瀏覽器 DevTools 截圖中有兩筆 `/api/auth/me` 的 401，發生於未登入的 Chrome 分頁；這是登入狀態檢查的預期回應，另有一行 React DevTools 資訊提示。使用者確認這些訊息不影響本次修正。未見其他紅色 console 訊息；Codex 未切換或送出任何隱私選項。

## Commit 與 push

本次修正會提交並推送至 `origin codex/pr21-main-integration`；不在此步驟合併到 main。commit SHA 以 Git 歷史記錄為準。