# 系統開發與 MySQL 資料稽核報告

- 稽核日期：2026-08-04～2026-08-05
- 專案：個人化課表規劃推薦系統
- 稽核基準：`C:/Users/yamat/OneDrive/Downloads/系統開發與 DB 資料確認清單.md`
- 稽核方式：專案全檔搜尋、前後端呼叫鏈追蹤、正式 MySQL 唯讀查詢、實際排課函式驗證
- 資料庫：MySQL 8.0.45，database `defaultdb`
- 安全聲明：本次只執行 `SELECT`、`SHOW`、`information_schema` 查詢及本機唯讀程式驗證，未執行 `INSERT`、`UPDATE`、`DELETE`、`ALTER`、`DROP`

> 本文件是後續修正工作的稽核依據。不得把「程式碼存在欄位」視為「正式 DB 有可用資料」，也不得把本機 JSON 或前端 fallback 視為正式 MySQL 資料。

## 一、執行摘要

正式 MySQL 目前只有四張表：

| 資料表 | 筆數 |
|---|---:|
| `Courses` | 3,086 |
| `Course_Sections` | 3,560 |
| `Course_Reviews` | 181 |
| `User_Profiles` | 1 |

關鍵結果：

1. `Courses.type` 只有 `必修` 1,760 筆與 `選修` 1,326 筆。
2. `Course_Sections` 全部是 `114／下學期`，沒有跨學期資料。
3. `current_amount` 3,560 筆全部為 0，且無 capacity/limit 欄位。
4. `teacher` 缺 87 筆，`room` 缺 153 筆；缺值以空字串表示。
5. 評價 181/181 筆可透過 `selection_code` 對到 section，但只覆蓋 181/3,560＝5.08% section。
6. `workload` 與 `coolness` 181/181 筆完全相等，疑似匯入欄位映射問題，不能直接相信 workload 方向。
7. `rag_context` 與 `rag_tag` 3,560 筆均有內容，但不是可靠的結構化評量方式欄位。
8. `User_Profiles` 只有一人；`completed_courses=[]`、`max_credits=NULL`、`preference_tags=["#不點名"]`。
9. DB 不存在互動、推薦事件、選課歷史、成績、先修、watchlist、技能及正課/實習配對表。
10. 以正式 profile 與全庫課程實際執行排課，只得到 3 個不重複方案，而非程式定義的 5 個；三個方案 `preferenceScore` 均為 0。

## 二、正式執行資料來源地圖

### 2.1 課程搜尋

```text
client/src/services/api.js coursesAPI.search()
→ GET /api/courses
→ server/src/routes/courses.js
→ server/src/skills/courseQuery.js searchCourses()
→ server/src/db/database.js getAll('courses')
→ getMysqlCourses()
→ MySQL Course_Sections INNER JOIN Courses
→ Node.js 記憶體內執行 filters
```

注意：

- `courses` 在設定 `DB_*` 時一定走 MySQL。
- 專案已沒有 `server/data/courses.json`，沒有正式可用的課程 JSON fallback。
- 搜尋 route 不處理 grade/class。
- category 搜尋比對的是 DB 原始 `Courses.type`，不會套用排課器的衍生分類。

### 2.2 個人化推薦與自動排課

REST 路徑：

```text
client scheduleAPI.generate()
→ POST /api/schedule/generate
→ routes/schedule.js
→ memoryService.getUserPreferences()
→ database.getAll('user_preferences')
→ numeric user：MySQL User_Profiles
→ non-numeric/demo user：server/data/user_preferences.json
→ constraintService.buildScheduleConstraints()
→ courseQuery.searchCourses() 或 getAll('courses')
→ MySQL Courses + Course_Sections
→ scheduler.generateSchedule()
```

AI Agent 路徑：

```text
POST /api/chat
→ agentService.handleChat()
→ run_csp_scheduler tool
→ buildScheduleConstraints()
→ getAll('courses')
→ scheduler.generateSchedule()
```

個人化訊號：

- 興趣：`preferredKeywords`、`interests`、`preference_tags` 與 `rag_tag/rag_context` 比對。
- 集中排課：依使用天數計分。
- 涼課方案：目前 scheduler 只掃 `rag_context` 關鍵字，沒有接 `Course_Reviews` 分數。
- 所有權重是固定 0/1，不是從使用者行為學習。

### 2.3 必修判斷、課程分類與年級

```text
User_Profiles.department + grade_level
+ users.json className（暫存）
→ constraintService
→ courseScope.buildStudentScope()
→ parseClassName(Courses.dept)
→ isRequiredForStudent()
```

- `Courses.dept` 實際是班級或開課群組名稱，如「資訊三甲」，不是完整系所名稱。
- A 類系所班級可由 `departmentMapping.js` 與 `courseScope.js` 推導系所、學制、年級、班別。
- B～F 類共同科目、學院班、英語班、學程與未完成課程適用規則尚未完成。
- 核心選修與系外選修只在 scheduler 前處理時由本機規則衍生。
- 課程搜尋仍只看到原始必修/選修。

### 2.4 課程評價

```text
GET /api/reviews/* 或 GET /api/courses/:id
→ reviewSearch.js / courseQuery.js
→ database.getAll('reviews')
→ getMysqlReviews()
→ Course_Reviews LEFT JOIN Course_Sections ON selection_code
```

- API 的 `review.courseId` 是 join 後的 `Course_Sections.section_id`。
- `Course_Reviews` 沒有 teacher/year/semester，評價本身無法證明屬於哪位教師或哪一學期。

### 2.5 畢業學分

```text
GET /api/graduation/:studentId
→ routes/graduation.js
→ users.json 或 User_Profiles 找使用者
→ data/graduationRequirements.js 取得需求學分
→ users.json earnedCredits / completedCredits 取得已修學分
→ MySQL 課程只用來產生一筆簡單建議
```

- 畢業需求不是 DB 資料，而是本機靜態 JS。
- demo 的分類已修學分來自 `users.json`，不是成績或歷史修課計算。
- API 失敗時，`GraduationPage.jsx` 會顯示完整虛構 fallback。

### 2.6 使用者偏好

- numeric user ID：讀寫 MySQL `User_Profiles` 支援欄位。
- 學號形式的 non-numeric user ID：讀寫 `server/data/user_preferences.json`。
- 班別永遠暫存在 `server/data/users.json`。
- `minCredits`、多數 boolean 偏好沒有 MySQL 欄位。
- Dashboard 另使用 `localStorage.fcu_initial_prefs`。

### 2.7 watchlist、已選課程、技能樹

- watchlist：`users.json`；有 API，但前端零呼叫。
- 已選課程：`SchedulePage` React state 與當次 request，不持久化。
- watching/selected 狀態：scheduler 支援，但只取當次 request。
- 技能樹：Graduation API 原樣回傳 `users.json.skillTree`；Dashboard 則完全硬編碼。

## 三、逐項稽核

狀態只能使用：

1. 已確認存在
2. 已確認不存在
3. 部分存在，但不足以支援需求
4. 只能從程式碼推測
5. 目前無法確認，需要查詢實際 MySQL 資料

### #12：課程分類粒度

**狀態：部分存在，但不足以支援需求**

**修復進度（2026-08-07）：🟡 部分完成**。#12A 已讓搜尋、排課與 AI Agent 共用分類流程，完成必修、核心選修、一般選修與系外選修；#12B 通識正式分類表、領域及適用學年度規則尚未建立，因此整項仍未結案。

**結論**：MySQL 只能提供必修/選修。排課時可由本機規則補出資工核心選修與部分系外選修，但沒有完整通識分類，且其他系所沒有相同規則。

**程式碼證據**：

- `server/src/db/database.js:433-461`：`getMysqlCourses()` 將 `Courses.type` 直接映射為 category/type。
- `server/src/skills/courseCategory.js:29-47`：排課前推導資工核心選修及系外選修。
- `server/src/data/csCurriculum.js:85-167`：資工核心選修 15 門、選修 53 門靜態清單。
- `server/src/skills/courseQuery.js:31-33`：搜尋只比較原始 category/type。
- `server/src/data/generalEducation.js:23-50`：僅處理不計畢業學分課程，非完整通識分類。

**資料庫證據**：`Courses.type`＝必修 1,760、選修 1,326；`dept` 有 562 種混合語意；無課程分類或畢業認列表。

**正式執行資料來源**：MySQL 原始類別；scheduler 額外套本機資工規則。

**問題與影響**：搜尋「通識」會是 0 筆；搜尋與排課看到不同 category；其他系所無法正確分類，影響搜尋、推薦、排序、畢業頁與 UI badge。

**最小建議**：搜尋與排課先共用同一分類函式；後續建立帶學年度與適用系所的正式分類規則表。

### #13：學生適用的必修範圍

**狀態：部分存在，但不足以支援需求**

**結論**：A 類系所班級可依系所、年級及班別判斷；B～F 類適用對象仍未知。

**程式碼證據**：

- `server/src/skills/courseScope.js:96-147`：解析班級名稱。
- `server/src/skills/courseScope.js:178-205`：建立學生 scope。
- `server/src/skills/courseScope.js:208-240`：本人必修與他人必修判斷。
- `server/src/db/database.js:325-370`：班別暫存在 `users.json`。
- `server/src/services/constraintService.js:47-56`：排課合併系所、年級、學制、班別。

**資料庫證據**：`User_Profiles` 有 department、grade_level；沒有入學年度、學制、學院、學程、班別。正式 profile 是資工三年級，本機 className 卻是「資訊二乙」。

**正式實測**：排課忽略不一致班別，排除 1,576 門他人必修；另有 506 門共同/跨系必修只能降為一般候選。

**問題與影響**：共同必修可能誤排或漏排；profile 與 JSON 可能漂移；畢業規則沒有依入學年度選擇。

**最小建議**：先補 profile 的入學年度、學制、班別；共同科目另建立適用規則。

### #8：歷史修課、先修與多學期規劃

**狀態：部分存在，但不足以支援需求**

**結論**：只有空的 `completed_courses` JSON；沒有成績、通過狀態、抵免、先修規則或跨學期 section。

**程式碼證據**：

- `server/src/db/database.js:406-424`：讀取 completed_courses。
- `server/src/services/constraintService.js:81-86`：傳 completed/retake IDs。
- `server/src/skills/scheduler.js:634-658`：只依 completed ID 排除，沒有先修鏈。

**資料庫證據**：正式 `completed_courses=[]`；全部 section 為 114 下學期；無 prerequisite、grades、歷史選課、抵免表。

**問題與影響**：無法判斷修課是否通過、重補修與先修資格；不能產生多學期畢業路徑。

**最小建議**：建立 `user_id + subid3 + term` 修課結果表，以及獨立先修/擋修規則表。

### #15：正課與實習綁定

**狀態：部分存在，但不足以支援需求**

**結論**：P 後綴高度可信為實習/實驗，但沒有正式共同修課關係，scheduler 不會自動綁定。

**資料庫證據**：

- P 結尾 188 筆、46 種課號。
- 188/188 課名含「實習」或「實驗」。
- 185/188 列可找到去除 P 後的 base code。
- 無 base code 的兩種課號：`BUS1121P 統籌科目實習(二)`、`HY2073P 水質分析實驗`。

**程式碼證據**：`server/src/skills/scheduler.js:220-239` 只把 P 與 base 視為不同課號，沒有共同修課邏輯。

**問題與影響**：無法證明每組是否必須共修，可能漏排或錯綁班次。

**最小建議**：新增 co-requisite 配對與例外資料；P 規則只能用來產生待確認候選。

### #4：結構化評分與課程特徵

**狀態：部分存在，但不足以支援需求**

**結論**：五項評分完整但覆蓋率低；RAG 完整但缺可靠的結構化評量欄位；scheduler 未使用評價分數。

**資料庫證據**：

- 181 筆評價的 sweetness/coolness/workload/value/overall 均 0 空值、值域 1～5。
- 評價覆蓋率 5.08%。
- rag_context/rag_tag 3,560 筆均有值。
- rag_context 命中：期中 3、期末 15、報告 251、分組/小組 196、英文/英語 285、實作/實驗/專題 1,189、涼/容易等 26。

**程式碼證據**：

- `database.js:248-276` 映射評分。
- `reviewSearch.js:28-70` 涼課 API 使用評分。
- `scheduler.js:242-248` scheduler 涼課只掃文字。
- `scheduler.js:145-173` 多個主觀偏好仍作硬過濾。

**問題與影響**：評價推薦與排課推薦使用不同特徵；文字沒提及不代表沒有考試/報告。

**最小建議**：先將評價聚合接入 scheduler，缺評價時才 fallback；結構欄位要支援 unknown。

### #5：評價與 section 對應

**狀態：部分存在，但不足以支援需求**

**結論**：目前單一學期 181 筆評價可 100% 對應 section，但老師、學期及 workload 語意仍不可靠。

**資料庫證據**：

- 有 FK：`Course_Reviews.selection_code → Course_Sections.selection_code`。
- 181/181 match，selection_code 在 section 唯一。
- 評價表無 teacher/year/semester。
- workload 與 coolness 181/181 相等。

**程式碼證據**：

- `database.js:464-488` 以 selection_code join。
- `reviewStats.js:55-67` 使用 `6 - workload` 當輕鬆度。

**問題與影響**：未來 selection_code 重用可能串錯；目前也不能證明評價屬於當前老師；workload 排序可能方向錯誤。

**最小建議**：先確認來源欄位映射；評價增加 subid3、teacher、term 或永久 section key。

### #2：互動紀錄

**狀態：已確認不存在**

正式 DB 無 `interaction_logs`、`recommendation_events`、`schedule_decisions`。`chat_history.json` 只記對話文字；`saved_schedules.json` 只記儲存課表，均不足以回答曝光、點擊、加入、移除或採用。

**影響**：不能訓練個人化、衡量轉換或追蹤推薦結果。

**最小建議**：先建立 append-only event table，至少包含 user、course/section、plan、event_type、timestamp 與 recommendation context。

### #6：協同過濾

**狀態：已確認不存在**

正式 DB 只有一位使用者，無歷史選課、行為矩陣，評價也無 user_id；程式中不存在相似使用者或協同過濾演算法。

**影響**：無法提供相似學生推薦。

**最小建議**：近期明確採內容式/規則式推薦；累積事件後再評估協同過濾。

### #7：個人化權重學習

**狀態：部分存在，但不足以支援需求**

`scheduler.js:284-344` 有興趣、集中、涼課三個固定 0/1 權重與 preference score，但不是由行為資料學習。DB 只有 `preference_tags=["#不點名"]`，無曝光、採用或退選資料。

**影響**：個人化只能依手動偏好，不能隨使用者行為調整。

**最小建議**：先保存推薦上下文與採用結果，再做可解釋的增量權重更新。

### #9：探索機制

**狀態：已確認不存在**

`scheduler.js:38-64` 的五個 variant 與 `scheduler.js:693-700` 的排序都是確定性規則；全專案無 random exploration、bandit、曝光或探索結果紀錄。

**影響**：無法測量探索成效，推薦容易固化。

**最小建議**：先有事件表，再加入小比例且可識別的探索候選。

### #3：硬過濾改軟懲罰所需資料

**狀態：部分存在，但不足以支援需求**

時間資料完整，但主觀特徵不足；期中、分組、英文、報告等目前仍在 `hardConstraintReason()` 中作硬排除。

**資料庫證據**：time_str/time_bitmask 0 缺值，217 筆含 `00` 未定時段；評價覆蓋率 5.08%；期中文字僅 3/3,560 命中。

**影響**：unknown 可能被當成 false，候選被錯誤排除。

**最小建議**：衝堂與明確 blocked period 維持硬限制；課型、負擔、考試方式改為含 unknown 處理的軟分數。

### #10：多方案塌縮

**狀態：部分存在，但不足以支援需求**

程式定義五個 variant，但真實資料/profile 只產生三個 unique plans：`required_first`、`compact`、`easy_score`；`interest` 與 `max_credits` 與其他方案重複後被去除。三個方案 `preferenceScore=0`。

**程式碼證據**：

- `scheduler.js:38-64`：五個 variant。
- `scheduler.js:786-793`：只依課程 ID 集合去重。
- `scheduler.js:242-248`：easy 未使用 review。
- `scheduler.js:259-279`：interest 依關鍵字與 RAG。

**問題與影響**：`#不點名` 被當作已表達興趣，但沒有任何匹配；系統不會提示偏好無效；方案數少於設計值。

**最小建議**：修正 tag contract、接入 reviews，並為方案設定最低集合/時段多樣性。

### F13：畢業頁分類學分

**狀態：部分存在，但不足以支援需求**

**修復進度（2026-08-07）：🟡 部分完成**。缺少歷史資料時已停止顯示未知進度與缺口，demo 使用者亦已匯入 53 門歷史課程；但 API 失敗時的前端虛構 fallback 尚未移除，正式通識與六分類規則仍待補齊。

需求學分來自 `graduationRequirements.js` 靜態官方對照；已修分類學分來自 demo `users.json`，不是正式 MySQL 歷史修課計算。`GraduationPage.jsx:31-57` 在 API 失敗時顯示虛構的 107/128、缺口與推薦。

**影響**：畢業頁看似完整，但不能代表正式學生資料。

**最小建議**：未有修課結果前明確顯示無法計算；移除成功式 mock fallback。

### F7：年級篩選

**狀態：✅ 已完成（2026-08-06）**

後端已從完整班級解析 `department`、`grade`、`className`，課程 API 強制要求學生班級範圍；缺少任一欄位時回傳指定 HTTP 400，不再廣泛搜尋。前端搜尋、排課課程抽屜及設定頁皆使用 profile 的解析結果。

後端可解析班級年級，但搜尋 API 不支援 grade/class。

**程式碼證據**：

- `SearchPage.jsx:42-59`：只送 department、keyword、category。
- `routes/courses.js:12-25`：不讀 grade/class。
- `courseQuery.js:11-72`：無年級 filter。
- `courseQuery.js:105-124`：只有 `/courses/classes` 使用 grade。
- `SetupPage.jsx:44`：雖送 grade，後端會忽略。

**影響**：UI 年級、班級不影響搜尋；Setup 已修選修清單可能為空。

**最小建議**：搜尋 route 接受 grade/className，並共用 `parseClassName()`。

### F9：最低與目標學分持久化

**狀態：部分存在，但不足以支援需求**

MySQL 只有 `max_credits`；min 永遠由 `database.js:418-420` 回傳預設 12。Profile UI 可編輯 min/max，但 numeric user 只能持久化 max，實際 `max_credits=NULL`。

**影響**：重新登入或換環境後最低學分會重設。

**最小建議**：建立獨立 user scheduling preferences 表。

### F10：技能樹

**狀態：部分存在，但不足以支援需求**

`users.json:28-37` 有 demo skillTree；Graduation API 原樣回傳；`DashboardPage.jsx:268-308` 則硬編碼四個 Lv.4 與總分 80。DB 無 grades、skill、course_skill_mapping 或學生能力表。

**影響**：畫面「基於歷年成績動態生成」的宣稱不實。

**最小建議**：在正式資料鏈完成前標示為 demo 或隱藏動態宣稱。

### F4：偏好 UI 與 preference_tags

**狀態：部分存在，但不足以支援需求**

前端固定 12 個 hashtag，但 DB 實際唯一值為 `#不點名`，前端沒有此選項。Setup 送 `selectedTags`，MySQL 更新函式只認 `preferenceTags` 或 `preferredCategories`；讀取時卻把 preferenceTags 當 interests。

**影響**：無法正確回填/儲存；DB tag 在排課中無匹配，preference score 為 0。

**最小建議**：定義 canonical preference key，不要直接以中文 UI label 作資料值。

### F6：關注與加選狀態持久化

**狀態：部分存在，但不足以支援需求**

scheduler 理解 watching/selected，但狀態只取 request；`SchedulePage` 使用 React state，重新整理即遺失，且目前只送 courseIds，未送 selectedCourseIds。

**資料庫證據**：無 watchlist、selected_courses、course_state 表。

**最小建議**：建立 user-section-state 表，狀態列舉 watching/selected/removed。

### F11：watchlist API

**狀態：部分存在，但不足以支援需求**

`client/src/services/api.js:33-37` 定義 `updateWatchlist()`，但全前端零呼叫；`routes/auth.js:49-66` 會整份重寫 `users.json`；GraduationPage 的加號按鈕沒有 onClick。

**影響**：只能顯示 demo watchlist，不能真正新增或跨環境保存。

**最小建議**：先定義 MySQL section-level watchlist contract，再接 UI。

### D5：資料規模與跨學期資料

**狀態：已確認存在**

User 1 人；section 全部為單一學期；completed_courses 空；max_credits NULL；無成績與歷史選課。

**影響**：不足以支援協同過濾、多學期規劃與完整個人化。

### D4：current_amount 全為 0

**狀態：已確認存在**

3,560/3,560 筆為 0，min=0、max=0；schema 無 capacity/limit 欄位。程式雖映射 currentAmount，但推薦與排課未使用。

**影響**：不能判斷熱門度、餘額或滿班風險。

**最小建議**：追查原始來源；釐清前 UI 不應解讀成真實 0 人。

### D7：preference_tags 值域不一致

**狀態：已確認存在**

正式 DB 為 `["#不點名"]`，前端清單無此值；實際排課把它視為已表達興趣，但三個方案 preference score 全為 0。

**影響**：系統不提示補偏好，方案卻沒有個人化。

**最小建議**：建立合法值 mapping；未知 legacy tag 必須顯示警告或轉換。

### D6：teacher、room 缺漏

**狀態：已確認存在**

teacher 空字串 87/3,560＝2.44%；room 空字串 153/3,560＝4.30%。欄位 NOT NULL，所以無法由 NULL/空字串區分未定與匯入問題。

**影響**：教師篩選、UI 顯示、教室資訊與評價歸屬。

**最小建議**：匯入端保存 missing reason；UI 統一顯示「未定」。

## 四、整體狀態表

| 編號 | 狀態 | 主要證據 | 需查正式 DB | 功能影響 | 優先 |
|---|---|---|---|---|---|
| #12 | 🟡 部分完成（#12A 完成，#12B 待辦） | 四類已統一；通識正式分類未建立 | 已查 | 搜尋/排課/畢業 | P0 |
| #13 | 部分存在，但不足以支援需求 | A 類可判，B～F 未定 | 已查 | 必修誤排 | P0 |
| #8 | 部分存在，但不足以支援需求 | completed JSON 空，無歷史/先修 | 已查 | 畢業路徑 | P1 |
| #15 | 部分存在，但不足以支援需求 | 188 P 課均實習/實驗，無配對表 | 已查 | 正實習漏排 | P1 |
| #4 | 部分存在，但不足以支援需求 | 評價完整但覆蓋 5.08% | 已查 | 推薦品質 | P1 |
| #5 | 部分存在，但不足以支援需求 | match 100%，workload 映射可疑 | 已查 | 涼課排序 | P0 |
| #2 | 已確認不存在 | 無事件表/寫入鏈 | 已查 | 推薦學習 | P1 |
| #6 | 已確認不存在 | 1 user、無行為矩陣 | 已查 | 協同過濾 | P3 |
| #7 | 部分存在，但不足以支援需求 | 固定 0/1 權重 | 已查 | 個人化 | P1 |
| #9 | 已確認不存在 | 無探索/曝光紀錄 | 已查 | 線上學習 | P3 |
| #3 | 部分存在，但不足以支援需求 | 時間完整、課型不足且仍硬濾 | 已查 | 空課表/錯排 | P0 |
| #10 | 部分存在，但不足以支援需求 | 5 variant 實際只剩 3 | 已查 | 方案比較 | P1 |
| F13 | 🟡 部分完成 | 缺資料提示與歷史匯入完成；API fallback 待移除 | 已查 | 畢業頁 | P0 |
| F7 | ✅ 已完成 | profile 解析並強制 department/grade/className | 已查 | 課程搜尋 | 完成 |
| F9 | 部分存在，但不足以支援需求 | 只有 max 可持久化 | 已查 | 偏好保存 | P1 |
| F10 | 部分存在，但不足以支援需求 | JSON/demo/硬編碼 | 已查 | 技能樹 | P2 |
| F4 | 部分存在，但不足以支援需求 | DB `#不點名` 不在 UI | 已查 | 個人化 | P0 |
| F6 | 部分存在，但不足以支援需求 | request state，無表 | 已查 | 關注/加選 | P1 |
| F11 | 部分存在，但不足以支援需求 | JSON API 存在但零呼叫 | 已查 | watchlist | P1 |
| D5 | 已確認存在 | 單 user、單學期 | 已查 | 全推薦系統 | P1 |
| D4 | 已確認存在 | current_amount 全 0 | 已查 | 熱門/餘額 | P2 |
| D7 | 已確認存在 | tag 不一致且 score=0 | 已查 | 個人化 | P0 |
| D6 | 已確認存在 | teacher 87、room 153 缺漏 | 已查 | UI/篩選 | P2 |

## 五、已確認可使用且正式程式有讀取的資料

### MySQL

- `Courses`
  - `course_id`, `name`, `credits`, `type`, `dept`, `subid3`
- `Course_Sections`
  - `section_id`, `selection_code`, `course_id`
  - `teacher`, `room`
  - `time_str`, `time_bitmask`
  - `year`, `semester`
  - `rag_context`, `rag_tag`
  - `current_amount` 有讀取但尚未用於推薦或排課
- `Course_Reviews`
  - `selection_code`, `Reviews_tags`, `Review_content`
  - `sweetness`, `coolness`, `workload`, `value`, `overall`, `review_count`
- `User_Profiles`
  - `department`, `grade_level`, `preference_tags`, `avoid_time`, `completed_courses`, `max_credits`

### 本機 JSON

- `users.json`：登入、班別、watchlist、earned credits、skillTree
- `user_preferences.json`：non-numeric user 偏好
- `saved_schedules.json`：儲存課表
- `chat_history.json`：對話歷史

## 六、存在但未使用或未充分使用的資料

1. `Course_Reviews` 分數：reviews API 使用，但 scheduler 不使用。
2. `current_amount`：API 映射，但推薦/容量檢查不使用，且全為 0。
3. `rag_tag`：interest variant 使用，搜尋與多數 UI 未充分使用。
4. `year/semester`：API 回傳，但無學期篩選或多學期規劃。
5. `users.json.skillTree`：Graduation API 會回傳，Dashboard 改用固定值。
6. `authAPI.updateWatchlist()`：定義完成但前端零呼叫。
7. SearchPage 的 grade/classStr：有 UI state，但不送 API。
8. `server/src/db/schema.sql`：舊 SQLite schema，正式 MySQL 不會套用。

## 七、完全缺少的資料

正式 MySQL 不存在：

- `interaction_logs`
- `recommendation_events`
- `schedule_decisions`
- `watchlist`
- `selected_courses`
- `graduation_rules`
- `prerequisite_rules`
- `grades`
- 正式歷史選課與加退選
- 抵免、通過狀態
- `course_skill_mapping`
- 學生技能進度
- 正課/實習配對或 co-requisite
- 結構化評量方式
- 使用者入學年度、學制、班別、學院、學程

## 八、前後端不一致清單

1. Search 年級、班級 UI 不影響 API 查詢。
2. Search/Schedule 提供「通識」，MySQL 搜尋只能匹配必修/選修。
3. Search 條件頁預設送 `language=中文 (Chinese)`；course 沒有 language，會把全部課程濾掉。
4. Setup 送 grade，course route 不處理。
5. Setup 以完整系名搜尋；DB `Courses.dept` 是班級名稱。
6. Setup 送 selectedTags；MySQL 更新只認 preferenceTags/preferredCategories。
7. Profile 可編輯 min credits，但 MySQL 無欄位。
8. DB `#不點名` 不在前端偏好清單。
9. Dashboard 技能樹宣稱動態生成，實際硬編碼。
10. Graduation API 失敗時顯示虛構成功資料。
11. watchlist API 存在，但 UI 沒有呼叫或按鈕事件。
12. SchedulePage 選課只送 courseIds，沒有明確傳 selectedCourseIds/courseStates。

## 九、唯讀 SQL

以下 SQL 均為唯讀，可由開發者重跑：

```sql
SHOW TABLES;

SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
ORDER BY TABLE_NAME, ORDINAL_POSITION;

SELECT 'Courses' AS table_name, COUNT(*) AS row_count FROM Courses
UNION ALL SELECT 'Course_Sections', COUNT(*) FROM Course_Sections
UNION ALL SELECT 'Course_Reviews', COUNT(*) FROM Course_Reviews
UNION ALL SELECT 'User_Profiles', COUNT(*) FROM User_Profiles;

SELECT type, COUNT(*) AS n
FROM Courses
GROUP BY type
ORDER BY n DESC;

SELECT dept, COUNT(*) AS n
FROM Courses
GROUP BY dept
ORDER BY n DESC, dept;

SELECT year, semester, COUNT(*) AS n
FROM Course_Sections
GROUP BY year, semester;

SELECT
  COUNT(*) AS total,
  SUM(teacher IS NULL OR TRIM(teacher) = '') AS teacher_missing,
  SUM(room IS NULL OR TRIM(room) = '') AS room_missing,
  SUM(time_str IS NULL OR TRIM(time_str) = '') AS time_missing,
  SUM(current_amount = 0) AS current_zero,
  SUM(current_amount > 0) AS current_positive,
  MIN(current_amount) AS current_min,
  MAX(current_amount) AS current_max,
  SUM(rag_context IS NULL OR TRIM(rag_context) = '') AS rag_context_missing,
  SUM(rag_tag IS NULL OR JSON_LENGTH(rag_tag) = 0) AS rag_tag_missing
FROM Course_Sections;

SELECT
  COUNT(*) AS review_rows,
  SUM(cs.section_id IS NOT NULL) AS matched_rows,
  ROUND(100 * SUM(cs.section_id IS NOT NULL) / COUNT(*), 2) AS match_pct
FROM Course_Reviews r
LEFT JOIN Course_Sections cs
  ON BINARY cs.selection_code = BINARY r.selection_code;

SELECT
  COUNT(DISTINCT r.selection_code) AS reviewed_sections,
  (SELECT COUNT(*) FROM Course_Sections) AS all_sections,
  ROUND(
    100 * COUNT(DISTINCT r.selection_code)
      / (SELECT COUNT(*) FROM Course_Sections),
    2
  ) AS coverage_pct
FROM Course_Reviews r;

SELECT
  COUNT(*) AS total,
  SUM(sweetness IS NULL) AS sweetness_null,
  SUM(coolness IS NULL) AS coolness_null,
  SUM(workload IS NULL) AS workload_null,
  SUM(value IS NULL) AS value_null,
  SUM(overall IS NULL) AS overall_null,
  SUM(workload = coolness) AS workload_equals_coolness
FROM Course_Reviews;

SELECT
  p.subid3,
  p.name,
  p.credits,
  p.type,
  p.dept,
  EXISTS (
    SELECT 1
    FROM Courses base
    WHERE BINARY base.subid3 =
          BINARY LEFT(p.subid3, CHAR_LENGTH(p.subid3) - 1)
  ) AS has_base_code
FROM Courses p
WHERE UPPER(TRIM(p.subid3)) LIKE '%P'
ORDER BY p.subid3, p.dept;

SELECT
  user_id,
  department,
  grade_level,
  preference_tags,
  avoid_time,
  completed_courses,
  max_credits
FROM User_Profiles;

SELECT requested.table_name,
       CASE WHEN actual.TABLE_NAME IS NULL THEN 'missing' ELSE 'exists' END AS status
FROM (
  SELECT 'interaction_logs' AS table_name
  UNION ALL SELECT 'recommendation_events'
  UNION ALL SELECT 'schedule_decisions'
  UNION ALL SELECT 'watchlist'
  UNION ALL SELECT 'selected_courses'
  UNION ALL SELECT 'graduation_rules'
  UNION ALL SELECT 'prerequisite_rules'
  UNION ALL SELECT 'completed_courses'
  UNION ALL SELECT 'grades'
  UNION ALL SELECT 'course_skill_mapping'
) requested
LEFT JOIN information_schema.TABLES actual
  ON actual.TABLE_SCHEMA = DATABASE()
 AND actual.TABLE_NAME = requested.table_name;
```

## 十、開發優先順序

### P0：會讓現有功能產生錯誤結果

1. 修正 Search grade/class/language/category contract。
2. 搜尋不得直接以 `通識` 匹配 `Courses.type`。
3. 確認 workload 匯入映射與分數方向。
4. 統一 preference tag contract，處理 legacy `#不點名`。
5. 移除 GraduationPage 虛構成功 fallback。
6. 釐清或保守阻擋 B～F 類必修適用規則。

### P1：主要功能無法完整實作

1. 建立歷史修課、成績、先修、抵免資料。
2. 建立正課/實習共同修課規則。
3. 將 reviews 聚合接入 scheduler。
4. watchlist/selected 狀態持久化。
5. 目標學分及偏好正式持久化。
6. 增加多方案最低多樣性條件。

### P2：資料品質或 UI 顯示

1. teacher/room 缺值顯示及來源狀態。
2. current_amount 全 0 的來源與 UI 語意。
3. 技能樹 demo 標示或暫時隱藏。
4. 避免將舊 `schema.sql` 誤認為正式 MySQL schema。

### P3：未來功能所需資料

1. interaction/recommendation event。
2. 探索機制。
3. 協同過濾。
4. 正式 course-skill mapping 與技能進度。

## 十一、交給 Claude Code 的修正注意事項

1. 修正前必須重新讀取根目錄 `AGENTS.md`。
2. 不得把本機 JSON mock 當成正式課程、評價或畢業資料。
3. 每次修改前先列出預計修改檔案並取得使用者確認。
4. API 或資料格式變動時同步更新 `docs/API_SPEC.md`、`docs/DATA_SCHEMA.md`。
5. scheduler 變動必須符合 `docs/SCHEDULING_LOGIC.md` 與 `docs/COURSE_SELECTION_RULES.md`。
6. 影響 UI、排課結果或 API 回應時，必須啟動 app 做瀏覽器 A/B 驗證。
7. 不得修改正式 DB，除非使用者另行明確授權；DB 稽核只能使用唯讀 SQL。
8. 正式資料不足時必須回報 unknown，不得用看似合理的 mock 數字掩蓋。
