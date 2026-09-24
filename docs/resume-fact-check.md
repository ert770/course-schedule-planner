# 履歷與自傳事實核對報告

> 調查日期：2026-09-14｜分支：`backend`（HEAD `8df7039`，已併入 `main` 的 PR #22）
> 依據優先序：**實際執行路徑的程式碼 > 測試 > 文件**。文件只作輔助。
> 本報告**未修改任何功能程式碼**，也不含任何 token、密碼、API key 或連線字串。

---

## 1. 專案現況摘要

以下各項能力都以程式碼確認：

- **後端**：Node.js + Express 5，共 9 組 REST router（`server/src/app.js`），資料以共用 MySQL 為主，`users.json`／`saved_schedules.json` 為後備檔案。
- **排課引擎**（`server/src/skills/scheduler.js` 的 `generateSchedule()`）
  - 先依版本化評分規則，以多個策略各跑一次**貪婪建構**（`buildPlan()`）。
  - 主推方案不合法或未達最低學分時，改用**有界回溯修復**（`scheduleSolver.js` 的 `solveWithBoundedBacktracking()`，節點上限 50,000、預設逾時 2 秒）。
  - 回傳前以獨立驗證器（`scheduleValidator.js`）重檢硬性限制。
  - **不是** CSP 傳播或 MRV solver，也不是 beam search、CP-SAT、local search。
- **多方案**：由 `planStrategies.js` 依使用者有表態的偏好軸動態產生「個人化綜合方案」、「更重視興趣／更集中排課／更重視輕鬆（或挑戰）」與「較多學分方案」。每個方案都以不同權重重新求解，再把課程組合相同的方案去重。
- **方案比較**：每個方案帶 `planMetrics` 與偏好符合度 `preferenceScore`。前端 `PlanComparison.jsx` 顯示差異列與課程增減，另有 counterfactual 端點回答「取消某偏好會怎樣」。
- **個人化**
  - **顯式偏好**（興趣關鍵字、集中排課、涼課或挑戰）決定評分方向。
  - **互動事件**只有在同時滿足下列條件時，才會以 boost 形式**放大已表態的偏好軸**，最多到 2 倍：
    - 使用者同意 `personalization_learning`
    - 可用事件達 50 筆以上
    - 權重已被重算
  - **歷史修課紀錄不參與權重**，只用於排除已通過課程、自動排入不及格必修的重修，以及畢業學分計算。
- **AI Agent**（`agentService.js` 的 `handleChat()`）
  - 以 OpenAI Responses API 的**原生 function calling** 驅動 7 個工具。
  - 排課工具與 REST 走同一個 `generateForUser()`。
  - 排課前做矛盾檢查；寫入型工具需要兩段式確認。
  - 最終回覆送出前，以規則式證據帳本做忠實度檢查。
- **隱私**
  - consent 中介層
  - 假名化 subject id
  - 聊天內容以 AES-256-GCM 加密
  - 保存期限常數
  - 匯出、刪除、重設個人化的 API
- **測試**：58 個 `node:test` 檔案，本次實跑 1,058 個測試（結果與限制見第 3 節第 23 項）。**前端與 E2E 測試為 0**。
- **尚未完成**：
  - 正式部署（roadmap #39）
  - 真實學生使用者測試（#38）
  - 協同過濾（#6、#32）
  - 先修條件（#8，資料全為 NULL）
  - 個人化效果在真實使用者上的證明（#36 部分完成，只有 synthetic 資料）

---

## 2. 履歷主張核對表

原句逐句拆解如下。

| # | 履歷主張 | 判定 | 完成程度 | 程式碼證據 | 測試證據 | 建議用語 |
| ---: | --- | --- | --- | --- | --- | --- |
| C1 | 我提出個人化課表推薦系統的構想 | `無法確認個人作者` | — | repository 最早的 commit 是 2026-06-08 `75b04d5`，由 yamat 提交，一次加入 74 個檔案；`report/` 內 3–4 月的文件在建 repo 前就存在，也被收進這個 commit。程式庫中沒有提案、會議或指導紀錄 | 無 | 可保留原句，但須有提案書、指導教授或組員可佐證；否則改寫為「參與提出」 |
| C2 | 主要負責後端核心功能與系統整合 | `可由程式碼確認`（Git 層面）＋ `無法確認個人作者`（帳號歸屬） | Git 層面高 | `server/src` 的核心檔案（`scheduler.js`、`scheduleSolver.js`、`planStrategies.js`、`scoringPolicy.js`、`preferenceLearning.js`、`agentService.js`、`explanationFaithfulness.js`、`privacyService.js`、`interactionEventService.js`）的非 merge commit **全部**出自 `yamat`。另一位提交者 Szuwei 在 `server/src` 只有 +42／−12 行。前端 `DashboardPage.jsx` 有 23 次 yamat、8 次 Szuwei 修改 | 後端 58 個測試檔的 commit 作者全為 yamat | 「負責後端核心功能與前後端整合」。前提是確認 `yamat`／`ert770` 為本人帳號（見第 4、8 節） |
| C3a | 將使用者**歷史修課紀錄**轉換為個人化權重 | `敘述可能誇大或不精確`／`程式與文件不一致` | 0%（就「權重」而言） | 修課紀錄只用在三處：<br>• `scheduler.js` 的 `buildPlan()` 以 `getPassedCourseCodes()` 排除已通過課程（`ALREADY_TAKEN_PASSED`）<br>• `getFailedRequiredCourses()` 自動排入重修<br>• `scheduleService.js` 的 `prepareGenerationInputs()` 把重修課加入候選池<br>權重學習的顯式基準 `preferenceLearningService.js` 的 `deriveExplicitProfile()` 只讀 `preferCompact`，**完全不讀 courseHistory** | `courseHistory.test.js`（16 個測試）、`scheduler.test.js` 的重補修案例 | 「依歷史修課紀錄排除已通過課程、自動排入待重修必修，並納入畢業學分缺口判斷」 |
| C3b | 將使用者**互動紀錄**轉換為個人化權重 | `部分實作` | 管線完整；實際生效有條件 | 前端 `client/src/services/interactionLog.js` 送出事件到 `POST /api/interactions`。<br>`preferenceLearning.js` 的 `learnPreferenceWeights()` 以下列事件投票：<br>• 退選原因<br>• 接受的方案（比對方案之間的權重差）<br>• 收藏<br>• 手動加選<br>• 瀏覽（弱訊號，有上限）<br>計算上套用 m-estimate 收縮、時間衰減與跨學期降權，結果存入 `Learned_Preference_Weights`。<br>生效條件：<br>• 需要同意<br>• 需要 ≥50 筆可用事件（`REQUIRED_USABLE_EVENT_COUNT`）<br>• boost 只放大使用者已表態的軸（`scoringPolicy.js` 為 `direction × (1 + boost)`，沒表態的軸永遠是 0）<br>• 重算只在 `GET /api/privacy/personalization` 發現資料過期時觸發（`getPersonalizationSource()`），排課路徑只讀已存的結果 | `preferenceLearning.test.js`（48）、`preferenceLearningService.test.js`（17）、`personalizationBaseline.test.js`（11）。全部使用 synthetic fixture | 「設計需使用者同意的互動事件紀錄，於資料量足夠時轉為偏好權重，強化使用者已表態的排課偏好」 |
| C4 | 據此調整課程排序 | `可由程式碼確認`（顯式偏好）＋ `部分實作`（學習權重） | 顯式偏好：完整；學習權重：有條件 | `scheduler.js` 的 `computeScoreComponents()` 加總多個分項：<br>• 必修、類別、學分<br>• 內容偏好<br>• interest／compact／easy × policy 權重 × 240<br>`scoringPolicy.js` 的 `resolveScoringPolicy()` 帶入 learned boost | `scoringPolicy.test.js`、`scheduler.test.js` 的 PD1–PD11（同一評價分數對方向相反的使用者產生相反排序） | 「依使用者偏好與版本化評分規則調整課程排序」 |
| C5 | 動態產生綜合、偏好加重及較多學分等方案 | `可由程式碼確認`（附限制） | 高，但方案常塌縮 | `planStrategies.js` 的 `buildPlanStrategies()` 產生三類策略：<br>• `personalized`（綜合）<br>• 每個非零軸一個 `personalized_<axis>`，權重 ×1.5<br>• `personalized_credits`，學分係數 ×3，並持續填課到候選用盡<br>`generateSchedule()` 對每個策略**各呼叫一次 `buildPlan()`**，是真正重新求解，不是換名稱。但 `uniquePlans()` 會合併課程組合相同的方案；roadmap #10 記錄 demo 帳號實際只得到 2 種方案。沒有表態任何偏好時只會嘗試 2 個策略 | `planStrategies.test.js`（2）；`scheduler.test.js`：<br>• P10-2「各方案的課程集合兩兩不同」<br>• PM3「沒有塌縮時」證明綜合策略與較多學分策略會選出不同課程<br>• PM3 塌縮說明測試 | 「依使用者表態的偏好，以不同權重重新求解，產生綜合、單一偏好加重與較多學分等候選方案，並合併重複結果」。**不要寫**「保證產生三種以上不同方案」 |
| C6 | 呈現各方案的符合度與取捨差異 | `可由程式碼確認` | 高 | • `scheduler.js` 的 `evaluatePreference()`：依有證據的軸做加權平均，得出 `preferenceScore`<br>• `computePlanMetrics()`<br>• `planComparison.js` 的 `diffPlans()`、`summarizeMetricDifferences()`、`buildCounterfactuals()`<br>• `POST /api/schedule/counterfactual`<br>• 前端 `PlanComparison.jsx`、`PlanSwitcher.jsx` | `planComparison.test.js`（11）、`scheduler.test.js` 的 PM1–PM6 | 「呈現各方案的偏好符合度、上課天數、空堂等指標差異，並提供『取消某項偏好』的反事實比較」。「保留部分課程再重排」未實作，不要寫 |
| C7 | 將課程時段與使用者條件納入排程，避免產生衝堂結果 | `可由程式碼確認` | 高 | • `scheduler.js` 的 `evaluateCoursePlacement()`，檢查項目：<br>&nbsp;&nbsp;– 重複班次 `DUPLICATE_SECTION`<br>&nbsp;&nbsp;– 衝堂 `TIME_CONFLICT`<br>&nbsp;&nbsp;– 學分上限<br>&nbsp;&nbsp;– 每日課數上限<br>&nbsp;&nbsp;– 早八、午休、晚課<br>&nbsp;&nbsp;– 封鎖時段<br>&nbsp;&nbsp;– 避開教師<br>• 成功回傳前一律經 `validateScheduleAgainstConstraints()` 檢查 | `constraints.test.js`（16）；`scheduler.test.js`（165，含 X5 自我檢查與 Z 系列 repair）；`schedulerBenchmark.test.js` | 「以硬性限制與獨立驗證器確保推薦課表無衝堂，並支援封鎖時段、不排早八／午休等條件」。注意：先修條件未檢查（`enforced:false`） |
| C8 | 透過 AI Agent 支援自然語言需求解析與排課操作 | `可由程式碼確認` | 高（程式路徑）；本次**未**以真實模型端到端驗證 | • `agentService.js` 的 `handleChat()` 呼叫 `client.responses.create({ tools, tool_choice: 'auto' })`<br>• `executeAgentTool('run_csp_scheduler')` 會先做 `checkPreflightContradictions()`，再呼叫 `generateForUser()`<br>• 寫入型工具經 `pendingChangeService` 兩段式確認 | `agentTools.test.js`（38）、`agentToolRegistry.test.js`（8）、`requirementPreflight.test.js`（41）、`pendingChangeService.test.js`（14）。`agentGoldenSet.test.js` 會呼叫真實模型，在 CI 中依設計跳過 | 「以 LLM 原生 Tool Calling 串接排課、查課與偏好更新工具，排課前偵測矛盾條件，並對寫入操作要求使用者確認」 |

---

## 3. 後端功能盤點表

| # | 功能 | 是否存在 | 實作狀態 | 核心檔案 | 測試 | 可否寫入履歷 |
| ---: | --- | --- | --- | --- | --- | --- |
| 1 | REST API 設計與實作 | 是 | 完成。9 組 router：auth、privacy、graduation、chat、courses、schedule、profile、reviews、interactions | `server/src/app.js`、`server/src/routes/*.js` | `authRoutes`、`scheduleRoutes`、`privacyRoutes`、`interactionEvents`；非全部路由都有 API 測試 | 可 |
| 2 | Authentication、Session、權限控制 | 是 | 部分完成：<br>• Session 以 HMAC-SHA256 簽章 cookie 實作（HttpOnly、SameSite=Lax、正式環境加 Secure，7 天）<br>• `requireIdentity` 回 401／403，只能操作本人資料<br>• **沒有角色權限**<br>• **密碼在 `users.json` 以明碼直接比對**（`routes/auth.js`） | `services/sessionService.js`、`middleware/requireIdentity.js`、`routes/auth.js` | `session.test.js`、`identity.test.js`、`accountIsolation.test.js`、`authRoutes.test.js` | 可寫「session 驗證與帳號資料隔離」；**不可**寫「完整身分驗證／安全登入」 |
| 3 | Consent、Privacy、個資處理 | 是 | 大致完成：<br>• consent 中介層<br>• 聊天內容 AES-256-GCM 加密<br>• 假名化 subject id<br>• 保存期限常數（聊天 30 天、事件 180 天）<br>• 匯出、刪除、重設 API<br>• migration 002 | `middleware/requireConsent.js`、`services/privacyService.js`、`data/privacyPolicy.js`、`routes/privacy.js` | `privacyService.test.js`、`privacyRoutes.test.js`、`privacyPolicy.test.js` | 可（避免宣稱「符合某法規」） |
| 4 | 使用者 Profile 與偏好存取 | 是 | 大致完成，有缺口：<br>• `noEveningClasses` 無法儲存<br>• `mustTakeCourses`／`avoidInstructors` **已持久化**：`database.js:682-687`（讀，`mapUserProfileRow()`）與 `database.js:885-896`（寫，`jsonColumns`） | `routes/profile.js`、`services/memoryService.js`、`db/database.js`、`data/preferenceTags.js`、`data/profileSchema.js` | `profileSchema.test.js`、`databaseProfileContract.test.js` | 可 |
| 5 | 修課紀錄與畢業條件 | 是 | 部分完成：<br>• 修課紀錄已遷入 MySQL（migration 004）<br>• 版本化畢業規則與逐門認列已完成<br>• 正式科目表、認列表仍待外部資料（roadmap #23 🟡） | `data/courseHistory.js`、`routes/graduation.js`、`data/graduationRuleVersions.js`、`data/generalEducationRecognition.js` | `courseHistory.test.js`、`courseHistoryDatabase.test.js`、`graduation*.test.js` | 可寫「畢業學分追蹤與重修判斷」 |
| 6 | 課程、班別、上課時段存取 | 是 | 完成（讀取）。`Course_Sections` JOIN `Courses`，一列代表一個班次，時段字串經解析；資料表本身由組員建置（待確認） | `db/database.js`、`skills/courseQuery.js`、`utils/periods.js`、`routes/courses.js` | `courseQuery.test.js`、`periods.test.js`、`database-contract.test.js`（連真實 MySQL，唯讀） | 可寫「存取」，不可寫「建置課程資料庫」 |
| 7 | 排課演算法 | 是 | 完成：<br>• 多策略貪婪建構<br>• 有界回溯修復（只在主推方案失敗、不合法或低於最低學分時觸發）<br>• 放寬階梯（opt-in，預設關閉）<br>• 獨立驗證器<br>**不是** CSP／beam search／CP-SAT | `skills/scheduler.js`（`buildPlan`、`runRepair`、`shouldAttemptRepair`、`tryRelaxationLadder`）、`skills/scheduleSolver.js` | `scheduler.test.js` Z1–Z7（含 greedy trap：baseline 3 學分，repair 找到 6 學分）；`schedulerBenchmark.test.js` | 可，須用正確演算法名稱 |
| 8 | 硬性限制與軟性偏好區分 | 是 | 完成：<br>• 限制定義集中在 `constraintSchema.js`<br>• 內容偏好（無期中、全英等）改為軟性加分（roadmap #3）<br>• 時段舒適偏好對非必修課是排除條件；正式必修課豁免 | `data/constraintSchema.js`、`skills/scheduleValidator.js`、`scheduler.js` 的 `hardConstraintReason()` | `constraints.test.js`、`scheduler.test.js` X 系列 | 可 |
| 9 | 衝堂檢測 | 是 | 完成：<br>• 多時段、週六日<br>• 關注課程不計入衝堂<br>• 另有 `POST /api/schedule/validate` | `scheduler.js` 的 `timeConflict()`、`conflictsWithSchedule()`；`scheduleValidator.js` 的 `checkTimeConflictsAndDuplicates()` | `scheduler.test.js`、`scheduleRoutes.test.js` | 可 |
| 10 | blocked periods、早晚課、午休 | 是 | 完成：<br>• 封鎖時段存成字串時會先正規化<br>• 早八定義為第 1 節、午休為第 5 節、晚課為第 12 節以後<br>• `noEveningClasses` 可執行但無法儲存 | `utils/periods.js` 的 `normalizeBlockedPeriods()`、`scheduler.js` 的 `isMorningBlock` 等、`services/constraintService.js` | `periods.test.js`、`scheduler.test.js` | 可 |
| 11 | 個人化權重與課程評分 | 是 | 完成：版本化評分規則 `personalized-scoring-v1`，分數由各分項加總而成，可逐項解釋 | `skills/scoringPolicy.js`、`scheduler.js` 的 `computeScoreComponents()` | `scoringPolicy.test.js`、PD1–PD11 | 可 |
| 12 | 歷史修課紀錄如何影響推薦 | 是（但**非**權重） | 完成：排除已通過課程、自動排入重修、畢業缺口推薦 | `scheduler.js` 的 `buildPlan()`、`scheduleService.js` 的 `prepareGenerationInputs()` | `courseHistory.test.js`、`scheduler.test.js` | 可，須照實描述 |
| 13 | 互動紀錄是否更新後續推薦 | 是（有條件） | 部分：管線完整，但：<br>• 需要同意且事件 ≥50 筆<br>• 只放大已表態的軸<br>• 重算只在隱私／個人化來源 API 被呼叫時觸發<br>• 沒有真實使用者資料證明效果 | `skills/preferenceLearning.js`、`services/preferenceLearningService.js`、`services/interactionEventService.js`、`client/src/services/interactionLog.js` | `preferenceLearning*.test.js`、`personalizationBaseline.test.js` | 可，須附條件描述，不可量化成效 |
| 14 | 多種課表方案產生 | 是 | 完成，但常塌縮（roadmap #10 🟡） | `skills/planStrategies.js`、`scheduler.js` 的 `uniquePlans()`、`buildPlanDiversity()` | `planStrategies.test.js`、P10 系列 | 可 |
| 15 | 綜合、偏好加重、較多學分方案 | 是 | 真的存在，且用不同權重重新求解：<br>• 「偏好加重」= 單軸權重 ×1.5，只為已表態的軸產生<br>• 「較多學分」= 學分係數 ×3，**不保證**學分最多 | `skills/planStrategies.js` | `scheduler.test.js` PM3、P10-2 | 可 |
| 16 | 方案符合度與取捨比較 | 是 | 完成；「保留部分課程再重排」未做 | `skills/planComparison.js`、`client/src/components/Schedule/PlanComparison.jsx` | `planComparison.test.js`、PM 系列 | 可 |
| 17 | AI Agent 自然語言排課 | 是 | 完成：<br>• 7 個工具，同一次請求最多 12 步（上限 20）<br>• 帶入最近 20 則對話<br>本次未連真實模型驗證 | `services/agentService.js`、`services/promptService.js`、`services/agentToolRegistry.js` | `agentTools.test.js`、`prompt.test.js`、`agentGoldenSet.test.js`（CI 略過） | 可 |
| 18 | 原生 Tool Calling | 是 | 完成：<br>• 2026-08-30 由 Gemini 文字格式 parser 改為 OpenAI Responses API function calling<br>• schema 為**非 strict 模式**（程式註解說明巢狀 required 不被強制） | `agentService.js` 的 `handleChat()`、`promptService.js` 的 `getAgentTools()` | `agentTools.test.js`、`agentToolRegistry.test.js` | 可 |
| 19 | Tool 執行結果驗證 | 部分 | 部分完成。**正式路徑上有**：<br>• JSON 解析<br>• 排課前矛盾檢查<br>• 過濾不存在的課程 id<br>• 寫入需兩段確認（以 turnId 防止同回合自我確認）<br>• 統一結果信封<br>• 失敗的工具不更新 intent<br>• 回饋需對照曝光紀錄<br>**只在評測中有**：JSON Schema 參數驗證（`toolSchemaValidator.js` 的 `validateToolCallArguments()`），**正式路徑沒有呼叫** | `agentService.js`、`requirementPreflight.js`、`pendingChangeService.js`、`scheduleFeedbackService.js`、`toolSchemaValidator.js` | `requirementPreflight.test.js`、`pendingChangeService.test.js`、`goldenSetAssertions.test.js` | 可寫「排課前矛盾檢查與寫入確認」；不可寫「執行期 JSON Schema 驗證所有工具參數」 |
| 20 | Evidence Ledger／Faithfulness Validation | 是 | 完成，屬規則式檢查。流程：<br>1. 帳本記錄本回合工具結果<br>2. 以正規表示式與課程指涉解析稽核回覆中的課程、教師、時間、學分、評價、成功宣稱<br>3. 違規時由 LLM 修正一次<br>4. 仍失敗則改用後端產生的安全回答<br>Codex 對抗式審查曾找出 3 個缺口，已在 #41 修補；規則式檢查仍可能有漏網 | `services/explanationFaithfulness.js`、`courseReferenceResolver.js`、`sentenceFacts.js` | `explanationFaithfulness.test.js`（32，F1–F24b） | 可寫「以證據帳本做規則式回答忠實度檢查」；不可寫「消除幻覺」 |
| 21 | 推薦理由與結果追溯 | 是 | 完成：<br>• 每門課的 `recommendationReason` 包含選入原因、資料來源、信心、落選者（最多 3 名）<br>• `requestId`／`planId` 標註<br>• 曝光事件保存各方案的評分規則 | `skills/recommendationReason.js`、`services/scheduleService.js` 的 `annotateScheduleIdentifiers()`、`buildExposureDraft()` | `recommendationReason.test.js`（21） | 可 |
| 22 | 使用者互動與推薦回饋紀錄 | 是 | 完成：<br>• 版本化事件 schema、idempotency、rate limit、consent 閘門<br>• 退選原因彈窗（前端由 Szuwei 改為複選） | `data/interactionEventSchema.js`、`services/interactionEventService.js`、`routes/interactions.js`、`services/scheduleFeedbackService.js` | `interactionEventSchema.test.js`、`interactionEvents.test.js`（39） | 可 |
| 23 | Unit／Integration／API／Agent tests | 是 | 後端完整，前端 0。本次實跑條件為 `CI=true` 加 `--test-force-exit`：<br>• **1,058 個測試，1,055 通過**<br>• 3 個失敗是 `authRoutes`／`privacyRoutes`／`scheduleRoutes` 三個檔案在 Windows 上 process 結束時的 libuv assertion，這三個檔案的子測試全部通過；不加 force-exit 時也通過<br>• 不加 force-exit 時，`interactionEvents.test.js` 的測試會通過，但 process 不會結束，`npm test` 在本機 300 秒內跑不完<br>• golden set 依設計略過；DB 契約測試以唯讀方式連真實 MySQL | `server/test/*.test.js`（58 檔）、`.github/workflows/ci.yml` | 同左 | 可寫「以 node:test 撰寫單元、API 與排課／Agent 評測」；不寫測試數字，除非重跑確認 |
| 24 | 部署、環境變數、正式環境設定 | 部分 | 未部署：<br>• 沒有 Dockerfile 或任何 PaaS 設定<br>• 沒有 CD，只有 CI（lint、build、test）<br>• 正式環境啟動時會檢查 `SESSION_SECRET` 與隱私設定（`assertSessionSecretConfigured`、`assertPrivacyConfigured`）<br>• `.env.example` 仍列出未使用的 `GEMINI_API_KEY`<br>roadmap #39 未開始 | `app.js`、`.env.example`、`.github/workflows/ci.yml` | 無部署測試 | 可寫「GitHub Actions CI」；**不可**寫「部署上線」 |
| 25 | 前端、後端、爬蟲、資料庫整合 | 部分 | 前後端整合完成，所有後端 API 都集中在 `client/src/services/api.js` 呼叫；後端讀取共用 MySQL。**repository 內沒有任何爬蟲程式**：<br>• 評價來自 `Course_Reviews` 表，`database.js` 註解寫明「由外部爬蟲流程寫入」<br>• Agent 工具名稱雖為 `search_dcard_reviews`，實際是讀資料表 | `client/src/services/api.js`、`db/database.js`、`skills/courseReviewStats.js` | `database-contract.test.js`、`courseMappingContract.test.js` | 可寫「整合爬蟲評價資料與課程資料庫至排課評分」，不可暗示爬蟲由本人撰寫 |

### 特別確認事項的結論

| 問題 | 結論 |
| --- | --- |
| 歷史修課紀錄是否轉成權重？ | **否**。只用於排除已通過課程、排入重修與畢業判斷（`deriveExplicitProfile()` 不讀 courseHistory）。 |
| 互動紀錄是否更新後續推薦？ | **有條件地是**。<br>• 條件：同意＋≥50 筆事件＋權重已被重算＋模型版本相符。<br>• boost 範圍 [0,1]，只作用在已表態的軸。<br>• **邏輯缺口**：排課只讀已存權重，重算只在 `GET /api/privacy/personalization` 觸發（`PrivacyPage.jsx`、`PreferenceSourceBadge.jsx` 載入時）。使用者若從未開啟這些畫面，就算累積足夠事件也不會生效。 |
| 多方案是重新求解還是換名稱？ | **重新求解**。每個策略帶不同的 `scoringPolicy`，各自呼叫 `buildPlan()`；組合相同的方案再去重。 |
| 方案差異可否由測試確認？ | 可。見 `scheduler.test.js` PM3「沒有塌縮時」與 P10-2。真實 demo 資料常只剩 2 種（roadmap #10）。 |
| 排課演算法 | 多策略 greedy 建構 → 條件式 bounded backtracking repair → opt-in 放寬階梯 → 獨立 validator。不是 beam search、CP-SAT、local repair 或 CSP 傳播。 |
| Agent 能否真的執行排課？ | 能。`run_csp_scheduler` 呼叫 `generateForUser()`，與 REST 同路徑，並寫入曝光事件（surface=`chat`）。 |
| 推薦理由是否經忠實度驗證？ | Agent 的**自然語言回覆**經 `enforceFaithfulReply()` 規則式稽核。`recommendationReason` 結構本身由排課器確定性產生，不經 LLM。 |
| 只有 UI 或資料結構、尚未影響推薦的欄位 | • `axisSignal`：只在回傳值診斷，不存表、不影響排序<br>• `program_type`／`enrolled_programs`／`college`：可讀寫，但特殊身分規則未套用（#13D）<br>• `Courses.prerequisites`：全 NULL，`enforced:false`<br>• `has_midterm`／`language` 等內容偏好：以文字關鍵字判斷，命中率極低<br>• `noEveningClasses`：無法儲存<br>• `@hello-pangea/dnd`：列在前端依賴，但 `client/src` 內沒有任何使用（README 所述「拖曳課表」不存在） |
| 只存在於 roadmap／文件的功能 | 協同過濾（#6、#32）、探索機制（#9）、先修與多學期規劃（#8）、學生使用者測試（#38）、正式部署（#39）、「保留部分課程再重排」（#27 註明未做）。 |

---

## 4. 個人貢獻證據

### 4.1 Git 可確認的事實

| 項目 | 事實 |
| --- | --- |
| Remote | `github.com/ert770/course-schedule-planner` |
| 提交者身分 | • `yamat`：98 個非 merge commit<br>• `ert770`：15 個 commit，**全部是 PR merge**<br>• 兩者使用**同一個 email**（學校 o365 信箱 `D1249697@…`）<br>• `Szuwei`：12 個非 merge commit＋4 個 merge commit（GitHub 帳號 `Szuwei-Huang`） |
| 組員 A（爬蟲）、組員 C（資料庫） | **在 repository 中沒有任何 commit**，也沒有爬蟲程式或建表 DDL（課程相關資料表為外部共用 MySQL） |
| yamat 非 merge 的增刪行數（`git log --numstat`） | • `server/src`：+22,222／−3,228<br>• `server/test`：+16,356<br>• `client/src`：+8,005／−1,436<br>• `docs/CHANGE_REPORTS`：+14,618<br>行數包含 AI 產生的程式與文件，**不能**當作個人工作量指標 |
| Szuwei 非 merge 的增刪行數 | • `client/src`：+1,320／−1,199<br>• `server/src`：+42／−12（`courseQuery.js`、`routes/courses.js` 搜尋參數）<br>• `server/data`：+6,496（多為測試資料 JSON） |
| Szuwei 的具體成果 | • PR #14（已合併）：課表 `.ics`／`.png`／`.txt` 匯出，`client/src/utils/exportSchedule.js` 全由 Szuwei 撰寫<br>• PR #3：尋找課程與前端防衝堂，未直接合併，由 yamat 在 PR #11 選擇性移植<br>• PR #10：LocalStorage 持久化，未合併<br>• PR #21：退選原因複選與技能樹 Modal，尚未合併<br>• 另有 `DashboardPage.jsx` 的 8 次修改 |
| 核心後端檔案作者 | `scheduler.js`（32 commits）、`scheduleSolver.js`、`planStrategies.js`、`scoringPolicy.js`、`preferenceLearning.js`、`agentService.js`（20）、`explanationFaithfulness.js`、`privacyService.js`、`interactionEventService.js`、`database.js`（23）：**非 merge commit 全部為 yamat** |
| PR 作者（GitHub） | 22 個 PR：<br>• ert770 開 18 個<br>• Szuwei-Huang 開 4 個（#3、#10、#14、#21） |

### 4.2 限制與不能由 Git 判定的部分

1. **帳號與本人的對應**：Git 的 name／email 由本機自行設定，不代表身分已驗證。`AGENTS.md` 記載開發曾使用「共用 ChatGPT／Codex 帳號」。`yamat`／`ert770` 是否只有本人使用，需要本人確認。
2. **初始 commit 之前的程式**：`75b04d5`（2026-06-08）一次加入 74 個檔案、14,842 行，內容包括：
   - 整個 React 前端骨架
   - Gemini 版 Agent
   - 189 行的初版排課器
   - 模擬資料
   - 3–4 月的 `report/` 文件

   這批內容在 repository 建立前的作者**無法由程式庫確認**。
3. **AI 協作**：yamat 的 98 個非 merge commit 中，**67 個帶 `Co-Authored-By: Claude`** trailer，最早一個是 2026-08-01。另有 `claude/…`、`codex/…` 分支名，以及「Codex adversarial review」修正紀錄。可從紀錄看出的本人行為包括：
   - 撰寫 `AGENTS.md` 規範
   - 在 `docs/CHANGE_REPORTS/` 維護 roadmap 與 86 份變更報告
   - 發起對抗式審查並據此修正
   - 瀏覽器 A/B 驗收的規定與紀錄

   但「需求拆解、設計決策、審查、驗收由誰完成」**只能依本人自述認定**。
4. **組員 B**：Szuwei 的工作內容與「前端 UI／UX」分工一致，但 Git 無法證明 Szuwei 就是自述中的組員 B。
5. **組員 A、C**：Git 無法確認，需團隊佐證。

### 4.3 可以如何準確描述本人貢獻（前提：確認帳號為本人）

- **可由 Git 支持**：後端核心模組、測試、CI、migration 001–007、前後端整合，以及 roadmap 規劃與變更報告，都以本人帳號提交。
- **只能依自述**：題目構想、團隊分工角色。
- **使用 AI 協作時的準確說法**：「使用 AI 程式助理輔助實作，由本人負責需求拆解、設計決策、整合、測試與驗收」。這句話需要本人確認屬實。

---

## 5. 文件與程式碼不一致

| # | 文件 | 文件所述 | 實際程式 |
| ---: | --- | --- | --- |
| 1 | `README.md`（2026-03-28 之後未更新） | 技術棧寫「React.js 或 Vue.js」「Node.js 或 Python」「MySQL 或 MongoDB」 | 已確定為 React + Express + MySQL |
| 2 | `README.md` | 「具備拖曳功能的課表展示區」 | `@hello-pangea/dnd` 只列在依賴中，`client/src` 內沒有任何使用 |
| 3 | `README.md` | Skill 3 執行「限制滿足問題 (CSP)」演算法 | 多策略 greedy＋有界回溯修復，沒有 CSP 傳播或 MRV |
| 4 | `README.md` | 「Python (BeautifulSoup / Selenium) 定期抓取 Dcard，並搭配 NLP 關鍵字萃取」 | repository 中沒有任何 Python 或爬蟲程式；評價從 `Course_Reviews` 表讀取 |
| 5 | `report/期中專題進度報告.md`（2026-04-12） | 「完成 CSP 排課引擎…Greedy + Limited Backtracking…生成時間縮減至 100 毫秒以內」 | 2026-08-09 的 `docs/專題進度報告.md` 自行稽核為「rule-based greedy，不是 CSP」；有界回溯直到 2026-08-30 才加入。「100 毫秒」在 repository 中**沒有量測證據** |
| 6 | `docs/專題進度報告.md`（2026-08-09） | Gemini 文字格式 tool-call parser、5 個固定 variant、無權重學習 | 已過時。實際已改為 OpenAI 原生 tool calling（#25）、動態策略（#7）、偏好學習（#30） |
| 7 | `AGENTS.md` | 「`server/data/` JSON 檔案式資料庫」「JSON 檔案式資料庫工具放在 `database.js`」 | 目前以 MySQL 為主，JSON 只是部分集合的後備 |
| 8 | `docs/project-guide/10-testing-and-deployment.md` | 「`npm test` 目前 1046 個測試全數通過」 | 本次實跑為 1,058 個；Windows 本機 `npm test` 因 `interactionEvents.test.js` 不退出而無法自然結束（見第 3 節第 23 項） |
| 9 | `docs/project-guide/11-known-limitations.md` #25 | 「Chat 歷史送進模型的筆數上限待確認」 | 程式已可確認：`getChatHistory(identity, 20)` |
| 10 | `docs/project-guide/06-personalized-scheduling.md` | 引用 `scheduler.js:2425` 等行號 | `generateSchedule()` 實際在第 2498 行，文件中多處行號已偏移 |
| 11 | `skills/preferenceLearning.js` 註解 | `VARIANT_AXIS` 對應「`scheduler.js` 的 `PLAN_VARIANTS`」 | `PLAN_VARIANTS` 已不存在（#7 改為動態策略），這張表只剩舊事件的後備用途 |
| 12 | `.env.example`、`server/package.json` | `GEMINI_API_KEY`、`@google/genai` | Agent 已不使用。`testFunc.js`、`testFunc3.js` 是 Gemini 實驗殘留，`db/schema.sql` 是遺留的 SQLite 檔 |
| 13 | Agent 工具名稱 `search_dcard_reviews` | 名稱暗示即時查 Dcard | 實際是查 `Course_Reviews` 資料表；評價來源網站無法從程式庫確認 |
| 14 | `docs/project-guide/11-known-limitations.md` #4 | migration 007（`Saved_Schedules`）已寫但未執行 | 2026-09-11 之後的 commit 已在 `database.js` 引用 `Saved_Schedules`；共用資料庫是否已執行 migration，**無法由程式庫確認** |

---

## 6. 不宜寫入履歷的內容

| 主張 | 原因 |
| --- | --- |
| 「將歷史修課紀錄轉換為個人化權重」 | 程式中不存在，修課紀錄不參與權重 |
| 「系統會從使用者行為自動學習並即時調整推薦」 | 需同意、≥50 筆事件、需觸發重算，且只放大已表態的偏好；沒有真實使用者證據 |
| 「機器學習／深度學習／協同過濾推薦」 | 權重學習是規則式投票加統計收縮；協同過濾未開始 |
| 「CSP solver」「全域最佳化」「最佳課表」 | 實際是 greedy 加有界回溯；逾時或節點耗盡時不保證最佳 |
| 「生成課表 100 毫秒內」或任何效能數字 | 沒有可重現的量測證據 |
| 「提升推薦滿意度或準確率 X%」「經學生測試驗證」 | roadmap #38 未開始，#36 只有 synthetic 資料 |
| 「已部署上線」「正式網站」 | 沒有部署設定，#39 未開始 |
| 「開發 Dcard 爬蟲與 NLP 評價分析」 | 程式庫中沒有，且屬組員 A 的自述分工 |
| 「建置課程資料庫」 | 課程相關資料表為外部共用 MySQL；本人可確認的只有 migration 001–007 與存取層 |
| 「拖曳式課表介面」 | 不存在 |
| 「保證產生三種不同方案」 | 方案會去重合併，真實資料常只剩 2 種 |
| 「完整 JSON Schema 驗證所有工具參數」 | 正式路徑沒有呼叫 `validateToolCallArguments()`，schema 為非 strict 模式 |
| 「消除／杜絕 AI 幻覺」 | 忠實度檢查是規則式，對抗式審查曾找到缺口 |
| 「完整安全登入機制」 | 密碼以明碼存放並直接比對 |
| 「先修條件檢查」 | 資料全為 NULL，`enforced:false` |
| 任何測試數量或覆蓋率 | 數字會隨 commit 變動，本機 `npm test` 也有不退出問題；要寫必須重跑確認 |

---

## 7. 建議履歷版本

> 以下文字只使用可由程式碼確認的內容。〔〕內為**需本人確認後**才能保留的部分。

### 7.1 專案摘要（約 60–70 字，英文詞以一字計）

> 四人畢業專題「個人化課表推薦系統」〔構想提出者、〕後端負責人。以 Express 與 MySQL 實作排課引擎，在衝堂與時段限制下依偏好產生多種可比較方案，並以 AI Agent 支援自然語言排課。

### 7.2 履歷專案說明（約 130 字）

> 負責後端核心與系統整合（Express、MySQL）。實作排課引擎，區分硬性限制與軟性偏好，以貪婪建構加有界回溯修復產生無衝堂課表並獨立驗證；依使用者偏好動態產生綜合、偏好加重與較多學分方案並比較取捨。建立需同意的互動紀錄與偏好權重管線；AI Agent 以原生 Tool Calling 呼叫排課服務，回覆經證據檢查。

### 7.3 自傳畢專段落（約 280 字）

> 在畢業專題中，我〔提出〕「個人化課表推薦系統」的構想，並在四人團隊中負責後端核心與系統整合。最困難的是把原本在模擬資料上運作的排課器接上真實課程資料庫：封鎖時段因格式不同被靜默忽略，已修課程排除從未生效，多個方案最後也只剩兩種不同課表。我逐一稽核資料與程式假設，把靜默失敗改為明確警告，並加入獨立驗證器與資料庫契約測試。之後我讓每種方案以不同權重重新求解，並讓 AI Agent 透過 Tool Calling 呼叫同一套排課服務，再以證據帳本檢查回覆。這段經驗讓我體會到，測試通過不等於功能正確；在缺乏真實使用者資料時，更要清楚區分系統能證明與不能證明的範圍。

---

## 8. 待本人確認事項

1. **帳號歸屬**：`yamat`、`ert770` 與 o365 信箱 `D1249697@…` 是否只有本人使用？`AGENTS.md` 提到的「共用 ChatGPT／Codex 帳號」是否有他人經手本 repository 的提交？
2. **構想提出**：是否有提案書、指導教授紀錄或組員可佐證題目由你提出？
3. **初始程式來源**：2026-06-08 初始 commit（74 檔、14,842 行，含前端骨架、Gemini Agent、初版排課器）與 `report/` 內 2026-03～04 文件，當時由誰撰寫？
4. **組員 A 的爬蟲**：程式放在哪裡？`Course_Reviews` 的來源網站與資料範圍為何？
5. **組員 C 的資料庫**：建置了哪些資料表與欄位（`Courses`、`Course_Sections`、`Course_Reviews`、`User_Profiles` 原始欄位）？與你撰寫的 migration 001–007 界線在哪裡？
6. **組員 B**：Szuwei 是否就是組員 B？初始前端骨架屬於誰的工作？
7. **AI 協作程度**：67 個 commit 帶 Claude co-author，另有 Codex 使用紀錄。需求拆解、設計取捨、code review、瀏覽器驗收是否由你完成？是否願意在履歷或面試中主動說明使用 AI 輔助開發？
8. **共用 MySQL 狀態**：migration 002、003、004、006、007 是否已在共用資料庫實際執行？demo 時是否啟用 `PRIVACY_ENFORCEMENT_ENABLED`？
9. **Agent 實機驗證**：是否曾以真實 OpenAI key 完整 demo 自然語言排課？`server/test/reports/golden-set-latest.json` 的成績是否要引用？若要引用，須重跑並寫明模型與日期。
10. **個人化是否生效過**：是否有任何帳號（含 demo persona）的學習權重曾達到 `sufficient` 並實際影響排課？
11. **使用者測試與部署**：是否做過真實學生測試或任何部署？repository 中都找不到證據。
12. **期中報告的「100 毫秒以內」**：數據來源為何？若無量測紀錄，建議不要再引用。

---

### 附錄：本次驗證方式

- 閱讀了下列程式與文件：
  - `server/src` 的路由、中介層、服務、skills
  - migrations、CI
  - 前端 `api.js`、`interactionLog.js`、`PlanComparison.jsx`
  - README、AGENTS.md、`docs/project-guide`、roadmap、期中與進度報告
- Git 查核：`git log --all`（含作者、numstat、co-author trailer）、`gh pr list`（PR 作者）。
- 測試執行（`server/`）：
  - `CI=true node --test --test-force-exit "test/**/*.test.js"`：1,058 個測試，1,055 通過；3 個失敗是 Windows 上 process 結束時的 libuv assertion，對應子測試全部通過。
  - 另以不含 force-exit 的方式跑 21 個核心檔案：520 通過；`interactionEvents.test.js` 在 300 秒後因 process 未退出被判失敗，加 force-exit 單獨執行則 39/39 通過。
- 未執行的項目：
  - 前端 lint／build：本次沒有修改程式
  - golden set：會呼叫真實模型並產生費用
  - 瀏覽器端到端驗證
