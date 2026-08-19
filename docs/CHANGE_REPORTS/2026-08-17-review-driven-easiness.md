# 2026-08-17 評價驅動的涼度評分（Roadmap #4）

## 修改日期

2026-08-17

## 修改檔案清單

**新增**：

- `server/src/utils/ttlCache.js`
- `server/src/skills/courseReviewStats.js`
- `server/test/ttlCache.test.js`
- `server/test/courseReviewStats.test.js`
- `server/test/reviewSearch.test.js`
- `docs/CHANGE_REPORTS/2026-08-17-review-driven-easiness.md`（本檔）

**修改**：

- `server/src/skills/reviewStats.js`
- `server/src/skills/reviewSearch.js`
- `server/src/skills/scheduler.js`
- `server/src/db/database.js`
- `server/src/services/constraintService.js`
- `server/src/services/scheduleService.js`
- `server/src/services/promptService.js`
- `server/test/reviewStats.test.js`
- `server/test/scheduler.test.js`
- `server/test/database-contract.test.js`
- `server/test/fixtures.js`
- `.env.example`
- `docs/SCHEDULING_LOGIC.md`
- `docs/API_SPEC.md`
- `docs/DATA_SCHEMA.md`
- `docs/TEST_PLAN.md`
- `docs/PROMPT_DESIGN.md`
- `docs/DECISIONS.md`（新增 ADR-006～008）
- `docs/CHANGE_REPORTS/2026-08-01-personalization-roadmap.md`（#4／#5／#10／#26 進度回填）

## 主要改動內容

### 問題

Roadmap #4「把評分方式結構化」原本標成 🟡 部分完成：`server/src/skills/reviewStats.js` 已提供評價
聚合（加權平均、`calculateEasinessFromAverages()`），但 `scheduler.js` 全檔沒有任何 `review` 字樣，
排課引擎判斷「涼課」仍然只看課程描述的「涼／容易／輕鬆／高分／甜」關鍵字。實測 3560 筆課程只有
26 筆（0.7%）命中，且會誤判——評價標籤裡的「教室很涼」（形容冷氣強）會被判成涼課。這是 roadmap
#10「五方案塌縮成兩種」的根因二：`easy_score` variant 的評分函式因此與 `required_first` 完全相同。

### 設計

1. **`skills/reviewStats.js` 新增 `shrinkEasiness()`**：m-estimate 收縮，`adjusted = (n×raw + m×prior) / (n+m)`，`m=5`（實測 `Course_Reviews.review_count` 落在 4–8，取中位數）。放在這個共用統計模組是因為它現在有兩個消費端：排課引擎與 `/api/reviews/easy` 排行榜。理由見 `docs/DECISIONS.md` ADR-007。
2. **新增 `skills/courseReviewStats.js`**：課程 ↔ 評價的對應（`buildReviewIndex`）、母體先驗（`buildReviewPrior`，只由有評價的課計算）、1–5→0–100 尺度映射（`easinessToScore`）、無證據課程的中性分（`getNeutralEasyScore`，即 m-estimate 在 n=0 的極限）、完整證據物件組裝（`deriveReviewEvidence`）。放 `skills/` 不放 `data/`：現行相依方向是 `skills → data` 單向，放 `data/` 會開出反向邊。
3. **評價經 `constraints.courseReviews` 直通**：比照 #19 `courseHistory` 的既有 pattern，`scheduleService.js` 從 `getAll('reviews')` 取得後經 `constraintService.js` 的新增第三參數 `context` 注入，不接受 request 覆蓋——沒有任何呼叫端會在 request 裡送評價，寫成雙來源合併只會暗示不存在的覆蓋能力，還讓 Agent 有機會塞造假分數。
4. **`scheduler.js` 全面接線**：
   - `prepareCandidates()` 在候選前處理階段（term/eligibility gate 之前）掛上 `course.reviewEvidence`。
   - `getEasyCourseScore(course)` 改回傳 `course.reviewEvidence?.easyScore ?? null`，移除關鍵字法。
   - `scoreCourse()` 的 `easy_score` 分支：無證據時用 `neutralEasyScore`（母體先驗換算），不用 0。完全沒有評價資料時這是常數偏移，排序與改動前逐項一致。
   - `getEasiness(plan)`：只在有證據的課上平均，回傳 `number | null`。與課程層「無證據給中性分」刻意不同調——這裡是對使用者的宣稱，不能用非證據支撐。
   - `evaluatePreference()`：`easy` 軸為 `null` 時連同權重一起從加權平均排除，不以 0 參與（否則會用資料缺口懲罰使用者）。設計取捨見 ADR-006、ADR-008。
   - 新增四條誠實性警告：完全沒有評價資料、涼課偏好但候選全無評價、涼度覆蓋率過低、有評價的課因資格待確認（#13C）被排除。
   - 新增 `plan.reviewCoverage`（`{ rated, total, ratio }`）與頂層 `reviewDataLoaded`。
5. **同步修正 `GET /api/reviews/easy` 的排名不一致**：抽出純函式 `rankEasyCourses()`，排序改用收縮後的 `adjustedEasiness`（與排課引擎共用同一套 index/先驗/收縮邏輯），不再是未收縮的 `easiness`。這是刻意的行為變更（ADR-007），已確認無前端 UI 呼叫、無既有測試釘住舊排序。順手修掉兩個既有小問題：`getEasyCourses()` 原本自己重算六次加權平均（未重用 `summarizeReviews()`），以及 `roundScore(easiness,2) || 0` 把 `null` 與 0 混為一談。
6. **`getAll('reviews')` 加 TTL 快取**：新增泛用 `utils/ttlCache.js`（`createTtlCache`，可注入時鐘），`database.js` 的 `getMysqlReviews()` 改用它包裝，預設 60 秒、可用 `REVIEWS_CACHE_TTL_MS` 覆寫。順手修掉 `reviewSearch.js` 既有的「一次請求撈兩次全表」問題（`getReviewsByCourse()` 與 `getSentimentSummary()` 現在共用快取結果）。
7. **`promptService.js` / `docs/PROMPT_DESIGN.md` 補輸出說明**：`reviewEvidence` 為 `null` 時不得宣稱涼／好拿分；`preferenceBreakdown.easy` 可能為 `null`，改讀 `reviewCoverage`；`get_easy_courses` 排序依據換成 `adjustedEasiness`。**`run_csp_scheduler` 的 tool 參數本身未改**——`courseReviews` 是伺服器端注入，不出現在 tool 契約中，比照 `courseHistory` 的既有決定。

### 明確不在本次範圍

- **per-user 加權方向**（同一難度數值對不同使用者相反符號）：屬 #5 的後半，需先有偏好強度模型與互動 log（#2、#7），本次只做母體共用的涼度。
- **`has_midterm`／`has_group_project`／`grading_scheme`／`language` 課程欄位**：需對共用 MySQL 做 `ALTER TABLE`，屬與 #18 `student_id` migration 同性質、需與組員協調的 D 類 rollout。`noMidterm`（真實命中率 0.1%）、`noGroupReport`、`englishTaught` 三個偏好因此**維持**現行描述關鍵字判定——它們是硬性限制，改判定方式會讓候選集歸零，屬 #3 的範圍。
- **不放寬 #13C 的通識資格判定**：68 筆通識評價維持保守排除，改為在警告中誠實說明「有評價但因資格待確認未納入」，不因此宣稱已知誰可以修。
- **`server/db/schema.sql` 的 category CHECK 修正**：前提已失效，該檔是 legacy SQLite 死檔，無程式讀取，roadmap 已記錄作廢，不動該檔。
- **#26 的其餘欄位**（`selectedBecause`、`matchedPreferences`、`requiredRules`、`alternativesRejected`、`constraintTradeoffs`、`confidence`、`dataSources`）：一個都不加，只提供 `reviewEvidence`。
- **不做前端涼度 UI**：本次唯一的使用者可見改動是 warnings 文字（已由 `DashboardPage.jsx` 既有的 `makeNotice()` 渲染），不新增徽章或方案比較介面，屬 #27。

## 影響範圍

- `POST /api/schedule/generate` 與 `/api/chat` 的 `run_csp_scheduler`：回應新增 `reviewDataLoaded`（頂層）、`reviewEvidence`（每門課）、`reviewCoverage`（每個 plan）；`preferenceBreakdown.easy` 語意由「關鍵字命中率」改為「評價平均」且可能為 `null`——**向後相容的欄位新增，但既有欄位的語意有變動**，已在 `docs/API_SPEC.md` 記錄。
- `GET /api/reviews/easy`：**排序結果改變**（改用收縮後分數），新增 `adjustedEasiness` 欄位，`easiness` 欄位保留但不再是排序鍵。已確認無前端 UI 呼叫此端點（`client/src` 只有 API 定義、無元件實際呼叫），實際影響侷限在 AI Agent 的 `get_easy_courses` tool 回答內容。
- 排課邏輯：`easy_score` variant 的實際評分依據改變，可能影響哪些課程被選入涼課方案（僅在候選課有評價資料時才會有差異；詳見下方驗證結果的效果量說明）。
- 效能：`getAll('reviews')` 加了 TTL 快取，同時修掉 `reviewSearch.js` 既有的雙重撈取問題，屬效能改善而非退化。

## 測試與驗證結果

### 自動化測試

- `npm test`：**407 tests / 94 suites 全數通過**（基準 365 tests / 86 suites，新增 42 個測試，0 個失敗、0 個 skip）。
- 新增測試依編號序列橫跨 4 個檔案（比照 `courseHistory.test.js` → `scheduler.test.js` 的既有慣例）：
  - `ttlCache.test.js`：TC1–TC4，純函式、注入時鐘、不連 DB。
  - `reviewStats.test.js`：V1–V5（`shrinkEasiness()`），另補齊 `calculateEasinessFromAverages`／`roundScore` 先前完全缺失的直接測試。
  - `courseReviewStats.test.js`（新檔）：V6–V15，課程 ↔ 評價對應與尺度映射。
  - `reviewSearch.test.js`（新檔，先前零測試覆蓋）：V16–V19，`rankEasyCourses()` 的排名一致性迴歸測試——V16 用真實會反轉排序的參數（4 則全高分 vs 8 則中高分 + 背景課拉低先驗）構造出具體的排序反轉案例。
  - `scheduler.test.js`：V20–V28，端到端整合測試，含 A/B、關鍵字誤判修復（V22）、警告觸發（V23／V28）、回歸安全性（V25：完全不帶評價時排序與改動前逐項相同）。
  - `database-contract.test.js`：新增三則連真實 MySQL 的契約測試（覆蓋率>0、五個評分欄位值域 1–5、`review.courseId` 可對回實際 section、母體 easiness 落在合理範圍），全數通過。
- 既有測試零回歸：已 grep 確認**沒有任何既有測試斷言 `preferenceBreakdown.easy`**，所有 fixture 的 `description` 為 `''`（舊版恆為 0）；新版對它們回傳 `null`，`easy` 軸在既有測試中權重本來就是 0（無測試設 `preferEasyCourses`），排除後 `preferenceScore` 不變，S13／S14 維持通過。

### S1–S10（`docs/TEST_PLAN.md` 與 `.claude/skills/commit-push/SKILL.md` 強制要求）

逐項執行，全數通過：S1（衝堂判定）、S2（關注課程不衝堂）、S3（必修優先）、S4（重補修優先）、S5（核心選修路徑解析）、S6（路徑警告）、S7（不排早八）、S8（週一空堂）、S9（學分不足警告）、S10（必要課程排不進去回傳失敗原因）。

### 真實資料驗證（node 層，連正式 MySQL）

- `Course_Reviews` 實測：181 列 / `Course_Sections` 3560（覆蓋率 5.1%），全部 114-下學期、全部選修，`review_count` 4–8、平均 5.40，總計 977 則評論，五個評分欄位 0 個 null、值域皆 1–5。母體 easiness（1–5）mean 3.725、sd 0.358。
- 對「資訊工程學系 3 年級」學生 scope，181 筆有評價的課程中，只有 **75 筆（`eligible` 且本學期）** 會真正進入自動排課；最大一塊（**68 筆通識**）因 #13C（B～F 類正式適用對象規則尚未確認）被保守排除。
- **demo 帳號 `D1249697`（資訊三乙）A/B**：`preferEasyCourses` 開關對主推方案的**課表內容沒有變化**（8 門課、23 學分，皆為必修與重補修，兩次結果相同）；原因是候選池 227 門中 219 門因 #13C／已修過等原因被排除，最終排入的 8 門課裡只有 1 門有評價（覆蓋率 12.5%）。但 `preferenceBreakdown.easy` 從無意義的關鍵字結果變成真實計算值 0.72，`偏好符合度` 由 17%（關掉）變 35%（開啟），且「涼度僅由 1／8 門有評價的課推得」的新警告正確觸發，「已保守排除的資格待確認課程中有 68 門有課程評價（共 371 則）」的新警告也正確觸發並在瀏覽器實機確認渲染。**此次驗證誠實回報：對這個 demo 帳號的實際候選池，涼度評分機制已正確接線並產生正確的解釋性輸出，但因資料覆蓋率限制未能改變最終排入哪些課程。**
- **補充驗證（75 筆 eligible+reviewed 候選、無 department 限制）**：`preferEasyCourses` 開啟後主推方案由「必修與重補修優先」變為「涼課與高分優先」，課表內容確實改變（「電子商務」被「商用英文會話(二)」取代），`preferenceBreakdown.easy = 0.70`、`reviewCoverage` 為 9/9（100%），去重後方案數由 1 增至 3——證明機制在評價覆蓋率充足時會產生真實的課程層級差異，且緩解（非解決）roadmap #10 的方案塌縮問題。

### 瀏覽器實機驗收（`AGENTS.md:133-147` 強制，`preview_start` 啟動 server + client）

- 以 demo 帳號 `D1249697` 完成登入與設定流程，`/schedule` 頁面自動排課後，畫面確認顯示新警告文字：「已保守排除的資格待確認課程中有 68 門有課程評價（共 371 則），因適用對象規則尚未確認（roadmap #13C）而未納入涼度評分。」（已截圖存證）。
- 透過 Chat 面板嘗試「幫我排涼課優先的課表」：因本機 `.env` 未設定 `GEMINI_API_KEY`，`/api/chat` 回傳既有的錯誤訊息（與本次改動無關的既有環境限制，非本次引入的錯誤）。改以瀏覽器已登入 session 直接呼叫 `POST /api/schedule/generate`（與 UI 按鈕背後呼叫的是同一支 API）驗證 `preferEasyCourses` 開關，取得上述真實 A/B 結果。
- Console 檢查：僅有登入前既有的 4 個 `/api/auth/me` 401 探測（登入前的既有行為，與本次改動無關），未增加任何新錯誤；`preview_logs` 確認伺服器端無錯誤日誌。

## 對抗式審查修正（2026-08-17 追加）

`/codex:adversarial-review` 對本次工作區變更提出一個 high、兩個 medium 發現，均成立，已修正。

**發現一（high）：評價查詢失敗會讓整個排課請求 500**

`generateForUser()` 原本直接 `await getAll('reviews')`，沒有獨立容錯。評價資料只是加分用的
enrichment——`scheduler.js` 明確支援它缺席（`reviewDataLoaded: false` + 中性分計分）——但只要
`Course_Reviews` 查詢因逾時、schema 不同步或暫時性錯誤而 reject，整個排課請求（REST 與 Chat 共用
同一入口）就會直接失敗，等於把一個選配資料來源變成排課功能的單點故障。

修法：抽出 `loadCourseReviewsSafely(loadReviews)`，失敗時記 log 並回傳 `[]`，讓排課照常以中性分
繼續進行，不再讓評價查詢的失敗擴散成排課請求整體失敗。

**發現二（medium）：找不到候選課的早退路徑遺漏 `reviewDataLoaded`**

`docs/API_SPEC.md` 明訂成功與失敗的排課回應都帶 `reviewDataLoaded`，但 `candidates.length === 0`
時回傳的是靜態常數 `NO_CANDIDATES_RESULT`，沒有這個欄位——呼叫端因此無法分辨「`false`」與「這個
版本的 API 沒有這個欄位」，而 `docs/PROMPT_DESIGN.md` 明確要求 Agent 依 `reviewDataLoaded === false`
分支。

修法：`NO_CANDIDATES_RESULT` 改為 `buildNoCandidatesResult(reviewDataLoaded)` 函式，動態帶入本次
實際取得評價資料的狀態。

**發現三（medium）：TTL 快取的 rejection handler 會清掉更新一代的 pending**

`ttlCache.js` 原本的 catch 區塊無條件 `pending = null`。若 generation A 的 producer 跑得比 TTL
還久，新呼叫發現已過期會啟動 generation B 並取代 `pending`，此時 A 才姍姍來遲地 reject——舊碼會把
「目前其實是 B」的 `pending` 一併清掉，讓後續呼叫誤以為沒有進行中的查詢而各自再起一個 producer，
在資料庫本就不穩定（逾時、暫時性錯誤）時反而製造 query stampede，恰好與 TTL 快取原本要防止的情況
相反。

修法：`if (pending === promise) { pending = null; }`——只清掉「自己仍是目前最新一代」的 pending。
已用一支獨立腳本針對舊實作重現：同樣的時序在修正前產生 3 次 producer 呼叫（多餘的第三次即為
stampede），修正後穩定維持 2 次。

**追加修改檔案**

- `server/src/services/scheduleService.js`
- `server/src/utils/ttlCache.js`
- `server/test/scheduleService.test.js`（新增）
- `server/test/ttlCache.test.js`（新增 TC5）

**追加驗證**

- `npm test`：**413 tests / 96 suites 全數通過**（本次追加前為 407/94，新增 6 個測試：`loadCourseReviewsSafely` 3 則、`buildNoCandidatesResult` 2 則、TC5 1 則）。
- S1–S10 重跑通過，無回歸。
- `node --check` 對兩個修改檔案通過。
- 已驗證 TC5 對修正前的舊實作確實會失敗（獨立腳本重現 3 次 producer 呼叫），不是一個永遠通過、測不到任何東西的假測試。

## 是否 commit 與 push

- 尚未 commit，尚未 push。
- 補充說明：`server/data/chat_history.json`／`server/data/users.json` 在瀏覽器驗收過程中因登入、設定精靈與 Chat 互動被 Express 正常寫入，新增了對話紀錄與去除檔尾換行符——這是瀏覽器驗收（AGENTS.md 強制要求）產生的既有副作用，不是本次任務刻意修改測試資料；且這兩個檔案在本次工作開始前就已經是 modified 狀態（見會話開始時的 git status）。commit 時將排除或如實包含這兩個檔案的變動，由使用者決定。
