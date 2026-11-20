# 課程主題選擇改版 Step D：追問服務與保存驗證

## 1. 修改日期

2026-11-20

## 2. 背景

接續 [Step A](./2026-11-20-interest-selections-step-a.md)（資料模型）、[Step B](./2026-11-20-interest-selections-step-b.md)
（S_tag 先驗）、[Step C](./2026-11-20-interest-selections-step-c.md)（選單分組）。這一步建立追問：學生勾選類別、
按「完成並保存偏好設定」之後，每個類別問一題，學生勾的**具體標籤**才會得到 S_tag 先驗。同時採用使用者決定的
**方案 A＋D**（見 [Step C 後續](./2026-11-20-interest-selections-step-c-followup.md)）。設定頁尚未接上。

## 3. 修改檔案清單

- `server/src/services/openaiClient.js`（新增）
- `server/src/services/interestFollowupService.js`（新增）
- `server/src/services/interestSelectionService.js`（新增）
- `server/src/routes/profile.js`
- `server/src/data/interestMenuConfig.js`
- `.env.example`（只加變數名稱 `INTEREST_FOLLOWUP_MODE` 與說明，沒有任何金鑰）
- `server/test/interestFollowupService.test.js`（新增）、`server/test/interestSelectionService.test.js`（新增）
- `docs/API_SPEC.md`、`docs/PROMPT_DESIGN.md`
- `docs/CHANGE_REPORTS/2026-11-20-interest-selections-step-d.md`（本報告）、`docs/CHANGE_REPORTS/README.md`

## 4. 主要改動內容

### 4.1 追問服務與 `POST /api/profile/interest-followups`

- **後端掌握可選標籤，GPT 只寫問題與調整順序**：每個類別的候選標籤來自這位學生的排課候選池（同時可學習且可跨課
  配對），依課程數排序取前 20 個；GPT 不能新增、改名、翻譯或移除標籤。GPT 回傳的編號不在清單內的丟掉、重複的丟掉、
  漏掉的依課程數補在後面；問題壓成單行純文字，過長（> 80 字）、含網址或為空就改用固定問句。
- **方案 A**：每個選項附代表課程與課程數（前端顯示「會加分給 N 門課」），學生自己判斷。
- **方案 D**：提示詞明確要求把工具與軟體名稱（PowerPoint、Chat GPT）、泛用詞、附帶主題排在最後；學生最多看到 12 個
  選項，排在尾端的就不會出現。
- **學生以前選過、仍然有效的標籤一律重新顯示**，不受 12 個上限與 GPT 排序影響，否則 GPT 每次挑不同選項會讓舊答案
  無法編輯。以前選過但已不在候選池的標籤不顯示。
- **固定問句後備**：沒有 `OPENAI_API_KEY`、`INTEREST_FOLLOWUP_MODE=fixed`、逾時（12 秒，不重試）、呼叫失敗、輸出格式不對，
  一律改用「『類別』裡你對哪些主題有興趣？」，選項來源與流程相同；`fallbackReason` 回報原因。**追問失敗不回錯誤，也不
  擋保存。**
- **隱私**：送給 OpenAI 的只有**類別名稱、標籤名稱與課程數**，沒有使用者 ID、Profile、修課歷史、系所或班別。題目只依
  「類別＋候選標籤」決定，所以在伺服器記憶體快取 24 小時、所有使用者共用；失敗不快取。沿用既有 `service_processing`
  同意，**不升 `PRIVACY_POLICY_VERSION`**（使用者決定）；`privacyPolicy.js` 的用途文字字面上沒有涵蓋這個用途，已用
  `INTEREST_FOLLOWUP_MODE=fixed`（完全不呼叫 OpenAI）作為退路，取捨與缺口會寫進 Step F 的 ADR。
- 路由：`requireIdentity` + `requireServiceConsent`，每位使用者每分鐘最多 6 次（限流的 key 只在記憶體，不寫資料表）；
  一次最多 6 個分類；請求本文驗證抽成純函式 `validateFollowupRequest()`。
- 單次呼叫用的 OpenAI client 獨立成 `openaiClient.js`（`maxRetries: 0`、逐次指定逾時、model 取自 `OPENAI_MODEL`），
  與聊天 Agent 的 client 分開；`agentService.js` 沒有修改。

### 4.2 保存驗證 `sanitizeInterestSelectionsForSave()`（接在 `POST /api/profile`）

- 標籤必須屬於「這一組、這個分類」在**這位學生的候選池**裡的可選標籤——單查「ID 存在於目錄」不夠：被竄改的請求可以
  送一個目錄裡存在、可選、卻跟他的選單完全無關的標籤，存進去後會悄悄改變排課。
- 分類必須存在、層級與組別相符（本系用子類別，通識與系外用大類別）、在這一組的候選池裡有這個分類。
- **與已保存的某一筆完全相同的選擇不重驗、原樣保留**：新學期候選池變了，舊答案不能被默默刪掉。
- **候選池載入失敗或班別沒選好時不接受新的標籤**：變動的選擇保留已保存的標籤、新增的只記類別，狀態 `unverified`，
  **不擋住其他欄位保存**。
- 回應多 `interestSelectionsStatus`（`unchanged`、`verified`、`unverified`）與 `interestSelectionWarnings`。

## 5. 影響範圍

- **使用者看得到的畫面沒有改變**：設定頁尚未接上追問與新的選單。
- API：新增 `POST /api/profile/interest-followups`；`POST /api/profile` 在送 `interestSelections` 時多驗證並多回兩個欄位，
  沒送的呼叫端不受影響。
- 沒有排課器修改，不需要 S1-S10。
- 已知限制：保存時若候選池快取已過期（10 分鐘），第一次需重建約 2 秒；GPT 追問第一次約 5 秒（見下）。
- 未推進 roadmap 任務的狀態（#43 延伸改版，尚未完成）。

## 6. 測試與驗證結果

- 新增 31 個測試：追問服務 18 個（FU1～FU17 與前提：GPT 排序與上限、編號驗證、失敗與逾時後備、mode 與 API key、隱私逐項釘住、
  以前選過的重新顯示、快取與 TTL 與失敗不快取、unavailable、A、D 提示詞、多分類一次呼叫、併過選項的名稱、問題清理、
  請求驗證）、保存驗證 13 個（SS1～SS12 與前提）。OpenAI 用注入的假 client，不打真的 API。
- **變異測試**：故意弄壞實作，確認對應的測試真的會失敗——追問服務 4 個（以前選過的不驗證有效性、不寫快取、不擋網址、
  偷偷把系所送給 OpenAI）、保存驗證 3 個（不檢查標籤在候選池、沒變的也重驗、候選池失敗時照收新標籤），全部被抓到，已還原。
- 後端完整測試：1,711 個，1,710 通過、0 失敗、1 略過；`server/src/**/*.js` 全部 `node --check` 通過。
- **真實驗證（唯讀資料庫＋真的 OpenAI 呼叫）**：資工三年級、系外組「語言、文學與溝通」（29 個可選標籤）。固定問句 23 毫秒；
  真的 GPT 第一次 **5.1 秒**，結構化輸出格式被模型接受，題目是「你想接觸哪些語言、文學或溝通主題？」，GPT 把語言類標籤
  （日語、西語、英語）排到前面；第二次走快取 22 毫秒。這次呼叫只送了該類別的名稱與標籤名稱。
  保存驗證在真實候選池上的結果：合法保留（verified）、語言類塞入商管類標籤被擋（`tag_not_in_pool`）、系外的日語選在通識組被擋、
  沒變的舊答案不重驗（unchanged）、班別沒選好時不接受新標籤（unverified）。
  這些實測**不是可重複執行的自動化測試**；路由本身（登入、同意、限流、資料庫寫入）沒有自動化測試，只確認路由模組能載入並
  註冊 `POST /interest-followups` 與 `POST /`。
- 沒有前端畫面改變，所以沒有做瀏覽器驗收；瀏覽器 Persona A/B 驗收留到最後一個 step。

## 7. 待決與風險

- **GPT 延遲約 5 秒**：使用者按「保存」後等這一次呼叫，前端對話框需要自己的 loading，逾時 12 秒會退回固定問句。
- 路由沒有自動化測試，Step G 的瀏覽器驗收要逐項走：追問、保存、`unverified` 路徑、`INTEREST_FOLLOWUP_MODE=fixed`、
  拿掉 `OPENAI_API_KEY`。
- 隱私用途文字的缺口與「不升版」的取捨，Step F 的 ADR 會記錄。

## 8. 是否 commit 與 push

是，推到 `origin backend`。`docs/API_SPEC.md`、`docs/CHANGE_REPORTS/README.md` 原本就有別人尚未提交的修改，這次只提交屬於本次的區塊。
