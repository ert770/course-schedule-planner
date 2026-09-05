# Data Schema

目前後端主要課程資料來源為 MySQL database `defaultdb`。`server/data/*.json` 仍保留給 demo 登入與已儲存課表。Raw Chat 不再使用 JSON；舊 `chat_history.json` 只等待經確認的清理，不是 runtime 資料源。

## 未設定 `DB_*` 時的行為

`courses` 與 `reviews` **只存在於 MySQL**——種子資料已於 2026-08-02 移除，
`server/data/` 沒有對應的 JSON 檔。未設定 `DB_HOST` / `DB_USER` / `DB_NAME` 時，
`database.js` 會**丟出明確錯誤**，而不是回傳空陣列。

先前的行為是靜默回傳 `[]`（檔案根本不存在），排課因此回報「找不到符合條件的候選課程」
——看起來像篩選條件太嚴，實際上是資料庫沒接上。這是最難查的一種失敗。

`user_preferences` 不在此限：它有合法的本機 demo 資料，未接資料庫時仍可運作。

## MySQL Tables

SQL 查詢必須使用真實表名與欄位名稱，並用反引號包住大小寫或特殊字元欄位。

### #33 Privacy foundation

分析與聊天表只使用 `subject_id = "v1:" + HMAC-SHA-256(ANALYTICS_ID_SECRET, canonicalId)`，
不存學號，且刻意不對 `User_Profiles` 建 FK。HMAC secret 只存在環境／密鑰管理系統。

| Table | 主要欄位 | 用途 |
| --- | --- | --- |
| `Privacy_Subject_State` | `subject_id`, `last_active_at`, `service_withdrawn_at` | 保存期限與撤回狀態 |
| `Privacy_Consents` | `recorded_sequence`, `consent_id`, `subject_id`, `purpose`, `granted`, `policy_version`, `decided_at`, `source`, `request_id` | append-only 同意決定；sequence 決定同毫秒寫入的先後 |
| `Privacy_Audit_Log` | `audit_id`, `subject_id`, `action`, `resource_type`, `outcome`, `request_id`, `occurred_at`, `metadata_json` | 不含 payload 的稽核紀錄 |
| `Privacy_Data_Requests` | `request_id`, `subject_id`, `request_type`, `token_hash`, `expires_at`, `completed_at`, `status` | 短效、單次刪除確認；只存 token hash |
| `Chat_Messages` | `message_id`, `subject_id`, `role`, `ciphertext`, `iv`, `auth_tag`, `key_version`, `created_at`, `expires_at` | AES-256-GCM Raw Chat，30 天到期 |
| `Interaction_Events` | `event_id`, `subject_id`, `event_type`, `occurred_at`, `expires_at`, `idempotency_key`, `catalog_course_code`, `section_id`, `plan_id`, `variant_id`, `source`, `feedback_reason`, `exposure_json` | Roadmap #2 互動事件，180 天到期 |

`ciphertext`、每筆獨立 96-bit `iv` 與 `auth_tag` 缺一不可；解密驗證失敗必須拒絕資料，
不得回傳部分內容。`key_version` 讓未來金鑰輪替可辨識資料使用哪一版金鑰。

三種 `purpose`：`service_processing`（必要）、`personalization_learning`（可選）、
`aggregate_research`（可選）。#2 寫 interaction event 前必須檢查第二項，並將 #29 envelope
中的 canonical `userId` 換成 `subject_id`；不得將兩者一起持久化。

### `Interaction_Events`（Roadmap #2）

`server/migrations/003_interaction-events.up.sql`，由
`server/scripts/interactionEventsMigration.js` 套用（dry-run 為預設，`--apply` 另需
`--confirm-shared-mysql`）。

- **沒有任何學號欄位。** 只存 `subject_id`，與其他隱私表一致。
- `(subject_id, idempotency_key)` 為 UNIQUE：去重不只靠應用層純邏輯，並行請求擠過
  「檢查」與「寫入」之間的空隙時由資料庫擋下。
- `expires_at` = `occurred_at` + `PRIVACY_RETENTION.interactionEventDays`（180 天），
  由 `npm run cleanup:privacy` 一併清理。
- `exposure_json` 存 `surface`／`trigger`／ordered `candidateSet`／`displayedSet`。
- `model_version` 與 `profile_schema_version` 由 server 當下的版本填入，不接受呼叫端宣告。
- **Roadmap #31**：`academic_year`／`semester` 從這輪起不再只是來源標記，也是
  `preferenceLearning.js` 時間衰減的**實質輸入**——`learnPreferenceWeights()` 用它們
  判定一筆事件是否屬於舊學期並降權（見下方 `Learned_Preference_Weights` 的說明）。

### `Learned_Preference_Weights`（Roadmap #30）

`server/migrations/006_learned-preference-weights.up.sql`，由
`server/scripts/learnedWeightsMigration.js` 套用（同一套 dry-run／`--apply
--confirm-shared-mysql` 契約）。`subject_id` 對 `Privacy_Subject_State` 的 FK
與命名慣例都與 `Interaction_Events` 一致。

- **`subject_id` 是主鍵，不是外鍵欄位——一個使用者一列。** 這張表存的是
  **推導狀態**，不是像 `Interaction_Events` 那樣的事實紀錄：重算永遠整列覆寫
  （`INSERT ... ON DUPLICATE KEY UPDATE`），不保留歷史版本。真正的事實來源是
  互動事件本身，這裡的權重永遠可以從那裡重新推導——保留多版本歷史只會製造
  第二個要保持同步的真相來源。
- `interest_weight`／`compact_weight`／`easy_weight`：`DECIMAL(4,3)`，範圍
  `[0, 1]`，是**無號的學習強度**，不是排課要用的最終權重——`sufficiency_status`
  為 `insufficient` 時，這三個值等於使用者當時的顯式設定，不是半調子的學習值。
  **Roadmap #5B 起，`scheduler.js` 會讀取它們**（經
  `getSchedulingPreferenceWeights()` 與 `computeLearnedBoosts()` 換算成「超出
  顯式基準的部分」），但只用在方案層的 `evaluatePreference()`；方向仍然由
  `User_Profiles.preference_tags` 的 `#涼課優先`／`#挑戰難課` 決定，這三個欄位
  本身**不儲存也不需要儲存方向**（見下方 Roadmap #5B 更新）。
- `sufficiency_status`：`sufficient`／`insufficient`／不落地（未同意時整批不寫，
  與 `Interaction_Events` 同一個 consent-first 原則）。`usable_event_count`／
  `required_event_count` 讓「還差多少」可以直接查表回答，不必重新跑一次推導。
- `evidence_json`：`{ interest: [...], compact: [...], easy: [...] }`，每筆
  `{ ruleId, eventId, occurredAt, decay }`——每個非零權重都指得回是哪些事件、
  依哪條規則、以多少衰減係數算出來的（見 `server/src/skills/preferenceLearning.js`）。
- `expires_at` 沿用 `PRIVACY_RETENTION.interactionEventDays`（180 天）的語意，
  由 `npm run cleanup:privacy` 與 `Interaction_Events`、Raw Chat 一起清理。
- 刪除／匯出路徑已接上 `#33`：`DELETE /api/privacy/data` 會一併刪這張表，
  `GET /api/privacy/export` 的 `data.learnedPreferenceWeights` 會帶出目前存的
  那一列（從未算過則為 `null`，如實回報，不是空物件）。

**Roadmap #31 更新**：

- `model_version` 從這輪起是 `preference-learning-v2`（`#30` 留下的舊列是
  `v1`）——`foldAxis()` 的折疊公式改寫、加上時間衰減，語意已經不同，
  舊版本號的列在下一次讀取時會被視為過期並自動重算，**不需要 backfill 腳本**。
- `preferenceLearningService.js` 新增 `resetPersonalization()`：清空這張表的
  對應列**與** `Interaction_Events` 裡這個 subject 的全部事件，`User_Profiles`
  完全不受影響。連事件一起刪是刻意的——權重是事件的純推導，只刪推導出的
  那一列，下一次讀取（見下方過期判定）會用一模一樣的事件重新算出一模一樣的
  值，一個會自己復原的「重設」不成立。接進 `DELETE /api/privacy/personalization`
  與 `PUT /api/privacy/consents`（`personalization_learning` 從 true 改 false
  時自動觸發，等同硬性暫停）。
- 新增 `getPersonalizationSource()`：**已存 + 精確過期判定**，不是每次讀取都
  重算。已存列滿足以下任一條件就視為過期並在讀取時重算並覆寫：從沒算過、
  `model_version` 不是現行版本、有比 `computed_at` 新的事件、或 `computed_at`
  超過一天沒更新（純時間衰減即使沒有新事件也會讓結果隨時間改變，一天遠低於
  120 天半衰期，成本可忽略）。回傳 `source: no-consent|insufficient|explicit|learned`
  與 `appliedToScheduling`（見下一點）。
- **本輪不需要新的 migration。** 三個理由：(1) 學期戳記本來就在
  `Interaction_Events.academic_year`／`semester`，不需另外加欄位；(2) 衰減
  metadata（半衰期、有效樣本數等）只在讀取時計算，不持久化，唯一持久化的
  形狀變化是 `evidence_json` 多了 `decay` 欄位，那是 `JSON` 欄位可以直接容納；
  (3) 不需要「暫停」欄位，因為暫停就是 `Privacy_Consents` 裡的
  `personalization_learning` 那一列——它本來就有完整歷史與稽核，不需要另建
  狀態機。
- **`appliedToScheduling` 從 Roadmap #5B（2026-09-05）起恆為 `true`**：
  `scheduler.js` 的 `evaluatePreference()`（方案層）已經讀取這張表；
  `computeScoreComponents()`／`scoreCourse()`（單一門課的排序）仍然沒有接，
  那是 `#7` 的工作，`appliedToScheduling` 的語意只承諾前者。
- **時間衰減在今天的真實資料上是數學上的 no-op**：實測全部 92 筆互動事件
  都在 4 天內、全部標記 114 學年下學期（即當前學期），衰減係數 > 0.977、
  學期係數恆為 1，權重到小數第三位完全不變。半衰期與跨學期降權的邏輯已用
  合成事件驗證過（見 `server/test/preferenceLearning.test.js` 的 PL11–PL17），
  只是還沒有真實資料能顯出差異。

**Roadmap #5B 更新**：

- **方向來自 `User_Profiles.preference_tags`，不是這張表。** 新增兩個互斥標籤
  `#涼課優先`（`preferEasyCourses`，`#5A` 起就被排課引擎讀取但先前無 UI／儲存
  路徑可設定）與 `#挑戰難課`（`preferChallengingCourses`，全新）——見
  `server/src/data/preferenceTags.js`。事件 schema 的退課原因只有 `workload`
  （太重），沒有任何欄位能表達「太簡單、我要更難」，方向因此**只能宣告，
  不能從行為推論**。
- **`easy_weight` 只提供強度，不提供方向。** 排課端用
  `computeLearnedBoosts(storedWeights, explicitProfile)`
  （`server/src/skills/preferenceLearning.js`）換算成「學到的值超出顯式基準的
  部分」，恆 `>= 0`；`scheduler.js` 的 `axisWeight(方向, boost)` 再乘上顯式方向
  的正負號。**不能直接拿 `easy_weight` 原值當強度**——`foldAxis()`
  （`#30`）把輸出下限釘在顯式先驗，對已經勾了集中排課的使用者
  `compact_weight` 恆為 `1`，若排課端誤用原值會讓這類使用者在功能上線當天
  無證據地被加重權重。
- 本輪同樣**不需要 migration**：`easy_weight` 欄位的型別與範圍都沒變，
  它一直都是 `[0,1]` 的無號值，只是消費端（`scheduler.js`）多讀了它一次。

### `Courses`

| Column | Type | API mapping |
| --- | --- | --- |
| `course_id` | varchar(45) | `course.courseId`, `course.code` |
| `name` | varchar(45) | `course.name` |
| `credits` | decimal(3,1) | `course.credits` |
| `type` | varchar(45) | `course.category`, `course.type`（見「必修的意義」） |
| `dept` | varchar(45) | `course.department`，實際存的是**班級名稱**（見 `docs/DEPARTMENT_MAPPING.md`） |
| `subid3` | varchar(45) | `course.catalogCourseCode`，**真正的課號**（見下方說明） |

`Courses.type` 仍只有 `必修`／`選修`；`course.category` 是分類流程的衍生值，不等同
資料庫原始欄位。通識衍生欄位如下：

`Courses.dept` 的 562 個現行相異值由 `courseScope.parseClassName()` 解析。一般系所班級
為 A 類；71 個非系所班級由 `server/src/data/classKindCatalog.js` 明確列為 B～F 類；
另有 8 個不符合一般語法的 A 類專班／學位學程使用同檔案的明確對照。這些都是
應用程式衍生資料，未修改 MySQL schema。

| 應用程式欄位 | 型別 | 說明 |
| --- | --- | --- |
| `classGroup` | `A`～`F` \| null | 班級分組；未收錄的新名稱為 `null` |
| `classKind` | string | 結構化班級種類；未收錄時為 `unclassified` |
| `eligibility` | `eligible` \| `ineligible` \| `unknown` | 對目前學生的班級適用資格 |
| `eligibilityReason` | string | 判定或未知的可讀原因 |

`eligibility` 不代表學分是否可計入畢業。B～F 類正式適用規則仍待 roadmap #13C，
目前一律為 `unknown`；系外選修畢業認列仍由 `outsideElective` 獨立判定。

| 應用程式欄位 | 型別 | 說明 |
| --- | --- | --- |
| `generalEducationDomain` | string \| null | 111 以前的舊領域、112～114 的四領域；115 起因不分領域而為 `null` |
| `generalEducationRuleVersion` | string | `through-111`、`112-114` 或 `from-115` |
| `generalEducationRecognitionType` | string | `direct` 或 `cross_college` |
| `classificationReference` | string | 逢甲大學官方分類或認抵來源網址 |

114-2 直接通識課以 `Courses.dept` 的四個官方領域名稱分類；三門跨院認抵課以
`catalogCourseCode` 的正式對照表分類。不得只看 `GE*` 課號前綴。完整歷史畢業認列、
入學年度與認抵學分上限屬 roadmap #23，不由課程物件自行推導。

#### `course_id` 不是課程識別碼，`subid3` 才是

`course_id` 是「班級 + 課程」的組合，同一門課在不同班級有不同的 `course_id`：

| `course_id` | `subid3` | 課名 | 班級 | 教師 |
| --- | --- | --- | --- | --- |
| `CE07131-28010` | `IECS3002` | 計算機演算法 | 資訊三甲 | 許芳榮 |
| `CE07132-28010` | `IECS3002` | 計算機演算法 | 資訊三乙 | 黃秀芬 |
| `CE07133-28010` | `IECS3002` | 計算機演算法 | 資訊三丙 | 黃秀芬 |
| `CE07134-28010` | `IECS3002` | 計算機演算法 | 資訊三丁 | 許懷中 |

**判斷「是否為同一門課」必須用 `subid3`。** `subid3` 是 MySQL schema 的實體欄位名；
`database.js` 映射成應用程式與 API 的 `course.catalogCourseCode`，不輸出 `course.subid3`
alias。一門課可能由不同老師開在不同班次，學生只能選一個；用 `course_id` 或
`section_id` 比對會讓同一門課的多個班次同時排進課表。

`subid3` 的 `P` 後綴代表實習（`MATH1005P` 對應正課 `MATH1005`），兩者是不同課號、本來就該一起修（路線圖 `#15`，排課引擎的配對與原子排入邏輯見 `docs/SCHEDULING_LOGIC.md` 的「共同必修」一節）。

**已用真實 MySQL 資料驗證過的例外清單**（2026-08-20，重現 2026-08-05 稽核、15 天內數字零漂移）：全庫 3086 筆課程、2004 個相異 `subid3`；422 筆零學分課程中 187 筆以 `P` 結尾（大小寫敏感，全庫無小寫 `p`），46 個相異 `subid3` 以 `P` 結尾（跨所有學分區間）。已知例外：

| `subid3` | 課名 | 學分 | 例外原因 |
| --- | --- | --- | --- |
| `BUS1121P` | 統籌科目實習(二) | 0 | 全庫查無對應正課 `BUS1121` |
| `HY2073P` | 水質分析實驗 | 0 | 全庫查無對應正課 `HY2073` |
| `LAND2012P` | 測量平差實習 | **1.0**（非 0） | 正課 `LAND2012`（2.0 學分）存在且配對正確，但配對規則若加上「學分必須為 0」會漏掉這筆 |
| `MKT2020P` | （行銷相關實習） | 0 | 正課 `MKT2020` 存在，但兩者 `dept` 完全不重疊（合班命名差異）；配對規則不得用 `dept` 做交叉驗證 |

零學分且課名含「實習」／「實驗」但不以 `P` 結尾的課程：**0 筆**——`P` 後綴慣例在「有沒有漏標」這個方向上完全可靠。

#### 必修的意義

`type = '必修'` 是「**某個班級**的必修」，不是「**這位學生**的必修」。全校 2094 筆必修 section 分屬不同系所與年級，判定方式見 `docs/SCHEDULING_LOGIC.md` 的「必修範圍」。

### `Course_Sections`

每一筆 section 會被後端視為一門可排課項目。

| Column | Type | API mapping |
| --- | --- | --- |
| `section_id` | int | `course.id`, `course.sectionId` |
| `course_id` | varchar(45) | join `Courses.course_id` |
| `teacher` | varchar(45) | `course.instructor`, `course.teacher` |
| `room` | varchar(45) | `course.location`, `course.room` |
| `time_str` | text | `course.timeStr`、`course.timeBlocks`，以及 `dayOfWeek` / `startPeriod` / `endPeriod` |
| `time_bitmask` | varchar(64) | `course.timeBitmask`，僅在 `time_str` 無法解析時作為後備 |
| `year` | int | `course.year` |
| `semester` | varchar(45) | `course.semester` |
| `current_amount` | int | `course.currentAmount` |
| `rag_context` | text | `course.description`, `course.syllabus` |
| `rag_tag` | json | `course.ragTag` |
| `selection_code` | varchar(4) | `course.selectionCode` |

### `Course_Reviews`

課程評價存放於 `Course_Reviews`，並透過 `selection_code` 對應到 `Course_Sections.selection_code`。
API 回傳的 `review.courseId` 是 join 後的 `Course_Sections.section_id`，不是課程主檔的 `Courses.course_id`。

| Column | Type | API mapping |
| --- | --- | --- |
| `Reviews_id` | int | `review.id` |
| `selection_code` | varchar(4) | `review.selectionCode`, join `Course_Sections.selection_code` |
| `Reviews_tags` | text | `review.keywords[]` |
| `Review_content` | text | `review.summary` |
| `sweetness` | int | `review.sweetness` |
| `coolness` | int | `review.coolness` |
| `workload` | int | `review.workload`, `review.difficultyRating` |
| `value` | int | `review.value` |
| `overall` | int | `review.overall`, `review.recommendScore` |
| `review_count` | int | `review.reviewCount` |
| `source` | varchar | `review.source` |
| `url` | text | `review.url` |
| `scraped_at` | datetime | `review.createdAt` |

情緒判定由 `overall` 推導：4 分以上為 positive，2 分以下為 negative，其餘為 neutral。

**實測現況（2026-08-17）**：`Course_Reviews` 共 181 列，對應 `Course_Sections` 3560 個 section
（覆蓋率 5.1%）。五個評分欄位（`sweetness`／`coolness`／`workload`／`overall`／`value`）0 個 null，
值域皆 1–5。`review_count` 落在 4–8、平均 5.40，總計 977 則評論。181 列**全部**是 114-下學期、
**全部**是「選修」（0 筆必修）。這批資料供排課引擎的涼度評分使用，見
`docs/SCHEDULING_LOGIC.md` 的「涼度評分與評價覆蓋率」與 `server/src/skills/courseReviewStats.js`。

**`Reviews_tags` 不得用來推導課程屬性欄位**：這是 Dcard 式的自由標籤，314 個相異值、長尾雜訊
（例如「教室很熱」「追星必備」「不用每次都出現」），不是結構化的課程性質。`has_midterm`、
`has_group_project` 等欄位不存在於現行 schema，也**不能**從 `Reviews_tags` 猜測填入——曾經考慮
過這個做法，因標籤雜訊過高而否決。這些欄位若要補齊，需要對共用 MySQL 做 `ALTER TABLE`，屬於
與 #18 `student_id` migration 同性質、需與組員協調的 D 類 rollout。

### `User_Profiles`

| Column | Type | API mapping |
| --- | --- | --- |
| `user_id` | int | 既有 MySQL 內部鍵；migration 前的資料庫邊界相容欄位，不是 API canonical ID |
| `student_id` | varchar(32), UNIQUE | `profile.userId`、`profile.studentId`；canonical ID（migration 目標欄位） |
| `department` | varchar(45) | `profile.department`（見下方說明） |
| `grade_level` | int | `profile.gradeLevel` |
| `class_name` | varchar(45) | `profile.className`（migration 目標欄位） |
| `profile_schema_version` | int | `profile.schemaVersion`；目前版本 `1`（migration 目標欄位） |
| `preference_tags` | json | `profile.preferenceTags`, `profile.preferredCategories` |
| `avoid_time` | json | `profile.blockedPeriods`（見下方說明） |
| `completed_courses` | json | **已停用**。本專案不再讀寫；歷史修課唯一來源為 `User_Course_History` |
| `max_credits` | int | `profile.targetCreditsMax` |
| `admission_year` | smallint unsigned NULL | `profile.admissionYear`；入學學年度（民國），決定套用哪一版畢業規則（roadmap #23）。`NULL` 代表未知，此時 `resolveGraduationRule()` 退回最新版本並標示 `appliedFallbackVersion`。Migration 為 `005_admission-year`，執行方式見下方 |

`student_id` 與 `profile_schema_version` 的 DDL 與安全 migration 已備妥，
但 shared MySQL 尚未套用；必須先取得組員協調確認。程式會偵測欄位是否存在，
因此 rollout 前可讀既有 v0 row，rollout 後改以 `student_id` 查詢。
`class_name` 與 `admission_year` 已存在於 shared MySQL。

**選用欄位的偵測方式**：`database.js` 對 `class_name`、`profile_schema_version`、
`student_id`、`admission_year` 各有一支 `has...Column()`，用 `SHOW COLUMNS` 查一次並快取，
查詢失敗一律退回 `false`。欄位不存在時該值為 `null`，不猜、不推導、不補預設值。
組員新增欄位後重啟後端即自動生效，不需改程式。

`User_Profiles` 另有組員新增的 `program_type`、`enrolled_programs`、`college` 三個欄位，
**本專案目前完全沒有讀寫**。它們是 roadmap #13D（學制、學程與特殊身分）的材料，
在 #13D 開始前不要當成不存在而重複新增。

### `admission_year` 與版本化畢業規則（roadmap #23）

```text
npm run migrate:admission-year --prefix server
npm run migrate:admission-year --prefix server -- --apply --confirm-shared-mysql
npm run migrate:admission-year --prefix server -- --rollback --confirm-shared-mysql
```

回填**一律交叉驗證**：`grade_level + ACTIVE_TERM.academicYear` 推一次、
`User_Course_History` 最早的 `academic_year` 推一次，兩者一致才寫入。不一致或只有
單一來源時留 `NULL` 並在 dry-run 輸出說明理由——錯的入學年度會靜默選到錯的規則版本，
留 `NULL` 至少會誠實回報「入學年度未知」。重複執行只回填仍為 `NULL` 的列，
不覆蓋人工修正過的值。

### Profile schema v1 與 migration

API Profile 的 canonical shape 固定回傳 `schemaVersion: 1`。缺少版本的既有資料視為 v0，
由 `server/src/data/profileSchema.js` 的集中式 normalizer 轉為 v1；欄位型別由 validator
檢查。資料庫 migration 位於 `server/migrations/001_profile_schema_v1.*.sql`，執行器為
`server/scripts/profileSchemaMigration.js`。

```text
# 預設只做 dry-run，不修改資料庫
npm run migrate:profile --prefix server

# 取得 shared MySQL 協調確認後才可執行
npm run migrate:profile --prefix server -- --apply --confirm-shared-mysql

# 以 apply 前產生的備份檔進行 rollback
npm run migrate:profile --prefix server -- --rollback --confirm-shared-mysql --backup=<path>
```

執行前會備份 `User_Profiles` 到被 `.gitignore` 排除的 `server/backups/profile-schema/`。
migration 先檢查欄位，全部存在時不重複新增；偵測到部分套用狀態會停止並要求人工檢查，
避免半套 schema。rollback 移除這次新增的 unique index 與三個欄位；原始 row 備份保留供核對。

**`student_id` 回填的身分對應無法由程式自動證明**（adversarial review 修復，2026-08-20）：
`backfillStudentIds()` 用本機 `server/data/users.json` 的 `id` 欄位去比對 shared MySQL 的
`User_Profiles.user_id`——這是回填當下**唯一**兩邊都有的鍵，因為 `student_id` 本身正是這次
要被填入的目標欄位，還不能拿來反查。若這個本機 `id` 剛好對不上 shared MySQL 裡同一個
`user_id` 代表的真實學生（例如兩邊各自獨立匯入、或曾以不同順序重建過），程式**無法自行
偵測**——只能盡量讓錯誤盡快、盡響地暴露出來，而不是假裝有辦法證明對應正確：

- dry-run 與 `--apply` 都會先印出完整的 `user_id → studentId, className` 對照表，附上
  「這個對應無法由程式自動證明」的警告，操作者必須在下 `--apply` 前自行核對。
- 回填包在單一交易裡（`server/src/db/mysql.js` 的 `withTransaction()`），每筆 `UPDATE`
  都檢查 `affectedRows === 1`；任何一筆對不上就整批 rollback，不留下部分套用的中間狀態。
- 先前的版本每筆各自 autocommit、完全不檢查 affectedRows——半途失敗會留下半套資料，
  對錯學生也會靜默「成功」。詳見 `docs/DECISIONS.md` ADR-015。

### `className`（班別）

資工系不接受必修換班，必修範圍必須收斂到班別（`資訊三甲`／`資訊三乙`…），
見 `docs/COURSE_SELECTION_RULES.md` 第八節。

**目標欄位**：

```sql
ALTER TABLE `User_Profiles` ADD COLUMN `class_name` varchar(45) NULL;
```

本專案不會在未協調時直接執行這道 DDL——該表與組員共用。程式已具備此欄位的完整讀寫：

| 路徑 | 位置 |
| --- | --- |
| 欄位偵測 | `database.js` 的 `hasUserProfileClassNameColumn()`（`SHOW COLUMNS`，結果快取） |
| 讀取 | `getMysqlUserPreferences()` 依偵測結果決定是否 SELECT `class_name`；`mapUserProfileRow()` 映射成 `profile.className` |
| 寫入 | `updateMysqlUserPreference()` 依偵測結果決定是否 UPDATE `class_name` |
| 位置決策 | `pickClassNameTarget()`（純函式，有測試） |

**欄位一新增就自動改走 SQL，不需要再改任何程式**；偵測結果快取於行程內，
新增欄位後需重啟後端才會生效（`npm run dev:server` 使用 `node --watch`）。

`class_name` 不會被無條件寫進 SQL：欄位不存在時把它加進 `SELECT` 會讓整個查詢失敗，
等於所有 profile 一起壞掉。

#### 欄位到位前的後備順序

讀取優先度與寫入目標一致：

| 順位 | 位置 | 適用 |
| ---: | --- | --- |
| 1 | `User_Profiles.class_name` | 欄位存在時的唯一真相來源 |
| 2 | `users.json` 的 `className` | demo 登入使用者（`studentId` 或 `id` 對得到） |

`users.json` 的對照方式：`studentId`（demo 登入用，例如 `D1249697`）與 `id`
（對應 `User_Profiles.user_id`）都建索引，兩者都能對到同一筆 profile。

**兩者都沒有時班別無處可存。** `pickClassNameTarget()` 回傳 `null`，
`upsertByField()` 據此拋錯。這是刻意的：先前的第 3 順位是
`user_preferences.json`，該檔已於 2026-08-11 刪除（同一份 profile 存兩處必然漂移）。
寧可讓寫入失敗，也不能像最早那個 bug 一樣「儲存成功」地把班別丟掉——
`updateMysqlUserPreference()` 沒有欄位可寫卻仍回傳成功的 profile，
下一次排課就無聲地退回系所 + 年級。

## Local JSON Collections

The following collections remain file-backed in `server/data/*.json` because the provided MySQL schema does not include equivalent tables:

- `users`
- `saved_schedules`

`chat_history` **不在此列**。舊 `server/data/chat_history.json` 只供經確認的清理工具
辨識，不得再由 runtime 讀取；新 Raw Chat 只存在 MySQL `Chat_Messages` 密文表。

`user_preferences` **不在此列**。`server/data/user_preferences.json` 已於 2026-08-11
刪除，profile 的唯一儲存體是 `User_Profiles`；未設定資料庫連線時
`getAll('user_preferences')` 與 `upsertByField()` 都會拋出明確錯誤，
不再靜默回空陣列或把檔案長回來。集合名稱 `user_preferences` 保留為這個
store 的邏輯名稱。

### `users.json` 的職責

`users.json` **只負責登入身分與尚未遷移的 demo 資料**（`studentId`、`password`、`name`、
`watchlist`、`skillTree`…），以及班別的後備儲存。它不再保存 `courseHistory`。

歷史修課唯一來源為 MySQL `User_Course_History`。已修課號、已修學分、分類學分彙總
一律由查出的 11 欄 `courseHistory` 物件呼叫 `server/src/data/courseHistory.js` 的
`getPassedCourseCodes()`／`getEarnedCredits()`／`getTotalEarnedCredits()`
當場算，不得在 JSON 或 profile 上保存衍生欄位。

### `User_Course_History`

資料庫以 snake_case 保存，`database.js` 映射為下列 `courseHistory` 項目：

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| `academicYear` | number | 學年度，例如 `112` |
| `semester` | number | 學期，例如 `1`、`2` |
| `courseCode` | string | 正式課程編碼，例如 `IECS2001`。與 MySQL `Courses.subid3`／應用程式 `course.catalogCourseCode` 同一值域、同一格式（已實測：兩側皆無前後空白、無非大寫、無空值），排課引擎比對時不做正規化 |
| `courseName` | string | 科目名稱 |
| `score` | number | 百分制成績 |
| `letterGrade` | string | 等第成績 |
| `credits` | number | 修習學分 |
| `passed` | boolean | 是否通過（`score >= 60`），於資料匯入時一次寫入，不由消費端各自用 `score` 現算——及格門檻是校規，未來可能有例外（抵免、停修等），收斂成單一欄位比讓每個呼叫端各自判斷不容易漂移 |
| `requirementType` | string | 成績資料中的修習別：`必修` 或 `選修` |
| `generalEducationCategory` | string \| null | 原始通識類別，例如 `(M)`、`(N)`；未標示時為 `null` |
| `graduationCategory` | string | 畢業分類：`required`、`elective`、`general`、`external` 或 `nonGraduation`。`nonGraduation`（體育、國防科技、班級活動等）不計入畢業學分，但**仍視為已修過**——`getPassedCourseCodes()` 不排除它，`getEarnedCredits()` 才排除其學分，兩者是不同的判定 |

以上 11 個欄位都是 `courseHistory` v1 的必要欄位。若同一 `courseCode` 有多筆紀錄，
以 `academicYear`、再以 `semester` 取最新一筆；最新 `passed: true` 視為完成，最新
`passed: false` 且 `requirementType: 必修` 才成為自動重補修來源。`withdrawn`、
`transferred`、`exempted` 等多狀態模型不屬於 #19，本次不新增欄位，改由 roadmap #23
在畢業認列規則與來源可追溯性一併設計。

`catalog_course_code` 不設 `Courses` FK，因為歷史課程可能已不在當期 catalog；只保留
`user_id → User_Profiles.user_id` FK。唯一鍵為使用者、穩定課號、學年度與學期。
Migration 為 `server/migrations/004_course-history-v1.*.sql`，執行方式：

```text
npm run migrate:course-history --prefix server
npm run migrate:course-history --prefix server -- --apply --confirm-shared-mysql
npm run migrate:course-history --prefix server -- --rollback --confirm-shared-mysql
```

查詢成功但 0 筆是合法空歷史；查詢失敗則回 `503 COURSE_HISTORY_UNAVAILABLE`，不得假裝
成空歷史繼續排課或計算畢業進度。

**不得**在此存放 `department` 與 `grade`。這兩個欄位的真相來源是
`user_preferences`／`User_Profiles.grade_level`；同一份資料存兩處只會各自漂移——
先前 `graduation.js` 讀 `users.json`、排課讀 `user_preferences`，兩邊可以依不同的系所
計算而毫無跡象，且手改 `users.json` 的年級完全不生效（見稽核報告 F16）。

## API Course Shape

`GET /api/courses` returns section-level course objects:

```json
{
  "id": 1,
  "sectionId": 1,
  "courseId": "CS101",
  "code": "CS101",
  "name": "資料結構",
  "instructor": "王小明",
  "department": "資工系",
  "credits": 3,
  "dayOfWeek": 1,
  "startPeriod": 2,
  "endPeriod": 4,
  "location": "B101",
  "category": "必修",
  "classGroup": "A",
  "classKind": "department",
  "eligibility": "eligible",
  "eligibilityReason": "班級系所、學制、年級及班別符合目前學生資料。",
  "timeStr": "(一)02-04",
  "timeBlocks": [
    { "dayOfWeek": 1, "startPeriod": 2, "endPeriod": 4 }
  ],
  "ragTag": ["資料結構", "演算法"]
}
```

### 課程時段欄位

`time_str` 的實際格式為 `(二)06-08`，同一門課可能含多個以空白分隔的時段，例如 `(四)01-04 (四)06-09 (五)01-04`。節次 `00` 代表尚未排定。

- `timeBlocks`：完整時段清單，每個元素含 `dayOfWeek`（1=週一 … 7=週日）、`startPeriod`、`endPeriod`。**衝堂與時間類限制判定必須使用此欄位。**
- `dayOfWeek` / `startPeriod` / `endPeriod`：`timeBlocks[0]` 的內容，僅供相容用途。無法解析時為 `null`。

### `avoid_time` 的兩種格式

同一欄位可能存在兩種格式，讀取時必須都支援：

| 來源 | 格式 | 範例 |
| --- | --- | --- |
| 外部匯入 | 時間字串陣列 | `["08:00"]` |
| 本系統寫回 | 排課引擎格式 | `[{ "day": 1, "period": 3 }]` |

排課引擎只認 `{ day, period }`。`server/src/utils/periods.js` 的 `normalizeBlockedPeriods()` 負責統一轉換，`database.js`（讀取已儲存偏好）與 `constraintService.js`（合併 request）兩處共用。

時間字串沒有星期資訊，視為**每天的該節次都要避開**，展開為 7 筆。時間對應節次採「第一個尚未結束的節次」，例如 `08:00` 對應第 1 節、`13:05` 對應第 6 節。

#### `avoid_time` 與 `#不排早八` 的分工

`avoid_time` 保存**第 1～14 節**，讀寫兩端都不篩掉任何節次。它與 `#不排早八`
標籤**不是同一件事，可以重疊，排課時取聯集**：

| 設定 | 涵蓋範圍 | 語意 |
| --- | --- | --- |
| `avoid_time` | 第 1～14 節，逐格指定星期 | 「星期三第 1 節我不要」 |
| `#不排早八` | 只有第 1 節，但跨整週 | 「每天第一節我都不要」 |

聯集是現成行為：`scheduler.js` 的 `hardConstraintReason()` 分別判定
`noMorningClasses`（`startPeriod <= 1`）與 `blockedPeriods`，互不干涉。

2026-08-11 前曾規定「第 1 節只能用標籤設定，`avoid_time` 只管第 2～14 節」，
讀寫時都把第 1 節剝掉，`POST /api/profile` 還會對含第 1 節的寫入回 `400`。
那是錯的：使用者可能只想避開某一天的早八，剝除等於讓他無法表達這個需求。
讀取時把 `avoid_time` 的第 1 節反推成 `#不排早八` 標籤同樣有害——那會把
「星期三第 1 節」放大成「每天第一節」，而且偏好面板上會出現使用者沒勾過的標籤。

### `department` 的引號正規化

匯入資料中 `User_Profiles.department` 曾存為 `'資訊工程學系'`——**包含字面單引號字元本身**，導致所有字串比對失敗（D3）。掃描全庫 19 個文字欄位後確認**只有此欄位**有此問題，屬單一欄位的匯入缺陷；`Courses.dept` 等課程端欄位皆乾淨。

`server/src/utils/text.js` 的 `normalizeDepartment()` 負責去除成對的包裹引號（半形 `'` `"` `` ` `` 與全形 `‘’` `“”` 「」 『』）並修剪空白，於三處套用：

| 路徑 | 位置 |
| --- | --- |
| MySQL 讀取 | `database.js` 的 `mapUserProfileRow()` |
| 本機 JSON 讀取 | `database.js` 的 `readCollectionBySource()` |
| 寫入（兩種來源共用） | `database.js` 的 `upsertByField()` |

只有真正成對時才剝除，因此 `O'Brien` 這類單邊引號不會被誤刪。資料庫中該筆資料已於 2026-08-02 清理。

**正規化不做型別轉換。** `normalizeDepartment()` 只接受字串，其餘型別一律回傳 `null`。若改用 `String(value)` 強制轉換，`{}` 會變成 `"[object Object]"`、`["資訊工程學系","電機工程學系"]` 會變成 `"資訊工程學系,電機工程學系"`、`123` 會變成 `"123"`——全都是看起來正常、實際上讓所有系所比對失敗的髒值。

寫入端有兩道檢查：

1. `POST /api/profile` 對非字串或空字串回 `400`。
2. 資料層 `upsertByField()` 丟棄型別錯誤的 `department` 並寫入警告，避免其他呼叫路徑繞過 API 檢查。

讀到需正規化的值時會寫入 `logger.warn`，不靜默修正。**去重鍵是「`user_id` + 原始值」**：只用 `user_id` 的話，同一位使用者第一次警告後，後續任何髒值都會被靜默處理，看不出上游匯入是否仍在寫入髒資料。日誌並附上本行程的累計正規化次數與相異髒值種類數。

### `ragTag`

`Course_Sections.rag_tag` 的 JSON 主題標籤陣列，資料庫中 100% 有值，例如 `["機器學習","圖像處理","物件偵測"]`。排課引擎的興趣比對會使用此欄位。

排課、課程詳情與評價 API 都使用 `sectionId` 作為路由與 request body 中的課程識別值。

## Constraint Schema（Roadmap #21）

`server/src/data/constraintSchema.js` 匯出的 `CONSTRAINTS`——排課引擎每個限制類型
（硬性與軟性都算）的正式登記表，供 `server/src/skills/scheduleValidator.js`（獨立
validator）與 `scheduler.js` 的結構化 conflict set／放寬階梯使用。**純資料表，不是
新的排除／評分邏輯**——`hardConstraintReason()`／`scoreCourse()` 目前的機制完全不變，
這裡只是把「目前的行為分類」寫成可查詢的資料。以固定 id 為 key，例如
`NO_MORNING_CLASSES`、`BLOCKED_PERIODS`、`ELIGIBILITY_UNKNOWN`。每筆欄位：

| 欄位 | 型別 | 意義 |
| --- | --- | --- |
| `id` | string | 與 key 相同，固定代號 |
| `category` | `'hard'` \| `'soft'` | hard 會排除課程／方案；soft 只影響排序分數 |
| `relaxable` | boolean \| null | 只對 hard 有意義；是否可被 opt-in 放寬階梯納入放寬 |
| `exemptForRequiredCourses` | boolean \| null | 排入正式必修（`isRequiredForStudent()===true`）時是否無條件跳過這項檢查，與 `relaxable`／`allowRelaxation` 無關 |
| `weight` | number \| null | 可放寬條目的預設放寬順序；軟性條目為既有評分常數的字面鏡射（僅供文件說明） |
| `source` | string | `CONSTRAINT_SOURCE` 其中一個固定代號，這項限制的真實性來源 |
| `confidence` | number \| null | 系統對這項判定的偵測結果有多確定（不是「多嚴格」），結構性事實一律 `1`，只有 8 個內容偏好為 `null` |
| `overridableBy` | string（可選） | 使用者可用哪種方式繞過這項排除（目前只有 `CONSTRAINT_SOURCE.USER_EXPLICIT_SELECTION`） |
| `flag` | string（可選） | 對應到 `constraints` 上單一布林旗標的名稱，只有 3 個時段類舒適偏好有此欄位 |
| `label` | string（可選） | 中文顯示標籤，供揭露警告與放寬訊息使用 |
| `enforced` | boolean | validator 是否真的檢查得到；`false` 只有先修／共修（`PREREQUISITE`／`COREQUISITE`），因為完全沒有資料來源 |

`CONSTRAINT_SOURCE` 為固定列舉字串（例如 `'user:flag'`、`'academic-record:completed-courses'`），
比照 `resolveCourseEligibility()` 的 `ELIGIBILITY_SOURCE`「不得用裸字串」的紀律，但這是**限制類型
層級**的登記表，跟逐課程的 `eligibilitySource` 是不同軸，刻意不合併。

`DEFAULT_TIME_PREFERENCE_PRIORITY` 為放寬階梯在使用者未指定 `constraints.timePreferencePriority`
時的預設順序（`['NO_MORNING_CLASSES', 'LUNCH_BREAK_FREE', 'NO_EVENING_CLASSES']`）。

詳見 `docs/SCHEDULING_LOGIC.md` 的「Hard/Soft Constraint Schema（Roadmap #21）」。

## InteractionEvent Schema v1（Roadmap #29）

`server/src/data/interactionEventSchema.js` 定義互動事件的正式資料契約、正規化、
validator、v0 draft → v1 migration 與 idempotency 純邏輯，並保持純函式。

**持久化由 Roadmap #2 完成**：`services/interactionEventService.js` 是唯一寫入位置，
`POST /api/interactions` 是唯一入口，`Interaction_Events` 是唯一儲存體。寫入前一律
檢查 `personalization_learning` consent，並把 canonical `userId` 換成 `subject_id`
——canonical ID 只存在於記憶體，不進資料庫。

```json
{
  "schemaVersion": 1,
  "eventId": "11111111-1111-4111-8111-111111111111",
  "eventType": "recommendation_exposed",
  "userId": "D1249697",
  "timestamp": "2026-08-21T01:02:03.000Z",
  "requestId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "actionId": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  "idempotencyKey": "sha256:<64 lowercase hex>",
  "course": null,
  "term": { "academicYear": 114, "semester": "second" },
  "plan": { "planId": "plan-a", "variantId": "required_first" },
  "position": { "planRank": 1, "courseRank": null },
  "exposureContext": {
    "surface": "dashboard",
    "trigger": "initial_load",
    "candidateSet": [
      { "catalogCourseCode": "IECS3002", "sectionId": 101 },
      { "catalogCourseCode": "IECS3059", "sectionId": 102 }
    ],
    "displayedSet": [
      { "catalogCourseCode": "IECS3002", "sectionId": 101 }
    ],
    "displayedPlanIds": ["plan-a", "plan-b"]
  },
  "versionSnapshot": {
    "profileSchemaVersion": 1,
    "modelVersion": "scheduler-greedy-v1",
    "recommendationReasonVersion": null
  },
  "source": "system_recommendation",
  "feedbackReason": null
}
```

### 欄位語意

| 欄位 | 型別 | 意義 |
| --- | --- | --- |
| `schemaVersion` | `1` | 事件契約版本；缺版本的 flat draft 經明確 migration 轉成 v1，未知未來版本拒絕讀取 |
| `eventId` | UUID | 單筆 event envelope 的唯一 ID，由 server 產生 |
| `eventType` | enum | 曝光、查看、收藏、選擇、接受、移除、退選或重新規劃 |
| `userId` | string | #29 純 schema 建立時是 authenticated canonical ID；#2 持久化前必須經 #33 boundary 換成 HMAC `subject_id`，持久層不得同時保存 canonical ID |
| `timestamp` | UTC ISO 8601 | server 認定的事件發生時間，不接受 client 覆寫 |
| `requestId` | UUID | 一次搜尋／推薦／排課請求；同一 response 產生的事件共用 |
| `actionId` | UUID | 一次 logical UI action；React 重送同一操作時沿用 |
| `idempotencyKey` | `sha256:<hex>` | 由 request/action/event/plan/course subject 決定，不含 `eventId`／`timestamp` |
| `course` | object \| null | `catalogCourseCode` 是穩定課號，`sectionId` 是實際班次；非單課事件可為 null |
| `term` | object | `academicYear` + 正規化後的 `semester: first \| second` |
| `plan` | object \| null | `planId` 是具體方案，`variantId` 是 `required_first` 等產生策略 |
| `position` | object | `planRank`／`courseRank` 一律從 1 起算；不適用者為 null |
| `exposureContext` | object \| null | 畫面、觸發方式、依顯示順序保存的完整候選集與實際曝光清單；`displayedPlanIds`（Roadmap #27）另列這次曝光顯示過的每一個方案 `planId`——見下方 `recommendation_accepted` 的說明 |
| `versionSnapshot` | object | 當時的 Profile schema、模型與推薦理由版本；#26 尚未完成時理由版本必須為 null |
| `source` | enum \| null | `explicit_selection`／`required`／`system_recommendation`／`exploration` |
| `feedbackReason` | enum \| null | 只有移除／退選可用；原因為 `time`／`content`／`instructor`／`workload`／`full`／`eligibility`／`other` |

### Event types

| `eventType` | 意義 |
| --- | --- |
| `recommendation_exposed` | 推薦清單或方案已實際顯示；必須帶 `exposureContext`。**只能由伺服器在 `services/scheduleService.js` 產生排課結果時自己寫入**（Roadmap #2 對抗式審查修正），任何呼叫端經 `POST /api/interactions` 提交一律拒絕，即使格式合法——client 自己說「系統顯示了什麼」等於自己發證明給自己驗證 |
| `course_viewed` | 開啟課程詳情 |
| `course_favorited`／`course_unfavorited` | 加入／移出收藏或關注 |
| `course_selected`／`course_deselected` | 手動加入／移出排課輸入 |
| `recommendation_accepted` | 接受系統推薦的課程或方案；至少指定一個 `course` 或 `plan`；`plan.planId` 必須出現在該 `requestId` 曝光紀錄的 `exposureContext.displayedPlanIds` 裡，對不上一律拒絕。**Roadmap #27 之前這裡只認曝光紀錄的 `plan.planId`（主推方案）一個值**——方案切換列上線後，使用者切到非主推的方案再接受會被誤判成偽造來源而拒絕寫入，這是瀏覽器實測時發現的真實 bug，修法是曝光時記下**這次顯示過的每一個方案**，不是只記主推的那個。舊曝光事件沒有 `displayedPlanIds` 時退回只認 `plan.planId`，維持向後相容 |
| `course_removed` | 在課表之外拒絕一個推薦。**本系統目前沒有這個介面，維持 forward contract，不埋** |
| `course_withdrawn` | **退掉課表上的課**。本專案不連學校正式選課系統，沒有「已正式選上」這個外部狀態，因此以「課已進入使用者的課表、之後又被拿掉」對應之——roadmap #2 的「加選後退選」由這個事件承接。`source: "system_recommendation"` 時同樣要對得上曝光紀錄的 `displayedSet`，`explicit_selection`／`required` 沒有可驗證的曝光對象，維持格式驗證 |
| `schedule_regenerated` | 修改條件後要求重新產生課表 |

`candidateSet` 與 `displayedSet` 必須分開，後者也必須是前者的子集；未顯示的候選
不得被解讀為「使用者看過但拒絕」。必修接受保留 `source=required`，衝堂移除保留
`feedbackReason=time`，讓後續 #30 不會把兩者錯當成興趣正／負回饋。

**Roadmap #27 之後，`displayedSet` 是這次曝光顯示過的每一個方案（`plans[]`）課程的聯集**，
不是只有主推方案 `schedule` 那一份——使用者能切到方案切換列裡任何一個方案，切過去
之後看到的課同樣算「顯示過」，`course_withdrawn` 的曝光比對（`displayedSectionIds`）
才不會誤判「這門課只存在於使用者切過去的方案裡，沒被顯示過」。

idempotency 的唯一範圍是 `(userId, idempotencyKey)`：不存在時可 append；相同 key
與相同 logical payload 回傳既有事件（duplicate）；相同 key 但 payload 不同則回
conflict，不靜默覆寫。`resolveIdempotentAppend()` 目前只對傳入陣列執行這項純邏輯，
不會自行寫入任何 runtime store。
