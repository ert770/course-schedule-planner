# 同意頁「個人化來源」顯示錯誤，以及已設定使用者每次登入都要重走引導流程

- 日期：2026-10-16
- 來源：[文字向量 v2 A/B](./2026-10-16-course-text-vector-v2-ab.md) 測試時觀察到的兩個現象，使用者要求兩件都修，第二件採方案 (a)

## 1. 修正內容

### 1.1 同意頁永遠顯示「未啟用個人化學習」

| 項目 | 內容 |
| --- | --- |
| 現象 | 已同意個人化學習、而且學習資料足夠的帳號，同意頁仍寫「目前個人化來源：未啟用個人化學習」 |
| 原因 | `OnboardingPage.jsx` 顯示 `personalization.label`，但 `GET /api/privacy/personalization` 從來沒有 `label` 欄位，畫面永遠落到預設字（2026-09-26 `31436ee` 引入） |
| 修正 | 改用首頁與隱私頁已在用的 `PreferenceSourceBadge`，把已載入的資料直接傳入（不多打一次 API），依 `source`／`sufficiency` 顯示文字 |

### 1.2 已設定過的使用者，每次登入都要重走「同意頁 → 設定頁」

| 項目 | 內容 |
| --- | --- |
| 現象 | 登出再登入、session 過期、換裝置後，都會被導到同意頁並要求重新設定 |
| 原因 | 「已設定過」只記在瀏覽器（`fcu:<學號>:setupDone`），而 2026-08-14 的帳號隔離規定登出時清除這個標記 |
| 修正（方案 a） | 伺服器判斷：`/api/auth/login` 與 `/api/auth/me` 回傳 `setupComplete`（`User_Profiles` 已有系所與年級）；前端 `isSetupDone()` 以它為準，沒有這個欄位時才退回瀏覽器標記 |

條件不含班級：設定頁沒有班級欄位（由系統帶入），新使用者存完設定可能仍沒有班級，若列為條件會一直被導回引導流程。

帳號隔離的設計不變：登出仍清除瀏覽器標記，伺服器的判斷不依賴瀏覽器。隱私同意是否要重新確認，仍由
`GET /api/privacy/consents` 的 `requiresAction` 決定，與這次修改無關。

## 2. 修改檔案

| 檔案 | 異動 |
| --- | --- |
| `server/src/data/profileSchema.js` | 新增 `isProfileSetupComplete()` |
| `server/src/routes/auth.js` | `/login`、`/me` 回應加上 `setupComplete`；Profile 讀取失敗時不帶此欄位（沿用既有的防護） |
| `client/src/contexts/AuthContext.jsx` | `isSetupDone()` 以伺服器 `setupComplete` 為準；`markSetupDone()` 同步更新本地使用者資料，存完設定不會被導回 |
| `client/src/pages/OnboardingPage.jsx` | 個人化來源改用 `PreferenceSourceBadge` |
| `server/test/profileSchema.test.js` | 新增 P3-C：系所與年級都有值才算完成；新使用者（normalize 後為 null）、年級 0、缺系所都不算 |
| `docs/API_SPEC.md` | `/auth/login`、`/auth/me` 的 `setupComplete` 說明 |

## 3. 驗證

| 項目 | 結果 |
| --- | --- |
| `server/src` 全部 `node --check` | 通過 |
| 後端 `npm test` | 1,609 項，1,608 通過、1 略過、0 失敗 |
| 前端單元測試（`node --test`） | 13 項全過 |
| 前端 `npm run lint`、`npm run build` | 通過 |

### 瀏覽器 A/B（demo 帳號 D1249697）

| 情境 | 修正前 | 修正後 |
| --- | --- | --- |
| 同意頁「目前個人化來源」 | 「未啟用個人化學習」（API 實際為 `source: learned`、72 筆可用事件） | 「使用學習到的偏好」＋「依你的行為調整，顯式設定仍是下限。」 |
| 瀏覽器沒有 `setupDone` 標記時進入首頁 | 被導到同意頁（同一次測試中發生兩次） | 直接進首頁 |
| 從畫面登出再登入 | 被導到同意頁 | 直接進首頁；瀏覽器標記為 `null`，`/auth/me` 回傳 `setupComplete: true` |

Console：401 來自登入前與登出後的身分檢查，屬預期。另有一筆 `PreferenceSourceBadge is not defined`，
是修改過程中先改使用處、後加 import 時開發伺服器熱更新的中間狀態；之後重新載入同意頁，徽章正常顯示
（若 import 仍缺少，整個頁面元件會無法渲染）。

## 4. 影響範圍與限制

- 只影響登入後的導向判斷與同意頁的一行顯示，不改排課、探索或資料寫入。
- `fcu_user` 快取會帶 `setupComplete`；重新整理頁面時由 `/auth/me` 更新，伺服器資料變動後最晚下一次載入會反映。
- 「興趣探索」的完成狀態仍只記在瀏覽器：換裝置後首頁不受影響，但若使用者自己打開興趣探索頁，會從頭開始。
- 未修改 roadmap（未推進任何任務）。未 commit。
