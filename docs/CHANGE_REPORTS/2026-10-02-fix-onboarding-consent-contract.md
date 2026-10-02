# 修正 onboarding 隱私同意欄位契約

修改日期：2026-10-02

## 修改檔案

- `client/src/pages/OnboardingPage.jsx`
- `client/src/services/privacyConsentAdapter.js`
- `client/src/services/privacyConsentAdapter.test.js`
- `docs/CHANGE_REPORTS/2026-10-02-fix-onboarding-consent-contract.md`
- `docs/CHANGE_REPORTS/2026-10-02-pr21-regression-fixes.md`

## 主要修改

- onboarding 改由 `GET /api/privacy/consents` 讀取伺服器保存的同意狀態；個人化來源仍由原本的 personalization API 載入。
- 將畫面欄位轉成後端正式用途 ID：`service_processing`、`personalization_learning`、`aggregate_research`，修正必要同意被判定為缺失而回 400。
- 若讀取同意失敗，停用繼續按鈕並顯示錯誤；儲存失敗則留在 onboarding，不標記完成或跳往設定頁，避免用預設值覆寫既有選擇。

## 測試與驗證

- `node --test client/src/services/privacyConsentAdapter.test.js`：3/3 通過。
- `node --test test/privacyRoutes.test.js`：3/3 通過。
- `CI=true npm test`（server）：1,060 項中 1,042 通過、18 項依 CI 規則略過、0 失敗、0 取消。略過項為需呼叫真實 OpenAI 模型的 golden set。
- `node --test test/accountIsolation.test.js`：6/6 通過。第一次執行時 sandbox 阻止專用 fixture 寫入而回 `EPERM`；放行隔離測試的 fixture 寫入後重跑通過，並非產品程式或缺少 MySQL 導致。
- client lint、production build（1,780 modules）、`node --check server/src/app.js` 及 `git diff --check` 通過。
- 瀏覽器對照：修正前的畫面出現同意用途錯誤；修正後唯讀檢查 `localhost:5175/onboarding`，頁面已載入現存選擇、繼續按鈕可用，原錯誤不再顯示。使用者先前自行送出並進入首頁；Codex 未操作隱私選項，亦未直接擷取當次 PUT 回應。
- 瀏覽器 DevTools 截圖中有兩筆 `/api/auth/me` 的 401，發生於未登入的 Chrome 分頁；這是登入狀態檢查的預期回應，另有一行 React DevTools 資訊提示。使用者確認這些訊息不影響本次修正。未見其他紅色 console 訊息；Codex 未切換或送出任何隱私選項。

## Commit 與 push

本次修正會提交並推送至 `origin codex/pr21-main-integration`；commit SHA 以 Git 歷史記錄為準。依專案規範，待瀏覽器 console 驗收完成後再提交至 `codex/pr21-main-integration`。