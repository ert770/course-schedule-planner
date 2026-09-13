# 05 API 參考

> 依 `server/src/routes/*.js` 實際掛載的路由與 `client/src/services/api.js`
> 實際呼叫點整理。完整欄位規格另見 `docs/API_SPEC.md`（1231 行）。
> 最後更新：2026-09-09

所有路由前綴為 `/api`。前端一律以 `credentials: 'include'` 呼叫（帶 session cookie）。

## API 總表

| Method | Path | 功能 | Auth | Consent | 副作用 | Service | 前端呼叫位置 |
| --- | --- | --- | :---: | :---: | --- | --- | --- |
| POST | `/auth/login` | 登入 | ❌ | ❌ | 建立 session | `routes/auth.js:12` | `LoginPage.jsx` |
| POST | `/auth/logout` | 登出 | ❌ | ❌ | 清除 session | `routes/auth.js` | 導覽列 |
| GET | `/auth/me` | 取得目前使用者 | ✅ | ❌ | — | `routes/auth.js:40` | `AuthContext.jsx:33` |
| POST | `/auth/update-watchlist` | 更新關注清單 | ✅ | ✅ | 寫 `users.json` | `routes/auth.js:54` | `ScheduleContext.jsx:284` |
| GET | `/profile` | 讀 Profile | ✅ | ✅ | — | `routes/profile.js` | `SetupPage.jsx:75` |
| POST | `/profile` | 更新 Profile | ✅ | ✅ | 寫 `User_Profiles` | `routes/profile.js` | `SetupPage.jsx:138`（唯一呼叫端，`ProfileForm.jsx` 已於 2026-09-09 刪除） |
| GET | `/profile/preference-tags` | 取得標籤目錄 | ❌ | ❌ | — | `routes/profile.js` | `SetupPage.jsx:53` |
| GET | `/courses` | 搜尋課程 | ❌ | ❌ | — | `skills/courseQuery.js` | `SearchPage.jsx:139` |
| GET | `/courses/:id` | 課程明細 | ❌ | ❌ | — | 同上 | `api.js:104` |
| GET | `/courses/classes` | 班級清單 | ❌ | ❌ | — | 同上 | `SetupPage.jsx:103` |
| GET | `/courses/departments` | 系所清單 | ❌ | ❌ | — | 同上 | **未使用** |
| GET | `/courses/instructors` | 教師清單 | ❌ | ❌ | — | 同上 | **未使用** |
| POST | `/schedule/generate` | 產生課表 | ✅ | ✅ | 寫 `recommendation_exposed` 事件 | `scheduleService.js` | `DashboardPage.jsx:131`、`SchedulePage.jsx:127` |
| POST | `/schedule/validate` | 驗證課表 | ❌ | ❌ | — | `scheduleValidator.js` | `ScheduleContext.jsx:220` |
| POST | `/schedule/save` | 儲存課表 | ✅ | ✅ | 寫 `saved_schedules.json` | `memoryService.js:101` | `ScheduleContext.jsx:319` |
| GET | `/schedule/saved` | 已存課表 | ✅ | ✅ | — | 同上 | `ScheduleContext.jsx:188` |
| POST | `/schedule/counterfactual` | 反事實分析 | ✅ | ✅ | — | `planComparison.js` | `PlanComparison.jsx:80` |
| POST | `/chat` | AI 對話 | ✅ | ✅ | 寫 `Chat_Messages`、可能寫偏好 | `agentService.js:574` | `ChatPanel.jsx`、`DashboardPage.jsx` |
| GET | `/graduation/me` | 畢業進度 | ✅ | ✅ | — | `routes/graduation.js` | `GraduationPage.jsx` |
| GET | `/graduation/:studentId` | 同上（指定學號） | ✅ | ✅ | — | 同上 | — |
| GET | `/reviews/easy` | 涼課清單 | ❌ | ❌ | — | `reviewSearch.js` | **未使用** |
| GET | `/reviews/:courseId` | 課程評價 | ❌ | ❌ | — | 同上 | **未使用** |
| POST | `/interactions` | 記錄互動事件 | ✅ | ⚠️ 特殊 | 寫 `Interaction_Events` | `interactionEventService.js` | `interactionLog.js:145` |
| GET | `/privacy/policy` | 隱私政策 | ❌ | ❌ | — | `privacyService.js` | `PrivacyPage.jsx` |
| GET | `/privacy/consents` | 同意狀態 | ✅ | ❌ | — | 同上 | `AuthContext.jsx:68` |
| PUT | `/privacy/consents` | 更新同意 | ✅ | ❌ | 寫 `Privacy_Consents`；撤回時連帶刪資料 | 同上 | `PrivacyPage.jsx:62` |
| GET | `/privacy/export` | 匯出個資 | ✅ | ❌ | — | 同上 | `PrivacyPage.jsx` |
| DELETE | `/privacy/chat` | 清除聊天 | ✅ | ❌ | 刪 `Chat_Messages` | 同上 | `PrivacyPage.jsx:98` |
| POST | `/privacy/deletion-intents` | 建立刪除意向 | ✅ | ❌ | 寫 `Privacy_Data_Requests` | 同上 | `PrivacyPage.jsx:112` |
| DELETE | `/privacy/data` | 刪除個資 | ✅ | ❌ | **刪除多表資料** | 同上 | `PrivacyPage.jsx:113` |
| GET | `/privacy/personalization` | 個人化來源 | ✅ | ❌ | — | `preferenceLearningService.js` | `PreferenceSourceBadge.jsx` |
| DELETE | `/privacy/personalization` | 重設個人化 | ✅ | ❌ | 刪權重 + 互動事件 | 同上 | `PrivacyPage.jsx:82` |

## 重要 API 詳述

### POST /api/schedule/generate

**Request**

```json
{
  "constraints": { "maxCredits": 25, "minCredits": 12 },
  "courseIds": [1234, 5678],
  "surface": "dashboard",
  "trigger": "manual_generate"
}
```

- `constraints`：可覆寫已存偏好的臨時條件（**注意**：前端目前把
  `maxCredits: 25`／`minCredits: 12` 寫死在 `DashboardPage.jsx:114-115`，
  沒有讀使用者的 `targetCreditsMax`）。
- `surface`：`dashboard`／`schedule`／`search`／`chat`。
- `trigger`：`initial_load`／`manual_generate`／`preference_regenerate`／`chat_tool`／`course_search`。

**Response（成功，節錄）**

```json
{
  "success": true,
  "requestId": "uuid",
  "schedule": [ { "id": 1234, "name": "資訊安全導論", "credits": 3, "dayOfWeek": 1,
                  "startPeriod": 3, "endPeriod": 4, "instructor": "教師A",
                  "recommendationReason": { "selectedBecause": "PREFERENCE_MATCH" } } ],
  "plans": [ { "planId": "...", "id": "personalized", "title": "個人化綜合方案",
               "schedule": [], "totalCredits": 15, "preferenceScore": 0.72,
               "planMetrics": {}, "generationPolicy": {} } ],
  "totalCredits": 15,
  "graduationCredits": 15,
  "excludedCourses": [ { "course": {}, "reason": "與「X」衝堂", "constraintId": "TIME_CONFLICT" } ],
  "warnings": ["..."],
  "solver": { "status": "solved", "resultSource": "greedy", "repairAttempted": false,
              "fallbackUsed": false, "elapsedMs": 0, "nodesVisited": 0, "seed": 0 },
  "planDiversity": { "distinctPlans": 2, "competablePoolSize": 16 },
  "reviewDataLoaded": true
}
```

**Response（失敗）**

```json
{
  "success": false,
  "message": "找不到符合條件的候選課程，請調整搜尋條件或偏好設定。",
  "solver": { "status": "data-insufficient" },
  "unmetRequirements": [ { "type": "required-course", "reason": "沒有可用的候選課程資料",
                           "adjustable": true } ],
  "clarification": { }
}
```

**可能失敗原因**：401 未登入、403 學號不符、428 未同意、500 排課例外、
`success:false` + `solver.status ∈ {infeasible, timeout, data-insufficient}`。

### POST /api/schedule/validate

**Request**：`{ "courses": [ {...} ] }`（**不需登入**）

**Response**

```json
{
  "valid": false,
  "hardConstraintsValid": false,
  "violations": [ { "constraintId": "TIME_CONFLICT", "reason": "...", "courses": [] } ],
  "unchecked": ["PREREQUISITE"],
  "conflicts": [ { "course1": {}, "course2": {} } ],
  "duplicates": []
}
```

`unchecked` 明確列出**因資料不足而無法檢查**的限制（例如先修）——
不會把「沒檢查」偽裝成「通過」。

### POST /api/chat

**Request**：`{ "message": "幫我排課，不要早八" }`

**Response**

```json
{
  "reply": "已為你排出 8 門課共 23 學分……這份課表符合你的需求嗎？",
  "intent": "run_csp_scheduler",
  "data": { "success": true, "schedule": [], "plans": [], "requestId": "uuid" }
}
```

**注意**：欄位是 `reply` 不是 `response`（`ChatPanel.jsx:48` 有明確註解記錄過此不一致）。
`data` 只在 `intent === 'run_csp_scheduler'` 時被前端用來覆蓋畫面。

### POST /api/interactions

**Request**：`{ "events": [ { "eventType": "course_favorited", "requestId": "uuid",
"actionId": "uuid", "course": { "catalogCourseCode": "...", "sectionId": 1234 },
"term": { "academicYear": 114, "semester": "下學期" }, "source": "explicit_selection" } ] }`

**Response（已同意）**：`{ "recorded": 1, "results": [ { "actionId": "...", "eventType": "course_favorited", "status": "append" } ] }`

**Response（未同意）**：`{ "recorded": false, "reason": "CONSENT_NOT_GRANTED" }`（**HTTP 200**）

`status` 三態：`append`（新寫入）／`duplicate`（同 key 同內容）／`conflict`（同 key 不同內容，不覆寫）。

**伺服器強制覆寫的欄位**：`eventId`、`userId`、`timestamp`、`schemaVersion`、
`idempotencyKey`——即使 client 送同名欄位也會被蓋掉，避免偽造身分或發生時間。
`recommendation_exposed` 由 client 送出**一律拒絕**（只能由伺服器自己寫）。

## 前後端一致性檢查

### 後端存在但前端未使用

| API | 說明 |
| --- | --- |
| `GET /api/courses/departments` | `api.js:105` 有定義，無呼叫點 |
| `GET /api/courses/instructors` | `api.js:112` 有定義，無呼叫點 |
| `GET /api/reviews/easy` | `api.js:161` 有定義，無呼叫點（Agent 的 `get_easy_courses` 走內部呼叫） |
| `GET /api/reviews/:courseId` | `api.js:162` 有定義，無呼叫點 |
| `GET /api/graduation/:studentId` | 前端只用 `/graduation/me` |

### 前端呼叫但後端不存在

本次調查**未發現**此類問題。

### 命名或回傳格式不一致

| 問題 | 位置 |
| --- | --- |
| 聊天回覆欄位是 `reply` 而非 `response`（前端有註解記錄此坑） | `ChatPanel.jsx:48` |
| `recorded` 欄位型別不一致：已同意時是數字，未同意時是 `false` | `routes/interactions.js` |

**已解決**：`POST /api/profile` 曾經接受兩種不同的 body 形狀（`SetupPage.jsx` 的
`selectedTags` 版 vs 已刪除的 `ProfileForm.jsx` 的原始布林版）。`ProfileForm.jsx`
於 2026-09-09 確認為零路由死碼並刪除後，`SetupPage.jsx:138` 是唯一呼叫端，
不再有兩種形狀並存的問題。

### 缺少保護的 API

| API | 現況 | 風險評估 |
| --- | --- | --- |
| `POST /api/schedule/validate` | 無 `requireIdentity` | 低——純函式驗證，不讀寫使用者資料 |
| `GET /api/courses/**` | 無 auth | 低——課程資料本身非個資 |
| `GET /api/reviews/**` | 無 auth | 低——同上 |
| `GET /api/profile/preference-tags` | 無 auth | 低——只是標籤目錄 |
