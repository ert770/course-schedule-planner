# API Spec

Base URL:

```text
http://localhost:3001/api
```

All request and response bodies are JSON.

## Authenticated identity

登入成功後，後端以簽名的 `fcu_session` cookie 保存 canonical student ID（學號）。
cookie 設為 `HttpOnly`、`SameSite=Lax`，前端所有 API request 都使用
`credentials: include`。Profile、Schedule、Chat、Graduation、watchlist 與 saved schedules
一律從 session 取得實際操作身分，不接受 client 指定其他使用者。

相容期間若 request 仍帶 `userId`／`studentId`，其值只能是 session 中的同一個學號；
不一致回傳 `403`。未登入或 session 失效回傳 `401`。

## Data Source

Course, section, review, and numeric user profile data are read from MySQL database `defaultdb`.

- API `course.id` is `Course_Sections.section_id`.
- API `course.code` and `course.courseId` are `Courses.course_id`.
- API `course.catalogCourseCode` is MySQL `Courses.subid3`, the stable catalog course code.
  API course objects no longer expose the database-oriented name `subid3`.
- Review lookups use `Course_Reviews.selection_code` joined to `Course_Sections.selection_code`; API responses expose the joined `section_id` as `review.courseId`.
- Demo auth users and saved schedules remain backed by `server/data/*.json`. Raw Chat 不再讀寫
  `chat_history.json`；啟用 #33 後只寫入 MySQL `Chat_Messages` 的 AES-256-GCM 密文。

## Privacy and consent

啟用 `PRIVACY_ENFORCEMENT_ENABLED=true` 後，Profile、Schedule、Chat、Graduation 與
watchlist 等個人資料端點除了 session，還需要目前政策版本的 `service_processing`
同意。缺少同意回 `428`：

```json
{ "error": "尚未同意目前版本所需的資料用途", "code": "CONSENT_REQUIRED" }
```

政策版本過期時 `code` 為 `CONSENT_VERSION_OUTDATED`。`personalization_learning`、`collaborative_learning` 與
`aggregate_research` 都是選擇性且預設 false，不影響核心服務。

**2026-10-14 政策升版為 `2026-10-14.v4`**（新增 `collaborative_learning`）：所有人在舊版下的同意都不再有效，
登入後 `requiresAction: true`、需在隱私中心重新確認一次；確認前個人化學習與排課的個人化訊號都停用。

### `GET /api/privacy/policy`

公開回傳政策版本、四種用途、processor 與保存期限，不需要登入。`collaborative_learning` 另有
`requires: ["personalization_learning"]`；`retention.collaborativeMinimumCooccurrence` 為 3。

### `GET /api/privacy/consents`

回傳登入者目前各用途的最新 append-only 決定、`requiresAction` 與政策內容。回應不含
canonical ID 或 pseudonymous subject ID。

### `PUT /api/privacy/consents`

```json
{
  "consents": {
    "service_processing": true,
    "personalization_learning": false,
    "collaborative_learning": false,
    "aggregate_research": false
  }
}
```

必要用途必須為 true 才能開始服務；各用途的值會以同一時間點原子寫入。

**協同過濾（2026-10-14 階段 7）**：`collaborative_learning` 是「貢獻」——讓本人的修課與課程互動進入課程共現表，
協助推薦給其他同學。以 `personalization_learning` 為前提：後者為 `false` 時伺服器一律把前者記為 `false`。
從 `true` 改為 `false` 時，伺服器約 5 秒後重建共現表，新表不含他的資料（不等每日排程）。
「接收」協同過濾分數只需要 `personalization_learning`。

**Roadmap #31**：`personalization_learning` 從 `true` 改為 `false`（撤回）時，
本次請求會**連同已學到的權重與作為其輸入的互動事件一起刪除**（等同呼叫下方的
`DELETE /api/privacy/personalization`）——撤回同意不只是停止未來蒐集，已持有的
學習成果也一併清除。重新勾選後個人化從零開始重新累積，不會沿用被刪除前的資料。

### `GET /api/privacy/export`

以 attachment JSON 串流登入者的可攜 Profile、已存課表、同意決定、**自己的互動事件**
（`data.interactionEvents`，Roadmap #2）、目前已存的三軸權重與標籤興趣檔案
（`data.learnedPreferenceWeights`、`data.learnedTagInterests`）。不包含密碼、內部 subject ID、
Raw Chat 明文、模型 thought 或研究逐筆事件；回應使用 `Cache-Control: no-store`。

匯出的事件刻意不含 `subject_id` 與 `idempotencyKey`：前者是分析用的內部假名，匯出它
等於把假名與本人身分綁在同一份檔案裡；後者是去重用的實作細節。

### `DELETE /api/privacy/chat`

刪除登入者全部加密 Raw Chat，不影響已寫入 Profile 的結構化偏好。

### `POST /api/privacy/deletion-intents`

建立 10 分鐘有效、單次使用且只屬於登入者的刪除 token。

### `DELETE /api/privacy/data`

Body 必須帶前一步的 `requestId`、`token` 與固定 `confirmationPhrase: "刪除我的資料"`。
成功後刪除服務帳號、Profile、修課歷史、已存課表、互動事件、三軸權重、標籤興趣檔案與 Raw Chat，清除 session；
最小同意與稽核記錄依政策保留 365 天。回應的 `deleted` 含 `interactionEventsDeleted`、
`learnedWeightsDeleted` 與 `tagInterestProfilesDeleted`。

**執行順序：先標記撤回，再刪除。** 同意紀錄依政策保留 365 天，因此刪除後 consent 檢查
仍會通過；若不先撤回，一個已通過檢查、正在執行中的 `POST /api/interactions` 可以在刪除
完成之後才落地，讓這支 API 回報成功卻仍留下個人資料。互動事件的寫入會在同一個交易裡以
`SELECT ... FOR UPDATE` 檢查撤回狀態，已撤回的 subject 一律回 `rejected`。

### `GET /api/privacy/personalization`（Roadmap #31）

目前個人化用的是顯式設定、學到的權重、還是資料不足／未同意。只需要 `requireIdentity`，
**不需要任何 consent**——沒同意的人正是要看到 `no-consent` 這個狀態。

```json
{
  "source": "insufficient",
  "appliedToScheduling": true,
  "explicitProfileEmpty": false,
  "hasExplicitPreferences": true,
  "weights": { "interest": 0, "compact": 1, "easy": 0 },
  "explicitProfile": { "interest": 0, "compact": 1, "easy": 0 },
  "sufficiency": {
    "status": "insufficient",
    "usableEventCount": 31,
    "requiredEventCount": 50,
    "missingAxes": ["easy"]
  },
  "modelVersion": "preference-learning-v2",
  "computedAt": "2026-09-04T02:38:14.334Z"
}
```

`hasExplicitPreferences`：使用者是否自己設定過偏好標籤、興趣、關鍵字或避開時段（2026-10-15 新增）。`explicitProfileEmpty` 只代表學習權重的基準軸都是 0，不能用來判斷「尚未表達偏好」。

`source` 為 `no-consent` / `insufficient` / `explicit` / `learned` 四選一；`insufficient`
時 `weights` 等於 `explicitProfile` 原樣。`appliedToScheduling`（Roadmap #5B 起恆為
`true`）表示可用的學習結果已進入排課決策；Roadmap #7 起，同一組帶號連續權重同時用於
單一門課排序與方案比較。學到的 boost 只加強已由顯式設定決定的方向。

⚠️ **這支 GET 有寫入副作用**：已存結果過期時（版本不符、有新事件、或超過一天沒更新）
會順手重算並覆寫 `Learned_Preference_Weights` 的那一列——冪等的快取填充，不是新的寫入
語意，但呼叫端不該假設它保證唯讀。已同意時內部會呼叫 `getUserPreferences()`（連
`User_Course_History` 的 MySQL 讀取），CI 因此無法端到端測試這支路由（見
`docs/TEST_PLAN.md` 的 PL 段落）。

### `GET /api/privacy/tag-interests`（Roadmap #43 階段 3）

讀取登入者自己的 rag-tag 興趣檔案。未同意 `personalization_learning` 時，不讀取互動事件、
不保存行為 profile；回應仍可列出既有 Profile 中精確對應的明確主題先驗，並以
`consented: false`／`source: "no-consent"` 表示沒有行為學習資料。

```json
{
  "consented": true,
  "source": "learned",
  "computedAt": "2026-10-09T04:00:00.000Z",
  "profile": {
    "modelVersion": "rag-tag-interest-v1",
    "catalogVersion": "rag-tag-catalog-2026-10-08-v1",
    "eligibilityVersion": "rag-tag-eligibility-2026-10-09-v1",
    "categoryInterests": [],
    "explicitTopics": [],
    "unmappedExplicitTopics": [],
    "tagInterests": [
      {
        "canonicalTagId": "tag_ac8bb4d19b34088425b1",
        "canonicalName": "0365 Copilot",
        "prior": 0,
        "positiveEvidence": 1,
        "negativeEvidence": 0,
        "score": 0.333333,
        "crossCourseMatchEligible": false,
        "hasEvidence": true
      }
    ],
    "summary": {
      "usableEventCount": 1,
      "tagCount": 1,
      "evidenceTagCount": 1,
      "crossCourseMatchTagCount": 0,
      "excludedEventCount": 0
    }
  }
}
```

這個 GET 在已同意且 profile 過期時會重算並覆寫 `Learned_Tag_Interests` 快取。只有跨課配對
資格為 true 的 tag 才能用於新課程分數；此 API 只提供 profile，階段 3 尚未把分數接進排課。

### `DELETE /api/privacy/personalization`（Roadmap #31）

只清除學到的三軸權重、標籤興趣檔案與作為其輸入的互動事件，**不影響顯式 Profile**（偏好標籤、避開時段、
學分上限）。與 `DELETE /api/privacy/data`（整個帳號）不同量級，不需要確認詞，但前端
一律用 `window.confirm` 講清楚會刪除什麼再送出。

```json
{
  "success": true,
  "learnedWeightsDeleted": 1,
  "tagInterestProfilesDeleted": 1,
  "interactionEventsDeleted": 92,
  "profilePreserved": true
}
```

連互動事件一起刪是刻意的：權重是事件的純推導，只刪推導出的那一列，下一次讀取
（上面 GET 的過期重算）就會用一模一樣的事件重新算出一模一樣的值——一個會自己
復原的「重設」比沒有這個功能更糟。

## Health

### `GET /api/health`

Response:

```json
{
  "status": "ok",
  "timestamp": "2026-06-11T00:00:00.000Z"
}
```

## Auth

The provided MySQL schema does not include password data, so auth still uses the local demo `users` JSON collection.

### `POST /api/auth/login`

Request:

```json
{
  "studentId": "D1249196",
  "password": "password"
}
```

Response:

```json
{
  "success": true,
  "user": {}
}
```

`user.name`（若有）來自 `User_Profiles.name`，不是 `users.json`——2026-09-10 起
`users.json.name` 已刪除，`/login` 與 `/me` 都在回傳前呼叫 Profile 讀取路徑補上顯示名稱；
查無 Profile 列、或該列的 `displayName` 只是排課引擎內部用的合成佔位字串（`User ${user_id}`）
時，回應不含 `name` 欄位。

`user.setupComplete`（2026-10-16 新增，boolean）：`User_Profiles` 是否已有系所與年級
（`isProfileSetupComplete()`）。前端據此判斷登入後要不要走「同意頁 → 設定頁」的引導流程，
登出或換裝置後不必重走。Profile 讀取失敗（例如未接 MySQL）時不含此欄位，前端退回瀏覽器的
`fcu:<studentId>:setupDone` 標記。隱私同意是否需要重新確認仍由 `GET /api/privacy/consents` 的
`requiresAction` 判斷，與此欄位無關。

### `GET /api/auth/me`

從 session 回傳目前登入的 local demo user profile（不含密碼），不接受 query student ID。
與 `/login` 相同，會帶上 `name`（若有）與 `setupComplete`。

### `POST /api/auth/logout`

清除 session cookie。

### `POST /api/auth/update-watchlist`

Request:

```json
{
  "watchlist": [1, 2, 3]
}
```

`watchlist` values should be section ids.

## Courses

### `GET /api/courses`

Query params:

- `department`（必填；完整系所名稱，例如 `資訊工程學系`）
- `gradeLevel`（必填；1～4 為大一至大四，5 為碩士／博士／研究所）
- `classYear`（由 `courseSearchScope` 提供；碩一／碩二等班級年次）
- `degree`（由 `courseSearchScope` 提供；班級學制）
- `className`（必填；由完整班級解析出的班別尾碼，例如 `甲`）
- `keyword`
- `category`（選填：`必修`、`核心選修`、`一般選修`、`通識`、`系外選修`）
- `dayOfWeek`
- `credits`
- `instructor`
- `code`
- `period`
- `language`

`department`、`gradeLevel`、`className` 必須使用 `GET /api/profile` 回傳的
`courseSearchScope`，前端不得自行拆解完整班級名稱。API 不接受 `class` alias。
缺少任一班級範圍欄位時不會退回廣泛搜尋，而是回傳 `400`：

```json
{
  "error": "缺少班級資料，請先匯入學生班級再搜尋課程。",
  "code": "CLASS_NAME_REQUIRED"
}
```

例如完整班級 `資訊三甲` 會產生：

```text
GET /api/courses?department=資訊工程學系&gradeLevel=3&classYear=3&degree=bachelor&className=甲
```

後端會先以學生 scope 解析每門課的分類，再套用 category 與其他搜尋條件。未指定
category 時維持 F7，只回傳本人班級及同年級合班；明確指定 `系外選修` 或 `通識`
才會跨出本人班級範圍。通識課以正式學年度規則、MySQL `Courses.dept` 的官方領域
名稱及官方跨院認抵表分類，不以 `catalogCourseCode` 前綴猜測。

課程搜尋會保留班級資格資訊。B～F 類（共同／通識、學院綜合班、英語與國際班、
學分學程及其他特殊班級）的正式適用對象尚未由校方確認，因此仍可被明確搜尋，
但回應為 `eligibility: "unknown"`，前端顯示「資格待確認」，不得解讀成確定可修。

### `GET /api/courses/catalog`

供「查詢全校課程」使用，不要求個人系所、年級或班別。從全校課程中依系統目前
`ACTIVE_TERM` 篩選，再套用下列條件：

- `keyword`（課名、課號、教師、系所或課程描述）
- `name`（只比對課名與課號；查詢頁「科目名稱」欄位用這個，「課程描述」欄位用 `keyword`。2026-10-15 新增）
- `code`
- `instructor`
- `dayOfWeek`
- `period`
- `credits`
- `language`：`English` 只留全英授課（`isEnglishTaught`），`中文 (Chinese)` 排除全英授課（2026-10-15 修正：
  原本比對不存在的 `course.language`，選任何語言都是 0 筆）
- `category`：`通識` 或資料庫原始類別 `必修`

`通識` 會依官方通識分類資料解析；`核心選修`、`一般選修`、`系外選修` 等需要個人
修課範圍才能判定的分類會回傳 `400 STUDENT_SCOPE_REQUIRED`。端點回傳
`{ appliedFilters, courses, total }`，課程物件沿用一般搜尋欄位及學期資訊。

這支 API 是全校目錄探索，**不判定目前登入者能否修讀課程，也不承諾課程可計入其畢業
學分**。加入課表與排課時仍須由既有個人化驗證檢查班級資格、先修、學分及其他規則。

### `GET /api/history-feedback`（協同過濾與 User Embedding 構想階段 5）

歷史修課回饋視窗的課程清單。**唯讀**；需登入與 service consent。未同意 `personalization_learning` 時
`consented: false`、`groups` 為空陣列。

依學期由近到遠列出最新一次已通過、畢業分類為選修／通識／系外選修的課。
設定頁可以編輯全部回傳課程。當期有班次及可比對標籤的課才會由首頁主動詢問。

```json
{
  "consented": true,
  "term": { "academicYear": 114, "semester": "下學期" },
  "groups": [{
    "academicYear": 113, "semester": 2,
    "courses": [{
      "courseCode": "IECS2011", "name": "系統分析與設計", "sectionId": 1234,
      "graduationCategory": "elective", "response": null, "answeredAt": null,
      "availableForInitialReview": true
    }]
  }],
  "pendingCount": 18,
  "excluded": { "noTags": 7, "notOfferedThisTerm": 0 }
}
```

- `response`：未到期事件中最後一次的回答（`liked`／`neutral`／`disliked`），沒回答過為 `null`。
- `sectionId`：當期沒有可對應的班次時為 `null`，仍可用本人修課紀錄的課號提交喜好。
- `pendingCount`：`availableForInitialReview` 為 true 且尚未回答的課數。`excluded` 計算因無當期班次或缺標籤而未列入首頁詢問的課數。
  前端在排課主頁 `pendingCount > 0` 時自動跳出一次；
  「稍後再說」會把這批課都記為 `neutral`，同一批課不再自動跳出。

回答以 `POST /api/interactions` 送出 `history_course_feedback` 事件：

```json
{
  "eventType": "history_course_feedback",
  "requestId": "<uuid>", "actionId": "<uuid>",
  "course": { "catalogCourseCode": "IECS2011", "sectionId": 1234 },
  "term": { "academicYear": 114, "semester": "下學期" },
  "source": "history_review",
  "interestFeedback": { "response": "liked", "canonicalTagIds": [] },
  "versionSnapshot": { "recommendationReasonVersion": null }
}
```

- `source` 必須是 `history_review`；`response` 只能是 `liked`／`neutral`／`disliked`；`canonicalTagIds` 必須是空陣列
  （針對整門課，證據標籤由伺服器快照決定）。
- **伺服器依 Profile 的修課歷史核對課號**：不是本人已通過的選修／通識／系外選修就 `rejected`。
- 無當期班次時，可傳 `course.sectionId: null` 保存課程喜好。這筆回答沒有班次標籤快照。
- 學習權重：喜歡 +1、不喜歡 −1、普通 0；同一門課以最後一次回答為準，不套用時間衰減（事件 180 天到期）。
  標籤空間使用者向量中，回答「不喜歡」的課不再給歷史修課的 +0.5。

### `GET /api/interest-exploration/cards`（Roadmap #43 階段 4）

需要登入及 `service_processing` 同意。從登入者的修課範圍與目前學期課程中，回傳 `pairs`，最多三組且每組兩門不同課號。
排除必修、已通過課程、資格未知／不符及沒有時段的課程。雙卡還要求每門課至少一個可學習且可跨課配對的 `representativeTags`。
課程先依主題相關度排序，同分再依既有向量訊號（s_vec）排序，最後依課號。配對優先找同類但代表標籤不同的另一門，候選不足時提供較少組。

主題相關度從 2026-11-22 起只讀課程主題問答的結果 `interestSelections`，依 ID 比對（ADR-029）：

- 課程的標籤中，每個學生勾選的標籤 +2。
- 課程的分類路徑中，每條落在學生所選方向（大類或子類）的路徑 +1。
- 課程屬於 `preferredTrack` 時 +1。
- 以上各項可疊加。

`interests`、`preferredKeywords` 不再影響相關度，s_vec 也從 2026-11-22 起不再讀這兩個欄位（ADR-030）。方向只用來排探索卡，不寫進任何分數。
`cards` 保留最多八張的舊版平面清單。`categoryPrompts` 自 2026-11-23 起固定為空陣列（它只讀已移除的文字興趣欄位，ADR-032），欄位保留以維持相容。
`GET /api/exploration` 是系外／通識相似度清單，與此初始興趣探索流程不同。

```json
{
  "term": { "academicYear": 115, "semester": "上學期" },
  "emptyReason": null,
  "categoryPrompts": [
    {
      "mainCategoryId": "main_...",
      "mainCategory": "人工智慧",
      "subcategories": [
        { "id": "sub_...", "name": "生成式 AI" },
        { "id": "sub_...", "name": "機器學習" }
      ]
    }
  ],
  "cards": [
    {
      "courseCode": "IECS3002",
      "sectionId": 801,
      "name": "課程名稱",
      "department": "資訊三甲",
      "credits": 3,
      "instructor": "授課教師",
      "schedule": "星期一 1-2 節",
      "term": { "academicYear": 115, "semester": "first" },
      "category": "一般選修",
      "track": "技術應用類",
      "description": "課程內容摘要",
      "representativeTags": [{ "canonicalTagId": "tag_ac8bb4d19b34088425b1", "canonicalName": "0365 Copilot" }],
      "tags": [
        {
          "canonicalTagId": "tag_ac8bb4d19b34088425b1",
          "canonicalName": "0365 Copilot",
          "categoryPaths": [
            { "mainCategoryId": "...", "mainCategory": "人工智慧", "subcategoryId": "...", "subcategory": "生成式 AI" }
          ]
        }
      ]
    }
  ]
}
```

`pairs` 是陣列，每一項都是上述格式的兩張卡。新版頁面直接顯示雙卡，不在探索頁加入額外的分類題。
`emptyReason` 為 `student_scope_unavailable` 時代表 Profile 缺少可確認的系所／年級／班級；
`no_eligible_courses` 代表舊版平面清單沒有合格卡片。新版沒有完整雙卡時 `pairs` 為空，使用者可直接排課。
課程主題回饋使用既有 `POST /api/interactions` 的
`interest_exploration_feedback`；未同意選擇性的 `personalization_learning` 時，前端不送出回饋，
不會阻止使用者繼續操作。

Response:

```json
{
  "scope": {
    "department": "資訊工程學系",
    "gradeLevel": 3,
    "classYear": 3,
    "degree": "bachelor",
    "className": "甲"
  },
  "appliedFilters": {
    "department": "資訊工程學系",
    "gradeLevel": 3,
    "className": "甲",
    "category": "核心選修"
  },
  "courses": [
    {
      "id": 1,
      "sectionId": 1,
      "courseId": "CS101",
      "code": "CS101",
      "catalogCourseCode": "IECS2001",
      "name": "資料結構",
      "instructor": "王小明",
      "department": "資工系",
      "credits": 3,
      "gradeLevel": 3,
      "prerequisites": null,
      "dayOfWeek": 1,
      "startPeriod": 2,
      "endPeriod": 4,
      "location": "B101",
      "category": "核心選修",
      "sourceCategory": "選修",
      "classificationSource": "cs_curriculum",
      "classGroup": "A",
      "classKind": "department",
      "eligibility": "eligible",
      "eligibilityReason": "已辨識為 A 類系所班級；其他選修限制仍依既有候選規則判定。",
      "eligibilitySource": "department-required-table:elective-default",
      "term": { "academicYear": 114, "semester": "下學期", "isActiveTerm": true },
      "scopeReason": "一般選修，可搜尋與加選。",
      "track": "技術應用類"
    }
  ],
  "total": 1
}
```

分類欄位：

| 欄位 | 說明 |
| --- | --- |
| `category` | 後端依學生範圍解析後的分類，供搜尋、排課與 UI 使用 |
| `sourceCategory` | MySQL 原始 `Courses.type`（必修／選修） |
| `classificationSource` | `mysql`、`cs_curriculum` 或 `outside_department` |
| `track` | 資工科目表對應的修課路徑，沒有資料時為 `null` |
| `outsideElective` | 系外選修的認列檢查、原因、警告及系辦確認狀態 |
| `classGroup` | 班級分類 `A`～`F`；尚未收錄的名稱為 `null` |
| `classKind` | `department`、`commonCurriculum`、`collegeWide`、`englishProgram`、`internationalProgram`、`creditProgram`、`other` 或 `unclassified` |
| `eligibility` | `eligible`、`ineligible` 或 `unknown`；是班級適用資格，不等同畢業學分認列 |
| `eligibilityReason` | 可供 UI 與 Agent 直接呈現的資格判定理由 |
| `eligibilitySource`（Roadmap #20） | `eligibility` 結論套用的規則代號，見 `server/src/skills/courseScope.js` 的 `ELIGIBILITY_SOURCE`，供追查來源用，不是給人看的文字 |
| `term`（Roadmap #20） | `{ academicYear, semester, isActiveTerm }`，這門課自己的開課學年學期，以及是否為系統目前的 active term |
| `scopeReason`（Roadmap #20） | 融合 term／類別／eligibility／系外選修認列結果的完整白話說明，可直接呈現給使用者 |
| `gradeLevel` | `Courses.target_grade` 的 API 名稱；0＝全年級、1～4＝大一至大四、5＝研究所 |
| `prerequisites` | 先修資料；`null` 代表資料尚未提供，不代表沒有先修。可能是課名陣列（空陣列＝沒有先修），或物件 `{ rules: [{ name, course_id }], required_ids, course_code, course_name }`（見 `DATA_SCHEMA.md`） |

**Active term（Roadmap #20）**：所有課程搜尋、排課與 Agent 查詢只回傳
`server/src/data/activeTerm.js` 定義的 `ACTIVE_TERM`（預設 114 學年下學期）內的
sections，非本學期候選不會出現在搜尋結果中；換學期時更新 `ACTIVE_ACADEMIC_YEAR`／
`ACTIVE_SEMESTER` 兩個環境變數即可，不需改程式碼（見 `docs/SCHEDULING_LOGIC.md`
「Active Term」一節）。

通識課另有下列欄位：

| 欄位 | 說明 |
| --- | --- |
| `generalEducationDomain` | 111 以前的舊領域、112～114 的四領域；115 起固定為 `null`（不分領域） |
| `generalEducationRuleVersion` | `through-111`、`112-114` 或 `from-115` |
| `generalEducationRecognitionType` | 通識中心直接開課為 `direct`；官方跨院認抵為 `cross_college` |
| `classificationReference` | 支撐該分類的逢甲大學官方來源網址 |

通識的 `classificationSource` 為 `general_education_department` 或
`general_education_recognition`。

### `GET /api/courses/departments`

Response:

```json
{
  "departments": []
}
```

### `GET /api/courses/classes`

某系所某年級實際存在的班別。必修不得換班（見 `docs/COURSE_SELECTION_RULES.md` 第八節），
學生需指定班別，此端點提供可選清單。

Query:

| 參數 | 必填 | 說明 |
| --- | --- | --- |
| `department` | 是 | 系所全名，例如 `資訊工程學系`。缺少時回 `400` |
| `gradeLevel` | 否 | 1～4 回傳對應學士班；5 回傳研究所班別 |
| `programType` | 否 | `master` 或 `doctoral`，用於 gradeLevel=5 時收斂班別 |

Response:

```json
{
  "classes": ["資訊三丁", "資訊三丙", "資訊三乙", "資訊三合", "資訊三甲"]
}
```

班別清單由課程資料現場推導（`Courses.dept` 經 `parseClassName()` 解析後篩選），
只回傳學士班。前端不得複製一份系所簡稱對照表——那份對照只有
`server/src/data/departmentMapping.js` 一份，複製就會各自漂移。

### `GET /api/courses/instructors`

Response:

```json
{
  "instructors": []
}
```

### `GET /api/courses/interest-options`

回傳設定頁可詢問使用者的課程方向。`department`、`gradeLevel` 必填；`className`
尚未提供時仍回傳該系的官方修課路徑，但 `topicGroups` 為空、`scopeReady` 為 `false`。班別完整時，
`topicGroups` 由這位學生的排課候選課程的 `Course_Sections.rag_tag`（經標籤目錄解析）統計而來，不在前端寫死。
同一課程的不同 section 對相同主題只計一次。

**舊的平面清單 `topics` 與 `topicCourseCount` 已於 2026-11-20 移除**（設定頁改讀 `topicGroups`）。

```json
{
  "tracks": ["嵌入式系統類", "技術應用類", "網路與安全類"],
  "scopeReady": true,
  "candidateCourseCount": 589,
  "topicGroups": []
}
```

上述三條官方路徑只適用資訊工程學系；其他系所的 `tracks` 為空陣列。`candidateCourseCount` 是完整排課候選數。

**`topicGroups`（分組選單，2026-11-20）**：三組選單，下面是各欄位的說明與範例。

```json
{
  "topicGroups": [
    {
      "key": "department", "label": "本系", "level": "sub",
      "options": [
        {
          "id": "sub_…", "name": "資訊安全與隱私", "level": "sub", "mainCategory": "資訊與計算",
          "mode": "direct", "courseCount": 5, "tagCount": 2, "aliasIds": [],
          "sampleCourses": ["電子商務安全", "安全程式設計", "系統安全"],
          "tags": [{ "tagId": "tag_…", "name": "資訊安全", "courseCount": 5, "sampleCourses": ["系統安全"] }]
        },
        { "id": "sub_…", "name": "網路、系統與程式工具", "mode": "followup", "courseCount": 19, "tagCount": 20, "aliasIds": [] }
      ]
    },
    { "key": "generalEducation", "label": "通識", "level": "main", "options": [] },
    { "key": "outside", "label": "系外（不含理工類學院）", "level": "main", "options": [] }
  ]
}
```

- 三組的範圍直接取自排課器的畢業分類桶：`department`＝本系選修、`generalEducation`＝通識、
  `outside`＝系外選修。必修與「其他」桶（應用外語、體育、學院綜合班、學分學程）不列入，因為
  標籤興趣（S_tag）只作用於前三個桶，勾了也不會影響排課。沒有任何選項的組不回傳。
- 本系用**子類別**，通識與系外用**大類別**。同一組「池內可選標籤集合」完全相同的子類別併成一個選項，
  其餘 ID 放在 `aliasIds`，`mainCategories` 是它們所屬的大類別（可能不只一個）。
  **併過的選項用內容命名**：`name` 是「大類別：最常出現的 3 個標籤」，標籤超過 3 個加「 等」，由資料
  產生，`nameSource` 為 `content`，並附 `catalogNames`（被併進來的目錄子類別名稱，方便追查）。原因是目錄的
  子類別層在很多大類別裡沒有區分度：例如「視覺藝術」「媒體」「建築與空間美學」的標籤清單完全相同（各 274 個），
  全目錄有 38.4% 的標籤在同一個大類別底下被分到 3 個以上子類別，併在一起後沒有「正確的目錄名稱」可選。
  沒有被併過、以及 `direct` 白名單內的選項用目錄原名（`nameSource` 為 `catalog`）；通識與系外用大類別，
  名稱就是大類別名稱。「學習階段與課程情境」「課程活動與評量」兩個大類別不當選項。
- 本系選單有**依系所的隱藏清單**（`HIDDEN_SUBCATEGORIES`，見 `server/src/data/interestMenuConfig.js`）：
  清單內的子類別在候選池裡命中的標籤混雜，不列成選項。只有「整組併在一起的成員都在清單內」才隱藏；
  隱藏只影響選單，不影響追問候選與保存驗證。目前只有資訊工程學系有清單。
- 只統計**同時可學習且可跨課配對**的標籤（單課標籤與 `too_common` 標籤不算），所以每個選項至少有一個
  能影響排課的標籤。每組依課程數由多到少，最多 8 個；同一門課開多個班只算一次。
- `mode: "direct"` 只給設定檔明列的白名單（目前只有「資訊安全與隱私」）：勾選後不追問，`tags` 是候選池
  裡實際命中的標籤，供前端顯示給學生確認。其餘一律 `followup`，不帶 `tags`。
- **人工策畫選項（2026-11-20，ADR-026）**：資訊工程學系的本系組最前面另有「人工智慧」（`id: "curated_ai"`、
  `nameSource: "curated"`、`mode: "direct"`），不佔依課程數排序的 8 個名額。`tags` 是人工清單（人工智慧、機器學習、
  深度學習、生成式AI、自然語言處理、語言模型、電腦視覺）在候選池裡實際命中的標籤，**包含 `too_common` 的人工智慧
  與機器學習**；這兩個標籤只有從這個選項明確選擇時才計分。其他系所、或候選池沒有命中時不出現。
- **系外組不含理工類學院**（資電、工程與科學、建設三個學院，加上環境工程與科學學系、航太與系統工程學系、
  人工智慧技術與應用學士學位學程、應用數學系、創能學院綜合班）。這只排除選單，不影響排課計分。
- 候選池以系所、年級、班別與學期為鍵快取 10 分鐘（重建一次約 2 秒）；班別沒選好時不猜測，`topicGroups`
  為空、`scopeReady` 為 `false`。

### `GET /api/courses/:id`

`id` is `Course_Sections.section_id`.

## Schedule

### `POST /api/schedule/generate`

Request:

```json
{
  "courseIds": [1, 2, 3],
  "filters": {},
  "constraints": {
    "minCredits": 15,
    "maxCredits": 22,
    "blockedPeriods": [],
    "noMorningClasses": false,
    "noEveningClasses": false,
    "mustTakeCourseIds": [7],
    "avoidInstructors": ["王小明"],
    "preferCompact": false,
    "preferredKeywords": ["網路", "資安"],
    "interests": [],
    "preferredTrack": null,
    "preferEasyCourses": false,
    "preferChallengingCourses": false,
    "noMidterm": false,
    "noGroupReport": false,
    "noRollCall": false,
    "discussion": false,
    "weightDaily": false,
    "practicalExam": false,
    "finalReport": false,
    "englishTaught": false,
    "learnMore": false,
    "allowRelaxation": false,
    "timePreferencePriority": [],
    "department": "資訊工程學系",
    "gradeLevel": 3,
    "className": "資訊三甲",
    "sessionAvoidances": [{ "sectionId": 102, "reason": "workload" }]
  },
  "surface": "dashboard",
  "trigger": "manual_generate"
}
```

`surface`（`dashboard`｜`schedule`｜`search`｜`chat`）與 `trigger`（`initial_load`｜
`manual_generate`｜`preference_regenerate`｜`chat_tool`｜`course_search`）標記這次排課
在哪個畫面、被什麼動作觸發，只用來寫入 `recommendation_exposed` 互動事件
（Roadmap #2），**不參與候選池或排課邏輯**。省略或值不在列舉清單中時，伺服器單純
不記錄這次曝光，不會因此讓排課失敗，也不會用猜的值頂替。Chat 路徑（`run_csp_scheduler`）
固定由伺服器帶入 `surface:"chat"`／`trigger:"chat_tool"`，不接受模型指定。

**`minCredits` 未提供時的預設值依年級而定**（`resolveMinCredits()`，
`server/src/data/creditPolicy.js`）：四年級以上為 9，其餘為 12——2026-09-10 前這裡
不論年級一律寫死 12，四年級的下限從未在真實請求中生效過，屬於已修復的 bug。
年級來自 `constraints.gradeLevel` 或已存 profile 的 `gradeLevel`；兩者皆缺時視為非四年級，
套用 12。

`department`、`gradeLevel`、`className` 決定必修範圍。`className` 為班別——
系上不接受必修換班，未提供時必修只收斂到系所與年級，並在 `warnings` 提醒。
三者未提供時會從使用者已儲存的 profile 帶入。系統自動建立候選池時，若 profile
缺少可解析班級，不會退回全校課程，而是回傳 `CLASS_NAME_REQUIRED`。前端不需要在
schedule request 重複傳班級；route 會先依 session identity 讀取 profile，再呼叫
`searchCoursesForSchedule()`。

畢業缺口配額不接受 request 指定。伺服器會用 Profile、MySQL
`User_Course_History`、入學年度適用的畢業規則與 `remainingSemesters` 建立
`graduationPlanning`，再透過 trusted context 交給排課器；request body 即使送入同名欄位
也會被忽略。配額計算與選課順序見 `docs/SCHEDULING_LOGIC.md` 的
「畢業缺口的當學期配額」。

`courseIds`、`selectedCourseIds`、`watchingCourseIds` 與 `mustTakeCourseIds` 使用 section id。

`sessionAvoidances` 是**本次規劃**的避開清單：使用者剛在畫面上移除的課，這一次重排
就不要再出現。每一筆只有 `sectionId` 與 `reason`（值域同 `feedbackReason`）；
課號與教師由伺服器從 `Courses` 重查，避開範圍由伺服器依 `reason` 推導，
呼叫端送 `scope` 也會被忽略。範圍對照表見 `docs/SCHEDULING_LOGIC.md`。

它是 **request-scoped**：不從已儲存偏好回填，也不會寫回偏好——「這次不想要」不該
靜默沉澱成永久設定（立場同 `nonNegotiablePreferenceIds`）。特別注意它**不是**
`avoidInstructors`：後者是持久化的 profile 欄位，把本次避開寫進去會整包蓋掉
使用者存好的清單。

它**不需要個人化同意也會生效**：避開條件是使用者本次的排課限制，不是訓練資料。

回應新增 `appliedSessionAvoidances`，每一筆是
`{ sectionId, reason, scope, pendingReason, status, message }`：

| `status` | 意義 |
| --- | --- |
| `applied` | 真的避開了 |
| `protected-conflict` | 那門課是必修、重補修或使用者指定必排，**仍在課表中**；`message` 說明衝突 |
| `not-found` | 這次的候選課程裡找不到對應的課 |

只有 `applied` 才可以在畫面上說「已避開」。`protected-conflict` 顯示成已避開，
畫面就會和旁邊的課表自相矛盾。

`avoidInstructors` 是教師完整姓名陣列。比對時只去除前後空白並忽略英文大小寫，
不做模糊搜尋，也不自行拆分或猜測姓名。命中的一般候選課會以
`constraintId: "AVOID_INSTRUCTOR"` 排除；`watchingCourseIds` 的關注課不套用此限制。
正式必修若只有該教師班次，與早八／午休／晚課舒適偏好相同，採必修優先並在
`warnings` 與 `recommendationReason.constraintTradeoffs` 揭露；使用者手動指定的
`mustTakeCourseIds` 不屬於正式必修豁免。

`completedCourseIds` 已於 2026-08-13 移除——已修排除改用穩定的 `courseHistory`
課號比對（`skills/scheduler.js` 呼叫 `data/courseHistory.js` 的
`getPassedCourseCodes()`），不接受 request 傳入任何形式的已修課清單，
一律以 MySQL `User_Course_History` 映射出的 `courseHistory` 為準。詳見「限制條件合併語意」。

`courseIds` 決定候選池，同時代表「使用者明確指定的課」。route 會把它併入
`explicitCourseIds` 傳給排課引擎；`selectedCourseIds`、`mustTakeCourseIds` 同樣視為明確指定。

`selectedCourseIds` 中不在候選池的班次（例如系外選修、通識）會從課程目錄補進候選池，排課引擎才能保留它們
（2026-10-15）。排課主頁的「套用偏好排課」把使用者自己加入課表的班次放在這裡送出；從已存課表載回的課不算。

`retakeCourseIds` 與 `failedRequiredCourseIds` 已移除。重補修不得由 client 或 Agent
手動指定；後端只依 Profile 的 `courseHistory`，對每個 `courseCode` 取最新
`academicYear + semester` 紀錄，自動找出 `passed: false` 且
`requirementType: "必修"` 的課，再映射到本學期相同 `catalogCourseCode` 的所有 sections。
優先序固定為「本學期必修 → 不及格必修重補修 → 其他課程」。本學期未開課時，
`warnings` 會提醒使用者下學期重修。

明確指定的課程**不會被系統的推論規則剔除**，一律排入並附警告：

| 規則 | 系統自撿的候選 | 明確指定 |
| --- | --- | --- |
| 系外選修不符認列條件 | 剔除，原因記入 `excludedCourses` | 排入，標記不計入畢業學分 |
| 他班／他系的必修 | 剔除，不進候選 | 排入，警告需自行向系辦確認 |
| B～F 類或未分類、`eligibility=unknown` | 保守排除，原因記入 `excludedCourses` | 保留並排入，警告「資格待確認」 |
| 非本學期開課（`term.isActiveTerm=false`，Roadmap #20） | 保守排除，原因記入 `excludedCourses` | 保留並排入，警告「非本學期開課」 |

理由：前三條都是「依系所、年級、班別**推論**」，不是校方的選課權限；非本學期一項
同樣可能因轉系、輔系、雙主修或加簽而修得到，處理原則一致。
見 `docs/SCHEDULING_LOGIC.md` 的「明確指定的課程豁免整批排除」與「Active Term」。

**注意**：`GET /api/courses` 課程搜尋沒有「明確指定」的概念（那是排課階段才有的
語意），非本學期候選一律直接過濾，不出現在搜尋結果中——見 `docs/SCHEDULING_LOGIC.md`
「Active Term」一節。

`preferredKeywords`、`interests`、`preferredTrack`、`preferCompact`、`preferEasyCourses`、
`preferChallengingCourses` 為軟性偏好（`preferredKeywords`／`interests` 只代表**這次請求**的興趣關鍵字，
不從已存偏好回填，ADR-032；長期興趣是 Profile 的 `interestSelections`，經 `interestTagIds` 進入排課），用於計算各方案的偏好符合度並決定主推方案。未提供
任何一項時，主推方案改以總學分決定。**`preferEasyCourses` 與 `preferChallengingCourses`
方向相反，不得同時為 `true`**——兩者同時設定時（Roadmap #5B）排課引擎會把難度偏好視為
未表態並在 `warnings` 說明，不會猜測使用者真正的意思。

`noMidterm`／`noGroupReport`／`discussion`／`weightDaily`／`practicalExam`／`finalReport`／
`englishTaught`／`learnMore`／`noRollCall` 這些內容偏好是軟性偏好，不會排除課程：
判定依據是課程描述的關鍵字比對，命中會調整候選課的排序分數，未命中維持中性（不當成負面證據）。
候選池中某個已設定旗標的關鍵字命中率過低（<5%）或過高（>95%）時，`warnings` 會附上一條「訊號
可靠度」警告，說明這個偏好目前幾乎無法有效區分課程；未觸發門檻時不會有額外警告。詳見
`docs/SCHEDULING_LOGIC.md` 的「內容偏好評分與訊號可靠度警告」。

`allowRelaxation`／`timePreferencePriority`（Roadmap #21）：opt-in 放寬階梯的開關與順序，
預設 `allowRelaxation:false`（沒有任何現行呼叫端會設定，行為與改動前完全相同）。啟用後，
若方案的選修側因 `noMorningClasses`／`lunchBreakFree`／`avoidInstructors`／`noEveningClasses` 排掉太多候選、
導致湊不到學分下限，會依 `timePreferencePriority`（constraintId 陣列，例如
`["LUNCH_BREAK_FREE", "AVOID_INSTRUCTOR", "NO_MORNING_CLASSES", "NO_EVENING_CLASSES"]`；未提供時採用系統預設
順序）逐一放寬並重試，成功時回應會附上 `relaxedConstraints` 並在 `warnings` 揭露。這個機制
**獨立於**正式必修對這 4 項舒適偏好的無條件豁免——後者永遠生效，不需要這個旗標。`blockedPeriods`
永遠不會被這個機制放寬。詳見 `docs/SCHEDULING_LOGIC.md` 的「Hard/Soft Constraint Schema
（Roadmap #21）」。

Response 頂層額外回傳 `requestId`（本次排課請求的 UUID），每個 `plans[i]` 額外回傳
`planId`（格式 `requestId:variantId`）與 `variantId`（`required_first` 等產生策略）。
這是 Roadmap #2 的曝光事件用來指認「哪一次推薦的哪一個方案」的依據——先前只有
`plan.id`（variant 名稱），五個方案在不同次排課之間無法區分。識別碼由
`services/scheduleService.js` 的 `annotateScheduleIdentifiers()` 於請求層附加，
`skills/scheduler.js` 不參與；REST 與 Chat 兩條路徑共用同一份結果物件。
成功與失敗回應都帶識別碼。屬向後相容的欄位新增，既有欄位語意不變。

**成功時，伺服器會在回應之前自己寫入一筆 `recommendation_exposed` 互動事件**
（Roadmap #2 對抗式審查修正）——用的是伺服器剛算出來的 `schedule`／`excludedCourses`，
不是事後由 client 回報。這是唯一合法的曝光寫入點：`POST /api/interactions`
一律拒絕 client 提交這個事件類型，即使格式完全合法。寫入前會檢查
`personalization_learning` consent，未同意時單純不記錄，不影響排課回應；
寫入失敗同樣不影響排課回應（fail-open，比照評價查詢失敗的既有處理方式）。

Response 除既有欄位外，無解時額外回傳 `conflictSet`（結構化的限制違規清單，取代「只回傳
第一個錯誤字串」），格式為 `[{ constraintId, severity, relaxable, source, courses, reason }]`，
附加於 `message`／`warnings` 之外，不取代它們；透過放寬階梯成功時額外回傳
`relaxedConstraints: [{ constraintId, reason, order }]`。

Roadmap #22 的 bounded backtracking repair 會在主推 greedy baseline 未通過 validator，或所有
合法 baseline 都低於最低學分時啟動。預設總預算為 2 秒（包含決策組前處理），並回傳下列附加欄位：

| 欄位 | 語意 |
| --- | --- |
| `solver.status` | `solved`／`infeasible`／`timeout`／`data-insufficient`；`timeout` 不代表已證明無解 |
| `solver.repairAttempted` | 本次是否真的啟動 repair |
| `solver.resultSource` | 正式結果來自 `greedy`、`repair`，或沒有正式結果的 `none` |
| `solver.fallbackUsed` | repair 未完成時是否退回已經 validator 驗證的 greedy baseline |
| `solver.timeoutMs`／`elapsedMs` | repair 預算與實際耗時（毫秒） |
| `solver.nodesVisited`／`prunedNodes`／`seed` | 搜尋統計與可重現 seed |
| `solver.baseline` | repair 前主推 baseline 的成功、最低學分與偏好摘要；無 baseline 時為 `null` |
| `solver.improved` | 主推正式結果是否由 repair 取代 baseline |
| `solver.optimizationComplete` | 是否完整探索所有分支；找到第一個目標解時可能為 `false`，不表示結果未驗證 |
| `draftSchedule`／`draftUnscheduledCourses` | 沒有完整合法解時供澄清用的最佳部分組合；永遠不是正式成功課表 |
| `isDraft` | 是否存在上述草稿 |
| `unmetRequirements` | 未滿足項目，含 `type`、`courseIds`、`constraintIds`、`reason`、`adjustable` |
| `clarification` | `{ required, reason, questions, adjustableConstraintIds, relatedCourseIds }`，供 Chat 逐項追問 |

若 `success:false`，正式 `schedule` 與正式學分統計維持空／零；部分結果只能讀取
`draftSchedule`。若 repair timeout 但有通過 validator 的低學分 baseline，回應仍可
`success:true` 並以 `solver.fallbackUsed:true` 揭露，`unmetRequirements`／`clarification`
則保留最低學分缺口。沒有候選或指定必要課程 ID 不存在時使用 `data-insufficient`，不得誤報
`infeasible`。

### 限制條件合併語意

request 的 `constraints` 與使用者已儲存偏好由 `server/src/services/constraintService.js` 的 `buildScheduleConstraints()` 合併，REST 與 AI Agent 兩條路徑共用同一份邏輯。

- **陣列型參數**（`blockedPeriods`、`mustTakeCourseIds`、`avoidInstructors`）：送空陣列 `[]` 視同**未指定**，會退回已儲存偏好。
- **`preferredKeywords`、`interests`**（2026-11-23 起，ADR-032）：只取這次請求的值，不從已儲存偏好回填；空陣列或沒送就是沒有關鍵字。要覆蓋已儲存值必須送入非空陣列。此語意是為了避免前端每次都送出空陣列而靜默清空使用者的既有設定。
- **`courseHistory`**：不適用上述合併規則，**純直通、不接受 request 覆蓋**——`constraints.courseHistory` 一律等於 MySQL `User_Course_History` 載入的 `prefs.courseHistory`。查詢成功但 0 筆是合法空歷史；查詢失敗時 Profile、Schedule、Chat 與 Graduation 回 `503 COURSE_HISTORY_UNAVAILABLE`，不得以空陣列繼續。REST 與 AI Agent 都不能提交或覆蓋歷史修課。
- **`courseReviews`**（Roadmap #4）：與 `courseHistory` 同理，**純伺服器端注入、不接受 request 覆蓋**。`scheduleService.js` 從 `getAll('reviews')` 取得 `Course_Reviews` 全表後放進 `context`，request body 與 AI Agent 的 tool 參數都不含這個欄位——沒有任何管道能讓客戶端塞入捏造的評價分數。
- **布林型參數**：`false` 是有效值，會覆蓋已儲存偏好；只有 `null` 與 `undefined` 才會退回已儲存值。
- **`selectedCourseIds`、`watchingCourseIds`、`courseStates`**：屬於本次操作的當下狀態，不從已儲存偏好回填。
- **`mondayFree`**：會展開成週一第 1~14 節的 `blockedPeriods`，並與既有封鎖時段合併。
- **`blockedPeriods` 與 `noMorningClasses`**：兩者獨立判定、取聯集。`blockedPeriods`
  接受第 1～14 節（逐格指定星期），`noMorningClasses` 只影響第 1 節但涵蓋每一天。
  兩者可重疊，不互相推導：`blockedPeriods` 含第 1 節**不會**讓 `noMorningClasses`
  變成 `true`。（2026-08-11 前 `POST /api/profile` 會對含第 1 節的 `blockedPeriods`
  回 `400`，該限制已移除。）

Response:

```json
{
  "success": true,
  "schedule": [],
  "totalCredits": 18,
  "graduationCredits": 17,
  "nonGraduationCredits": 1,
  "courseCount": 6,
  "graduationPlanning": {
    "enabled": true,
    "remainingSemesters": 1,
    "remainingSemestersSource": "grade-and-active-term",
    "gaps": { "required": 2, "elective": 6, "general": 4, "external": 0 },
    "semesterTargets": { "elective": 6, "general": 4, "external": 0 },
    "selected": {
      "required": { "courses": 0, "credits": 0 },
      "elective": { "courses": 2, "credits": 6 },
      "general": { "courses": 2, "credits": 4 },
      "external": { "courses": 0, "credits": 0 }
    },
    "unavailableBuckets": [],
    "creditFloorTopUp": { "courses": 0, "credits": 0, "sectionIds": [] }
  },
  "message": "...",
  "plans": [],
  "excludedCourses": [],
  "warnings": [],
  "watchedCourses": [],
  "unscheduledCourses": [],
  "watchOnly": false,
  "preferenceProfile": { "interest": 1, "compact": 0, "easy": -1.4 },
  "preferenceProfileSource": {
    "learnedApplied": true,
    "reason": "applied",
    "modelVersion": "preference-learning-v2",
    "computedAt": "2026-09-04T02:38:14.334Z",
    "boosts": { "interest": 0, "compact": 0, "easy": 0.4 },
    "easyDirection": "challenge"
  },
  "hasExpressedPreference": true,
  "reviewDataLoaded": true,
  "draftSchedule": [],
  "draftUnscheduledCourses": [],
  "isDraft": false,
  "unmetRequirements": [],
  "clarification": {
    "required": false,
    "reason": null,
    "questions": [],
    "adjustableConstraintIds": [],
    "relatedCourseIds": []
  },
  "solver": {
    "status": "solved",
    "repairAttempted": false,
    "resultSource": "greedy",
    "fallbackUsed": false,
    "timeoutMs": 2000,
    "elapsedMs": 0,
    "nodesVisited": 0,
    "prunedNodes": 0,
    "seed": 0,
    "baseline": {},
    "improved": false,
    "optimizationComplete": true
  }
}
```

`preferenceProfile`（Roadmap #5B 起為**帶號連續值**）：三軸權重的絕對值決定該軸在
單門課排序及偏好符合度加權平均裡佔多少，**符號**決定涼度分數對這個人是加分還是扣分
——`easy` 為負代表使用者勾了 `#挑戰難課`，此時涼度分數越低（課越硬）符合度越高。
未表態的軸恆為 `0`；同時勾選 `#涼課優先` 與 `#挑戰難課` 時 `easy` 也會被歸零並在
`warnings` 說明矛盾。`preferenceProfileSource` 是附加的可觀察欄位，讓呼叫端不必解讀
`preferenceProfile` 的數值就能直接知道學到的權重是否套用：`reason` 為
`applied`／`absent`／`no-consent`／`insufficient`／`stale-model-version`／`unavailable`
之一，只有 `applied` 時 `boosts`／`modelVersion`／`computedAt` 才非 `null`。

`reviewDataLoaded`（Roadmap #4）表示這次排課是否取得了任何 `Course_Reviews` 資料。為 `false`
代表接線異常（呼叫端沒帶 `courseReviews` 或資料庫回空），不是「沒有評價可用所以正常忽略」——
此時所有課程的涼度一律以中性值計算，`warnings` 會明確告知。與成功與否無關，成功與失敗回應都會帶上。

`graduationPlanning`（Roadmap #23）說明這次排課採用的畢業缺口、剩餘學期、每學期目標與
實際排入的類別門數／學分。`enabled:false` 代表歷史修課、畢業規則或剩餘學期不足，系統
不會假裝有配額。它也會出現在每個方案中；多方案的類別門數必須與 S₀ 一致。

`graduationPlanning.externalInterestReservation`（2026-10-14 階段 4）：
`{source,candidateLimit:5,preferredCourses:[{courseCode,score}]}`。
`source` 為 `s_vec`、`no-consent`、`no-positive-signal`、`unavailable` 或舊政策 `keyword`。
清單為 greedy 可用系外候選中正 `s_vec` 的前五個不同課號，每系最多一門，班次不重複計數。
它表示優先嘗試清單，不保證全排入；`externalReservedForInterest` 表示有沒有額外保留系外名額，
最終排入仍看 `selected`。分數不加入候選／方案的既有計分。
context 僅由 server 建立，request body 不能指定政策、向量或分數；REST 與 Chat 共用。
`EXTERNAL_INTEREST_RESERVATION_MODE` 預設 `vector`，設 `keyword` 重現原關鍵字 A/B。
未同意、沒有正向證據或讀取失敗時不額外保留，但不刪除原有系外候選。

`graduationPlanning.totalGap`／`creditFloorOnly`（2026-10-02，出現在各方案的
`graduationPlanning`）：`totalGap` 是畢業門檻總學分減已取得總學分（沒有資料時為 `null`）；
`creditFloorOnly: true` 代表 `totalGap < minCredits`，本學期排到最低學分就停，不再照類別配額往上排。

`graduationPlanning.creditFloorTopUp`（2026-10-02）：配額排完後總學分仍低於 `minCredits` 時，
為達下限而另外補的課。`courses`／`credits` 是門數與學分，`sectionIds` 是補進來的班次。沒有補課時
三者為 `0`、`0`、`[]`。有補課時 `warnings` 另有一則
「本學期畢業缺口只需要部分學分；為達最低 N 學分，另補 M 門課…」。

`watchedCourses` 在成功與失敗回應中都會回傳。關注課程不佔時段、不計入衝堂，因此不會因為排課失敗而消失。

所有課程物件（課程搜尋與明細、排課結果、`excludedCourses`、`watchedCourses`、
`unscheduledCourses`、畢業建議及 AI Agent 工具結果）統一使用 `catalogCourseCode` 表示
正式課號。`subid3` 是 MySQL 欄位名，不再出現在 API 回應。這是欄位改名的 breaking
change；repository 外的呼叫端若曾讀取 `course.subid3`，必須改讀
`course.catalogCourseCode`。

`unscheduledCourses` 為已排入但**尚未排定上課時間**的課程（`time_str` 節次為 `00`）。它們計入 `totalCredits` 與 `courseCount`，但不在 `schedule` 內，因此不會出現在課表格上。

### 兩個學分數

`totalCredits` 是**學期修習學分**（用於 12～25 學分上下限），`graduationCredits` 是**計入畢業的學分**。
軍訓國防科技、體育、班級活動要排進課表但依校規不計入畢業學分
（見 `docs/COURSE_SELECTION_RULES.md` 第四節），兩者因此可能不同。

`schedule[]` 與 `unscheduledCourses[]` 的每個元素另含：

| 欄位 | 說明 |
| --- | --- |
| `countsTowardGraduation` | 此課學分是否計入畢業 |
| `nonGraduationCategory` | 不計入時的類別（`軍訓國防`／`體育`／`班級活動`／`系外選修未認列`），計入時為 `null` |
| `outsideElectiveRecognized` | 僅在使用者指定、但不符合系外選修認列條件時出現，值為 `false` |
| `outsideElectiveReasons` | 同上，不認列的原因清單 |
| `category` | **對這位學生解析後**的類別（`必修`／`核心選修`／`選修`／`通識`／`系外選修`） |
| `sourceCategory` | 資料庫原始的 `Courses.type`，僅在解析結果不同時出現 |
| `track` | 修課路徑（`嵌入式系統類`／`技術應用類`／`網路與安全類`），無歸類時為 `null` |
| `classGroup`／`classKind` | 班級 A～F 分組及結構化種類 |
| `eligibility`／`eligibilityReason` | 班級適用資格及可讀原因；`unknown` 不得宣稱確定可修 |
| `eligibilitySource`（Roadmap #20） | `eligibility` 結論套用的規則代號，供追查來源 |
| `term`（Roadmap #20） | `{ academicYear, semester, isActiveTerm }`，這門課自己的開課學期 |
| `scopeReason`（Roadmap #20） | 融合 term／類別／eligibility／系外選修認列結果的完整白話說明 |
| `easinessSource`（Roadmap #10） | 排序用涼度分數的來源：`reviews`（有實際評價）／`proxy`（無評價，依課程屬性推估）／`none`（兩者皆無）。**`proxy` 不是證據**——UI 與 Agent 只能說「依課程屬性推估」，不得說涼／好拿分。它也不會進入 `reviewCoverage` 或方案層 `preferenceBreakdown.easy`。詳見 `docs/SCHEDULING_LOGIC.md` 的「涼度來源」 |
| `recommendationReason`（Roadmap #26） | **這門課為什麼被推薦**的結構化理由，詳見下表。`reason` 那個字串仍保留（既有呼叫端在讀），這是它的證據版本，不是取代 |
| `reviewEvidence`（Roadmap #4） | 課程評價證據物件，`null` 代表這門課沒有評價，**不是** 0 分。有值時包含 `reviewCount`、`avgSweetness`／`avgCoolness`／`avgWorkload`／`avgOverall`／`avgDifficulty`／`avgRecommend`、`positiveCount`／`negativeCount`／`neutralCount`、`easiness`（1–5，未收縮）、`adjustedEasiness`（1–5，m-estimate 收縮後）、`easyScore`（0–100，排課實際採用）、`priorEasiness`、`shrinkagePriorWeight`、`source`。詳見 `docs/SCHEDULING_LOGIC.md` 的「涼度評分與評價覆蓋率」 |
| `formallyRequired`（Roadmap #21） | 布林，永遠存在（`true`／`false`）。`true` 代表這門課是這位學生本學期正式必修（`isRequiredForStudent()===true`），且排入時已無條件豁免 3 個時段類舒適偏好（不排早八／午休保留／不排晚課）；不含封鎖時段，也不含使用者手動指定的 `mustTakeCourseIds`。詳見 `docs/SCHEDULING_LOGIC.md` 的「Hard/Soft Constraint Schema（Roadmap #21）」 |
| `corequisiteCode`（Roadmap #15） | 字串或 `null`。有配對時為對應正課／實習的 `catalogCourseCode`；`null` 代表這門課沒有配對（含 P 後綴但候選池中找不到正課的例外情況） |
| `corequisiteRole`（Roadmap #15） | `'regular'`／`'internship'`／`null`。標示這門課在共同必修配對中的角色；`null` 代表不受共同必修規則影響。`excludedCourses`／`conflictSet` 可能出現 `constraintId: 'COREQUISITE_PAIR_INCOMPLETE'`，代表配對中的一方排不進去、兩者皆不排入。詳見 `docs/SCHEDULING_LOGIC.md` 的「共同必修（Co-requisite，Roadmap #15）」 |

`category` 與 `track` 的解析見 `docs/SCHEDULING_LOGIC.md` 的「課程類別解析」；`term`／
`eligibilitySource`／`scopeReason` 見同檔案的「Active Term」與「候選課程的可追溯
metadata」兩節。

### `recommendationReason` 的欄位（Roadmap #26）

| 欄位 | 說明 |
| --- | --- |
| `reasonVersion` | 理由結構的版本（目前 `2026-09-05.v2`）。同一個值會寫進 `Interaction_Events.recommendation_reason_version`，讓曝光事件能回溯「當時是用哪一版理由算的」 |
| `selectedBecause` | 主要原因代號：`REQUIRED_COURSE`／`RETAKE_REQUIRED`／`USER_SPECIFIED`／`COREQUISITE_PAIR`／`PREFERENCE_MATCH`／`CREDIT_FILL`／`WATCHING`。用代號不用自由文字，中文由呈現層決定 |
| `scoringPolicy` | 這個排序決策使用的版本化權重快照；必修預置、關注等不經一般 scorer 的放置路徑為 `null` |
| `scoreBreakdown` | 分數組成，`[{ component, value }]`，只列非 0 的元件。除既有 `base`／`requiredSelection`／`requiredCourse`／`category`／`credits`／`contentPreference`／`compact`／`easy`／`interest` 外，啟用標籤候選排序時可包含 `tagInterest`（標籤興趣對池內基礎分的加減量）；系所年級規則可包含 `crossYearElective`／`outsideOwnDepartment` |
| `scoreTotal` | 這門課在勝出方案裡的總分。**含**被 `scoreBreakdown` 過濾掉的 0 值元件 |
| `matchedPreferences` | 這門課實際命中的偏好，`[{ type, preferenceId, label, score }]`。`type` 為 `content`（內容偏好旗標）或 `interest`（興趣）。`interest` 的 `preferenceId` 有兩種：`interests` 是興趣關鍵字（含 AI 聊天單次排課的關鍵字），`label` 是關鍵字本身；`interestSelections`（2026-11-22 起，ADR-031）是課程主題問答勾選的標籤，`label` 是標籤名稱。**空陣列代表它沒有命中任何偏好**，不得解讀成「還沒算」 |
| `requiredRules` | 必修／分類的判定依據：`formallyRequired`、`category`、`sourceCategory`、`classificationSource`、`track`、`countsTowardGraduation`、`nonGraduationCategory` |
| `reviewEvidence` | 同上表的 `reviewEvidence`；`null` 代表沒有評價 |
| `easinessSource` | 同上表的 `easinessSource` |
| `constraintTradeoffs` | 排入這門課付出的代價，例如必修無條件豁免了時段偏好：`[{ type, label, because }]` |
| `alternativesRejected` | 見下方說明 |
| `confidence` | `high`／`medium`／`low`，由**證據完整度**決定：資格待確認或系所範圍無法解析 → `low`；涼度只是推估或完全沒有評價 → `medium`；其餘 `high` |
| `dataSources` | 這門課**實際查過**的來源。沒有評價的課不會列 `Course_Reviews` |

`alternativesRejected` 的 `status` 有三種，**不可混為一談**：

| `status` | 意義 |
| --- | --- |
| `had-competitors` | 有課在同一個決策點輸給它。`candidates` 為 `[{ sectionId, catalogCourseCode, name, scoreDelta, notScheduledBecause }]`，`notScheduledBecause` 是它最後不在課表的原因（通常是與勝出者衝堂） |
| `no-competitors` | **確實沒有其他課與它競爭**，不是還沒算 |
| `not-applicable` | 這條放置路徑不經過競爭（例如必修迴圈、關注課程） |

只記錄「在該決策點被比下去」的課。**被更早的硬限制擋掉的課不算落選者**——那是
`excludedCourses` 的 `constraintId` 在回答的問題。另外，當下排在後面、稍後自己也被
排入的課會在 `finalizePlan()` 被剔除（實測 demo 帳號 18 筆原始記錄裡有 16 筆屬於這種
情況），否則「A 輸給 B」會是假的。

`watchOnly` 為 `true` 時表示沒有任何正式加選課程排入，課表上只有關注課程。此情境的 `success` 仍為 `true`，因為關注課程本身是合法且可顯示的結果。

每個 `plans[]` 元素另含：

```json
{
  "variantId": "personalized_easy",
  "generationPolicy": {
    "version": "personalized-scoring-v1",
    "weights": { "interest": 1, "compact": 0, "easy": -2.1 },
    "categoryCoefficient": 0.35,
    "creditCoefficient": 1,
    "source": {
      "learnedApplied": true,
      "reason": "applied",
      "modelVersion": "preference-learning-v2"
    }
  },
  "stopWhen": "no-credit-progress",
  "preferenceScore": 0.214,
  "preferenceBreakdown": { "interest": 0.21, "compact": 0.25, "easy": 0.68 },
  "reviewCoverage": { "rated": 5, "total": 8, "ratio": 0.625 },
  "planTagScore": 0.35,
  "tagInterestCoverage": 0.75,
  "planTagMultiplier": 1.21,
  "combinedPlanScore": 0.259,
  "alphaPlan": 0.6,
  "freeChoiceCourseCount": 8,
  "evidenceCourseCount": 6
}
```

`generationPolicy` 是實際產生該方案的評分規則。系統先建立個人化綜合方案，再只為使用者
已表態的軸建立加重比較方案，最後建立較多學分方案，總數上限為 5；因此方案不是固定五種，
呼叫端不得從 `variantId` 猜測使用者偏好。`stopWhen` 為 `no-credit-progress` 或
`candidate-exhausted`。`plans` 先依 `success` 與是否達最低學分排序；標籤排序為 `active` 且 profile
可用時，再依 `combinedPlanScore`，其餘模式依 `preferenceScore`，最後以 `totalCredits` 排序。
`preferenceScore` 一律用原始使用者權重計算，不讓加重策略替自己評分；標籤合併分不覆寫它。
`plans[0]` 即主推方案，其內容會複製到頂層 `schedule`。若主推方案有標籤興趣證據，頂層 `message`
會以「偏好與標籤興趣合併分」說明排序依據；沒有標籤證據時仍顯示既有偏好或學分依據。

`active` 且標籤 profile 可用時，每個方案會多回傳 `planTagScore`、`tagInterestCoverage`、
`planTagMultiplier`、`combinedPlanScore`、`alphaPlan`、`freeChoiceCourseCount` 及
`evidenceCourseCount`。`planTagScore` 是有興趣證據的自由選擇課程分數平均；必修、重補修、使用者
固定選擇與關注課不納入。`tagInterestCoverage` 是有證據的自由選擇課數除以自由選擇課數；沒有自由
選擇課時為 `null`。沒有任何可計分課時 `planTagScore` 為 `null`、倍率為 1、合併分等於原
`preferenceScore`。`shadow` 僅在伺服器 log 記錄方案分布及假想名次變動的彙總，不在 API 回應中暴露
單一方案分數；`off` 不讀取或計算標籤方案分數。

方案倍率使用獨立的 `alphaPlan`（預設 0.6，範圍 0～1）：

```text
planTagMultiplier = 1 + alphaPlan × planTagScore
combinedPlanScore = preferenceScore × planTagMultiplier
```

例如 `preferenceScore=0.5`、`planTagScore=+0.8` 時，倍率為 1.48、合併分為 0.74；標籤分為
`−0.8` 時倍率為 0.52、合併分為 0.26。方案硬性成功狀態與最低學分判斷仍排在標籤及偏好軟性分數之前。

`preferenceBreakdown.easy`（Roadmap #4）改為由已排入且**有評價**課程的 `adjustedEasiness` 平均而得，
不再是課程描述關鍵字命中率。**可能為 `null`**——代表這個方案排入的課全部沒有評價，無法評分，
此時該軸連同權重一起從 `preferenceScore` 的加權平均中排除，不會以 0 分拉低分數。

`reviewCoverage`（Roadmap #4）說明 `preferenceBreakdown.easy` 是由幾門課推出來的：`rated` 為方案中帶
`reviewEvidence` 的課程數、`total` 為方案總課程數、`ratio` 為兩者比值。「涼度 68%」與「涼度 68%但只
由 1／8 門課推得」是完全不同的兩件事，只讀 `preferenceBreakdown.easy` 而不看 `reviewCoverage` 會誤判
可信度。

### `planMetrics`（Roadmap #27）

每個 `plans[]` 元素另含 `planMetrics`，是方案比較 UI 要用的指標，**在後端算好、前端不重算**——
`usedDays` 沿用 `getCompactness()` 判斷「用了幾天」的同一份邏輯（`getUsedDays()`），
避免前端從 `timeBlocks` 自己再數一次而與偏好符合度算出不同答案：

```json
{
  "courseCount": 8,
  "scheduledCourseCount": 8,
  "totalCredits": 23,
  "graduationCredits": 23,
  "usedDays": 5,
  "morningCourses": 0,
  "eveningCourses": 0,
  "gapPeriods": 0,
  "preferenceScore": 0.333,
  "preferenceBreakdown": { "interest": 0, "compact": 0.33, "easy": 0.72 },
  "reviewCoverage": { "rated": 1, "total": 8, "ratio": 0.125 },
  "planTagScore": 0.35,
  "tagInterestCoverage": 0.75,
  "planTagMultiplier": 1.21,
  "combinedPlanScore": 0.403,
  "alphaPlan": 0.6,
  "freeChoiceCourseCount": 8,
  "evidenceCourseCount": 6
}
```

`morningCourses`／`gapPeriods` 的節次界線與 `constraintSchema.js` 的
`NO_MORNING_CLASSES`／`LUNCH_BREAK_FREE`／`NO_EVENING_CLASSES` 判定共用同一組常數
（`MORNING_LAST_PERIOD`／`LUNCH_PERIOD`／`EVENING_FIRST_PERIOD`），不是另一份定義。
`gapPeriods` 只算「當天第一節到最後一節之間沒課的節次」，不含上課日之前或之後的空檔——
「早上沒課」是使用者要的結果，不算空堂。

`preferenceScore`／`preferenceBreakdown`／`reviewCoverage` 與 plan 本身同名欄位完全相同；若啟用標籤
方案排序，`planTagScore`、`tagInterestCoverage`、`planTagMultiplier`、`combinedPlanScore`、
`alphaPlan`、`freeChoiceCourseCount` 及 `evidenceCourseCount` 也會同步列在 `planMetrics`，讓前端只讀
`planMetrics` 就能組出方案比較表。

### `planDiversity`（Roadmap #27）

頂層新增 `planDiversity`，是「方案塌縮」的結構化版本——原本這件事只以中文句子存在於
`warnings`（見下方 `已合併` 範例），前端要顯示「實際方案數與重複原因」只能 parse 字串。
現在同一份資料同時有結構化欄位與句子兩個出口，句子由結構產生，不是兩份各自維護：

```json
{
  "requestedVariants": 4,
  "distinctPlans": 2,
  "reason": "same-course-combination",
  "collapsed": [
    { "variantId": "personalized_compact", "title": "更集中排課" },
    { "variantId": "personalized_credits", "title": "較多學分方案" }
  ],
  "competablePoolSize": 16
}
```

`requestedVariants` 是這次實際嘗試的策略數，不保證為 5。`reason` 在課程集合重複時為
`same-course-combination`，沒有塌縮時為 `null`；重複只能證明策略得到相同組合，不能單憑
這個欄位推論候選池不足。失敗回應（`success:false`）也會帶這個欄位；`collapsed` 沒有
塌縮時為空陣列，不是 `null`。

**2026-09-19 起（Roadmap #10 任務 1）**：替代方案改由 HiGHS MILP 產生，`requestedVariants`
固定為 4（S₀ 加三個主軸），每個 `collapsed` 項目帶 `reason`，另有 `solver` 摘要：

```json
{
  "requestedVariants": 4,
  "distinctPlans": 3,
  "reason": "milp-candidate-unavailable",
  "collapsed": [
    { "variantId": "personalized_interest", "title": "興趣導向方案", "reason": "no-signal",
      "detail": "threshold-unreachable" }
  ],
  "competablePoolSize": 218,
  "solver": {
    "method": "dinkelbach-milp",
    "status": "generated",
    "elapsedMs": 1240,
    "axes": [
      { "archetype": "easy", "status": "generated", "reason": null, "candidateCount": 1,
        "candidates": [{ "ratio": 75.0, "qualityRetention": 1,
          "distanceFromBase": { "removed": [], "added": [], "hammingDistance": 8, "replacementDistance": 4 },
          "convergence": { "converged": true, "reason": null, "iterations": 2, "residual": 0,
            "initialSolution": "quality-optimal" },
          "category": "optimal" }] },
      { "archetype": "interest", "status": "no-signal", "reason": "no-signal",
        "detail": "threshold-unreachable", "candidateCount": 0 }
    ]
  }
}
```

`collapsed[].reason` 可能值：`no-signal`、`rating-coverage-infeasible`、
`axis-threshold-infeasible`、`insufficient-difference`、`quality-floor`、
`credit-parity-infeasible`、`hierarchy-parity-infeasible`、`combined-constraints`、`solver-time-limit`、
`solver-budget-exceeded`、`solver-unavailable`、`candidate-check-failed`、`selection-error`。
不可行時 `solver.axes[].diagnosis` 列出 `resolvedBy`（只放寬哪一組限制就可行）。

**2026-10-01 起（Roadmap #10 任務 2）**：方案挑選改採 Danna & Woodruff (2009) 的 D_bin 目標並以
窮舉精確求解（規則見 `docs/SCHEDULING_LOGIC.md`）。回應新增三件事：

1. `collapsed[]` 的新代碼：
   - `reason: "candidate-check-failed"`：求解器給了候選，但全部沒通過單一方案檢查。`detail` 為
     `validator-rejected`、`model-check-rejected` 或 `mixed`。
   - `reason: "insufficient-difference"` ＋ `detail: "too-similar-to-selected"`：這條主軸排得出
     合法方案，只是與已選的方案換課不到兩門。此時**另帶** `conflictsWith`。
     （不帶 `detail` 的 `insufficient-difference` 意義不變：求解器在限制內換不出兩門課。）
   - `reason: "selection-error"`：挑選步驟的輸入契約被違反，退回只有 S₀；細節在
     `solver.subsetSelection.error`。
2. `collapsed[].conflictsWith`：**陣列**，元素是 `{ "variantId", "title" }`，指向畫面上實際顯示、
   與這條主軸太像的方案（可能包含綜合平衡方案）。只在 `too-similar-to-selected` 時出現，
   其他情況**沒有這個 key**。前端直接用 `title` 組句子，不需自行對照。
3. `solver.subsetSelection`：挑選步驟的診斷。`solver.method` 仍是候選的**產生**方法
   （`dinkelbach-milp`），兩者不混用。

```json
{
  "collapsed": [
    { "variantId": "personalized_compact", "title": "集中排課方案",
      "reason": "insufficient-difference", "detail": "too-similar-to-selected",
      "conflictsWith": [{ "variantId": "personalized_interest", "title": "興趣導向方案" }] }
  ],
  "solver": {
    "method": "dinkelbach-milp",
    "subsetSelection": {
      "method": "dbin-exact-enumeration",
      "objective": { "planCount": 3, "dBin": 0.0268, "pairwiseHammingSum": 18 },
      "b": 224, "evaluated": 4, "feasible": 4, "elapsedMs": 0.5,
      "rejectedCandidates": [{ "archetype": "easy", "stage": "validator" }]
    }
  }
}
```

`objective.dBin` 在只有一份方案時為 `null`（公式分母為 0，未定義）。`b` 是不重複的競爭課號數。
`evaluated` 是搜尋空間大小、`feasible` 是其中滿足距離限制的組合數；兩者相等代表候選之間沒有
衝突。`rejectedCandidates[].stage` 為 `validator` 或 `model-check`。未注入求解器時沒有
`subsetSelection`。

`reason` 為 `no-signal` 時另帶 `detail`，說明是哪一項資料條件不成立：
`no-interest-keywords`、`no-easiness-baseline`、`insufficient-rating`、`flat-scores`、
`threshold-unreachable`（主軸門檻超出「固定課 ∪ 競爭課」的可達範圍，做不到比 S₀ 更好）、
`single-day`、`fixed-days-blocked`。**前端在 `detail` 有更精確說法時優先依 `detail` 顯示**：`threshold-unreachable` 顯示「綜合方案已達目前課程資料可改善的界線，無法再產生有意義的主軸改善」，其餘 `no-signal` 才顯示「候選課缺少可區分的資料」（`client/src/components/Schedule/PlanSwitcher.jsx`）。
**2026-11-23 起**：興趣導向方案的 `reason` 為 `axis-threshold-infeasible`、且綜合方案本身已有興趣命中時，`detail` 為 `base-already-best-interest`，前後端顯示「綜合方案已經是最符合你興趣的組合，再排一份只會是重複的課表」（判斷式 `scheduler.js` 的 `collapseDetailFor()`）。

MILP 方案另帶：

- `comparisonToBaseline`：相較 S₀ 的 `removed`／`added`、`hammingDistance`、
  `replacementDistance`、`utility`、`baselineUtility`、`qualityRetention`（`1 − d/qualityScale`）、
  `axisValue`、`usedDays`、`bindingConstraints`。
- `milpSolver`：`method`、`category`（`optimal`／`limit-with-solution`…）、`rawStatus`（HiGHS 原始
  狀態字串）、`approximate`、`convergence`、`trace`（每輪 λ、耗時、N̂、D̂、殘差、暖啟動狀態）。
- `milpChecks`：獨立驗證器與 `milpPlanChecks` 的結果，後者另回傳跨年級／系外
  `hierarchyCounts`。品質效用排除 `base`、`crossYearElective`、`outsideOwnDepartment`；兩個
  階層項改由與 S₀ 相同門數的硬限制保護。

頂層另新增 `recommendedPlanId`（推薦方案，恆等於 `plans[0]`；經 service 後為 `planId`）與
`displayOrder`（方案顯示順序）。舊的 `personalized_credits` 與各軸 ×1.5 方案已移除。

### `POST /api/schedule/counterfactual`（Roadmap #27）

「取消某項偏好，課表會怎麼變」。**獨立端點，不併入 `/generate`**——實測候選池放大後
（`#13C` 解決後的規模）一次完整排課約 289ms，若把使用者目前開啟的每項偏好都逐一重排，
單次請求會變成數百 ms 到數秒；多數使用者不會展開比較面板，讓每次排課都付這個代價不划算。

Request（與 `/generate` 同一組輸入形狀）：

```json
{
  "courseIds": [],
  "filters": {},
  "constraints": { "maxCredits": 25, "minCredits": 12 }
}
```

伺服器端用同一組輸入**自己重跑一次基準**，不接受前端傳課表進來比對——那份宣稱是瀏覽器
自己說的，用來當「取消偏好前後有沒有差」的基準不可信。

Response：

```json
{
  "baseline": { "planId": "req-1:required_first", "variantId": "required_first" },
  "competablePoolSize": 16,
  "counterfactuals": [
    {
      "preferenceId": "preferCompact",
      "label": "盡量集中排課",
      "status": "unchanged",
      "removed": [],
      "added": [],
      "reason": "取消這項偏好後，排出來的課表完全相同——可競爭的課程只有 16 門，候選課程用完就停了，這項偏好沒有可以發揮的空間。"
    },
    {
      "preferenceId": "lunchBreakFree",
      "label": "午休務必空出",
      "status": "not-applicable",
      "removed": [],
      "added": [],
      "reason": "你目前沒有開啟這項偏好。"
    }
  ],
  "reviewDataLoaded": true
}
```

`status` 三態，理由與 `recommendationReason.alternativesRejected.status` 同一個原則——
空陣列會讓「算過、沒有差異」與「沒算」長得一樣，所以要有明確的狀態值：

| `status` | 意義 |
| --- | --- |
| `changed` | 取消這項偏好，主推方案確實會換課；`removed`／`added` 為 `[{ sectionId, catalogCourseCode, name, credits }]`，並附 `metricsDelta`（`planMetrics` 幾個欄位的差值） |
| `unchanged` | **算過了，確實不會變**，`reason` 說明原因（例如可競爭課程數不足） |
| `not-applicable` | 使用者目前沒有開啟這項偏好，沒有「取消」這件事可談 |

只對使用者**目前開著**的偏好計算 `changed`／`unchanged`；沒開的一律 `not-applicable`，
不會浪費一次重排去確認「開啟一個沒開的偏好會怎樣」——那不是這個端點要回答的問題。

這條路徑**不寫任何互動事件、不記曝光**——使用者只是在問假設性問題，沒有推薦被曝光。

### `POST /api/schedule/validate`

Request:

```json
{
  "courses": [],
  "constraints": {}
}
```

`constraints` 為 Roadmap #21 新增的可選欄位，省略或傳空物件 `{}`（目前唯一的實際呼叫
模式——`client/src` 尚未呼叫這支端點）皆可。

Response（`valid`／`conflicts`／`duplicates`／`totalCredits`／`graduationCredits`／
`nonGraduationCredits` 為既有欄位，語意不變）：

```json
{
  "valid": true,
  "conflicts": [],
  "duplicates": [],
  "totalCredits": 18,
  "graduationCredits": 17,
  "nonGraduationCredits": 1,
  "hardConstraintsValid": true,
  "violations": [],
  "unchecked": ["SAME_SERIES_SAME_TERM", "PREREQUISITE", "COREQUISITE"]
}
```

`duplicates` 為同一門課的多個班次（以 `catalogCourseCode` 課號判定），例如兩門不同老師開的「計算機演算法」。學生只能選一個班次，因此即使時段不衝突也屬不合法，`valid` 為 `false`。`conflicts` 與 `duplicates` 的元素皆為 `{ course1, course2 }`。

**Roadmap #21，2026-08-20 起一律執行**（Codex adversarial review 修正——原本只在
`constraints` 非空時才額外檢查，導致只送 `{courses}` 的呼叫完全繞過了不需要
`constraints` 就能檢查的規則，例如共同必修配對完整性）：呼叫
`server/src/skills/scheduleValidator.js` 的 `validateScheduleAgainstConstraints()`，
附加 `hardConstraintsValid`／`violations`／`unchecked` 三個欄位（不取代上述既有欄位）：

```json
{
  "hardConstraintsValid": false,
  "violations": [
    { "constraintId": "CREDIT_CEILING", "severity": "hard", "relaxable": false,
      "source": "user:numeric-limit", "confidence": 1, "courses": [], "reason": "課表共 28 學分，超過上限 25 學分" }
  ],
  "unchecked": ["SAME_SERIES_SAME_TERM", "PREREQUISITE", "COREQUISITE"]
}
```

這個檢查涵蓋衝堂、重複班次、學分上限、資格／學期／系外選修／已修過的 metadata 複查、
4 個時段類硬性限制、必修涵蓋率、共同必修配對完整性（Roadmap #15），比既有的 `valid`
（只查衝堂與重複班次）範圍更完整。

`unchecked` 永遠包含 `PREREQUISITE`／`COREQUISITE`（先修／共修，見 Roadmap #21）——這
兩項專案裡完全沒有資料來源可查。2026-09-18 起也永遠包含 `SAME_SERIES_SAME_TERM`：同一
系列的 (一)(二) 不排同學期是排課時依課名推測的規則，validator 刻意不複查。**`COREQUISITE_PAIR_INCOMPLETE`（Roadmap #15）只在
送入的課程物件完全沒有任何一門帶 `corequisiteRole` 欄位時才會出現在 `unchecked`
裡**——這個欄位只由 `generateSchedule()` 產出的課表天生帶著；外部直接組出來、沒有這
個欄位的原始課程物件無法讓 validator 安全判斷哪些課「應該」有搭檔（`catalogCourseCode`
的 `P` 後綴規則有真實例外，見 `docs/DATA_SCHEMA.md`），因此**不會**用課號猜測配對關
係，寧可誠實回報未檢查，也不假裝檢查過而誤判合法課表。只要把 `generateSchedule()`
產出的課表（或至少保留其 `corequisiteRole`／`corequisiteCode` 欄位）原樣送回
`/validate`，這項規則就會確實執行。

此檢查**不套用**正式必修對時段偏好的無條件豁免（沒有 scope 可用）；只有課程物件已帶
`formallyRequired: true` 標記（來自 `generateSchedule()` 自己產出的課表）時才會豁免，
外部直接提供的課表一律照嚴格規則檢查。詳見 `docs/SCHEDULING_LOGIC.md` 的「Hard/Soft
Constraint Schema（Roadmap #21）」與「共同必修（Co-requisite，Roadmap #15）」。

### `POST /api/schedule/save`

需要登入及服務處理同意。前端附上目前登入的學號，伺服器仍以 session 驗證身分。

```json
{
  "userId": "D0009007",
  "name": "我的課表",
  "schedule": [],
  "totalCredits": 18
}
```

有 MySQL 時存入 `Saved_Schedules`。未設定 MySQL 時以本機 JSON 保存。

前端於課表成功變更後自動保存。載入既有快照時不重複寫入。同一個瀏覽器頁面依序保存新快照，未送出的中間版本可由最新版本取代。

### `GET /api/schedule/saved`

只回傳登入帳號的已存課表。可附 `?userId=學號` 核對前端身分，與 session 不符時回傳 `403`。
成功回應帶 `Cache-Control: private, no-store`。

### `GET /api/schedule/avoidances`、`PUT /api/schedule/avoidances/:sectionId`

需要登入及服務處理同意。GET 讀取目前登入帳號的避開課程，PUT 以 `{ "avoid": true }` 加入，或以 `{ "avoid": false }` 解除。回傳 `{ "avoidances": [{ "sectionId": 123, "catalogCourseCode": "COURSE1", "courseName": "課名" }] }`。新增時由伺服器查班次取得課號及名稱，排課依已存設定排除，無課號時僅避開該班次。

## Chat

### `GET /api/chat/history`

回傳登入者最近 50 則尚未過期的聊天文字，按時間由舊至新排列。使用者須同意當前版本的服務處理。紀錄沿用聊天資料的 30 天保留期限，使用者可從隱私設定清除。回應以 `Cache-Control: no-store` 禁止快取。

```json
{
  "messages": [
    { "role": "user", "content": "週一上午不要排課", "createdAt": "2026-11-24T02:00:00.000Z" },
    { "role": "assistant", "content": "可以，這次規劃會避開週一上午。", "createdAt": "2026-11-24T02:00:00.001Z" }
  ]
}
```

`messages` 無紀錄時為空陣列。每則訊息含角色、文字及時間。未登入回 `401`，未同意當前版本資料用途回 `428`。

### `POST /api/chat`

聊天預設回傳 JSON。以 `Accept: text/event-stream` 送出相同請求時，伺服器在驗證登入、同意及訊息後開啟事件串流。每筆事件的 `data` 為單行 JSON。

| 事件 | 內容 |
| --- | --- |
| `progress` | `id`、`title`、選填的 `detail`、`state`（`running`、`done`、`failed`）。相同 `id` 更新同一步。偏好寫入成功時可附 `preferencesUpdated: true`。 |
| `result` | 與一般 JSON 回應相同。收到後串流結束。 |
| `error` | 串流開始後發生的錯誤，含 `message`。串流前的驗證錯誤仍使用原有 HTTP 狀態與 JSON。 |

換課工具回傳的候選只代表伺服器查到可替代班次。首頁先驗證整份課表，再一次套用替換。畫面確認課表更新後才顯示換課成功。串流中斷時由使用者確認目前狀態後重試。

Request:

```json
{
  "message": "幫我排課",
  "planningContext": {
    "requestId": "…",
    "activePlanId": "…",
    "activeVariantId": "…",
    "currentCourses": [{ "sectionId": 101 }],
    "selectedCourses": [{ "sectionId": 101 }],
    "plans": [{ "id": "personalized", "title": "個人化綜合方案" }],
    "selectedVariantId": "personalized",
    "removedCourses": [{ "sectionId": 102, "reason": "workload" }]
  }
}
```

`planningContext` 是選用的：使用者畫面上目前留著哪些課、本次移除了哪些課、原因是什麼。
少了它，Agent 只能反問它其實問得到的資料。
`selectedCourses` 是選用的手動加選班次清單，每筆只含 `sectionId`，必須同時出現在 `currentCourses`。
若提供清單，Agent 重排使用此清單作為手動保留班次。範圍不明的偏好會先回覆問題，既有課表和帳號偏好維持原狀。
由首頁明確使用 `preference_regenerate` 執行「套用偏好排課」時，排課會使用帳號目前尚有效的聊天單次條件，成功後清除。
`plans` 可帶本次畫面至多八個可切換方案，每筆為唯一的 `id` 和 `title`。
`selectedVariantId` 對應目前選中的方案，供聊天中的比較與切換使用。
Agent 操作準備成功時，`intent` 會是 `manage_schedule`，`data.scheduleAction` 帶操作代號及核對過的班次或方案。
前端複查課表仍是同一份，再套用操作並依實際結果顯示成功或衝突。

**只收 ID 與原因代號。** 課名、課號、教師一律由伺服器從 `Courses` 重查
（`services/planningContextService.js`）——那些字串會進 system prompt，
由呼叫端提供等於讓它決定「避開的到底是哪門課」，也能把任意文字塞進 prompt。
`reason` 的值域與 `POST /api/interactions` 的 `feedbackReason` 完全相同。

`scope`（避開範圍）與 `pendingReason`（原因是否還沒問到）**不接受呼叫端指定**，
由伺服器依 `reason` 推導；送了也會被忽略。對照表見
`docs/SCHEDULING_LOGIC.md` 的「本次規劃的避開清單」。

這份資料只能變成兩種東西：本次排課的 request-scoped 限制，以及 prompt 裡的事實敘述。
它**不會**寫入 `Interaction_Events`、不構成曝光證明，也不會放寬
`record_schedule_feedback` 的來源驗證。

Response:

```json
{
  "reply": "...",
  "intent": "run_csp_scheduler",
  "data": {},
  "planningContextStatus": "accepted"
}
```

| 欄位 | 說明 |
| --- | --- |
| `reply` | 要顯示給使用者的文字。 |
| `intent` | 這次請求中**最後一個成功**的工具名稱；沒有任何工具成功時為 `general_chat`，呼叫模型本身失敗時為 `error`。 |
| `data` | 最後一個成功的**可渲染**工具結果（`query_course_db`、`search_dcard_reviews`、`run_csp_scheduler`、`get_easy_courses`、`swap_course`），否則為 `null`。換課時為 `{ success: true, swap: { removeSectionId, addSectionId, addCourse }, courses }`，前端移除 `removeSectionId`、加入完整課程物件 `addCourse`（ADR-036）。 |
| `planningContextStatus` | `accepted`／`rejected-invalid`／`temporarily-unavailable`，見下表。 |
| `preferencesUpdated` | 選填。這次對話中 Agent 成功寫入了已存的排課偏好（ADR-036）或課程主題勾選（ADR-037）時為 `true`，前端應重抓 `GET /api/profile` 更新左側偏好與主題摘要。 |

**`planningContext` 不合法不會讓整次對話失敗。** 它住在瀏覽器的 `sessionStorage`，
會因為部署升版、開著沒關的舊分頁、瀏覽器資料損壞而變成舊格式；回 400 的話使用者的
**每一則訊息**都會失敗，直到他自己想到要清 storage。只有 `message` 不合法才回 400。

| `planningContextStatus` | 意義 | 前端應有的行為 |
| --- | --- | --- |
| `accepted` | 正常採用（沒送 `planningContext` 時也是這個值） | 照常 |
| `rejected-invalid` | 格式不合法：舊版本殘留或資料損壞 | **清除**本地的避開清單 |
| `temporarily-unavailable` | 後端暫時查不到課程資料等暫時性問題 | **保留**避開清單，本次不採用，之後可重試 |

未通過驗證的內容一律不會用來組 prompt 或當成排課限制——丟棄就是整包丟棄，不做部分採用。


**工具被拒絕時不會出現在 `intent` 或 `data` 裡。** Agent 的工具有伺服器端驗證
（例如 `record_schedule_feedback` 會對照推薦曝光紀錄），被拒時只回一個 `{ error }`
給模型自行修正。若這兩個欄位照樣帶上該工具名稱，等於對呼叫端宣稱一件沒有發生的事
——例如顯示「已記錄你的回饋」，但資料庫裡一筆都沒有。因此
`agentService.applyToolOutcome()` 只在工具成功時更新它們。

`data` 帶的是**完整、未經任何信封包裝的原始結果**——Roadmap #25 新增的
tool result 信封（`schemaVersion`／`dataSource`／`term`／`warnings`／`errorCode`）
**只包在送給模型的那一份**，不影響這個欄位。送進模型的是投影後再包信封的版本
（見 `docs/PROMPT_DESIGN.md` 的「排課結果必須先投影」與「工具結果信封」）。

## Profile

### `GET /api/profile`

從 session 的 canonical student ID 讀取 `User_Profiles`。Response 固定包含
`schemaVersion: 1`；資料庫 migration 尚未套用時，後端會把既有 v0 row 正規化成 v1 response。

回應保留完整 `className`，並由後端共用 `parseClassName()` 產生課程搜尋範圍：

```json
{
  "schemaVersion": 1,
  "studentId": "D1249697",
  "className": "資訊三甲",
  "courseSearchScope": {
    "department": "資訊工程學系",
    "grade": 3,
    "className": "甲"
  }
}
```

完整班級缺少或無法解析時，`courseSearchScope` 的三個欄位均為 `null`。

`interestSummary` 由已保存的 `interestSelections` 和正規化標籤目錄產生。它帶有
`directions`（`group`、`categoryId`、`title`、`categoryLabel`）與
`topics`（`group`、`categoryId`、`tagId`、`name`、`duplicate`）。同一個標籤 ID
從第二次出現起標為 `duplicate: true`。舊資料中目錄外的方向顯示為「舊版課程方向」，
目錄外的標籤不列入摘要。這份摘要直接由目錄組成，候選池可用性仍由
`POST /api/profile/interest-questions` 的 `stage: "summary"` 在作答時判斷。

設定頁或首頁排課偏好成功保存後，首頁用現有的 `POST /api/schedule/generate`
以 `surface: "dashboard"`、`trigger: "preference_regenerate"` 發出一次排課，
並以回傳的方案更新課表。首次設定仍會先走探索流程。

### `POST /api/profile/interest-followups`

設定頁「想接觸的課程主題」的追問題目（2026-11-20 起）。學生勾選類別、按「完成並保存偏好設定」之後，每個類別問一題，
學生勾選的**具體標籤**才會得到 S_tag 先驗（類別本身不展開）。需要登入與服務同意；每位使用者每分鐘最多 6 次
（超過回 `429`、`code: "RATE_LIMITED"`）。

Request（`department`、`gradeLevel`、`className` 用來重建這位學生的候選池，與 `GET /api/courses/interest-options` 相同；
一次最多 6 個分類，重複的 `(group, categoryId)` 只留一筆）：

```json
{
  "department": "資訊工程學系",
  "gradeLevel": 3,
  "className": "資訊三甲",
  "selections": [{ "group": "outside", "categoryId": "main_…" }]
}
```

Response：

```json
{
  "followups": [
    {
      "group": "outside",
      "categoryId": "main_…",
      "categoryName": "語言、文學與溝通",
      "question": "你想接觸哪些語言、文學或溝通主題？",
      "source": "gpt",
      "totalTagCount": 29,
      "options": [
        { "tagId": "tag_…", "name": "日語", "courseCount": 1, "sampleCourses": ["日語短劇"], "previouslySelected": false }
      ]
    },
    { "group": "outside", "categoryId": "main_不存在", "unavailable": true, "reason": "category_not_in_pool" }
  ],
  "scopeReady": true,
  "mode": "gpt"
}
```

- **選項一律來自後端的清單**：這位學生候選池裡該類別的可選標籤（同時可學習且可跨課配對），依課程數排序取前 20 個
  當候選，學生最多看到 12 個。每個選項附代表課程與課程數（前端顯示「會加分給 N 門課」）。**學生以前選過、仍然
  有效的標籤一律重新顯示**（`previouslySelected: true`），不受 12 個上限與排序影響，否則舊答案無法編輯。
- **GPT 只寫問題與調整順序**，不能新增、改名、翻譯或移除標籤；回傳的編號不在清單內的丟掉、漏掉的依課程數補在後面。
  提示詞要求把工具與軟體名稱（PowerPoint、Chat GPT）、泛用詞與只是課堂附帶提到的主題排在最後（見
  `docs/PROMPT_DESIGN.md`）。送給 OpenAI 的只有**類別名稱、標籤名稱與課程數**，沒有使用者 ID、Profile、歷史、系所或班別。
- `source` 是 `gpt` 或 `fixed`。**固定問句後備**：沒有 `OPENAI_API_KEY`、`INTEREST_FOLLOWUP_MODE=fixed`、逾時（12 秒，
  不重試）、呼叫失敗、輸出格式不對、題目過長或含網址，該類別改用「『類別』裡你對哪些主題有興趣？」，選項來源與流程相同。
  頂層 `fallbackReason` 為 `mode_fixed`、`no_api_key`、`gpt_timeout`、`gpt_error` 或 `partial_gpt_output`；**追問失敗不回錯誤，
  也不能擋住保存**。
- 題目依「類別＋候選標籤」快取在伺服器記憶體 24 小時，所有使用者共用（內容沒有個人資料）。失敗不快取。
- 分類不在這位學生這一組的候選池時，該筆回 `unavailable: true`、`reason: "category_not_in_pool"`；班別沒選好時回
  `{ "followups": [], "scopeReady": false }`。
- 錯誤：`400`（欄位缺漏或型別錯誤，例如 `selections 最多 6 筆`）、`429`（限流）。

### `POST /api/profile/interest-questions`

設定頁「想接觸的課程主題」的逐題問答（課程主題問答 v1，ADR-027，2026-11-22 起取代設定頁的三組分類按鈕與上面的追問對話框；
`/interest-followups` 保留，但設定頁已不再呼叫）。一次出一題，選項由後端從這位學生的候選池選好，語言模型只改寫文案。
需要登入與服務同意；每位使用者每分鐘最多 30 次（超過回 `429`、`code: "RATE_LIMITED"`）。不讀這位使用者的 Profile。

共通欄位：`department`、`gradeLevel`、`className`（重建候選池，與 `GET /api/courses/interest-options` 相同）與 `stage`。

**`stage: "group"`**：本系、通識、系外各一題，每批最多 3 個方向。

```json
{ "department": "資訊工程學系", "gradeLevel": 3, "className": "資訊三甲",
  "stage": "group", "group": "department", "seenOptionIds": [] }
```

```json
{
  "stage": "group", "group": "department", "scopeReady": true,
  "question": "如果下學期多修一門本系選修，你想深入哪些方向？",
  "options": [
    { "categoryId": "curated_ai", "aliasIds": [], "level": "sub", "title": "讓電腦從資料中學習",
      "description": "了解模型怎麼辨識圖像、理解文字或做預測。", "categoryLabel": "人工智慧",
      "topics": ["機器學習", "人工智慧", "生成式AI", "自然語言處理", "深度學習", "電腦視覺"], "topicCount": 7, "courseCount": 3 }
  ],
  "hasMore": true, "source": "default"
}
```

- 方向順序：規格表的 9 個預設方向（`server/src/data/interestQuestionnaireCopy.js`）先出，其餘依選單原本的課程數排序。
- 「換一組」：把看過的 `categoryId` 放進 `seenOptionIds` 再呼叫；`hasMore` 為 false 時沒有新方向。這組沒有任何方向時回
  `question: null`、`options: []`，前端跳過這組。
- 題幹固定用該組的題幹；有預設文案的方向直接用預設文案，其餘交給語言模型改寫短標題與一句說明。
- `topics` 是這個方向在候選池裡課程數最多的前 6 個主題名稱，`topicCount` 是總數；只用來說明方向包含什麼（前端顯示「包含主題：…」），**不會被當成已選的具體主題**。

**`stage: "card"`**：點方向卡時呼叫。傳同樣的班級範圍，另帶
`direction: { group, categoryId }` 與可省略的 `seenTagIds`（最多 3 個，只用於第二題）。
回 `question` 與至多三個 `options: [{ tagId, name, title, description }]`，其中 `tagId` 和 `name` 來自候選池。
有預算分群時優先從各群取代表標籤；找不到分群時依既有標籤順序。`hasMore` 只在第一題還有其他標籤時回 `true`。
語言模型改寫題幹及文案，遇到逾時、固定模式或回應不符時用原題幹及標籤名。前端確認後沿用 `interestSelections` 保存格式。

**`stage: "detail"`**：中沙漏的方向總覽。一次送這一組**所有**已選方向。
設定頁另外傳 `layout: "cards"` 以取得 `cardPages`，每頁最多四張 `{ group, categoryId, examples }`，
候選標籤交集達較小集合的 60% 或同屬軟體、AI、資安、硬體的本系方向分開顯示。
所有已選且有可用標籤的方向都會出現在其中一頁。方向總覽不呼叫語言模型，點方向才請求 `stage: "card"`。
回應仍包含原有 `directions` 資料供相容。

```json
{ "department": "資訊工程學系", "gradeLevel": 3, "className": "資訊三甲", "stage": "detail",
  "directions": [{ "group": "outside", "categoryId": "main_…" }] }
```

```json
{
  "stage": "detail", "scopeReady": true,
  "question": "你想先接觸哪些主題？點有興趣的群展開，可複選，也可以略過。",
  "directions": [
    {
      "group": "outside", "categoryId": "main_…", "title": "了解品牌與消費者", "categoryLabel": "商業與管理",
      "tagCount": 76, "mode": "clusters",
      "tags": [{ "tagId": "tag_…", "name": "行銷", "courseCount": 6 }],
      "popular": [{ "tagId": "tag_…", "name": "行銷", "courseCount": 6 }],
      "clusters": [{ "clusterId": "c1", "label": "行銷市場", "tagIds": ["tag_…"] }]
    }
  ]
}
```

- `mode`：
  - `flat`：標籤 12 個以下，或 13 個以上但沒有預先算好的分群（備援）。前端直接列出 `tags`，先 12 個，其餘收在「更多」。
  - `clusters`：13 個以上，而且 `server/src/data/interestTagClusters.json` 有這個方向、這份標籤清單的分群。另附：
    - `popular`：最熱門的 3 個標籤，放在區塊最上面；
    - `clusters`：群卡，`clusterId: "other"` 是「其他」，只帶標籤 ID，名稱與課程數由 `tags` 對照。
  - `tags` 一律是全部標籤（依課程數），供同頁搜尋。
- 分群只查表，鍵是「方向 ID＋排序後的標籤 ID」。候選池的標籤有任何差異就查不到，退回 `flat`，不把對不上的標籤塞進「其他」。
- 不在候選池的方向略過；全部都不在時回 `question: null`、`directions: []`。
- 分群只是導覽，不保存、不計分；只有學生勾選的標籤 ID 會存進 `interestSelections`。

**`stage: "summary"`**：把已存的方向與標籤 ID 換成顯示名稱（確認頁、重新進入設定頁），不呼叫語言模型。
`selections` 為 `[{ group, categoryId, tagIds }]`，回 `{ directions: [{ group, categoryId, title, categoryLabel, available }],
topics: [{ group, categoryId, tagId, name, duplicate }] }`；`available: false` 表示該方向目前不在候選池，同一標籤第二次出現時
`duplicate: true`。

- （以下只適用 `stage=group`）`source` 為 `default`、`gpt`、`fixed` 或 `mixed`。**固定文案後備**：沒有 `OPENAI_API_KEY`、`INTEREST_FOLLOWUP_MODE=fixed`、
  逾時（12 秒，不重試）、呼叫失敗，或輸出的參照、順序、數量與輸入不符、文字過長或含網址，整批改用固定文案：方向的短標題用目錄名稱、
  說明列代表課；細項的短標題用標籤名稱；題幹用固定題幹。頂層 `fallbackReason` 為 `mode_fixed`、`no_api_key`、`gpt_timeout`、
  `gpt_error` 或 `invalid_gpt_output`。**出題失敗不回錯誤**。
- 送給 OpenAI 的只有這一題的分類名稱與標籤名稱（見 `docs/PROMPT_DESIGN.md`）。文案依內容快取在伺服器記憶體 24 小時，所有使用者共用；失敗不快取。
- 班別沒選好時回 `scopeReady: false`、`question: null`。
- 錯誤：`400`（欄位缺漏或型別錯誤）、`429`（限流）。
- 問答的結果仍由 `POST /api/profile` 的 `interestSelections` 保存，形狀不變；`tagIds` 只放使用者確認的具體主題（ADR-027）。

### `POST /api/profile`

只更新 session 使用者的 `User_Profiles` 支援欄位。request 不需也不應傳 `userId`。

興趣方向可用下列欄位更新：

```json
{ "preferredTrack": "網路與安全類" }
```

`preferredTrack` 必須是字串或 `null`，持久化於既有的 `User_Profiles.preferences_json.values`，不新增資料庫欄位。

`GET /api/profile` 回傳已存的 `scheduleOptions`。更新時只合併送到的鍵，陣列可使用空陣列清除，
選填數值可用 `null` 恢復預設。單次排課可用 `POST /api/schedule/generate` 的
`constraints.scheduleOptions` 覆蓋本次使用的鍵。欄位與 Agent 工具共用，詳見 `PROMPT_DESIGN.md`。
想學的主題改由下方的 `interestSelections`（課程主題問答）保存。

**2026-11-23 起（ADR-032）不再接受 `interests`、`preferredKeywords`**：帶了任一個（含空陣列）都回 `400`，
訊息為「`interests` 已停用，請改用設定頁的課程主題問答（interestSelections）」。Profile 回應也不再有這兩個欄位。
更新時會保留 `values` 中其他個人化資料。

**Roadmap #10 任務 3A** 另接受 `useLearnedPreference`（布林，預設 `true`）：

```json
{ "useLearnedPreference": false }
```

同樣存在 `preferences_json.values`。**只接受真正的布林值**，字串 `"false"`、`0`、`null`
一律回 `400`——一個決定「要不要用學到的偏好」的旗標，不該靠型別轉換猜測使用者的意思。

更新興趣不會洗掉這個開關，更新開關也不會洗掉興趣。

為相容既有呼叫端，Profile 仍接受舊欄位 `remainingSemesters`（1～8 的整數或 `null`）：

```json
{ "remainingSemesters": 3 }
```

它保存在 `preferences_json.values.remainingSemesters`。`null` 會刪除該欄位，字串 `"3"`、小數、0 與 9 一律回 `400`。
設定頁已移除這個輸入。排課結果的 `graduationPlanning.remainingSemesters` 是後端推算值，包含當學期。
`remainingSemestersSource` 為 `course-history-and-active-term`（歷史修課與入學起點可核對）、
`grade-and-active-term`（依年級與當期學期回退）或 `unknown`（推算值為 `null`）。舊 Profile 欄位不參與推算。

`gradeLevel`、`targetCreditsMax`、`schemaVersion` 會寫進 `User_Profiles` 的整數欄位，
只接受正整數或 `null`；字串（包括 `"2"` 這種數字字串）、小數、0、負數、物件一律回 `400`。
2026-11-08 以前這三個欄位沒有檢查，送 `"abc"` 會由 MySQL 拒絕寫入並回 `500`，錯誤訊息還帶出資料表欄位名稱。

**`preferencesJson` 本身不可直接更新**（送了回 `400`）：`preferences_json.values` 的每個
受管理欄位都有專屬 API 欄位。開放整包覆寫會讓上面的型別檢查可以被繞過
（送 `{ values: { useLearnedPreference: "false" } }` 就能存進不合法的字串，讀取時再靜默
退回預設），也會順手洗掉 `values` 裡的其他鍵。

**這一輪只做持久化，開關尚未生效**：`getSchedulingPreferenceWeights()` 還沒有讀它，
排課結果在 `true`／`false` 下完全相同。真正讓它生效（回 `user-opted-out`）並補上前端
介面是 3B 的範圍——提前生效會讓 3A 不再是「不改變正式推薦結果」的 shadow 階段。

Profile 另接受 `interestSelections`（設定頁「想接觸的課程主題」的選擇結果，2026-11-20 起）：

```json
{
  "interestSelections": [
    { "group": "outside", "categoryId": "main_…", "level": "main", "mode": "followup", "tagIds": ["tag_…"] }
  ]
}
```

每一筆以 `(group, categoryId)` 為鍵，`group` 只接受 `department`、`generalEducation`、`outside`；
`categoryId` 必須是非空字串；`tagIds` 省略或空陣列代表只選了類別、尚未追問；最多 48 筆。
不是陣列、項目不是物件、未知 `group`、空的 `categoryId`、非字串的 `tagIds` 一律回 `400`。
送空陣列代表清空所有選擇。它保存在 `preferences_json.values.interestSelections`，更新時不會
洗掉其他鍵（已移除的 `interests`／`preferredKeywords` 殘留時會一併刪除）。

**保存前的驗證（2026-11-20）**：送了 `interestSelections` 時，伺服器對照這位學生的候選池（`department`、
`gradeLevel`、`className` 取自這次請求，沒帶就用已保存的 Profile）：分類必須存在、層級與組別相符（本系用子類別、
通識與系外用大類別）、在這一組的候選池裡有這個分類；標籤必須是該分類在這一組候選池裡的可選標籤，不在的丟掉。
`categoryId` 也可以是人工策畫選項（`curated_ai`，只限本系組、只限適用的系所）：標籤對照它的人工清單在候選池裡
實際命中的部分，清單內的 `too_common` 標籤也接受（ADR-026）。
**與已保存的某一筆完全相同的選擇不重驗、原樣保留**，新學期候選池對不上舊答案時不會被默默刪掉。回應多兩個欄位：

```json
{ "success": true, "preferences": {}, "interestSelectionsStatus": "verified", "interestSelectionWarnings": [] }
```

`interestSelectionsStatus` 是 `unchanged`（沒有任何變動）、`verified`（已對照候選池）或 `unverified`（候選池載入失敗
或班別沒選好，**不接受新的標籤**：變動的選擇保留已保存的標籤、新增的只記類別，**不擋住其他欄位保存**）。
`interestSelectionWarnings` 每一項是 `{ group, categoryId, tagId?, reason }`，`reason` 為 `unknown_category`、
`wrong_level`、`category_not_in_pool`、`tag_not_in_pool` 或 `verification_unavailable`。

`department` 若有帶，必須是**非空字串**（去除包裹引號與空白後仍有內容）。物件、陣列、數字、布林或空字串一律回 `400`：

```json
{
  "error": "department 必須是非空字串"
}
```

正規化不是型別轉換層：`{}` 會變成 `"[object Object]"`、`["資訊工程學系","電機工程學系"]` 會變成 `"資訊工程學系,電機工程學系"`，寫入後在資料庫與 API 回應中都像一般字串，但所有系所比對都會失敗。資料層另有一道防線，會丟棄型別錯誤的 `department` 而非寫入。

## Reviews

### `GET /api/reviews/easy?limit=10`

Returns courses ranked by derived easiness score from `Course_Reviews`.

排序依據（Roadmap #4）是 **`adjustedEasiness`**（m-estimate 收縮後的分數），**不是**
`easiness`（未收縮的原始加權平均）。兩者皆會回傳：

| 欄位 | 說明 |
| --- | --- |
| `easiness` | 未收縮，1–5 尺度。單一課程自己的評價原始算出來的分數，不管評論數多寡 |
| `adjustedEasiness` | 收縮後，1–5 尺度。排序實際採用；評論數少的課會被拉向母體平均 |
| `reviewCount` | 該課評論數（加權後，非資料列數） |

**這是一次行為變更**：舊版直接用 `easiness` 排序，樣本數少的課（例如剛好 4 則評論全 5 分）
會穩定壓過樣本數更多、更可信的課（例如 8 則評論平均 4.5 分）。改用 `adjustedEasiness` 後，
這份排行榜與排課引擎「涼課與高分優先」方案採用同一套邏輯（`courseReviewStats.js`），不會再
出現「涼課排行榜第一名沒被排進涼課方案」的不一致。

### `GET /api/reviews/:courseId`

`courseId` is `Course_Sections.section_id`.

Response:

```json
{
  "reviews": [],
  "sentiment": {
    "courseId": 1,
    "sentiment": "positive",
    "summary": "..."
  }
}
```

## Interactions

### `POST /api/interactions`

批次上報互動事件（Roadmap #2）。需要登入身分。

Request：

```json
{ "events": [ { "eventType": "course_withdrawn", "requestId": "...", "actionId": "...", "course": { "catalogCourseCode": "IECS3002", "sectionId": 101 }, "term": { "academicYear": 114, "semester": "下學期" }, "source": "explicit_selection", "feedbackReason": "time" } ] }
```

探索回饋和評價也走同一個 consent-first、冪等的事件端點：

```json
{
  "events": [
    {
      "eventType": "interest_exploration_feedback",
      "requestId": "...",
      "actionId": "...",
      "course": { "catalogCourseCode": "IECS3002", "sectionId": 101 },
      "term": { "academicYear": 115, "semester": "first" },
      "source": "exploration",
      "interestFeedback": { "response": "interested", "canonicalTagIds": [] }
    },
    {
      "eventType": "course_rated",
      "requestId": "...",
      "actionId": "...",
      "course": { "catalogCourseCode": "IECS3002", "sectionId": 101 },
      "term": { "academicYear": 115, "semester": "first" },
      "source": "explicit_selection",
      "rating": 5
    }
  ]
}
```

`interested` with an empty tag list means all learning-eligible tags on the displayed course; a
negative response must list at least one tag the user identified as unwanted. `learn_more` records no
positive or negative evidence. 新版雙卡用 `paired_interested`，每門勾選的課程一筆，附上實際顯示的 1～2 個代表標籤。
同題的事件共用 `requestId`，每門課有自己的 `actionId`；重試時沿用這兩種 ID。每個代表標籤的名義正向證據各為 `+1`，
沿用現有時間衰減。沒勾選或略過不送事件，舊 `interested` 規則仍按標籤數分攤。
The server resolves the course's current `rag_tag`, validates the
selected canonical IDs, checks the user's required-course scope, and stores the versioned tag snapshot
in `Interaction_Events.tag_interest_snapshot_json`. Clients must not supply that server-owned snapshot.
Events without a tag snapshot (including pre-feature history) are not used in the rag-tag profile.
For `course_rated`, include an integer `rating` from 1 to 5. For
`interest_exploration_feedback`, the validated `interestFeedback` payload is retained with the
event so export and idempotency checks preserve the original response. These columns are added by
the Stage 3 migration; the migration is not applied automatically.

事件本體為 `InteractionEvent v1`（見 `docs/DATA_SCHEMA.md`）。`userId`、`eventId`、
`timestamp`、`schemaVersion`、`idempotencyKey` 與 `versionSnapshot` 的
`profileSchemaVersion`／`modelVersion` 一律由 server 產生，client 送同名欄位會被覆寫。
單次最多 50 筆。

**來源驗證（Roadmap #2 對抗式審查修正）**：

- `eventType: "recommendation_exposed"` **一律拒絕**，即使格式完全合法——這個事件類型
  只由伺服器在產生排課結果時自己寫入（見 `POST /api/schedule/generate`），不接受這支
  端點提交，回 `rejected` 並附錯誤訊息，不寫入。
- `eventType: "recommendation_accepted"`，以及 `source: "system_recommendation"` 的
  `course_withdrawn`，會對照這位使用者、這個 `requestId` 底下伺服器實際寫過的曝光紀錄：
  接受的 `plan.planId` 必須是當時真的顯示過的方案，退選的 `course.sectionId` 必須出現在
  當時曝光的 `displayedSet` 裡。對不上（含 `requestId` 查無曝光紀錄）一律回 `rejected`。
  格式驗證只證明「像一個事件」，不證明「這件事真的發生過」——這個檢查固定在
  `recordInteractionEvents()` 本身，任何呼叫端都繞不過去，不只是 Agent tool 那條路徑。
- **`eventType: "plan_chosen"`（Roadmap #10 任務 3A）** 的驗證比 `recommendation_accepted`
  更嚴格，因為它是 Choice Perceptron 唯一的學習輸入：曝光必須存在、曝光的
  `planFeatureVersion` 必須是目前支援的值、`displayedPlanIds` 至少 2 個（只顯示一個方案
  不構成 set-wise choice）、被選方案必須有特徵且 `variantId` 相符、特徵必須覆蓋整組方案。
  **一次詢問只能學一次**：它的 idempotency 只由 `requestId + eventType` 決定，不含被選方案，
  所以同方案重送回 `duplicate`、同 `requestId` 改選另一方案回 `conflict`；`actionId` 由伺服器
  依 `requestId` 推導，client 送的隨機值會被覆寫。
  `recommendation_accepted` 照舊寫入，兩者是同一次操作的兩筆事件，學習器只讀 `plan_chosen`。
- **`eventType: "course_withdrawn"`** 的 `actionId` 由伺服器依 `(requestId, sectionId)` 推導，
  client 送的隨機 UUID 會被覆寫。理由是同一次移除會經過兩條路徑（畫面上按移除、
  接著在 Chat 講同一件事），不統一識別碼就會寫成兩筆。冪等比較也只看
  `requestId + sectionId + feedbackReason`，**不比 `source` 與 `versionSnapshot`**——
  移除一門必修時前端寫 `source: "required"`、Agent 寫 `"system_recommendation"`，
  那不是衝突，是同一件事的兩種記法。改了原因才回 `conflict`。詳見 `docs/DATA_SCHEMA.md`。
- 其餘 event type（`course_viewed`／`course_favorited`／`course_selected` 等）沒有可對照的
  伺服器端事實可驗證，維持格式驗證即可寫入。

Response：

```json
{ "recorded": 2, "results": [ { "actionId": "...", "eventType": "course_withdrawn", "status": "append" } ] }
```

`status` 為 `append`｜`duplicate`｜`conflict`｜`rejected`（`rejected` 另帶 `errors`）。

**未同意 `personalization_learning` 時回 `200 { "recorded": false, "reason": "CONSENT_NOT_GRANTED" }`，
不是 `428`。** 這是可選用途，預設關閉是完全合法的狀態，回 428 等於把使用者推到同意牆前面。
此時**一列都不會寫入**，滿足 #33 的驗收標準。詳見 `docs/DECISIONS.md` ADR-018。

| 狀態碼 | 情境 |
| --- | --- |
| 200 | 已處理（含未同意而未記錄） |
| 400 | `events` 不是陣列或超過 50 筆 |
| 401 | 未登入 |
| 403 | 嘗試操作其他使用者的資料 |
| 429 | 節流（`RATE_LIMITED`，每分鐘超過 20 次）或每日事件量配額（`DAILY_QUOTA_EXCEEDED`，24 小時內超過 2000 筆） |
| 500 | 儲存體暫時無法使用 |

呼叫端必須把這支端點視為**旁路**：失敗時不得影響加選、移除、排課或聊天。
前端 `client/src/services/interactionLog.js` 一律 fire-and-forget 並吞掉錯誤，
`logInteraction()` 回傳的 promise 永不 reject，只在結果裡帶真實狀態
（確認列會依此決定文案，不會謊報「已記錄」）。

## Exploration

### `GET /api/exploration`（Roadmap #10 任務 4）

系外與通識探索清單。從一門已修過的課出發，列出相近的系外選修與通識，每個系所／通識領域只出一門
（Pardos & Jiang 2020，規則見 `docs/SCHEDULING_LOGIC.md`）。**唯讀**：不寫互動事件，也不影響
`POST /api/schedule/generate` 的結果。需登入與 service consent。

Query：

- `favoriteCourseCode`（選填）。必須是使用者已通過、且在起點選單中的課號。省略時取選單第一門。
- `representation`（選填）。只接受 `embedding`；傳 `tfidf` 或其他值回 `400 INVALID_EXPLORATION_REPRESENTATION`。

```json
{
  "mode": "favorite",
  "favorite": { "courseCode": "IECS1001", "name": "Python程式設計", "source": "system-default" },
  "favorites": [
    { "courseCode": "IECS1001", "name": "Python程式設計", "score": 92, "available": true },
    { "courseCode": "IECS2007", "name": "離散數學", "score": 80, "available": true },
    { "courseCode": "XXXX1000", "name": "某課", "score": 70, "available": false, "reason": "no-course-vector" }
  ],
  "emptyReason": null,
  "outside": {
    "diversification": "department",
    "items": [{
      "courseCode": "MATH4085", "name": "數學與金融企業實務", "credits": 3, "unit": "應用數學系",
      "similarity": 0.62,
      "semanticMatch": {
        "sourceCourseCode": "IECS1001",
        "parts": { "name": 0.49, "description": 0.67, "topic": 0.69 },
        "commonTags": ["資料分析"]
      },
      "recognition": { "status": "needs-office-confirmation", "checked": true, "needsOfficeConfirmation": true, "warnings": [] },
      "sections": [{ "id": 2031, "catalogCourseCode": "MATH4085", "timeBlocks": [] }]
    }]
  },
  "general": { "diversification": "domain", "items": [] },
  "method": {
    "representation": "course-exploration-vectors-v1", "fields": ["name", "description", "topic"],
    "combine": "mean-of-available-fields", "selection": "one-per-unit-cosine", "k": 5, "minSimilarity": 0.55,
    "embeddingModel": "text-embedding-3-large", "dimension": 512, "generatedAt": "…"
  },
  "poolSize": { "outsideCourses": 207, "outsideUnits": 35, "generalCourses": 79, "generalUnits": 3 }
}
```

- **分數**（ADR-035）：課名、課程說明、課程主題三個向量各算 cosine，取**兩邊都有的欄位**的平均；
  ≥ 0.55 才列出。本學期課程表沒有的已修課（例：離散數學）只有課名向量，只比課名。
  `outside`／`general` 各**最多** 5 門，可能少於 5 門或為空。
- `semanticMatch.parts`：三種相近程度（無法比較時為 `null`）。`commonTags` 是兩門課都有的主題標籤
  （工具軟體、上課方式不列），只是附加說明。
- `favorites`：已通過的課，**不含**不計入畢業學分的課（體育、國防科技、班級活動）、全校共同必修
  （中文思辨與表達、大學基礎英文、大學精進英文，以及核心必修 `GEG2000`／`GEK2000`）與實習課；候選也同樣排除；
  依課名排序（英文 A～Z 在前、中文依筆畫），可用的排前面。`available: false` 的唯一原因是
  `no-course-vector`（沒有探索向量）。省略起點時 `favorite.source` 為 `system-default`。
- 候選：當學期、資格確定（`eligibility` 不是 `unknown`／`ineligible`）、有上課時間、尚未通過、
  有探索向量的系外選修與通識；不含不計入畢業學分的課；整門都是實習的課不列（講課底下的實習班仍併入講課）。
- `emptyReason`（`favorite` 為 `null`、清單為空，回 `200`）：`no-course-history`、`no-available-favorite`、
  `favorite-no-course-vector`、`exploration-vectors-unavailable`（產物不存在）、`exploration-vectors-invalid`
  （產物格式或版本不符；不改用其他方法）。
- `sections`、`recognition`、`general.diversification`、講課與實習課合併：同前（班次是完整的標準班次物件）。

錯誤：`400 FAVORITE_NOT_IN_HISTORY`（不是已通過的課，或是被排除的課）、`400 INVALID_EXPLORATION_REPRESENTATION`、
`400 CLASS_NAME_REQUIRED`。

向量為離線產物 `server/simulation-runs/course-exploration-embeddings/index.json`（git-ignored），由
`node server/scripts/courseExplorationEmbeddings.js --apply` 產生；請求當下不呼叫外部 API、不寫入 MySQL。

#### `GET /api/exploration?mode=profile`（協同過濾與 User Embedding 構想階段 4）

「依你的修課與興趣」探索。以標籤空間使用者向量（`server/src/skills/userTagVector.js`）排序系外選修與
通識：向量由非必修已通過的歷史修課、收藏／加選／表示有興趣等互動事件與明確興趣組成，**必修不列入**；
課程分數用階段 2 的標籤相近表與審核過的降權名單。每個系所／通識領域只出一門（通識沒有領域時不分散）。
**需要 `personalization_learning` 同意**；使用者向量只在記憶體中計算，不寫入任何資料表。唯讀，
不寫互動事件，也不影響自動排課。

```json
{
  "mode": "profile",
  "emptyReason": null,
  "signals": { "historyCourses": 18, "positiveEvents": 120, "negativeEvents": 6, "explicitTags": 9 },
  "outside": {
    "diversification": "department",
    "items": [{
      "courseCode": "COME3046", "name": "機器學習", "credits": 3, "unit": "通訊工程學系",
      "score": 0.8123,
      "reasons": {
        "tags": [
          { "userTag": "資料科學", "courseTag": "資料科學", "viaNeighbor": false },
          { "userTag": "機器學習", "courseTag": "深度學習", "viaNeighbor": true }
        ],
        "closestEvidence": { "courseCode": "IECS3059", "name": "人工智慧導論", "source": "history" }
      },
      "recognition": { "status": "needs-office-confirmation", "checked": true, "needsOfficeConfirmation": true, "warnings": [] },
      "sections": [{ "id": 2031, "catalogCourseCode": "COME3046" }]
    }]
  },
  "general": { "diversification": "domain", "items": [] },
  "method": { "representation": "user-tag-vector-v1", "selection": "one-per-unit-svec", "k": 5, "requireExactTag": true },
  "poolSize": { "outsideCourses": 207, "outsideUnits": 35, "generalCourses": 79, "generalUnits": 3 }
}
```

- `emptyReason`：`no-personalization-consent`（未同意個人化學習，不計算）或 `no-profile-signal`
  （沒有任何非必修修課、互動或可對應的明確興趣）。這兩種情況 `items` 皆為空陣列；前者 `signals` 為 `null`。
- `score`：−1～1，以候選池內正向相似度第 95 百分位為 1；只列正向相似大於 0 的課。
- **入選條件**（ADR-033，2026-11-23）：課程至少有一個和使用者向量**完全相同**的標籤（太常見的可以，工具軟體與
  上課方式不行）；只靠相近標籤配到的課不列，由下一門補上。`poolSize` 只計符合此條件的候選。
- `reasons.tags`：貢獻最大的標籤配對（使用者本來就有的課程標籤一律標 `viaNeighbor: false`，且至少列出一個
  完全相同的標籤）；`viaNeighbor: true` 表示經標籤相近表連結（使用者的標籤與課程的標籤
  意思相近但不同）。`closestEvidence`：使用者證據中與這門課最接近的**另一門**課，`source` 為
  `history`（修過）或互動事件類型（例：`course_favorited`、`interest_exploration_feedback`、`course_viewed`）。
- 其餘欄位（`recognition`、`sections`、`poolSize`、候選條件）與預設模式相同。

## Graduation

### `GET /api/graduation/me`

Uses the authenticated session identity. Legacy `/api/graduation/:studentId` 暫時保留，
但 path student ID 必須與 session 相同，否則回傳 `403`。

畢業學分要求**依 `program + degree + admissionYear` 解析版本化規則**
（`server/src/data/graduationRuleVersions.js` 的 `resolveGraduationRule()`），沒有全校通用的
預設值（總學分有 128／130／131／134／156 五種）。

Response:

```json
{
  "courseHistoryAvailable": true,
  "courseHistoryMessage": null,
  "totalRequired": 128,
  "totalEarned": 118,
  "required": { "required": 63, "elective": 28, "general": 28, "external": 9, "unspecified": 0 },
  "earned": { "required": 61, "elective": 22, "general": 24, "external": 11, "unspecified": 0 },
  "gaps": { "required": 2, "elective": 6, "general": 4, "external": 0, "unspecified": 0 },
  "attribution": {
    "required": {
      "credits": 61,
      "courses": [
        {
          "courseCode": "IECS1005", "courseName": "計算機概論", "credits": 2,
          "academicYear": 112, "semester": 1, "requirementType": "必修",
          "ruleVersion": "114",
          "ruleSource": "https://registration.fcu.edu.tw/news/...",
          "needsVerification": false,
          "attributionSource": "course_history_category"
        }
      ]
    }
  },
  "admissionYear": 112,
  "ruleVersion": "114",
  "ruleSource": "https://registration.fcu.edu.tw/news/...",
  "ruleCoverage": { "from": 114, "to": null },
  "appliedFallbackVersion": true,
  "warnings": ["目前只有 114 學年度必選修科目表，112 學年度入學適用的版本尚未取得，已套用 114 學年度規則；此結果僅供參考。"],
  "recommendations": [
    {
      "type": "suggestion",
      "title": "補足本系選修",
      "message": "行動應用程式開發（3 學分）可計入本系選修，目前尚缺 6 學分。",
      "course": { "id": 1295, "name": "行動應用程式開發", "credits": 3 },
      "fillsGap": "elective",
      "gapLabel": "本系選修",
      "gapBefore": 6,
      "credits": 3,
      "ruleVersion": "114",
      "ruleSource": "https://registration.fcu.edu.tw/news/..."
    }
  ],
  "watchlist": [],
  "skillTree": [],
  "overallScore": 80,
  "overallScoreMax": 100
}
```

| 欄位 | 說明 |
| --- | --- |
| `courseHistoryAvailable` | 是否已有可供計算畢業進度的歷史修課資料；必須同時具備總學分及分類學分彙總，只有課程 ID／名稱清單仍視為不足 |
| `courseHistoryMessage` | 缺少歷史修課資料時的使用者提示；資料可用時為 `null` |
| `required` | 該系所的畢業學分要求。`general` 為通識基礎與通識選修之和，`unspecified` 為未列明學分（通常是自由選修） |
| `earned` | 使用者已修學分，key 與 `required` 一致 |
| `gaps` | 每類的缺口，不會小於 0 |
| `attribution` | **逐門認列追溯**（roadmap #23）：每個分類列出湊出這些學分的課程，各帶課號、課名、學分、修課學年度／學期、規則版本、規則出處、是否待人工複核與認列來源。各分類的 `credits` **恆等於** `earned` 的對應值（與 `getEarnedCredits()` 共用同一組篩選，由 G10 測試釘住）。`courseHistoryAvailable` 為 `false` 時為 `null` |
| `admissionYear` | 學生入學學年度（民國）。來自 `User_Profiles.admission_year`，未知時為 `null`，**不從年級推導** |
| `generalEducation` | **通識拆成基礎必修／選修兩個缺口**（roadmap #23）。`gaps.general` 維持總數不變（向後相容），這裡是額外細分——先前系統只知道「通識共缺 N」，不知道缺在哪一邊。含 `basic`／`elective`（各有 `earned`／`required`／`gap`）、`ruleVersion`／`ruleSource`、`coreRequired`（要求／已完成／未完成的課號）、`disagreements`（兩個判定來源不一致、需人工確認的課）、`unverifiableRules`（有官方出處但目前無資料可執行的規則及其阻塞原因）、`notes`。`courseHistoryAvailable` 為 `false` 時為 `null` |
| `recommendations[].needsEligibilityConfirmation` | 這門課的正式適用對象尚未確認（目前只有通識會是 `true`）。`message` 裡也會明講，前端不得只靠旗標 |
| `ruleVersion`／`ruleSource`／`ruleCoverage` | 這次實際套用的畢業規則版本、官方出處與該版本涵蓋的入學年度範圍 |
| `appliedFallbackVersion` | 是否因為該入學年度沒有對應版本而退回最新一版。為 `true` 時 `warnings` 會含說明——**目前只有 114 學年度一版真實資料**，因此 112／113 入學生一律為 `true` |
| `warnings` | 查不到系所對照、該系資料標記為待人工複核、或規則版本退回時的說明。**查無對照時不會用臆測的數字填補** |
| `recommendations[].fillsGap` | 這門課會補到哪一類缺口（`required`／`elective`／`general`／`external`）。**每筆推薦都已驗證該分類的 `gaps` 大於 0**；補不了任何缺口的課（例如 0 學分的班級活動、體育、國防科技）不會出現 |
| `recommendations[].gapLabel`／`gapBefore` | 缺口的中文標籤與推薦前的缺口學分數，供前端直接顯示 |

**補學分推薦的候選範圍**：本人班級課程 ＋ 通識 ＋ 系外選修的聯集，三者皆由
`courseQuery.js` 的 `filterCategorizedCourses()` 取得（與搜尋、排課、Agent 同一套班級規則）。
先前只撈本系開的課，因此 `general`／`external` 缺口實務上永遠推不出東西。

**判定順序**：排除已修過並通過的課 → 排除不計入畢業學分的課
（`countsTowardGraduation()`）→ 排除 `ineligible`；`unknown` 一律排除，
**唯一例外是通識**（官方明載四大領域「不是班級，適用全校學生」，見
`docs/COURSE_SELECTION_RULES.md`），放行時標記 `needsEligibilityConfirmation` 並在
`message` 講明 → 對映到缺口分類 → 只留該分類缺口大於 0 者 → 排序（缺口大者優先 →
學分高者優先 → 課號）→ 同一 `catalogCourseCode` 只留一筆 → **每個有缺口的分類各先取
一門，再用剩餘名額輪流補**，總共 3 筆。

最後那條是必要的：單純取前 3 名會讓最大的缺口吃光名額（實測本系選修缺 6、通識缺 4 時，
三個名額全被本系選修佔滿），缺通識的使用者永遠看不到通識建議。所有缺口都補滿或
`gaps` 為 `null` 時回傳空陣列，不硬推一門。

**查不到系所對照表**（`getGraduationRequirement()` 回傳 `null`）時，`required`、
`totalRequired`、`gaps` 皆為 `null`，`warnings` 固定含 `此系所不存在，請檢查是否輸入錯誤`。
2026-08-13 前這裡會退回 `users.json` 上使用者自帶的 `requiredCredits`／`totalRequired`
（那正是必修60／選修40／通識20／系外8這批沒有出處的捏造數字混進畫面的路徑），
該後備已移除——查不到就是查不到，不再猜。此情境與 `courseHistoryAvailable`
互相獨立：即使已修學分正常顯示，系所對照查不到時 `required`／`totalRequired`／`gaps`
仍為 `null`。

當 `courseHistoryAvailable` 為 `false` 時，`totalEarned`、`earned` 與 `gaps` 均為 `null`，前端不得將缺少資料解讀為已修 0 學分或據此顯示學分缺口與補課建議。

## Error Response

```json
{
  "error": "錯誤訊息"
}
```

# 學生註冊與 MyFCU 歷史修課匯入（2026-11-23 移植）

> 以下各節自 `feature/myfcu-session-import`（commit 1d9db09）移植，整合決定見 ADR-034。團隊整合時的調整：
>
> - `POST /auth/login`：MySQL 有帳號且有 argon2id 雜湊時只驗雜湊；**沒有雜湊**（demo D1249697、Persona D0009001～D0009010）時，非 production 退回 `users.json` 核對。`ALLOW_LEGACY_JSON_AUTH=false` 可關閉退回；production 一律關閉。
> - `GET /api/course-history`：列出目前 Session 帳號的全部歷史修課（含未匹配課號的列）。
> - 推薦、排課與畢業計算讀取歷史修課時，略過沒有課號或成績無法判讀的列；修別與畢業分類為 NULL 時依序以課名（體育／國防／班級活動→不計畢業）、科目表、課程表的通識身分、非本系開課（先算系外）補分類，對不上為「未確認／unspecified」，不寫回資料庫（規則見 DATA_SCHEMA）。
> - 同課名同成績只在**同一學年、同一學期**合併；不同學期（重修）各留一筆。
> - `GET /api/controlled-browser/*` 在本機 MyFCU 模式未開啟時一律 404；首頁視為未開放，不顯示錯誤。

## 學生註冊（本機實作）

- `GET /auth/register-options`：回傳系所及其既有班級簡稱；行政班別依年級固定選擇。
- `POST /auth/register`：接收 `studentId`、`name`、`department`、`gradeLevel`、`className`、`password`、`confirmPassword`。密碼須為 8 至 1024 位英文字母或數字；成功回 201，不回傳密碼或雜湊。失敗可能為 400、409、429 或 503。
- 生產環境只接受 MySQL Argon2id；舊 JSON 登入僅在非 production 且明確設定 `ALLOW_LEGACY_JSON_AUTH=true` 時啟用。舊帳號需受控核對學號與 Profile 對照，再以安全流程設定 Hash，否則不能在 production 登入；本次不執行回填或資料庫寫入。
- Argon2id 使用 Node.js 內建 `crypto.argon2`；已在 Node 26 驗證，部署前須確認執行環境支援此 API。註冊限流為單程序記憶體計數，多程序部署需要外部共用限流機制。

## 本機受控瀏覽器模擬（開發模式）

僅於 `CONTROLLED_BROWSER_MOCK=true` 且非 production 開啟，後端限定 loopback，且伺服器綁定 `127.0.0.1`。除虛構 mock 頁外，工作階段 API 均要求現有 Session 及服務同意，並以帳號及 Session cookie 綁定工作階段。`POST /api/controlled-browser/sessions` 接受 `{consent:true}`；`GET /sessions/:id` 讀狀態、`GET /sessions/:id/frame` 讀畫面、`POST /sessions/:id/input` 送受限的點擊或按鍵、`DELETE /sessions/:id` 關閉。沒有任意網址、資料庫匯入或真實 MyFCU 支援。

工作階段五分鐘逾時；取消、登出、逾時與擷取結束會關閉 context。只供單機測試，不適合部署。受控瀏覽器伺服器能接觸輸入內容，禁止輸入真實帳密。實體手機與電腦是不同裝置時無法跨 loopback 連線。

## 受控瀏覽器輸入與真實模式準備

Mock 畫面支援點擊後鍵盤橋接及輸入法組字；輸入僅用於本次受控操作，不應記錄。預覽依課號、學年、學期去重並保留衝突與重修。登出會銷毀 Session 對應的 context。

`CONTROLLED_BROWSER_REAL_TEST` 僅用於離線網址與模式隔離檢查，沒有真實登入 API、瀏覽入口或外連。此開關與 `CONTROLLED_BROWSER_MOCK` 不可同時啟用；真實 MyFCU 使用前仍需安全審查與獨立的網路、身分和憑證處理設計。

### 本機受控瀏覽器公開頁測試

`POST /api/controlled-browser/sessions` 的回應新增 `mode`（`mock` 或 `real`）；由伺服器啟動設定決定，不接受請求指定。`real` 僅在 `CONTROLLED_BROWSER_REAL_TEST=true`、Mock 關閉、非正式環境且無 MySQL 設定時啟用。既有 Session、同意與 loopback 限制仍適用；真實公開頁僅供截圖檢視，任何輸入及受保護頁面均禁止。

`GET /api/controlled-browser/config` 回傳伺服器目前模式 `{mode:"mock"|"real"}`，受既有本機、Session 及隱私同意保護；前端不指定模式。工作階段建立失敗時可能回傳安全分類 `code`，包含 `NAVIGATION_BLOCKED`、`DNS_ERROR`、`TLS_ERROR`、`TIMEOUT`、`PLAYWRIGHT_MISSING`、`SECURITY_FEATURE_UNAVAILABLE`、`BROWSER_LAUNCH_FAILED`、`BROWSER_SETUP_FAILED`、`NAVIGATION_FAILED` 及 `HTTP_ERROR`，不回傳原始例外或網址。

公開頁工作階段新增隨機短效 `grant`：建立回應交給前端記憶體，後續 state、frame、input、cancel 請求以 `X-Controlled-Grant` 傳遞；後端只保留雜湊，並同時驗證登入身分及原始 Session。取消、登出或到期移除授權；有效期限不超過系統 Session。Mock 模式保持原契約。此機制不能撤銷外洩的系統 Session Cookie。

### 修課紀錄 JSON 確認匯入

`POST /api/course-history-import/preview` 與 `/commit` 的正式路徑目前一律關閉：前端聲明不能證明 MyFCU 身分，尚未有伺服器端核對機制。僅隔離 fixture 可測試預覽與寫入。匯入核心拒絕前端指定 user_id、要求本人聲明通過狀態與分類，未知成績可為 null；交易內鎖定並核對 Profile、重新比對，衝突拒絕、重複跳過。原始學分記錄需經核准套用 migration 011 後才可保存。

僅在測試環境、Mock、loopback、無 MySQL、指定 fixture 帳號且 `COURSE_HISTORY_IMPORT_FIXTURE=true` 時提供隔離記憶體替身，重啟後清空；不得與正式匯入或真實公開頁測試混用。

### 隔離 MySQL E2E（僅測試）

`ISOLATED_HISTORY_MYSQL_E2E=true` 只有在 `NODE_ENV=test`、Mock 開啟、真實模式關閉、MySQL 為 loopback 的 `33160` 或測試腳本明確指定的臨時埠、專用 `history_test` 帳號、隨機 `codex_history_` 測試資料庫且無 CA 設定時可啟動；後端綁定 loopback，且不載入專案環境檔。虛構登入身分必須與伺服器 Session 的兩個 fixture 身分之一一致，匯入資料來源須與該工作階段的擷取結果相符。這不是正式 MyFCU 身分驗證，正式匯入與真人入口仍關閉。

### Windows 本機 MyFCU 預覽（非正式匯入）

非 production 的 Windows 開發模式可明確設定 `LOCAL_MYFCU_PREVIEW=true`，不得與 Mock、公開頁、本人受控或隔離 MySQL E2E 模式同時啟用；後端綁定 loopback。沿用 `/api/controlled-browser/config` 與 sessions，模式為 `local`，同意後由本機非持久化 Chrome 視窗讓本人操作；Session、短效 grant 和 cookie 均由後端核對，取消、登出或逾時會終止。受攔截的頁面請求僅允許官方 HTTPS 同源、確認的主框架路徑及固定 banner iframe；WebSocket、WebRTC、WebTransport 與 service worker 關閉。取得的修課資料僅在記憶體供預覽，MyFCU 身分仍未驗證，正式匯入維持封鎖。此模式尚未通過真實網站及完整安全驗收。

Chrome 背景網路行為及異常退出時作業系統暫存尚未完整驗證；不得將頁面層攔截視為系統層防火牆。
# 本機自行聲明修課來源（隔離測試）

本機預覽設定啟用 `localSelfAttested` 時，可由同一個登入 Session 的使用者確認擷取來源及修課結果後呼叫既有匯入 API。此為學生聲明，並非校方身分驗證。後端僅接受該 Session 尚未逾時的完整擷取結果，使用 Session 的 numericId，禁止前端指定使用者。此模式僅限 Windows 非 production、loopback 及專用的 127.0.0.1:33160 隔離測試庫；正式匯入身分驗證阻擋不變。
# 本機修課資料自動匯入

Windows 本機 SessionImport 模式的快照預檢與確認匯入共用去重規則。已存紀錄的目錄課號或來源課號、學年、學期和已知數字成績均相同，且課名只差結尾的 `(Online)` 時，該筆計入 `skipped`，不產生衝突或寫入。

`POST /api/course-history-import/auto` 僅限受限制的本機自行聲明模式，使用目前 Session 並從伺服器端已完成的擷取工作階段取得資料，不接受使用者或課程資料。以來源課號及課名精確對照 `Courses.subid3` 與 `Courses.name`，不以班級或學期匹配；同一課號、課名的不同班次視為同一代碼。缺課號、目錄缺課或課名不符時，完整來源紀錄保存於歷史表且 catalog 為 NULL，不覆蓋既有紀錄。回傳新增、重複跳過、未匹配及其中衝突筆數；此聲明不是官方身分驗證。

使用 migration 015 後，新匯入的未匹配紀錄改為保存在歷史表，`catalog_course_code` 為 NULL，原始課號保存在 `source_course_code`。明確數字成績依 `score > 60` 計算通過，其餘未知為 NULL；原有待查表資料保留。正式身分驗證限制不變。
