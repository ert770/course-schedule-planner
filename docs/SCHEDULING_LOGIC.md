# 排課邏輯規格

## 來源

本文件依據：

- `C:\Users\yamat\OneDrive\Downloads\課程推薦系統_排課邏輯與學分要求.docx`
- `server/src/skills/scheduler.js`
- `server/data/*.json`

## 學分要求

**畢業學分依系所而定，沒有全校通用值。** 各系官方數據見 `server/src/data/graduationRequirements.js`，規則與出處見 `docs/COURSE_SELECTION_RULES.md`。

以資訊工程學系（114 學年度入學適用）為例，畢業 128 學分：

| 課程類別 | 學分數 |
| --- | ---: |
| 本系必修 | 63 |
| 本系選修（核心選修 + 一般選修） | 28 |
| 外系選修 | 9 |
| 通識基礎 | 16 |
| 通識選修 | 12 |

其他系所的畢業總學分有 130、131、134、156（建築五年制），外系選修也有 0 與 3 的情形，不可假設全校一致。

**通識共同必修 3 學分（軍訓國防科技 1、體育 2、班級活動）不計入畢業學分**，但仍需排進課表。

排課結果因此回報兩個學分數，判定於 `server/src/data/generalEducation.js`：

| 欄位 | 意義 |
| --- | ---: |
| `totalCredits` | 學期修習學分，用於 12～25 學分上下限。**含**軍訓、體育、班級活動 |
| `graduationCredits` | 計入畢業的學分。**不含**上述三類 |
| `nonGraduationCredits` | 兩者差額 |

每門排入的課另帶 `countsTowardGraduation` 與 `nonGraduationCategory`。
畫面只顯示一個學分數的話，學生會把含軍訓體育的學期學分誤當成畢業進度。

特殊畢業門檻：資工系學生畢業前須修習 2-6 學分數位課程（來源為 `docs/REQUIREMENTS.md`，尚未查證）。

### 每學期學分上下限

| 項目 | 學分 |
| --- | ---: |
| 上限 | 25 |
| 下限 | 12 |
| 四年級下限 | 9 |
| 超修上限（須申請，由使用者自行選擇） | 30 |

**每日課程數沒有校方上限**，先前預設的「每日 4 門」沒有依據，已移除；呼叫端仍可自行指定 `maxCoursesPerDay`。

## 課程狀態

### 關注

`關注` 課程會顯示在課表上，供學生觀察時間分佈。

規則：

- 可同時關注多門同時段課程。
- 不計入正式排課衝突。
- 用於比較、預覽與決策。
- 排課成功或失敗，回應都必須帶回關注課程，不得因排課失敗而遺失。
- 若候選課程全為關注狀態，視為合法結果並標記 `watchOnly`，不得判定為排課失敗。

### 加選

`加選` 課程會顯示在課表上，且正式佔用該時段。

規則：

- 同時間不可加選多門課。
- 若多門加選課程時段重疊，視為衝堂。
- 排課演算法產生正式課表時，應以加選狀態判斷衝堂。

## 一門課只能選一個班次

一門課可能由不同老師開在不同班次（例如計算機演算法在資訊三甲、三乙、三丙、三丁各有一班），**學生只能選其中一個**。

判定同一門課必須用 `course.catalogCourseCode`（由 MySQL `Courses.subid3` 映射的真正課號），不能用 `course_id`——後者是「班級 + 課程」的組合，同一門課在不同班級的值並不相同。詳見 `docs/DATA_SCHEMA.md`。

規則：

- 同一課號的其他班次，即使時段不衝突也不得再排入，理由記為「已排入同一門課的其他班次」。
- 第一個班次若違反硬性限制或衝堂，仍可改排同一門課的其他班次。
- `catalogCourseCode` 缺漏時以課程名稱作為後備判定。
- 實習與正課是不同課號（`MATH1005P` 對 `MATH1005`），不受此規則限制，但兩者受下方「共同必修」規則約束。
- `POST /api/schedule/validate` 對重複班次回報 `duplicates` 並將 `valid` 判為 `false`。
- 關注課程不受此限制，學生可同時關注多個班次以比較時段。

## 共同必修（Co-requisite，Roadmap #15）

部分課程分成正課與實習兩堂（例如「會計學(二)」與「會計學(二)實習」），規定要一起修。改動前排課引擎把兩者當成完全不相干的課程，實測會排出「只有實習沒有正課」這種在選課上不成立的課表。

**配對規則**：`catalogCourseCode`（即 `Courses.subid3`）以 `P` 結尾者為實習，去掉 `P` 後的字串即為對應正課代碼（`STAT1002P` ↔ `STAT1002`）。純字串規則，**不看學分、不看系所**——已用真實 MySQL 資料驗證兩個會誤判的真實案例：

- `LAND2012P`（測量平差實習）實際帶 1.0 學分，一般實習慣例雖是 0 學分，但這筆是真實例外；若判定條件加上「學分必須為 0」會把這組正確配對誤判掉。
- `MKT2020P` 與其正課 `MKT2020` 的 `dept` 欄位完全不重疊（合班命名差異）；若判定條件加上系所比對會誤判掉這組正確配對。

**找不到對應正課的例外**：資料庫裡有 2 門課程代碼以 `P` 結尾、但完全查不到對應正課（`BUS1121P` 統籌科目實習(二)、`HY2073P` 水質分析實驗）。系統不會強制卡住這類課程——依規則判定（P 後綴 + 候選池中找不到 base code）自動視為一般課程，正常排入，並在 `warnings` 附上一則彙總提醒（「N 門課程符合實習／實驗代碼慣例但找不到對應正課，本規則對這些課程不生效」），不逐課發、也不寫死特定課號。

**排入規則**：

- 排入正課時必須一併排入對應實習；任一排不進去，兩者皆不排入（不留下只排一半的結果）。
- 實習不得單獨排入——貪婪填充階段完全不讓實習角色的候選獨立進入評分競爭，只能靠對應正課帶動。
- 學分計算直接加總各自的 `credits` 欄位，**不對實習學分做任何歸零**——0+3 或 `LAND2012P` 的 1+2 都自動正確，把實習學分強制歸零反而會蓋掉真實資料。
- **單向設計**：只有「正課必修 → 一併帶入實習」，沒有反向的「實習被指定必排 → 正課自動升級為必修」。使用者若只把實習的 id 放進 `mustTakeCourseIds`（沒放正課），系統不會反向推論正課也要必排。
- 因配對排不成而整組不排時，`excludedCourses`／`conflictSet` 記錄 `constraintId: 'COREQUISITE_PAIR_INCOMPLETE'`，與「衝堂」「重複班次」同一等級（結構性事實，不可放寬）。候選池裡連對應實習班次都沒有時，訊息會明確寫「找不到對應實習班次」，跟「實習存在但排不進去」的訊息不同，方便分辨原因。
- **多個候選實習班次**（同一門實習開兩班以上）逐一嘗試，任一班次成功即整組排入、停止嘗試；中途失敗的嘗試靜默回滾，不留下任何訊息——只有**全部班次都試過且全部失敗**才記一次排除紀錄。這是 2026-08-20 的 Codex adversarial review 修正：原本每次失敗的嘗試都會立刻寫入排除/失敗訊息，若後面的班次其實成功排入，殘留的失敗訊息仍會讓最終驗證器誤判整組不完整。
- **不及格必修重補修**的正課若帶共同必修，比照一般必修規則一併嘗試排入對應實習（同樣是 2026-08-20 的修正——原本重補修路徑完全沒有接上配對邏輯，會排出「重修正課排入了、對應實習卻缺席」的不合法課表）。三個排入路徑（本學期必修、貪婪填充、不及格重補修）共用同一個 `placeCourseWithCorequisite()` 函式，不再各自維護一份規則。

**與 Roadmap #21 的先修／共修缺口是兩件事**：#21（見下方「Hard/Soft Constraint Schema」一節）的 `PREREQUISITE`／`COREQUISITE` 指的是**廣義**的先修／共同修習規則（任意課程之間，例如「修過 A 才能修 B」），目前完全沒有資料來源，`enforced:false`。這裡的共同必修是**窄範圍、資料已驗證**的正課/實習配對特例，兩者不要混為一談——這次交付不代表 #21 的先修／共修缺口已解決。

## 必修範圍

**`Courses.type = '必修'` 代表「某個班級的必修」，不是「這位學生的必修」。** 全校共 2094 筆必修 section；把它們全部當成每位學生的必修，產生的課表會橫跨 79 個系所並含 12 個不同研究所的碩士論文（路線圖 `#13`）。

判定依據只有 `course.department`，而它實際上是**班級名稱**（例如 `資訊三甲`），不是系所名稱。判定流程：

1. 解析班級名稱為「系所簡稱 + 學制 + 年級 + 班別」——`server/src/skills/courseScope.js` 的 `parseClassName()`。
2. 簡稱對照系所全名——`server/src/data/departmentMapping.js`，來源為 `docs/DEPARTMENT_MAPPING.md` 的 A 表。
3. 與學生的系所、年級與班別比對。

### 必修不得換班：收斂到班別

資工系選課公告明文**不接受必修課程換班級的要求**（見 `docs/COURSE_SELECTION_RULES.md` 第八節）。
資訊三甲～三丁各開一班計算機演算法，學生只能選自己班的那一班，因此必修範圍必須收斂到**班別**。

班別的真相來源是 `User_Profiles.class_name`；該欄位尚未新增，因此目前退回
`users.json`。儲存位置與遷移方式見
`docs/COURSE_SELECTION_RULES.md` 第八節與 `docs/DATA_SCHEMA.md`。
讀取由 `database.js` 合併進 profile，再經 `constraintService.js` 帶入排課限制。

**合班（`資訊二合`）必須視為本班**：資料結構與資料結構實習開在 `資訊二合`，
是資訊二甲～二丁全體的必修。只做嚴格字串比對會讓資訊二甲的學生漏掉這兩門必修。

### 判定規則

| 課程 | 判定 | 排課處理 |
| --- | --- | --- |
| 本系所、本學制、本年級、**本班別或合班**的必修 | 這位學生的必修 | 必修階段優先排入 |
| 同系所同年級但**其他班別**的必修 | 別人的必修 | **整批排除，不進候選** |
| 同系所其他年級或其他學制的必修 | 別人的必修 | **整批排除，不進候選** |
| 其他系所的必修 | 別人的必修 | **整批排除，不進候選** |
| B～F 類的通識、共同科目、學院綜合班、英語／國際班、學分學程及其他特殊班級 | `eligibility=unknown` | 系統自動候選保守排除；明確指定時保留並警告 |
| 任何系所的選修 | 可修 | 一般候選（系外選修另有認列條件，見下方） |

班級名稱必須是「簡稱 + （學制）+ 年級字」才算系所班級。只比對前綴會把 `建設英班` 判成建設系、`商學院綜合班` 判成商學、`商學一(UQ)` 判成商學一年級，全部是假陽性。

### 明確指定的課程豁免整批排除

上表的「整批排除」只適用於**系統自己撿的候選**。使用者明確指定的課程一律保留並排入，
只附上警告。

理由：這裡的判定是「依系所、年級、班別**推論**」，不是校方的選課權限。轉系、輔系、
雙主修、跨班加簽都可能讓學生真的修得到。把使用者親手指定的課靜默刪掉，
畫面上只會少一門課而沒有任何線索——與系外選修的處理一致（見下方「系外選修認列條件」）。

「明確指定」= `POST /api/schedule/generate` 的 `courseIds`、`selectedCourseIds`、
`mustTakeCourseIds`。

### B～F 班級分類與 unknown eligibility

現行 MySQL 的 562 個相異 `Courses.dept` 已全部分類：483 個可由一般語法解析的 A 類、
8 個明確對照的特殊格式 A 類，以及 71 個 B～F 類。B～F 目錄位於
`server/src/data/classKindCatalog.js`，分類只回答「這是哪一種班級」，不回答「誰可以修」。

- B：全校共同與通識班級。
- C：學院綜合班。
- D：英語授課班與國際學程班。
- E：學分學程。
- F：用途待確認班級。

在 #13C 取得正式適用規則前，B～F 一律回傳 `eligibility: 'unknown'` 與
`eligibilityReason`。搜尋保留這些課讓使用者看得到；排課器不得自動排入，會把課程及
原因放入 `excludedCourses` 並彙整 warning。使用者透過 `courseIds`、
`selectedCourseIds` 或 `mustTakeCourseIds` 明確指定時，課程仍保留並排入，但 warning
必須顯示「資格待確認」。

### Active Term（Roadmap #20）

所有查課、排課與 Agent API 共用同一個「目前學期」設定：`server/src/data/activeTerm.js`
的 `ACTIVE_TERM`（預設 114 學年下學期，可用 `ACTIVE_ACADEMIC_YEAR`／`ACTIVE_SEMESTER`
環境變數覆寫）。這是**系統常數，不接受 per-request 覆寫**——所有使用者共用同一個
學期範圍，不開放個別切換。

- **搜尋**（`filterCategorizedCourses()`）：非本學期的候選課程一律過濾，沒有例外。
  涵蓋 `GET /api/courses`、Agent 的課程查詢、以及排課的主要候選來源
  （`searchCoursesForSchedule()`）。
- **排課的例外處理**：使用者明確指定 `courseIds`，以及 #19 的重補修候選查找，是
  直接查資料庫、繞過上述搜尋過濾，因此 `scheduler.js` 的 `prepareCandidates()`
  另外做一次過濾——沿用「系統自撿排除＋原因、使用者明確指定保留＋警告」的既有
  模式（與 B～F unknown eligibility 相同精神，且排在其之前，因為 term 是更外層
  的閘門）。
- 候選課程缺少學年學期資料時**視為本學期**（不新增排除），因為那是資料缺口，
  不是「已知不符合」——既有測試 fixture 從未標註學年學期，若把缺資料當成不符合，
  會讓所有既有候選被排除。

換學期時只需更新 `ACTIVE_ACADEMIC_YEAR`／`ACTIVE_SEMESTER` 兩個環境變數（或
`activeTerm.js` 的預設值），**並同步更新** `server/src/data/generalEducationCatalog.js`
的 `RECOGNIZED_GENERAL_EDUCATION_COURSES_114_2`——兩處目前都寫死 114 學年下學期，
沒有互相引用，忘記其中一處會讓通識認列與排課候選各自套用不同學期。

### 候選課程的可追溯 metadata（Roadmap #20）

每門候選課除了既有的 `eligibility`／`eligibilityReason`，另外附加三個欄位：

| 欄位 | 說明 |
| --- | --- |
| `eligibilitySource` | `eligibility` 結論套用的規則代號，見 `server/src/skills/courseScope.js` 的 `ELIGIBILITY_SOURCE`（例如 `department-required-table`、`class-catalog:unconfirmed-rules`），供 UI／Agent／未來的 evidence-based reason（#26）追查來源 |
| `term` | `{ academicYear, semester, isActiveTerm }`，這門課**自己的**開課學期與是否為 active term |
| `scopeReason` | 給人看的完整白話說明，融合 term／類別／eligibility／系外選修認列結果；優先序為：非本學期 → `eligibility=unknown` → 必修判定（本人／他人）→ 通識 → 系外選修 → 一般選修 |

### 四種候選判定的正式對照（Roadmap #20）

| 判定 | 依據 | 程式位置 |
| --- | --- | --- |
| 可搜尋 | `term.isActiveTerm`（硬性過濾）＋ 班級範圍過濾／通識／系外選修分支 | `courseQuery.js` |
| 本人必修 | `category==='必修' && eligibility==='eligible'`（`eligibilitySource: REQUIRED_TABLE`） | `courseScope.js` → `courseCategory.js` |
| 可加選 | `eligibility !== 'ineligible'` 且 `term.isActiveTerm`；`scopeReason` 講明是哪個閘門在擋 | `courseCategory.js`（term 與 eligibility 融合） |
| 可計入畢業學分 | 本人必修／本系選修／通識預設可計；系外選修委由 `evaluateOutsideElective().eligible` | `outsideElective.js`（不動）；文字併入 `scopeReason` |

B～F 正式適用對象（#13C）與學制／學程欄位（#13D）仍未解決，`eligibility` 與
`scopeReason` 在那些情境下維持 `unknown`／保守排除，不因本項完成而宣稱已知誰可以修。

### 無法判定時

系所或年級缺漏時，**不得退回「全校必修都算」**——那正是 `#13` 的缺陷本身。此時不把任何課
當成必修，只排入明確指定的課程與一般候選，並在 `warnings` 指出**缺的是哪一項**
（「未設定系所與年級」／「未設定年級」）。

**「沒填」與「填了但對不到系所對照表」必須分開回報。** 後者是資料錯誤——系所名稱打錯字，
或 A 表少了一個單位——會讓該使用者的必修範圍永遠判不出來。這種情況**回報為失敗**
（`plan.failures`）而不是警告，訊息指名系所並說明要去確認什麼。合併成同一句
「未設定系所或年級」的話，資料錯誤會被當成「使用者還沒填」而永遠查不出來。

班別缺漏時**不套用班別收斂**，維持系所 + 年級判定並警告「未設定班別」——
多一個欄位不該讓原本能排出必修的使用者突然排不出來。

### 年級以班別為準

班別名稱本身就編碼了年級（`資訊二乙` → 2 年級），且它是使用者最後明確選的值：

| 情況 | 處理 |
| --- | --- |
| 班別是**本系**的系所班級 | **年級改依班別**，並回報與個人資料的年級不一致 |
| 班別的系所與 profile 不符（`電機三甲` 對資工） | 無從調解，忽略班別並警告，年級沿用 profile |

`buildStudentScope()` 回傳 `gradeOverriddenByClass` 與 `profileGrade`，警告會寫出兩邊的
年級。資料不一致本身是要修的問題，不得靜默吞掉。

先前的做法是「年級與班別不一致就忽略班別」，結果是使用者改了班別、課表毫無變化
（見稽核報告 F16）。

## 課程類別解析

**資料庫的 `Courses.type` 只有 `必修` 與 `選修` 兩種值**（必修 1760 筆、選修 1326 筆）。
排課引擎的類別優先度表裡的 `核心選修`、`通識`、`系外選修` 從來不會出現在資料中，
因此那三條優先度規則在解析導入前從未生效過。

`server/src/skills/courseCategory.js` 在排課前把每門課解析成「對這位學生而言」的類別：

| 來源 | 解析結果 |
| --- | --- |
| `type = '必修'` | `必修`（是否為這位學生的必修由上方必修範圍判定） |
| 選修，且在資工系核心選修清單中 | `核心選修` |
| 選修，且在資工系選修清單中 | `一般選修` |
| `dept` 是該學年度官方通識領域，或課號在官方跨院認抵表 | `通識`，並帶領域、規則版本與來源 |
| 選修，且開在其他系所班級 | `系外選修` |
| 其他 | 維持原值 |

原始值保留在 `sourceCategory`，分類依據保留在 `classificationSource`，才分得出
「資料庫寫選修」與「系統依資工科目表判定為核心選修／一般選修」。

課程搜尋、排課與 Agent 各有獨立入口：`searchCoursesForStudent()`、
`searchCoursesForSchedule()`、`searchCoursesForAgent()`；三者共用
`annotateCourseCategory()`，因此入口的班級限制可以不同，但分類規則不會漂移。
通識分類位於 `server/src/data/generalEducationCatalog.js`：111 以前使用人文／社會／
自然／統合，112～114 使用官方四領域，115 起不分領域。114-2 MySQL 中四領域共有
167 個正式課號、208 個班次且均有 `catalogCourseCode`；另有三門官方跨院認抵課。
分類只接受正式 `dept` 領域或認抵表對照，不以 `GE*` 課號前綴猜測。排課候選會在
本人班級課程之外納入通識，優先度仍排在一般選修之後、系外選修之前。

核心選修與修課路徑資料來自 `server/src/data/csCurriculum.js`（114 必選修科目表 + 113 課程地圖），
比對條件為**課程物件的 `catalogCourseCode` 以 `IECS` 開頭且課名在清單中**。只比對課名會把通訊系的
`網路程式設計 COME3016`、機電系的 `電子學 MCAE3103` 誤判為資工系核心選修。

目前只有資訊工程學系有這份對照，其他系所維持原本的類別。

## 系外選修認列條件

只有「其他**系所班級**開的選修」才算系外選修。通識、共同科目、學院綜合班、英語授課班、
學分學程都不是系所班級，不在此判定範圍。

`server/src/skills/outsideElective.js` 依資工系規定過濾：

| 條件 | 處理 |
| --- | --- |
| 進修部開設 | 不認列 |
| 課名與本系必選修科目表重複 | 不認列 |
| 大一**且**課名含概論／導論／通論／概要／入門 | 不認列 |
| 課號級數為大一層級 | **只警告，仍認列**（難度無法機械判定） |
| 通過全部條件 | 認列，但標記須向系辦確認 |

### 不認列的課怎麼處理，取決於是誰放進來的

這組條件判定的是**能不能計入畢業學分**，不是能不能修。

| 來源 | 處理 |
| --- | --- |
| 系統自己撿的候選 | 整個剔除；原因進入每個方案的 `excludedCourses` |
| **使用者明確指定** | **保留並排入**，標記 `countsTowardGraduation: false` 與 `nonGraduationCategory: '系外選修未認列'`，警告中說明原因 |

「明確指定」= `POST /api/schedule/generate` 的 `courseIds`（課程瀏覽器勾選的課，
它決定候選池但**不會**進入 `selectedCourseIds`，因此另以 `explicitCourseIds` 傳入）、
`selectedCourseIds`、`mustTakeCourseIds`。

把使用者親手勾的課靜默刪掉，畫面上只會少一門課、沒有任何線索，而學生其實修得到
那門課——去留必須交還給使用者。

警告訊息彙整成單行並只列前幾門課名——每門課各一條警告會有數十行，把其他警告全部淹掉。
警告是純文字直接顯示，**不得使用 markdown 語法**（`**` 會原樣印在畫面上）。

### 尚未定義的部分

通識與共同科目（`國文綜合班`、`大二英文綜合班`、`核心必修綜合班`、`軍訓(一年級)`）、學院綜合班、英語授課班與國際學程、學分學程的**班級種類已於 #13B 完成分類**；正式適用對象仍未確認，整理於路線圖 `#13C` 與 `docs/DEPARTMENT_MAPPING.md`。目前搜尋保留並標示 `unknown`，排課不會自動納入。

**#20 本輪已完成**：active term 過濾、`eligibilitySource`／`scopeReason`／`term` 三個
可追溯欄位、四種候選判定的正式對照（見上方兩節）。**仍未解決**：B～F 的正式適用對象
（卡 `#13C`，需系辦／校方書面規則）、學制與學程欄位（卡 `#13D`，需 Profile schema
擴充學制／雙聯學程／英語班／已報名學分學程等欄位，目前 `User_Profiles` 沒有這些欄位）。
這兩項在取得前維持 `unknown`，不得用猜測填入判定邏輯。

## 大二以上排課流程

1. 讀取學生過去修習紀錄與歷史成績（見下方「已修課程排除」）。
2. 推估當學期應補足的課程類別與學分。
3. 優先安排必修課（限本系所、本年級——見上方「必修範圍」）。
4. 若學生曾有必修課不及格，檢查當學期是否開授重補修課程，並優先排入。
5. 必修確定後，依序安排核心選修、一般選修、通識、系外選修。
6. 依照偏好產生多個課表方案。
7. 回傳課表、學分、衝堂資訊、推薦理由與備選課程。

### 方案分化：每個 variant 一張權重表（Roadmap #10）

五個 variant **不是**「共用一組基礎分，各自再加一點小分」——那樣會塌縮。
量測過的失衡：類別項每差一級 120 分，而 variant 專屬項只有 25～40 分
（`max_credits` 的 2→3 學分只差 25），主題訊號被類別分完全蓋過，五個方案排出
同一份課表，去重後只剩 1 份。

現在 `scheduler.js` 的 `VARIANT_WEIGHTS` 給每個 variant 一組係數
（`category`／`credits`／`easy`／`interest`／`compact`）。`required_first` 全部維持
1／0，行為與改動前逐項相同，是其餘 variant 的對照組；其餘 variant 降低類別係數、
拉高自己的主題係數，讓主題真的能重排選修。

**必修的絕對優先不受權重表影響。** 「必修先排」是規則不是偏好，因此本人必修改由
固定加分（`REQUIRED_COURSE_BONUS`）取得絕對優先，權重表只負責排序**選修**。
少了這一層，把類別係數調低的 variant 會讓替代涼度高的一般選修壓過必修。
判定沿用 `getEffectiveCategoryPriority()` 的結果，不另寫一份「非本人必修要降級」
的判斷，避免兩個實作漂移。

### 推薦理由（Roadmap #26）

每門排入的課帶 `recommendationReason`——它為什麼被選、用了哪些證據、誰輸給了它。
欄位定義見 `docs/API_SPEC.md`。三個設計要點：

**分數的公式只有一份。** `computeScoreComponents()` 回傳各項分數，
`scoreCourse()` 只是把它加總。解釋用的數字與排序用的數字因此不可能不一致
（`scheduler.test.js` 的 R7 釘住「組成總和 === 總分」）。

**理由只解釋決策，不參與決策。** `recommendationReason.js` 不重新判定任何規則——
`isRequiredForStudent()`、`resolveCourseEligibility()`、`deriveReviewEvidence()`
的結果一律沿用。排課結果不得因為理由的計算而改變（R10）。

**「沒有競爭者」與「還沒算」要分得出來。** `alternativesRejected.status` 用
`no-competitors`／`not-applicable`／`had-competitors` 三態表達，不用空陣列含糊帶過。
實測 demo 帳號現況：8 門排入的課裡有 7 門真的沒有競爭者（可競爭課程只有 16 門，
貪婪迴圈是候選用完才停，不是撞到學分上限）——那是真實情況，不是計算失敗。

落選者的記錄時間點是**做決定的當下**，那時還不知道排在後面的課稍後會不會也被排入。
因此 `finalizePlan()` 會把「最後也進了課表」的課從落選清單剔除（實測 18 筆裡有 16 筆
屬於此類），否則「A 輸給 B」是假的。

**方案數少於 5 時要說明原因**：`warnings` 會指出哪些取向被合併、以及可競爭的課程數。
最常見的原因不是排序邏輯，而是**可修的課太少**（demo 帳號實測 227 門候選裡 211 門
因 #13C 適用對象規則未確認而保守排除，真正能競爭的只有 16 門）。
另外，使用者若本來就勾了「盡量集中排課」，每個方案本來就會集中，
「集中排課」方案自然不會再產生第二種答案——這是合理結果，warnings 會明講。

## 已修課程排除

已通過的課不得再出現在候選池，判定依據是**課號**（`courseHistory[].courseCode`
比對 `course.catalogCourseCode`），不是當學期的 section id——section id 每學期、每個班次
都會改變，用它排除已修課從一開始就不會生效。

`courseHistory` 只由 MySQL `User_Course_History` 載入，不再讀取 `users.json`。資料庫查詢
失敗時整次排課回 `503 COURSE_HISTORY_UNAVAILABLE`；不能把錯誤當成零筆歷史，否則會重新
推薦已修課。真正查詢成功且 0 筆才代表沒有歷史修課。

- 候選課程的 `course.catalogCourseCode` 落在使用者 `courseHistory` 已通過（`passed: true`）
  的課號集合裡，就整批排除（一課多班次時**每一個班次**都要排除，不能只擋到其中
  一個 section）。
- 被排除的課推入 `excludedCourses`，附上 `已修過並通過（課號 XXX）` 的理由——
  已修課程若靜默從候選池消失、畫面上沒有任何線索，使用者會誤以為候選池本來
  就只有這麼少門課。
- 每個 `courseCode` 先依 `academicYear + semester` 取最新一次紀錄。最新紀錄
  `passed: true` 時視為完成；最新紀錄 `passed: false` 且 `requirementType: 必修` 時，
  自動映射到本學期相同 `catalogCourseCode` 的所有 sections，優先序排在本學期必修之後。
- 不接受 `retakeCourseIds`／`failedRequiredCourseIds`。舊 client 即使送入也不生效。
- 不及格必修若本學期沒有對應 section，回傳「本學期沒有開課，請下學期記得重修」warning；
  若有開課但因本學期必修衝堂或其他硬限制無法排入，也回傳可操作的 warning。
- `nonGraduation` 分類（體育、國防科技、班級活動等）的課**仍視為已修過**而排除，
  即使它不計入畢業學分——「修沒修過」與「計不計學分」是兩件事，見
  `docs/DATA_SCHEMA.md` 的 `courseHistory` 欄位定義。
- 沒有 `catalogCourseCode` 的候選課不會被誤判為已修——比對時自然落在
  `Set.has(undefined) → false`，不需要額外的課名 fallback（也不應該用課名去猜
  一份課號清單）。

實作於 `server/src/skills/scheduler.js` 的 `buildPlan()`，比對函式來自
`server/src/data/courseHistory.js` 的 `getPassedCourseCodes()`、
`getLatestAttemptsByCourseCode()` 與 `getFailedRequiredCourses()`。
`server/src/routes/graduation.js` 的「建議補足系上課程」推薦邏輯呼叫同一支函式，
與排課共用同一套已修判定，兩處不會對「這位學生修過什麼」給出不同答案。

## 核心選修與選修路徑

核心選修與選修主要支援三條修課路徑（名稱以**113 學年度資工系課程地圖**為準）：

- 嵌入式系統類。
- 技術應用類。
- 網路與安全類。

每門核心選修／選修所屬的路徑已建入 `server/src/data/csCurriculum.js`，
解析後放在 `course.track`。114 新增科目與實習類課程在 113 課程地圖上沒有歸類，`track` 為 `null`。

各路徑的核心選修學分數：

| 路徑 | 核心選修學分 | 與 12 學分的差 |
| --- | ---: | --- |
| 技術應用類 | 15 | 超過 3 |
| 嵌入式系統類 | 11 | 缺 1 |
| 網路與安全類 | 9 | 缺 3 |

規則：

- 依照學生偏好路徑與預定修習學分，優先排入核心選修。
- 核心選修不足時，再補入一般選修。
- 嵌入式系統類缺 1 學分、網路與安全類缺 3 學分，需允許跨類別核心選修補齊。
- 學生可不完全按照三條路徑修課，系統需支援客製化偏好。

本節先前寫的「網路安全類」與「技術應用類核心選修剛好 12 學分」皆有誤，已依課程地圖更正。

## 推薦因素

選修推薦需考慮：

- 學生興趣。
- 教授容易度、課程難易度、給分甜度、評價推薦分數：來源是 `Course_Reviews` 的結構化評分（`sweetness`／`coolness`／`workload`／`overall`），**不是**課程描述關鍵字。詳見下方「涼度評分與評價覆蓋率」。
- 是否可集中排課。
- 是否能空出休息日。

通識與系外選修推薦需考慮：

- 是否符合興趣。
- 是否容易取得高分，例如 95 分以上。
- 是否為涼課：同樣來自 `Course_Reviews`，不是描述關鍵字。
- 是否免考試，只需報告。

## 涼度評分與評價覆蓋率

`server/src/skills/courseReviewStats.js`（課程層派生）與 `server/src/skills/reviewStats.js`（統計數學）共同實作，`scheduler.js` 的「涼課與高分優先」方案與 `GET /api/reviews/easy` 排行榜共用同一套邏輯。

**為什麼不用課程描述關鍵字**：舊版靠「涼／容易／輕鬆／高分／甜」等字樣計分，真實資料庫 3560 筆課程只有 26 筆（0.7%）命中，且會誤判——評價標籤裡的「教室很涼」（形容冷氣強）會被判成涼課。改用結構化評分後不再有這個問題。

**涼度計算公式**：

1. `easiness = mean([coolness, sweetness, 6-workload, overall])`（`reviewStats.calculateEasinessFromAverages`），四個維度皆缺值時回傳 `null`（未收縮，1–5 尺度）。
2. **m-estimate 收縮**（`reviewStats.shrinkEasiness`）：`adjustedEasiness = (n×easiness + m×prior) / (n+m)`，`n` 為該課評論數、`prior` 為母體平均、`m=5`（實測 `review_count` 落在 4–8，取中位數）。樣本數少的課會被拉向母體平均，避免「剛好 4 則全 5 分」穩定壓過「8 則平均 4.5 分」的課。
3. **母體先驗**（`courseReviewStats.buildReviewPrior`）由呼叫端傳入的**全部**評價計算，不是候選池，否則同一門課在不同搜尋條件下會得到不同的收縮後涼度。
4. **1–5 → 0–100 尺度映射**（`courseReviewStats.easinessToScore`），供 `scoreCourse()` 與其他計分項目（`類別優先度 × 120`、`學分 × 12`）疊加，維持原有相對權重。

**沒有評價的課不是 0 分**：`getEasyCourseScore(course)` 對沒有評價的課回傳 `null`，`scoreCourse()` 的排序邏輯改用「中性分」（母體先驗換算後的分數，即 m-estimate 在 `n=0` 時的極限）而不是 0。給 0 分等於斷言「查不到評價 = 這門課很硬」，而 3560 個班次只有 181 個（5.1%）有評價，這樣的預設會讓 95% 的課全部沉底。整批都沒有評價資料時，中性分退回尺度正中央（50 分）。

**方案層涼度（`preferenceBreakdown.easy`）與課程層不同調，是刻意設計**：課程層排序需要每門課都有分數，因此無證據給中性分；方案層是「這個方案涼度 68%」這種對使用者的宣稱，只在**有評價證據的課**上取平均，無證據的課不參與，且可能回傳 `null`（代表整個方案沒有任何一門課帶評價）。覆蓋率另外由 `plan.reviewCoverage`（`{ rated, total, ratio }`）回報，讓使用者分得清楚「涼度 68%」是由幾門課推出來的。

**已知限制**：181 筆評價中最大一塊（68 筆通識）因 #13C（B～F 類正式適用對象規則尚未確認）被保守排除，不會進入自動排課，因此不影響涼度評分。實際會生效的評價依候選池而定，warnings 會列出「有課程評價但因資格待確認未納入」的統計。

### 涼度來源：`easinessSource`（Roadmap #10）

每門課帶 `easinessSource`，表示排序用的涼度分數是**哪裡來的**：

| 值 | 意義 | 可以對使用者說什麼 |
| --- | --- | --- |
| `reviews` | 有實際課程評價 | 可以講涼度，並附覆蓋率 |
| `proxy` | 沒有評價，依課程屬性推估 | **只能說「依課程屬性推估」，不得說涼／好拿分** |
| `none` | 沒有評價也沒有課程描述 | 不得做任何涼度宣稱 |

`proxy` 的存在理由很窄：demo 帳號實測**實際參與競爭的 10 門課裡只有 1 門有評價**
（16 門可修課扣掉 6 門已修過），涼度分數幾乎是常數，「涼課與高分優先」方案排出來的
課表與「必修優先」近乎相同，去重後直接消失。替代訊號讓這個方案仍然排得出一份
**不同**的課表，但它撐不起「這門課很涼」這個宣稱。

替代訊號只用實測有區分力的項目（對那 16 門課量測）：討論／互動／參與 8/16、
實作／實驗／專題 13/16、學分數。**排除**期中考（0/16）、期末報告（0/16）、
深入進階應用（16/16）——這三組完全無法區分，加進來只是雜訊。

**誠實邊界**：`proxy` 分數只影響**排序**，不得進入 `plan.reviewCoverage`，
也不得讓方案層 `preferenceBreakdown.easy` 冒出數字——那兩者只認真實評價
（見上一段）。`server/test/scheduler.test.js` 的 P10-5 釘住這條界線。

## 內容偏好評分與訊號可靠度警告

Roadmap #3。8 個內容偏好（免期中考／免分組報告／討論課／重視平時成績／實作評量／
期末報告／英文授課／學到較多內容）判定依據是課程描述的關鍵字比對（`course.description`），
不是結構化欄位——`has_midterm`／`grading_scheme`／`language` 等欄位不存在，見「目前程式差距」。

**為什麼從硬性排除改成軟性加分**：真實資料庫實測命中率差異極大（0.1%～97.6%）。
未命中即排除的旗標在命中率極低時（`weightDaily` 1.7%）會讓候選集幾乎歸零——實測對一位
資工三學生，227 門候選課只剩 3 門（1.3%）可排；命中即排除的旗標在命中率極低時
（`noMidterm` 0.1%）幾乎從不真正排除任何課，等於對使用者的靜默假承諾。兩者都不該用一個
不可靠的關鍵字判定去整批剔除候選課程。

**評分公式**（`scheduler.js` 的 `getContentPreferenceScore()`，於 `scoreCourse()`
不分 variant 一律套用，量級與 `INTEREST_KEYWORD_SCORE` 相同）：

- 命中關鍵字：「想避免」類（`noMidterm`／`noGroupReport`）扣 40 分；
  「想要」類（其餘 6 個）加 40 分。
- **未命中：一律 0 分，不論哪一類。** 關鍵字沒出現在描述裡，代表「描述沒提到」，
  不代表「這門課真的沒有這個特徵」——與涼度評分「沒有評價不是 0 分」是同一個
  誠實原則的延伸，見 `docs/DECISIONS.md` ADR-010。

**訊號可靠度警告**：`prepareCandidates()` 對候選池（5 個方案共用同一批）算出
每個**已設定**旗標的關鍵字命中率，命中率 <5% 或 >95% 時發出警告，提醒使用者
這個偏好的關鍵字判定幾乎無法區分課程，結果可能不準。用真實資料驗證：
`noMidterm`（0.1%）、`weightDaily`（1.7%）、`learnMore`（97.6%）會觸發；
`noGroupReport`（5.5%）、`discussion`（48.9%）、`practicalExam`（33.4%）、
`finalReport`（12.2%）、`englishTaught`（8.0%）不會（見 ADR-011）。

**這不是 roadmap #21 的正式 schema**：沒有 `weight`／`relaxable`／`source`／
`confidence` 欄位，也沒有逐級放寬機制。#21 的正式 schema 見下方「Hard/Soft
Constraint Schema（Roadmap #21）」一節。

## 硬性限制

硬性限制違反時，課表方案不得成立：

- 加選課程不得衝堂。
- 必修與重補修優先。
- 總學分不得超過上限。
- 若指定必修課無法排入，必須回傳失敗原因。
- 被封鎖時段不得排入正式加選課程（含週一空堂 `mondayFree` 展開後的封鎖時段）。
- 不上早八（`noMorningClasses`）。
- 不上晚課（`noEveningClasses`）。
- 午休保留（`lunchBreakFree`）。

封鎖時段一律以 `{ day, period }` 表示（`day` 為 1~7、`period` 為 1~14）。使用者偏好可能以時間字串儲存（例如 `["08:00"]`），必須先經 `server/src/utils/periods.js` 的 `normalizeBlockedPeriods()` 轉換；時間字串沒有星期資訊，視為每天的該節次都要避開。未轉換直接送入排課引擎時，`bp.day` 為 `undefined`，比對會靜默跳過而使設定完全失效。

上述時段類的 4 項限制是對課程時段的結構化事實判定（`block.startPeriod` 等），不是對自由文字做關鍵字猜測，因此不像上方「內容偏好」有訊號可靠度的問題，維持硬性排除（roadmap #3）。

**Roadmap #21 補充**：`noMorningClasses`／`noEveningClasses`／`lunchBreakFree` 這 3 項
對正式必修課（`isRequiredForStudent(course, scope) === true`）**無條件豁免**——必修課本學期
一定要修，這 3 項是使用者比較希望的事，不是外部事實，不該讓它們把必修課排除掉；`blockedPeriods`
**永遠不豁免**，包含對必修課，因為它代表真實的外部不可用時段（例如學生有工作），連必修課都
無法違反。豁免發生時會在 `warnings` 附上「必修課「X」不符合「Y」偏好，但必修優先，已排入課表」
的揭露訊息，不做靜默改動。此豁免範圍**僅限**正式必修，不含 `mustTakeCourseIds`／`selectedCourseIds`
（使用者手動指定的必排課）——後者仍照原本規則被這 4 項排除。詳見下方 schema 一節與
`docs/DECISIONS.md` ADR-013。

## 軟性偏好

軟性偏好可用於排序不同課表方案，不會排除課程：

- 集中排課（`preferCompact`）。
- 涼課／高分優先（`preferEasyCourses`，見「涼度評分與評價覆蓋率」）。
- 興趣關鍵字／修課路徑優先（`preferredKeywords`／`interests`／`preferredTrack`）。
- 8 個內容偏好——免期中考（`noMidterm`）、免分組報告（`noGroupReport`）、討論課
  （`discussion`）、重視平時成績（`weightDaily`）、實作評量（`practicalExam`）、
  期末報告（`finalReport`）、英文授課（`englishTaught`）、學到較多內容（`learnMore`），
  見下方「內容偏好評分與訊號可靠度警告」。

## Hard/Soft Constraint Schema（Roadmap #21）

`server/src/data/constraintSchema.js` 的 `CONSTRAINTS` 表，把上方「硬性限制」與
「軟性偏好」兩節描述的每個限制類型正式登記成資料，補上 4 個欄位：

- **`category`**：`'hard'`（排除課程／方案）或 `'soft'`（只影響排序分數）。與現行
  機制行為完全一致，本次不會讓任何限制改變類別。
- **`relaxable`**：只對 hard 條目有意義。`true` = 可被 opt-in 放寬階梯
  （見下方）納入放寬；`false` = 永遠不進入階梯。目前只有 `NO_MORNING_CLASSES`／
  `LUNCH_BREAK_FREE`／`NO_EVENING_CLASSES` 為 `true`；`BLOCKED_PERIODS`（代表真實
  外部不可用時段）明確為 `false`——這正是驗收標準舉的例子：「盡量不排早八」可放寬、
  「週一絕對不能上課」不可被放寬。
- **`weight`**：可放寬條目的預設放寬順序（數字小的先放寬），可被
  `constraints.timePreferencePriority` 整個覆蓋；軟性條目則是既有評分常數的字面
  鏡射，僅供文件說明，`scoreCourse()` 不會動態讀這張表。
- **`source`**：這項限制的真實性來自哪裡（使用者旗標、學業紀錄、課程目錄、系統
  推導等固定代號），供除錯與追查用。
- **`confidence`**：**不是**「這個限制多嚴格」（那是 `relaxable`），而是「系統對
  這項判定的偵測結果有多確定」。結構性事實（衝堂、學分加總、資格查詢等）一律是
  `1`；只有 8 個內容偏好關鍵字判定是 `null`，因為可靠度是候選池依賴、每次請求才
  知道的（見「內容偏好評分與訊號可靠度警告」）。
- **`enforced`**：`false` 代表 validator 完全不檢查這項。目前只有 `PREREQUISITE`／
  `COREQUISITE`（先修／共修）——專案裡完全沒有這方面的資料來源（`server/src` 與
  `docs/DB_AUDIT_REPORT_2026-08-05.md` 皆無先修表；roadmap #8 尚未開始，才是這個
  資料模型真正的負責項目）。validator 會誠實回報 `unchecked: ['PREREQUISITE',
  'COREQUISITE']`，不會假裝檢查過或悄悄放行。

**正式必修的無條件豁免**（`exemptForRequiredCourses`）：另一個獨立欄位，只有 3 個
時段類舒適偏好為 `true`。排入 `isRequiredForStudent()===true` 的課程時，這 3 項
無條件跳過，跟 `allowRelaxation` 無關、永遠生效；`BLOCKED_PERIODS` 明確為 `false`，
必修課也不豁免。詳見上方「硬性限制」一節與 `docs/DECISIONS.md` ADR-013。

**與方案產生器分離的獨立 validator**：`server/src/skills/scheduleValidator.js` 的
`validateScheduleAgainstConstraints(schedule, constraints)`，檢查衝堂、重複班次、
學分上限、資格／學期／系外選修／已修過的 metadata 複查、4 個時段類硬性限制、必修
涵蓋率，回傳 `{ valid, violations, unchecked }`。`generateSchedule()` 每次成功回應
前都會對自己的主推方案呼叫一次作為內部自我檢查（落實「所有成功方案經 validator
驗證 hard constraint violation 為 0」這條驗收標準）；理論上不該觸發，若真的觸發會
把結果降級為失敗並誠實回報，而不是送出一份實際上不合法的課表。這個 validator
**不套用**必修豁免——它是對「字面上給定的課表」做檢查，沒有 scope 可用，只認課程
物件上由 `addCourseToPlan()` 寫入的 `formallyRequired` 標記；外部提供的課表（例如
`/api/schedule/validate` 帶 `constraints` 時）沒有這個標記，一律照嚴格規則檢查。

**opt-in 放寬階梯**：`constraints.allowRelaxation`（預設 `false`，沒有任何呼叫端
會設定，行為與改動前完全相同）。啟用後，若方案的選修側因時段偏好排掉太多候選、
導致湊不到學分下限，`generateSchedule()` 會依 `constraints.timePreferencePriority`
（使用者自訂的 constraintId 陣列，未提供時退回 schema 的預設順序）逐一清除
`relaxable:true` 的旗標並重試，一旦成功就停止，並在回應附上 `relaxedConstraints`
與對應的 `warnings` 揭露字串。這是**獨立於**必修豁免的另一套機制——必修豁免永遠
生效不需要旗標，這個階梯只在使用者明確開啟時才動作。`BLOCKED_PERIODS` 與其餘所有
非 `relaxable` 條目結構上不存在於這個階梯的迭代清單中，不是執行期判斷擋掉。

**結構化 conflict set**：無解時，`generateSchedule()` 除了維持既有的
`message`／`warnings`（附加，不取代）之外，會額外回傳 `conflictSet`——走訪所有
方案的排除紀錄、依 constraintId 與課程 id 去重後的陣列，每筆帶
`{ constraintId, severity, relaxable, source, courses, reason }`，取代「無解時只
回傳第一個錯誤字串」的舊行為。

### Bounded backtracking repair（Roadmap #22）

系統保留五個既有 greedy variant 作為 baseline。主推 baseline 未通過獨立 validator，或
所有通過 validator 的 baseline 都低於 `minCredits` 時，才啟動 repair；已合法且達最低學分
的 baseline 不額外搜尋。

- **決策組**：同一正式課號的不同 section 互斥；正課與實習共同必修以一個原子 option
  加入或回滾，不允許只留下其中一門。所有實際放置仍走 `scheduler.js` 的既有 hard-rule
  判定，搜尋器不複製另一套限制。
- **界限與可重現性**：一次 repair 的決策組前處理加搜尋共用 **2 秒**預算，另有
  50,000 nodes 上限；預設 seed 為 `0`，同分候選使用 seeded stable hash 決定固定順序。
- **狀態**：`solved` 表示找到經 validator 驗證的完整課表；`infeasible` 只在預算內完整
  搜尋後仍無解時使用；`timeout` 不等同無解；必要課程 ID 不在候選資料或沒有候選資料時
  回 `data-insufficient`。
- **fallback 與草稿隔離**：timeout 時若已有通過 validator 的 greedy baseline，即回傳該
  baseline，並標記 `resultSource:'greedy'`、`fallbackUsed:true`。若沒有完整合法方案，正式
  `schedule` 必須為空；最佳結構安全的部分組合只放在 `draftSchedule`／
  `draftUnscheduledCourses`，並以 `isDraft:true`、`unmetRequirements` 與 `clarification`
  明確標示仍需討論，不得冒充排課成功。
- **Chat 澄清**：`clarification.questions` 只依實際缺口與 conflict evidence 產生，詢問
  必要課程／班次、最低學分、不能上課的日期節次或互斥課程取捨；只允許建議調整
  `adjustableConstraintIds`，不得建議違反衝堂、重複班次、學分上限或封鎖時段。

**範圍界定**：先修／共修只定義層級、不強制執行（見上方 `enforced`）；`scoreCourse()`
的內建評分算式維持逐位元組不變，不會動態讀這張表；`maxCoursesPerDay`（每日課程數
上限）維持非 `relaxable`，不在本次調整範圍內。詳見 `docs/DECISIONS.md` ADR-012～014
與對應的變更報告。

## 課程時段

一門課可能有多個時段，且可跨不同天。資料庫中約 9% 的課程屬於此類，例如：

```text
(四)01-04 (四)06-09 (五)01-04
```

每門課的完整時段以 `timeBlocks` 陣列表示，每個元素含 `dayOfWeek`、`startPeriod`、`endPeriod`。頂層的 `dayOfWeek` / `startPeriod` / `endPeriod` 為第一段，僅供相容用途，**不得**作為衝堂或限制判定的唯一依據。

上課日為 `1`（週一）至 `7`（週日）。實際課程資料含週六與週日課程，課表顯示與排課邏輯皆須涵蓋七天。

## 尚未排定時間的課程

節次 `00`（例如 `(一)00`）代表課程尚未排定上課時間，解析後 `timeBlocks` 為空陣列。

規則：

- 不佔用任何時段，因此不與任何課程衝堂，也不受時間類硬性限制與單日課程數上限約束。
- **不得參與貪婪填充。** 這類課程沒有任何限制，若可被自由填入會被無限累積。僅在被明確指定為必要課程時才排入。
- 排入後放在 `unscheduledCourses`，不進入 `schedule`，避免與有時段的課程混在課表格上。
- 學分計入總學分，因此門數也必須一併計入，並在訊息與警告中明確說明，否則畫面上的門數與學分會對不起來。

## 衝堂判定

兩門加選課程只要**任一組時段**重疊，即為衝堂：

- 兩個時段的 `dayOfWeek` 相同。
- 兩個時段的節次範圍重疊。

判定公式（對兩門課的 `timeBlocks` 取笛卡兒積，任一組成立即為衝堂）：

```text
exists a in A.timeBlocks, b in B.timeBlocks such that
  a.dayOfWeek == b.dayOfWeek
  and not (a.endPeriod < b.startPeriod or b.endPeriod < a.startPeriod)
```

只比對第一段會漏判。實例：`建築設計(二) (四)01-04 (四)06-09 (五)01-04` 與 `循環經濟 (四)06-07`，第一段不重疊但第二段完全重疊。

時間類硬性限制（不上早八、不上晚課、封鎖時段、午休保留）與單日課程數上限，同樣必須檢查課程的每一個時段。

## 多方案課表

系統不應只產生一份課表。至少應支援：

- 學分最大化方案。
- 集中排課方案。
- 興趣優先方案。
- 涼課/高分優先方案。
- 必修與重補修優先方案。

每個方案應包含：

- 課程清單。
- 總學分。
- 方案類型。
- 推薦理由。
- 被排除課程與原因。

## 目前程式差距

目前 `server/src/skills/scheduler.js` 已有：

- 學分上下限。
- 封鎖時段。
- 早課/晚課限制。
- 必選課。
- 貪婪排課。
- 簡單補學分。

- 關注/加選分離。
- 多方案輸出。
- 必修與重補修優先規則。
- 必修收斂到班別（必修不得換班）。
- 核心選修與修課路徑解析。
- 系外選修認列條件。
- 學期學分與畢業學分分離。
- 涼課評分改用結構化評價（`Course_Reviews`），取代課程描述關鍵字（見「涼度評分與評價覆蓋率」）。
- 8 個內容偏好改為軟性加分並附訊號可靠度警告，取代硬性排除（roadmap #3，見「內容偏好評分與訊號可靠度警告」）。
- roadmap #21 的正式 `hard`／`soft` constraint schema（`weight`／`relaxable`／`source`／`confidence` 欄位）、與方案產生器分離的獨立 validator、opt-in 放寬階梯、結構化 conflict set，見「Hard/Soft Constraint Schema（Roadmap #21）」。

仍需補強：

- 數位課程畢業門檻。
- 評價分數的 per-user 個人化加權（同一難度數值對不同使用者相反符號）；目前是母體共用的涼度，屬 roadmap #5B。
- `has_midterm`／`has_group_project`／`grading_scheme`／`language` 課程欄位仍不存在；8 個內容偏好因此仍以描述關鍵字軟性計分（見「內容偏好評分與訊號可靠度警告」），欄位化需要對共用 MySQL 做 `ALTER TABLE`，屬需與組員協調的 D 類 rollout，不在 roadmap #3 範圍內。
- roadmap #21 的先修／共修（prerequisite/co-requisite）強制執行：schema 已定義這個層級（`enforced:false`），但完全沒有資料來源可查（無先修表），validator 誠實回報 `unchecked`，不強制執行；資料模型屬 roadmap #8，尚未開始。
- 通識基礎 16 學分的完整對照（目前只實作「不計畢業學分」的那 3 學分）。
- 核心選修 12 學分的達成度追蹤（目前只做到分類與優先度，未累計缺口）。

