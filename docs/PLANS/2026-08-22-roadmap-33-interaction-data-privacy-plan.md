# Roadmap #33：互動資料隱私、同意與保存方案

日期：2026-08-22
狀態：✅ 已完成（2026-08-22）

## 問題

系統同時處理 Profile、修課歷史、偏好、已存課表、互動事件與 AI 對話。這些資料可直接或間接識別學生；若在 #2 收集互動事件前沒有用途、同意、保存、刪除與研究匯出界線，就可能讓原本提供服務的資料被默認拿去訓練個人化或研究，也會讓 Raw Chat 長期明文保存。

Raw Chat 不進入個人化學習，不表示對話中確認的偏好會消失。兩者要分開：原始逐字內容只用於 30 天內的對話連續性；使用者明確確認的「不排早八、興趣領域、目標學分」等，仍由既有 `update_preferences` 工具寫入結構化 Profile，之後排課直接使用 Profile。

## 解法

### 分層同意

- `service_processing`（必要）：Profile、修課歷史、偏好、已存課表、Gemini AI 對話與加密 Raw Chat，用於當下服務。
- `personalization_learning`（選擇性，預設關閉）：允許 #2 的去識別互動事件及 #30 的學習權重。Raw Chat 永不進入此用途。
- `aggregate_research`（選擇性，預設關閉）：只允許 k ≥ 5 的彙總資料；不輸出逐筆事件、Raw Chat 或完整修課歷史。

每次決定以 append-only consent 記錄保存，綁定政策版本。政策改版後需重新同意；撤回立即停止對應用途。

### 去識別與秘密管理

伺服器以 `HMAC-SHA-256(ANALYTICS_ID_SECRET, canonicalUserId)` 產生 `v1:<digest>`。分析、聊天與隱私資料表只保存 subject ID，不保存學號。`ANALYTICS_ID_SECRET` 與 AES 金鑰只能由環境變數提供，不寫入 repository，也不回傳前端。

### Raw Chat 與結構化偏好

- Raw Chat 使用 AES-256-GCM，每筆使用獨立 96-bit IV 與驗證標籤。
- 保存 30 天，只取未過期的最近 20 則供 Gemini 對話連續性。
- 只有成功取得回覆後，才原子保存 user/assistant 一對訊息；錯誤訊息不保存。
- Log 不記錄訊息、完整 Profile、模型 thought、工具參數或結果內容。
- 使用者在聊天中確認的偏好仍可寫入 Profile；這是結構化服務資料，不是 Raw Chat 複製品。

### 保存期限

| 資料 | 期限／規則 |
| --- | --- |
| 加密 Raw Chat | 30 天 |
| #2 互動事件 | 180 天 |
| 匯出暫存 | 優先串流；若產生暫存檔最長 30 天 |
| 非活躍 Profile、修課歷史、已存課表 | 365 天後清理或重新確認 |
| 同意與稽核最小記錄 | 撤回後 365 天 |

### 舊資料

新版執行期不再讀取 `server/data/chat_history.json`。清理程式預設只 dry-run 並回報筆數與日期區間，不顯示內容或學號；真正刪除必須另帶 `--apply --confirm-legacy-chat-delete`，且需使用者再次明確批准。本次不刪除舊檔。

## 功能與 API

- `GET /api/privacy/policy`：公開政策版本、用途與保存期限。
- `GET /api/privacy/consents`：目前登入者的同意狀態。
- `PUT /api/privacy/consents`：一次更新三種用途；選擇性用途預設 false。
- `GET /api/privacy/export`：串流使用者自己的可攜資料，不包含密碼、內部 subject ID 或 Raw Chat 明文。
- `DELETE /api/privacy/chat`：刪除登入者的 Raw Chat。
- `POST /api/privacy/deletion-intents`：建立短效、單次刪除確認 token。
- `DELETE /api/privacy/data`：確認 token 與固定確認詞後刪除服務帳號、Profile、修課歷史、已存課表與 Raw Chat；保留 365 天的最小同意／稽核記錄。因 MySQL 與 JSON 無法組成單一交易，各步驟需可重試並留下稽核結果。

個人資料 API 在啟用 enforcement 後，若尚未同意目前版本的必要用途，回傳 HTTP 428 與 `CONSENT_REQUIRED`／`CONSENT_VERSION_OUTDATED`。#2 未完成前不會由 #33 假造互動 event 或推薦理由版本；#33 只提供 consent guard 與 pseudonymization boundary。

## 工程實作

1. `privacyPolicy.js` 是目的、版本、保存期與研究門檻的唯一程式規格。
2. MySQL migration 建立同意、subject state、稽核、資料請求與加密聊天表，刻意不與 `User_Profiles` 建 FK，避免分析身分直接回連學號。
3. `privacyService.js` 負責 HMAC subject ID、AES-256-GCM、append-only consent、聊天保存與清理；測試可用記憶體 adapter，production 不可使用。
4. `requireConsent` middleware 擋下未具有效必要同意的個人資料 API。
5. Chat 先檢查必要同意與輸入／Gemini 設定，成功後才保存加密訊息，並只輸出 metadata log。
6. 前端 Privacy Center 顯示三層同意、保存期、Gemini 處理說明及匯出／清除／刪除操作；server consent 是唯一真相來源，localStorage 不代表法律同意。
7. migration、retention 與 legacy cleanup 均為顯式 CLI；migration/cleanup 預設 dry-run。

## 驗證與部署門檻

- 單元／route 測試涵蓋預設拒絕、政策改版、撤回、HMAC 不含學號、AES round-trip/tamper、跨使用者隔離、短效單次 token。
- 執行 server 全測試、前端 lint/build、後端全檔 `node --check`。
- 已用隔離的 `BROWSER01` fixture 完成人工瀏覽器 A/B：未同意時受保護 API 回 `428 CONSENT_REQUIRED`；只同意必要用途後可進入課表主頁，同一 API 改由一般輸入驗證回 400。
- MySQL consent 狀態確認 `requiresAction=false`、`service_processing=true`、`personalization_learning=false`、`aggregate_research=false`。
- 同意後課表主頁可正常顯示，瀏覽器 console 的 error／warning 為 0。
- shared MySQL migration 已在使用者明確批准後套用，並再次 dry-run 確認五張表全部存在。
- 本機 `server/.env` 已產生兩把獨立 secrets、設定 MySQL store 並開啟 enforcement；因尚無正式網站，Production hosting 另由 #39 追蹤。
- 舊 Chat 刪除不在本次執行範圍；#33 原始碼與文件經驗證後由同一筆 commit 發布。
