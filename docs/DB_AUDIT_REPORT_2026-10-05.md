# 資料庫全表稽核：同一個欄位裡混了幾種寫法

日期：2026-10-05
方式：唯讀（只執行 `SHOW` 與 `SELECT`），沒有修改任何資料。逐表列出每個欄位的筆數、
空值數與值的分布。密碼雜湊、聊天密文、課程說明等內容欄位沒有列出。

目的：10 位 persona 寫入後，同一個欄位出現多種寫法。後端只認其中一種，其餘會被靜默當成
「沒有資料」。這份文件把全庫的寫法不一致整理成一張表，讓爬蟲端與後端對同一份標準。

## 1. 最重要的結論

1. **`User_Course_History` 同一欄混了三個來源的三種寫法**，後端只讀得懂其中一種。
2. **persona 的中文分類其實是照 `Courses.category` 的詞彙寫的**（專業必修、共同必修、專業選修）。
   所以問題不是爬蟲端亂填，而是「課程表的分類詞彙」與「修課紀錄的分類代碼」本來就是兩套，
   規格書沒有講要用哪一套。
3. **同一個概念在不同表有不同的鍵**：課程有四種識別碼、使用者有三種、學期有三種寫法。
   這是既有設計，程式有做轉換；但新寫入的資料只要選錯一種，就會整批對不上。
4. **D1249697（user_id 1）的 profile 在 10/2 之後被改過**：現在是四年級、資訊四乙、偏好標籤
   與興趣主題都是空的；10/2 查到的是三年級、資訊三乙、`#不排早八`、9 個興趣主題。

## 2. 各表概況

| 資料表 | 筆數 | 後端有沒有讀 | 備註 |
| --- | ---: | :---: | --- |
| `Courses` | 3086 | 有 | 課程主檔；不重複課號 2004 個 |
| `Course_Sections` | 3560 | 有 | 全部是 114 下學期 |
| `Course_Reviews` | 181 | 有 | 來源全是 `1111opt` |
| `User_Profiles` | 14 | 有 | 原有 4 筆＋persona 10 筆 |
| `User_Course_History` | 675 | 有 | 三個來源，見第 3 節 |
| `Interaction_Events` | 508 | 有 | 只有 4 位使用者 |
| `Learned_Preference_Weights` | 4 | 有 | |
| `Privacy_Consents` | 109 | 有 | 6 位使用者；persona 沒有 |
| `Privacy_Subject_State` | 6 | 有 | |
| `Privacy_Audit_Log` | 20 | 有 | |
| `Privacy_Data_Requests` | 6 | 有 | 4 筆 `pending` 且已於 9/3 過期 |
| `Chat_Messages` | 98 | 有 | 加密儲存 |
| `Saved_Schedules` | 4 | 有 | 全是 user 1 的 |
| `User_Course_States` | 0 | **沒有** | 規格書要寫的表，目前沒有任何程式讀它 |
| `Skills` | 24 | **沒有** | 5 大類 24 個技能 |
| `Course_Skill_Mappings` | 144 | **沒有** | 只對到 24 個技能中的 7 個 |
| `User_Course_History_Legacy_004` | 0 | 沒有 | 舊表，已空 |

## 3. `User_Course_History`：三個來源、三種寫法

| 來源標記 | 使用者 | 筆數 |
| --- | --- | ---: |
| `users_json_migration_004` | user 1（D1249697） | 53 |
| `demo_markdown_20260906` | user 2、3、4 | 168 |
| `mock_persona` | 9001～9010 | 454 |

### `graduation_category`（後端只認英文代碼）

| 值 | 筆數 | 來源 | 後端怎麼讀 |
| --- | ---: | --- | --- |
| `required` | 100 | 原有 | 系必修 |
| `elective` | 36 | 原有 | 系選修 |
| `general` | 52 | 原有 | 通識 |
| `external` | 15 | 原有 | 系外選修 |
| `nonGraduation` | 17 | 原有 | 不計入畢業 |
| `unspecified` | 1 | 原有 | 未分類 |
| 專業必修 | 160 | persona | **未分類** |
| 專業選修 | 143 | persona | **未分類** |
| 共同必修 | 113 | persona | **未分類** |
| 通識 | 38 | persona | **未分類** |

對照時要注意兩件事，不能只做字面翻譯：

- **「共同必修」不是一類。** persona 把中文思辨、大學英文、體育、班級活動都標成共同必修。
  原有資料把前兩者算 `general`（通識基礎必修），體育與班級活動算 `nonGraduation`。
- **國防科技** persona 標「專業選修」，原有資料是 `nonGraduation`。

### `general_education_category`（10 種值）

| 寫法 | 值 | 來源 |
| --- | --- | --- |
| 代碼 | `M`×12、`H`×2、`S`×1、`N`×1 | demo |
| 帶括號的代碼 | `(M)`×3、`(N)`×1 | user 1 |
| 中文 | 人文×15、社會×10、自然×8、美育×5 | persona |

三種寫法都存在。另外，112～114 學年度入學適用的通識領域是四個新名稱
（全球氣候變遷與永續發展、人文藝術與社會經典教育、世界格局與歷史地理視野、
科技知識原理與趨勢浪潮），上面三種寫法都不是這一套。

### 課號

- 原有資料：`IECS3002`、`MATH1005`（4 位數，對得到 `Courses.subid3`）。
- persona：`IECS101`、`MATH101`、`GE001`、`PE101`（3 位數）。128 個不重複課號**沒有任何一個**
  存在於 `Courses.subid3`。

### 其他

- `letter_grade`：demo 的 168 筆全是空值；user 1 與 persona 有填。不影響運作。
- `credits`：出現 0.0（班級活動，37 筆，全是 persona）。
- `passed = 0` 只有 3 筆，全是 persona（9004 兩門、9010 一門）。

## 4. `User_Profiles`

| 欄位 | 現有的寫法 | 後端認得的 |
| --- | --- | --- |
| `preference_tags` | 原有：`#不排早八`、`#涼課優先`…；persona：不排早八、偏好涼課、極致涼課… | 只認帶 `#` 的固定標籤 |
| `program_type` | `bachelor`×1、`major`×3、日間學士班×10 | 只分辨碩博士，其餘都當學士班；三種都不會壞 |
| `enrolled_programs` | 空陣列×1、空值×9、`["資工系學士班"]`×3、`["金融科技微學程"]`×1 | demo 三筆把「主修」填進了學程欄 |
| `must_take_courses` | 空值×4、空陣列×9、`["MATH101","IECS203"]`×1 | 班次 ID（數字） |
| `watchlist` | 空值×4、空陣列×10 | 班次 ID |
| `completed_courses` | user 1 是空的；demo 與 persona 有填課號 | **沒有程式讀**；已修課以修課紀錄表為準 |
| `preferences_json` | 12 筆空值；2 筆有結構 | 興趣主題與修課路徑存在這裡 |
| `max_credits` | 25×6、22×2、28、20、18、15、12、10 | 校規上限 25；28 會被擋 |
| `admission_year` | 112×7、111×3、110×2、113×1、109×1 | persona 用「大一＝113」；系統當前學年是 114 |
| `password_hash` | 只有 persona 10 筆有值 | **登入不讀這欄**；登入比對的是帳號清單裡的密碼 |
| `class_name` | 資訊四甲、四乙、四延在本學期課程資料中沒有班次 | 四年級本學期只開「資訊四合」 |
| `avoid_time` | `[{"day":1,"period":1}]` | 寫法一致，沒有問題 |

另外，14 筆 profile 中只有 4 筆在帳號清單裡。9001～9010 不在清單，系統查不到這 10 個人。

## 5. 同一個概念、不同的鍵（既有設計，新資料最容易選錯）

### 課程的四種識別碼

| 識別碼 | 範例 | 在哪裡 | 用途 |
| --- | --- | --- | --- |
| `Courses.course_id` | `AS00100-00739` | `Courses`、`Course_Sections`、`Course_Reviews`、`Course_Skill_Mappings` | 資料表之間的關聯鍵 |
| `Courses.subid3` | `IECS3002` | 修課紀錄的 `catalog_course_code`、互動事件 | **課號**；已修課與重補修靠它比對 |
| `Course_Sections.section_id` | `1453` | 互動事件、已存課表、指定必修、關注清單 | **班次 ID** |
| `Course_Sections.selection_code` | `0036` | `Course_Reviews` | 選課代號 |

規格書裡 `User_Course_States.course_id` 的範例是 `IECS201`，沒有說是哪一種。
`must_take_courses` 與 `watchlist` 的範例是 `"0123"`，看起來像選課代號，但後端要的是班次 ID。

### 使用者的三種識別碼

| 識別碼 | 範例 | 在哪裡 |
| --- | --- | --- |
| 學號 | `D1249697` | 帳號清單、登入 |
| `user_id` | `1`、`9001` | `User_Profiles`、`User_Course_History`、`Saved_Schedules` |
| `subject_id` | `v1:d256f4…`（雜湊） | 互動事件、同意紀錄、學習權重、聊天訊息 |

三者靠帳號清單互相對應。不在帳號清單裡的 `user_id` 沒有學號，也算不出正式的 `subject_id`。

### 學期的三種寫法

| 寫法 | 在哪裡 |
| --- | --- |
| `上學期`／`下學期` | `Course_Sections.semester` |
| `1`／`2` | `User_Course_History.semester`、`User_Course_States.semester` |
| `first`／`second` | `Interaction_Events.semester` |

程式有做轉換，這一項目前沒有造成問題。

### 分類的兩套詞彙

| 欄位 | 值 |
| --- | --- |
| `Courses.type` | 必修、選修 |
| `Courses.category` | 專業必修、專業選修、共同必修、院核心/學程、體育、通識-人文藝術、通識-其他選修、通識-社會科學、國防教育 |
| `User_Course_History.requirement_type` | 必修、選修、通識 |
| `User_Course_History.graduation_category` | `required`、`elective`、`general`、`external`、`nonGraduation` |

`Courses.category` 是「這門課對開課系所而言是什麼」；`graduation_category` 是「這門課對這位學生
而言算哪一類畢業學分」。同一門課對不同學生可能不同（別系的專業必修，對資工學生是系外選修），
所以不能直接把前者抄進後者。

## 6. 其他表的資料品質觀察

- **`Course_Reviews` 的 `workload` 與 `coolness` 分布完全相同**（5×74、4×51、3×40、2×11、1×5）。
  看起來 `workload` 是照 `coolness` 複製的，不是獨立的評分。沒有逐筆比對，這是從分布推測的。
- `Course_Sections`：89 筆的考試／分組／英語授課欄位全是空值；110 筆沒有人數上限。
- `Courses.credits`：0 學分的課有 422 門；另有 9 學分×27、8 學分×2。
- `Interaction_Events`：`dwell_time_ms` 與 `ui_slot` 508 筆全是空值（從未寫入）；
  `variant_id` 還留有舊版的值（`required_first`、`interest`、`easy_score`、`personalized_credits`）；
  `model_version` 有三種。
- `Privacy_Data_Requests`：4 筆 `pending` 的刪除請求在 9/3 就過期了，沒有被清掉。
- `Saved_Schedules`：4 筆全是 user 1、名稱都是「我的課表」、都是 25 學分。

## 7. 建議的標準寫法（給爬蟲端）

| 欄位 | 標準 |
| --- | --- |
| 課號 | `Courses.subid3` 的值，必須查得到 |
| `graduation_category` | `required`／`elective`／`general`／`external`／`nonGraduation`，依「對這位學生而言」判定 |
| 體育、國防、班級活動 | `nonGraduation` |
| 中文思辨、大學英文、兩門核心必修 | `general`，`requirement_type` 為必修 |
| `general_education_category` | 需要先決定：沿用代碼（`M`、`H`、`S`、`N`），或改用現行四個領域名稱 |
| `preference_tags` | 後端 `preferenceTags.js` 列出的固定標籤（帶 `#`） |
| `must_take_courses`、`watchlist` | `Course_Sections.section_id` |
| `program_type` | `bachelor` |
| `max_credits` | 不超過 25 |
| `admission_year` | 以當前學年 114 為基準：大一 114、大二 113、大三 112、大四 111 |
| 帳號 | 要能被系統認得，必須同時登記在帳號清單；要能登入，密碼也要放在那裡 |
| 同意紀錄 | 要讓帳號能用，至少需要服務處理的同意；要參與偏好學習，還需要個人化學習的同意 |

## 8. 這份稽核沒有做的事

- 沒有逐筆核對 persona 的課名、學分是否與真實課程一致（課號對不上，無從比對）。
- 沒有查 D1249697 的 profile 是誰、在什麼時候改的。
- 沒有修改任何資料。
