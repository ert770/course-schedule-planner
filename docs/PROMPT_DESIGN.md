# Prompt 設計規格

## 目前實作

Prompt 與工具 schema 建構於 `server/src/services/promptService.js`，Agent 執行於
`server/src/services/agentService.js`。

**Provider 與協定（2026-08-30 起）**：OpenAI `gpt-5.6-luna`，走 **Responses API**
（`/v1/responses`）的**原生 tool calling**。

先前採用的是文字 ReAct 協定——要求模型輸出 `[LLM_Thought]:` 與 `[ToolCall]: {json}`
再用 regex 撈出來。那等於把參數合法性完全交給模型自律：reason 可以填「太難」、
requestId 可以亂編、JSON 可以寫壞。現在參數由 JSON Schema 約束，enum 與必填欄位
在 API 層就被擋下。

不用 Chat Completions 是因為 `gpt-5.6-luna` 是推理模型，在 `/v1/chat/completions`
掛 function tools 會被擋：

```text
Function tools with reasoning_effort are not supported for gpt-5.6-luna in
/v1/chat/completions. To use function tools, use /v1/responses or set
reasoning_effort to 'none'.
```

另一條路要關掉推理，而這個 Agent 要做的正是多步驟推理，因此選 Responses API。
同理，請求不送 `temperature`（推理模型不吃這個參數）。

## System Prompt 目標

System prompt 必須讓 Agent：

- 扮演課表推薦助理。
- 使用繁體中文。
- 根據工具結果回答。
- 不編造課程資料。
- 知道可用工具與格式。
- 在需要排課時呼叫排課工具。

## Tool Call 格式

工具由 `getAgentTools()` 以 Responses API 的扁平形狀宣告，模型透過 API 的
`function_call` 回傳參數，不再由文字解析：

```js
{
  type: 'function',
  name: 'query_course_db',
  description: '…',
  parameters: { type: 'object', properties: { keyword: { type: 'string' }, … } },
}
```

伺服器把每次呼叫的結果以 `function_call_output` 放回 `input`，模型回傳一則
**沒有 `function_call` 的訊息**時即為最終回答。

推理項目（`reasoning`）也會原樣放回 `input`；少了它，下一輪模型看不到自己上一輪
的推理，多步驟流程（查課 → 排課 → 記錄回饋）會退化成互不相干的單步呼叫。

## 可用工具

| Tool | 目的 |
| --- | --- |
| `query_course_db` | 查詢課程資料 |
| `search_dcard_reviews` | 查詢課程評價摘要 |
| `run_csp_scheduler` | 產生課表 |
| `get_easy_courses` | 取得涼課或高推薦課 |
| `update_preferences` | 更新使用者偏好 |
| `update_student_profile` | 更正系所／年級／班別（roadmap #24，兩段式確認） |
| `record_schedule_feedback` | 記錄使用者對已產生課表的最終評價（roadmap #2） |

**沒有 `final_answer`**：原生 tool calling 的自然終止就是「模型回一則沒有
`function_call` 的訊息」。留一個 `final_answer` 工具是在跟 API 對打，也讓模型多繞
一步、多一次出錯機會。

`query_course_db` 由後端依目前 `userId` 的 profile 建立班級範圍，Agent 不傳入或猜測
`department`、`grade`、`className`。可用 `category` 為 `必修`、`核心選修`、
`一般選修`、`通識`、`系外選修`。通識領域必須使用工具回傳的
`generalEducationDomain`；115 學年度起該欄位為 `null`（不分領域），不得由課號前綴
或課名自行猜測。
若工具回傳 `eligibility: "unknown"`，Agent 只能說「資格待確認」並附上
`eligibilityReason`，不得宣稱使用者確定可修。搜尋結果可呈現；排課時除非使用者明確
指定，否則後端會保守排除。

## `run_csp_scheduler` 參數

排課工具的參數必須與 `server/src/services/constraintService.js` 的 `buildScheduleConstraints()` 保持一致。兩條路徑（REST 與 AI Agent）共用同一份合併邏輯。

| 類別 | 參數 |
| --- | --- |
| 學分 | `minCredits`, `maxCredits`, `allowCreditOverload`, `maxCoursesPerDay` |
| 學籍 | `department`, `gradeLevel` |
| 時間 | `blockedPeriods`, `mondayFree`, `noMorningClasses`, `noEveningClasses`, `lunchBreakFree` |
| 課程指定 | `mustTakeCourseIds` |
| 課程狀態 | `selectedCourseIds`, `watchingCourseIds`, `courseStates` |
| 內容偏好 | `noMidterm`, `noGroupReport`, `discussion`, `learnMore`, `weightDaily`, `practicalExam`, `finalReport`, `englishTaught` |
| 個人化偏好 | `preferCompact`, `preferEasyCourses`, `preferredKeywords`, `interests`, `preferredTrack` |
| 畢業門檻 | `digitalCreditsNeeded` |

### 修課歷史不屬於工具參數

`completedCourseIds` 與 `courseHistory` 都不得出現在 `run_csp_scheduler` 的參數中。
模型無法可靠得知使用者實際修過哪些課，讓模型提供這些值只會誘導它編造資料。

同一次對話開始時，後端已從 MySQL `User_Course_History` 把 profile（含 `courseHistory`）載入 `prefs`；
`agentService.js` 呼叫 `generateForUser(identity, { constraints: args }, { prefs })`，再由
`buildScheduleConstraints()` 只取 `prefs.courseHistory`。因此已修排除會自動生效，
即使模型自行在參數中加入 `courseHistory` 也會被忽略。
資料庫查詢失敗時 Chat 回 `COURSE_HISTORY_UNAVAILABLE`，不得由模型假設為空歷史後繼續排課。

`retakeCourseIds` 與 `failedRequiredCourseIds` 也不得成為工具參數。重補修只由後端讀取
Profile 的 `courseHistory`，依最新一次修習結果自動推導，避免模型或 client 指定不存在的
失敗紀錄。

### 課程評價不屬於工具參數

`courseReviews` 不得出現在 `run_csp_scheduler` 的參數中，理由與 `courseHistory` 相同：
沒有任何管道能讓模型可靠得知每門課的真實評價分數，讓模型自行提供只會誘導編造。

`scheduleService.js` 從 `getAll('reviews')` 取得 `Course_Reviews` 全表後，經
`buildScheduleConstraints()` 的 `context` 參數注入，兩條路徑（REST 與 Chat）共用同一份資料，
Agent 完全不需要、也不能夠自己提供評價分數。

### 學分上下限與超修

未指定 `minCredits` / `maxCredits` 時，排課引擎依校規給預設值：上限 **25**、下限 **12**（`gradeLevel` 為 4 時下限 **9**）。

**`allowCreditOverload` 必須由使用者明確表達才可帶入**——超修至 30 學分需另行申請，Agent 不得自行開啟。使用者若說「我想多修一點」「可以超修」，才帶 `allowCreditOverload: true`。

`department` 與 `gradeLevel` 決定必修範圍（見 `docs/SCHEDULING_LOGIC.md`）。兩者通常來自已儲存的使用者資料，Agent 僅在使用者明確更正時才需帶入。

### 個人化偏好的必要性

`preferredKeywords`、`interests`、`preferCompact`、`preferEasyCourses` 決定多方案中主推哪一個。

使用者表達興趣、想集中排課或想修涼課時，Agent **必須**把對應參數帶進 `run_csp_scheduler`。未帶入時系統只能改以總學分挑選方案，推薦會失去個人化，且回應的 `hasExpressedPreference` 會是 `false`。

排課結果的每個方案含 `preferenceScore`（0~1 的偏好符合度），Agent 應用它向使用者說明為何主推該方案。

### 評價證據的使用限制

排課結果每門課帶 `reviewEvidence`（來自 `Course_Reviews` 的評價統計），為 `null` 代表這門課沒有
評價。**`reviewEvidence` 為 `null` 時，Agent 不得宣稱這門課「涼」「好拿分」「甜」**——沒有評價
就是沒有依據，只能明說「這門課沒有評價資料」。這是 `AGENTS.md` 「不得編造課程、教師、時間、
學分、評價或畢業規則」的直接要求。

方案的 `preferenceBreakdown.easy` 可能為 `null`（代表排入的課全部沒有評價可評分），此時 Agent
應改讀該方案的 `reviewCoverage`（`{ rated, total, ratio }`）向使用者說明證據有多少，不得把 `null`
講成 0%。

`get_easy_courses` 的排序依據是收縮後的 `adjustedEasiness`（樣本數少的課會被拉向全體平均），
不是未收縮的 `easiness`；兩者皆會回傳，Agent 說明時以 `adjustedEasiness` 為準。

### 內容偏好的使用限制

`noMidterm`／`noGroupReport`／`discussion`／`weightDaily`／`practicalExam`／`finalReport`／
`englishTaught`／`learnMore`（Roadmap #3）是**軟性**偏好，判定依據是課程描述的關鍵字比對，
**不保證真的滿足**。Agent 不得因為使用者設定了 `noMidterm: true` 就宣稱「已排除所有有期中考的
課」——關鍵字沒出現在描述裡不代表課程真的沒有這個特徵，只是描述沒提到。

回應的 `warnings` 若包含「訊號極弱」或「無法有效區分課程」字樣，代表候選池中這個偏好的關鍵字
命中率過低或過高，Agent 必須如實轉達，例如：「這個偏好目前只能靠課程描述關鍵字判斷，候選課程中
符合的比例很低，排課結果不一定能反映你的偏好」，不得省略不提或講成偏好已確實生效。

### Repair 結果與澄清（Roadmap #22）

`run_csp_scheduler` 的結果可能包含 `solver`、`draftSchedule`、`unmetRequirements` 與
`clarification`。Agent 必須遵守：

- `solver.status:'timeout'` 只表示在 2 秒預算內沒有完成，不能說成「已證明無解」；
  `infeasible` 才表示完整搜尋後仍無解，`data-insufficient` 表示候選或必要課程資料不足。
- `clarification.required:true` 時，優先依 `clarification.questions` 逐項詢問；問題只能轉述
  `questions`、`unmetRequirements` 與 `conflictSet` 的既有證據，不得自行發明衝突。
- `draftSchedule` 是供討論的結構安全草稿，不是成功課表；不得稱它已合法完成，也不得呼叫
  `record_schedule_feedback` 把草稿記為接受方案。
- 只能詢問或調整 `clarification.adjustableConstraintIds` 中列出的限制。不得建議違反衝堂、
  重複班次、學分硬上限或 `blockedPeriods`。
- 使用者回答具體必要課程／班次、最低學分、不可上課時段或衝突取捨後，才把更新後條件重新送進
  排課工具；不得猜測答案或永久更新未經確認的偏好。

### 陣列參數語意

陣列型參數送空陣列 `[]` 視同「未指定」，會退回使用者已儲存的偏好。要覆蓋已儲存值必須送入非空陣列。

## 排課後的確認與 `record_schedule_feedback`（Roadmap #2）

排課只是推薦。**使用者是否覺得這份課表符合需求，才是「最終選擇」**，而系統原本
排完課就結束，完全沒有取得這個訊號。因此：

- `run_csp_scheduler` 成功後，模型給使用者的那則文字回覆**必須**詢問這份課表是否符合
  需求，並說明若有不適合的課，請指出是哪一門以及原因。
- 使用者回答之後，**那一回合的第一個工具呼叫必須是 `record_schedule_feedback`**，
  記錄完成才可以重新排課、追問或回覆。先重排再記錄的話，新課表的 `sectionId` 對不上
  舊的曝光紀錄，後端會拒絕，訊號就永久遺失（2026-08-30 瀏覽器驗收實際踩到）。
- `accepted` 為 true，或 `rejectedCourses` 至少一筆——兩者皆空的呼叫沒有記錄到任何
  東西，會被拒絕。
- 使用者沒有回答時**不得**代為假設他接受了這份課表。

參數：

| 參數 | 說明 |
| --- | --- |
| `requestId` | 上一次 `run_csp_scheduler` 回傳的 `requestId`，必填，不可自行編造 |
| `planId` | 接受課表時必填，使用排課結果中的 `planId`（格式 `requestId:variantId`）；`variantId` 由後端反推 |
| `accepted` | 布林值，使用者表示符合需求時為 `true` |
| `rejectedCourses` | `[{ "sectionId": 數字, "reason": 原因 }]` |

`reason` 只接受 `time`、`content`、`instructor`、`workload`、`full`、`eligibility`、`other`
七個值，**不收自由文字**。使用者沒說明原因時填 `other`，不得自行猜測理由。

後端會把 `accepted` 記成 `recommendation_accepted`、每筆 `rejectedCourses` 記成
`course_withdrawn`；欄位長相與合法性由 `services/scheduleFeedbackService.js` 決定，
模型只轉述使用者說了什麼。

**來源驗證**：後端會對照該次推薦的 `recommendation_exposed` 紀錄，確認
`requestId` 確實屬於這位使用者、`planId` 是實際顯示過的方案、每個 `sectionId` 都在
當時真的排進課表的課程裡。編造的識別碼、別人的 requestId、只出現在候選但沒顯示的課，
全部會被拒絕並回傳說明——不要嘗試補值或改用相近的值繞過，直接照實回覆使用者。

```json
{
  "tool": "record_schedule_feedback",
  "parameters": {
    "requestId": "上一次排課回傳的 requestId",
    "accepted": false,
    "rejectedCourses": [{ "sectionId": 101, "reason": "time" }]
  }
}
```

## 工具結果（function_call_output）

工具結果以 JSON 字串放回 `input`：

```js
{ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(result) }
```

### 單次請求的步數上限

一步 = 一次模型往返。上限由 `AGENT_MAX_STEPS` 決定，預設 **12**，硬性天花板 **20**
（`agentService.resolveMaxSteps()`）。設天花板是因為 `input` 會隨每一步累積推理項目
與工具結果——沒有上限的話，一個卡住的模型會把延遲、費用與 context 用量拉到無界。

耗盡步數時不會丟掉模型沿途寫出來的內容：優先回傳最後一段非空的文字，真的一個字都
沒有才用「任務過於複雜，已達最大思考步數」這句罐頭訊息，同時在伺服器記一筆
`logger.warn`。

### 永久寫入的兩段式確認（Roadmap #24）

`update_preferences` 與 `update_student_profile` 的第一次呼叫**不寫入任何東西**，
只回傳 `proposedChanges` 與 `confirmationToken`；模型必須把內容講給使用者確認，
取得同意後帶著 token 再呼叫一次才生效。

伺服器端有兩道保證，都不依賴模型自律：

- **跨回合**：`pendingChangeService` 會拒絕「同一回合內自己暫存又自己確認」
  （`turnId` 比對）。模型可以在同一回合連續呼叫兩次工具，但使用者在那中間根本
  沒有機會說話；要求跨回合等於要求使用者真的又送出了一則訊息。
- **只寫暫存內容**：確認時採用當初暫存的欄位，第二次呼叫夾帶的其他欄位一律忽略
  ——否則模型可以拿一個使用者確認過的 token 偷渡他從沒同意過的變更。

`confirmationToken` 與 `requestId`、`sectionId` 一樣**由伺服器補進 prompt**：工具
結果不跨回合保存，模型下一回合不會記得自己拿過的 token（實測時它因此又重新暫存
一次，永遠走不到寫入）。

### 偏好強度：「絕對不」與「盡量不」（Roadmap #24）

`allowRelaxation` 與 `nonNegotiablePreferenceIds` 兩個參數對應這個區分。

`allowRelaxation` 與 `tryRelaxationLadder()` 在 `constraintService.js` 與
`scheduler.js` 早就完整接好，但一直沒有出現在工具 schema 裡；schema 是
`additionalProperties: false`，模型送不進來的參數等於不存在——**chat 這條路的
放寬階梯先前是結構性死碼**，這才是這個區分至今無從實作的真正原因。

`nonNegotiablePreferenceIds` 只作用於單次請求，**不從已儲存偏好回填**：
「這次絕對不行」是當下這句話的語氣，不該靜默沉澱成永久設定。

### 結構化理解回講（Roadmap #24）

`run_csp_scheduler` 有一個**必填**參數 `interpretation`，模型排課前必須先把理解
攤開來：`nonNegotiable`（不可退讓）、`flexible`（可彈性）、`creditGoal`、
`notMentioned`（它沒有資訊的部分）、`sourcePhrases`（參數 → 使用者原話）。

**為什麼需要**：原生 tool calling 保證得了**參數格式**，保證不了**理解正確**
——模型把「盡量不要早八」聽成「絕對不要」，參數一樣合法，使用者卻拿到不對的課表。

**三個清單一律填代號，不填自由文字**（`NO_MORNING_CLASSES`、`PREFER_COMPACT`…，
完整詞彙表見 `promptService.js` 的 `INTERPRETATION_TOPICS`），中文說明由伺服器的
`describeInterpretation()` 依代號生成。

**為什麼是代號**：實測同一句話跑三次，模型對語意的判斷完全一致，但自由文字每次
寫法不同（「午休時段可以彈性安排」／「可以彈性安排」／「可以彈性調整」），學分
也時而從偏好摘要抄、時而不抄。**變異全部來自「同一個意思有很多種寫法」，不是來自
理解不穩。** 改成代號等於把輸出空間縮到每個意思只有一種寫法，同句重跑就能得到
逐位元相同的結構化結果——這是驗收標準第四條前半句唯一可行的達成方式，因為模型
本身無法變成確定性的（此模型連 `temperature` 都不接受，實測回 `400 Unsupported
parameter`）。

伺服器會檢查回講與實際參數是否自相矛盾（`nonNegotiable` 含 `NO_MORNING_CLASSES`
就必須同時設好 `noMorningClasses` 與 `nonNegotiablePreferenceIds`），對不上就退回
要求修正；**也會擋下缺漏的回講**——schema 的巢狀 `required` 在非 strict 模式下
不被 API 強制，實測模型會送 `interpretation: {}` 過來。

回講會跟著排課結果回傳給前端顯示，但**不寫進 log、不進 `Interaction_Events`**：
`sourcePhrases` 含使用者原話，#33 明訂 log 只記 metadata 不記內容。

**誠實界線**：這不會讓模型的解析變成確定性的，它讓解析**看得見、可被使用者當場
糾正、可被 golden set 量測**。

### 排課前的矛盾偵測（Roadmap #24）

`requirementPreflight.js` 在進入排課引擎之前，檢查一整組不必真的排一次課就能斷定
的矛盾。**這份清單就是「完整」的定義**——結構性矛盾（數字、時段、集合互相打架）
可以窮舉，因此宣告完整：

1. `minCredits > maxCredits`
2. 學分為負、`maxCoursesPerDay` ≤ 0
3. 兩門指定必修彼此衝堂
4. 指定必修撞自訂封鎖時段
5. 指定必修的學分總和超過學分上限
6. 指定必修不在本學期開課
7. 已選課程撞封鎖時段
8. 時段偏好合起來把可用節次清空
9. 系所／年級無法解析（先前會靜默照排，必修判定其實懸空）
10. `nonNegotiablePreferenceIds` 指名了某項，但該偏好根本沒開
11. 理解回講與實際參數自相矛盾
12. 理解回講缺漏（chat 路徑才要求）

**不宣稱完整的**：語意矛盾（「想輕鬆一點但也想學很多」）。那取決於語言理解而非
數字比對，無法窮舉——這條界線要講清楚，不要含糊成一句「無法窮舉」。

時段判定沿用 `scheduler.js` 的既有規則（早八 = 第 1 節、午休 = 第 5 節、
晚間 = 第 12 節以後），不另立一套。

回傳形狀與 `scheduler.js` 的 `buildClarification()` 完全一致，模型既有的 #22 澄清
指令因此可以原封不動套用；`requirementPreflight.test.js` 有一項測試專門釘住兩者的
欄位一致，避免日後漂移。

### 排課結果必須先投影

`run_csp_scheduler` 的完整結果實測 **838 KB**——`excludedCourses` 一項就有 200+ 門
完整課程物件，`plans` 每個方案又各自帶一份完整課表。原封不動送回模型，第二次排課
就會撞上 `400 Your input exceeds the context window of this model`。

`agentService.summarizeScheduleForModel()` 因此把結果投影成模型真正會用到的欄位
（約 9.7 KB）：

- 保留：`requestId`、`solver`、`clarification`、`unmetRequirements`、`warnings`、
  `hasExpressedPreference`、`reviewDataLoaded`、各方案的 `preferenceScore`／
  `preferenceBreakdown`／`reviewCoverage`。
- 課程只留 `sectionId`、`catalogCourseCode`、`name`、`teacher`、`credits`、
  `timeStr`、`category`、`eligibility`／`eligibilityReason`、`reviewEvidence`；
  `syllabus`、`description`、`timeBitmask` 等長欄位不送。
- `excludedCourses` 改成 `excludedCourseCount` 加 15 筆樣本。
- 各方案不再重複攜帶自己那份完整課表。

**完整結果仍原封不動回傳給前端**渲染課表；被裁掉的只有送進模型的那一份。

## 最終回答格式

模型回傳一則沒有 `function_call` 的訊息即為最終回答，內容就是要顯示給使用者的文字。
不需要（也不應該）再包一層 `final_answer` 工具。

## 伺服器補進 prompt 的推薦上下文

`saveChatExchange()` 只保存使用者訊息與最終文字回覆，**工具結果不會被保存**。
因此下一回合模型手上既沒有合法的 `requestId`，也沒有課程 `sectionId`，只記得
自己寫過的課名——`record_schedule_feedback` 實際上永遠呼叫不成功。

`agentService` 每回合會查出這位使用者**最近一次 `surface: "chat"` 的推薦曝光**，
把下列內容補進 system prompt：

```text
最近一次推薦（使用者目前看到的那一份課表）：
- requestId：<uuid>
- planId：<uuid>:interest
- 這份課表包含的課，record_schedule_feedback 的 sectionId 只能從這裡挑：
  - sectionId 1303：資訊安全管理
  …
```

只認 `chat` 這個 surface 是刻意的：排課頁一載入就會自動排一次課並寫下
`dashboard / initial_load` 曝光，不分介面地取「最新一筆」會讓對話中的回饋對到
使用者根本沒在聊天裡看過的那一份課表。

這**不會**鬆動來源驗證——`scheduleFeedbackService` 仍然對照曝光紀錄檢查
`requestId` 與 `sectionId`；這裡只是把資料庫裡本來就有的事實放回模型的視野。

## Few-shot 情境

使用者：

```text
幫我排一份不要早八的課表，我對網路和資安有興趣。
```

模型（實際觀察到的 `function_call` 參數）：

```json
{"noMorningClasses":true,"minCredits":12,"maxCredits":25,
 "interests":["網路","資安"],"preferredKeywords":["網路","資安"]}
```

排課成功後，模型的文字回覆必須以「這份課表是否符合你的需求？」收尾。使用者回答
「『資訊安全管理』那門時間不行」之後，**那一回合的第一個工具呼叫必須是**：

```json
{"requestId":"<上面 prompt 給的 requestId>","accepted":false,
 "rejectedCourses":[{"sectionId":1303,"reason":"time"}]}
```

記錄完成之後才可以重新排課。先重排再記錄的話，新課表的 `sectionId` 對不上舊的
曝光紀錄，後端會拒絕，回饋訊號就永久遺失。

## 禁止事項

- 不得在沒有工具結果時宣稱查到課程。
- 不得把工具回傳的原始 JSON 貼給使用者。
- 不得要求使用者提供 API key。
- 不得忽略使用者明確限制。
- 不得自行編造 `requestId` 或 `sectionId`；只能用 prompt 裡「最近一次推薦」給的值。

## 維護規則

若新增工具：

1. 更新 `promptService.js` 的 `getAgentTools()`（JSON Schema）。
2. 更新 `agentService.js` 的 `executeAgentTool()` dispatch。
3. 更新 `server/test/prompt.test.js` 的工具清單與 `server/test/agentTools.test.js`。
4. 更新本文件。

若新增的工具會回傳大型物件，必須一併決定它的投影方式（見「排課結果必須先投影」），
不要直接把整包 JSON 餵回模型。
4. 新增測試案例到 `docs/TEST_PLAN.md`。
