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

### 學分上下限與超修

未指定 `minCredits` / `maxCredits` 時，排課引擎依校規給預設值：上限 **25**、下限 **12**（`gradeLevel` 為 4 時下限 **9**）。

**`allowCreditOverload` 必須由使用者明確表達才可帶入**——超修至 30 學分需另行申請，Agent 不得自行開啟。使用者若說「我想多修一點」「可以超修」，才帶 `allowCreditOverload: true`。

`department` 與 `gradeLevel` 決定必修範圍（見 `docs/SCHEDULING_LOGIC.md`）。兩者通常來自已儲存的使用者資料，Agent 僅在使用者明確更正時才需帶入。

### 個人化偏好的必要性

`preferredKeywords`、`interests`、`preferCompact`、`preferEasyCourses` 決定多方案中主推哪一個。

使用者表達興趣、想集中排課或想修涼課時，Agent **必須**把對應參數帶進 `run_csp_scheduler`。未帶入時系統只能改以總學分挑選方案，推薦會失去個人化，且回應的 `hasExpressedPreference` 會是 `false`。

排課結果的每個方案含 `preferenceScore`（0~1 的偏好符合度），Agent 應用它向使用者說明為何主推該方案。

### 陣列參數語意

陣列型參數送空陣列 `[]` 視同「未指定」，會退回使用者已儲存的偏好。要覆蓋已儲存值必須送入非空陣列。

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

