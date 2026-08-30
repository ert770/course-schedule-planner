# Prompt 設計規格

## 目前實作

Prompt 建構於 `server/src/services/promptService.js`，Agent 執行於 `server/src/services/agentService.js`。

目前採文字 ReAct 流程：

```text
[LLM_Thought]: ...
[ToolCall]: {"tool": "...", "parameters": {...}}
[Observation]: ...
```

## System Prompt 目標

System prompt 必須讓 Agent：

- 扮演課表推薦助理。
- 使用繁體中文。
- 根據工具結果回答。
- 不編造課程資料。
- 知道可用工具與格式。
- 在需要排課時呼叫排課工具。

## Tool Call 格式

```json
{
  "tool": "query_course_db",
  "parameters": {
    "keyword": "人工智慧"
  }
}
```

## 可用工具

| Tool | 目的 |
| --- | --- |
| `query_course_db` | 查詢課程資料 |
| `search_dcard_reviews` | 查詢課程評價摘要 |
| `run_csp_scheduler` | 產生課表 |
| `get_easy_courses` | 取得涼課或高推薦課 |
| `update_preferences` | 更新使用者偏好 |
| `record_schedule_feedback` | 記錄使用者對已產生課表的最終評價（roadmap #2） |
| `final_answer` | 輸出最終回答 |

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

同一次對話開始時，後端已把 profile（含 `courseHistory`）載入 `prefs`；
`agentService.js` 呼叫 `generateForUser(identity, { constraints: args }, { prefs })`，再由
`buildScheduleConstraints()` 只取 `prefs.courseHistory`。因此已修排除會自動生效，
即使模型自行在參數中加入 `courseHistory` 也會被忽略。

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

- `run_csp_scheduler` 成功後，`final_answer` 的 `reply_text` **必須**詢問這份課表是否符合需求，
  並說明若有不適合的課，請指出是哪一門以及原因。
- 使用者回答之後，先呼叫 `record_schedule_feedback` 記錄，再用 `final_answer` 回覆。
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

## Observation 格式

工具結果應以 JSON 字串送回模型：

```text
[Observation]:
{"success":true,"schedule":[]}
```

## Final Answer 格式

```json
{
  "tool": "final_answer",
  "parameters": {
    "reply_text": "我幫你產生了三個方案..."
  }
}
```

## Few-shot Example

使用者：

```text
幫我排一個不要早八，最好週一空堂的課表
```

模型：

```text
[LLM_Thought]:
使用者提出排課限制，需要更新偏好並呼叫排課工具。
[ToolCall]:
{"tool":"run_csp_scheduler","parameters":{"noMorningClasses":true,"mondayFree":true}}
```

## 禁止事項

- 不得輸出無效 JSON tool call。
- 不得在沒有工具結果時宣稱查到課程。
- 不得將內部 `[LLM_Thought]` 顯示給使用者。
- 不得要求使用者提供 API key。
- 不得忽略使用者明確限制。

## 維護規則

若新增工具：

1. 更新 `promptService.js`。
2. 更新 `agentService.js` tool switch。
3. 更新本文件。
4. 新增測試案例到 `docs/TEST_PLAN.md`。
