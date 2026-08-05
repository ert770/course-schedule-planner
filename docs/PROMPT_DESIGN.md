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

## `run_csp_scheduler` 參數

排課工具的參數必須與 `server/src/services/constraintService.js` 的 `buildScheduleConstraints()` 保持一致。兩條路徑（REST 與 AI Agent）共用同一份合併邏輯。

| 類別 | 參數 |
| --- | --- |
| 學分 | `minCredits`, `maxCredits`, `allowCreditOverload`, `maxCoursesPerDay` |
| 學籍 | `department`, `gradeLevel` |
| 時間 | `blockedPeriods`, `mondayFree`, `noMorningClasses`, `noEveningClasses`, `lunchBreakFree` |
| 課程指定 | `mustTakeCourseIds`, `retakeCourseIds`, `completedCourseIds` |
| 課程狀態 | `selectedCourseIds`, `watchingCourseIds`, `courseStates` |
| 內容偏好 | `noMidterm`, `noGroupReport`, `discussion`, `learnMore`, `weightDaily`, `practicalExam`, `finalReport`, `englishTaught` |
| 個人化偏好 | `preferCompact`, `preferEasyCourses`, `preferredKeywords`, `interests`, `preferredTrack` |
| 畢業門檻 | `digitalCreditsNeeded` |

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

