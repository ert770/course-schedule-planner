# 2026-08-20 修復 backend 分支的 adversarial review 發現（3 項）

## 修改日期

2026-08-20

## 修改檔案清單

**新增**：

- `docs/CHANGE_REPORTS/2026-08-20-adversarial-review-fixes.md`（本檔）

**修改**：

- `.gitignore`
- `server/src/db/mysql.js`
- `server/scripts/profileSchemaMigration.js`
- `server/src/services/sessionService.js`
- `server/src/app.js`
- `server/test/session.test.js`
- `docs/DATA_SCHEMA.md`
- `docs/DECISIONS.md`（新增 ADR-015）
- `docs/CHANGE_REPORTS/README.md`

**移除追蹤（檔案仍在磁碟上）**：

- `server/data/chat_history.json`（改為 `.gitignore` 排除）

## 背景

對 `backend` 分支相對 `main` 的完整差異（117 個檔案、約 12,000 行新增）跑了一次 Codex
adversarial review，結果標成 `needs-attention`，列出 3 項發現。本次逐一修復。

## 主要改動內容

### 1. `server/data/chat_history.json` 不再進 Git 追蹤（high）

**問題**：`memoryService.js` 的 `addChatMessage()` 每次 AI 聊天都會寫入這個檔案，內含真實
`userId`（學號）、對話內容、時間戳記。因為 `chat_history` 不在 `database.js` 的
`MYSQL_COLLECTIONS` 集合裡，不論有沒有設定 MySQL，一律固定走本機 JSON 路徑——這不是
demo fixture，是持續累積真實對話紀錄的執行期檔案，卻被追蹤進 Git。已用 `git log --follow`
確認過去 4 次提交都帶著這個檔案的快照，最近一次（2026-08-19）就包含真實學號 `D1249697`
與對話內容。

**修復**：加進 `.gitignore` 並 `git rm --cached`——檔案仍留在磁碟上供本機 JSON 回退路徑
使用，只是往後不再進版控。

**明確保留給使用者決定的部分**：歷史上已提交的 4 次快照仍留在 Git 歷史裡，移除需要改寫
歷史並強制推送到共用的 GitHub remote，會影響其他協作者的本地 clone（需要重新 clone）。
這是本次**刻意不做**的部分，是否要做需要 repo 擁有者明確決定。

### 2. `student_id` 回填 migration 加上交易與逐筆驗證（high）

**問題**：`profileSchemaMigration.js` 的 `backfillStudentIds()` 用本機 `users.json` 的
`id` 欄位直接比對 shared MySQL 的 `User_Profiles.user_id`，逐筆各自 `UPDATE` 並各自
autocommit，完全不檢查 `affectedRows`。兩個具體風險：(a) 半途失敗會留下部分套用、部分
未套用的資料庫狀態；(b) 若本機 `id` 恰好對不上 shared MySQL 裡同一個 `user_id` 代表的
真實學生，`UPDATE` 仍會「成功」，等於把 `student_id` 寫進了別人的 profile，且完全沒有
任何錯誤訊號。

**修復**（`server/src/db/mysql.js` 新增 `withTransaction()`，`profileSchemaMigration.js`
改寫 `backfillStudentIds()`）：
- 整批回填包在單一交易裡，任何一筆 `UPDATE` 的 `affectedRows !== 1` 就立即拋錯並
  rollback，不留下部分套用的中間狀態。
- dry-run 與 `--apply` 都會先印出完整的 `user_id → studentId, className` 對照表，
  附上「這個對應無法由程式自動證明」的明確警告，要求操作者在下 `--apply` 前自行核對。

**誠實記錄的限制**：這個修復**沒有**、也**不能**真正證明本機 `id` 與 shared MySQL 的
`user_id` 對應同一位真實學生——pre-migration 的 schema 沒有第三個共同欄位可以交叉核對
（`student_id` 本身正是這次要填入的目標欄位，還不能拿來反查）。修復做的是「把這個假設
講清楚、寫錯了立刻整批失敗」，不是「自動驗證身分」。真正的驗證仍需操作者對照。

### 3. Production 環境現在強制要求固定的 `SESSION_SECRET`（medium）

**問題**：`sessionService.js` 的 `getSecret()` 在 `SESSION_SECRET` 未設定時，靜默生成
一把本次程序的隨機密鑰，只發一條警告。在 production 環境下，這會讓每次重啟讓所有登入
session 失效，多台 replica 之間也會互相拒絕彼此簽的 cookie（各自用不同的隨機密鑰）——
症狀是隨機、難以重現的認證失敗，而不是一個清楚的啟動錯誤。

**修復**：新增 `assertSessionSecretConfigured()`——`NODE_ENV !== 'production'` 時完全
不動作（本機／demo 行為不變）；`NODE_ENV === 'production'` 時要求 `SESSION_SECRET`
存在且長度至少 32 字元，否則拋出說明清楚的錯誤。`app.js` 的 `startServer()` 在
`app.listen()` 之前呼叫這個檢查，讓設定錯誤的 production 部署在啟動當下就失敗，而不是
成功啟動後才在有真實流量、多副本情境下才顯現問題。

## 測試

- `node --check` 對所有變更檔案全數通過。
- `server/test/session.test.js` 新增 I5（4 個測試）：非 production 時不論有無設定都不
  拋錯；production 缺 `SESSION_SECRET` 時拋錯；production 但長度不足時拋錯；production
  且長度足夠時不拋錯。
- `npm test`（完整 server 測試套件）：446/446 通過，零回歸（較前一次的 442 增加 4，
  即新增的 I5 測試；`profileSchemaMigration.js` 需要真實 MySQL 連線才能有意義地測試，
  比照本專案既有慣例（唯一連真實 DB 的是 `database-contract.test.js`），未強行加上
  假連線的單元測試）。
- 瀏覽器實測（server:3001 + client:5173，帳號 D1249697）：確認 `sessionService.js`／
  `app.js` 改動後，dev 環境（`NODE_ENV` 非 production）啟動、登入、`/api/auth/me`
  仍正常運作，`assertSessionSecretConfigured()` 在本機環境正確不動作。過程中
  `node --watch` 因程式碼變動多次重啟，導致舊 session cookie 失效（這是既有、已記載的
  預期行為——重啟會用新的暫時密鑰重簽——不是本次改動造成的迴歸），重新登入後恢復正常。

## 明確排除在本次範圍外

- 歷史 Git 提交中已存在的 `chat_history.json` 快照未被清除（需要改寫歷史並強制推送，
  影響其他協作者，需 repo 擁有者另外決定）。
- `student_id` 回填的身分對應仍仰賴操作者人工核對，沒有、也無法自動化證明——這是
  pre-migration schema 本身缺乏可交叉核對欄位的結構性限制，不是本次修復的疏漏。
