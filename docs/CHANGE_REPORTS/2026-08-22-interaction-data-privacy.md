# 建立互動資料隱私、匿名化、consent 與保存規則（Roadmap #33）

修改日期：2026-08-22

## 修改檔案

- 隱私規格與決策：`docs/PLANS/2026-08-22-roadmap-33-interaction-data-privacy-plan.md`、`docs/API_SPEC.md`、`docs/DATA_SCHEMA.md`、`docs/DECISIONS.md`、`docs/TEST_PLAN.md`、個人化 roadmap。
- 後端政策與服務：`privacyPolicy.js`、`privacyService.js`、`requireConsent.js`、`privacy.js`。
- 後端整合：`app.js`、Auth／Chat／Profile／Schedule／Graduation routes、Agent／Memory／Prompt services；移除 legacy SQLite schema 的明文 `chat_history` 定義。
- 資料庫與維運：`002_privacy-foundation` up/down migration、privacy migration／本機 secret 設定／retention cleanup／legacy Chat cleanup scripts、`.env.example`、server scripts。
- 前端：Privacy Center、路由 consent guard、Auth consent 狀態、API client、onboarding 文案、Dashboard 入口與樣式。
- 測試：privacy policy、service 與 route tests。

## 主要改動

1. 定義必要 `service_processing` 與預設關閉的 `personalization_learning`、`aggregate_research`，以 append-only、policy-versioned consent 保存決定。
2. 以 HMAC-SHA-256 產生不可直接回連學號的 subject ID；分析 secret 與 AES 金鑰分離且只由環境提供。
3. Runtime 停止讀寫明文 `chat_history.json`。Raw Chat 改為 AES-256-GCM、每筆獨立 IV／auth tag、30 天到期，只供對話連續性。
4. Agent 不再記錄訊息、完整 Profile、model thought、工具參數或結果內容；送給 Gemini 的偏好摘要移除顯示名稱。
5. 只有成功回覆才原子保存 user/assistant 訊息對。錯誤回覆不進聊天歷史。
6. Chat 中明確確認的偏好仍由 `update_preferences` 寫入 Profile；清除 Raw Chat 不會讓結構化偏好消失。
7. 提供政策／同意／匯出／清 Chat／刪除確認與帳號資料刪除 API，以及前端 Privacy Center。
8. 研究輸出固定為 k ≥ 5 的 aggregate-only 邊界；#33 不建立 #2 的實際 interaction event storage。

## 影響範圍

- `PRIVACY_ENFORCEMENT_ENABLED=true` 時，個人資料 API 缺少目前版本必要同意會回 HTTP 428。
- 本機已設定獨立 `ANALYTICS_ID_SECRET`、32-byte Base64 `PRIVACY_DATA_KEY_V1` 與 enforcement；正式網站尚不存在，由新增的 #39 負責平台 secrets 與 Production rollout。
- 完整資料刪除會刪除登入帳號，因此成功後 session 立即失效；最小同意／稽核記錄保存 365 天。
- 舊聊天檔沒有自動搬移、讀取或刪除，避免未經同意把既有明文重新加工成新資料集。

## 測試與驗證結果

- `npm test`：478/478 通過；新增 HMAC、AES round-trip/tamper、consent default-off、跨 subject Chat 隔離、單次 deletion token、HTTP 428 A/B route 測試。
- `npm run lint`：通過，0 errors／0 warnings。
- `npm run build`：通過，Vite 產出成功。
- 後端 `server/src/**/*.js` 與四支新 script `node --check`：通過。
- `npm --prefix server run cleanup:legacy-chat` dry-run：舊檔仍存在，共 104 筆，日期範圍 2026-03-28 至 2026-08-17；未顯示內容／學號，未刪除。
- 瀏覽器 A/B：以隔離的 `BROWSER01` fixture 完成人工驗收。未同意時受保護 `POST /api/chat` 回 `428 CONSENT_REQUIRED`；只同意必要用途後進入課表主頁，同一空訊息請求回一般輸入驗證的 400，證明 consent guard 已放行。
- Consent 狀態：`requiresAction=false`、`service_processing=true`；`personalization_learning=false`、`aggregate_research=false`，確認兩項可選用途關閉不影響核心服務。
- 同意後課表主頁正常顯示；瀏覽器 console 的 error／warning 為 0。
- shared MySQL migration：經使用者明確批准後成功套用；再次 dry-run 確認五張 privacy tables 全部存在、缺少 0 張。
- 本機 secrets：由 `configurePrivacyEnvironment.js` 直接產生並寫入被 Git 忽略的 `server/.env`；終端與文件未顯示 secret value。`PRIVACY_STORE=mysql`、`PRIVACY_ENFORCEMENT_ENABLED=true` 已設定。

## Commit / Push

- 本報告與 #33 原始碼由同一筆 commit 提交。
- Push 目標：`origin backend`；commit SHA 以 push 後回報為準。
