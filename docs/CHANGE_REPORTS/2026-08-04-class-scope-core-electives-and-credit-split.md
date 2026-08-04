# 班別收斂、核心選修分類、系外選修條件與畢業學分分離

## 修改日期

2026-08-04

## 背景

使用者提出四項待實作，並上傳兩份官方文件供確認：

- `113_bachelor_course_map_new.md` —— 資訊工程學系課程地圖（113 學年度）
- `114_bachelor.md` —— 資訊工程學系學士班必選修科目表（114 學年度）

四項需求：

1. 實作必修不得換班（資工系明文）：必修範圍應收斂到班別，但 `User_Profiles` 沒有班別欄位。
2. 實作系外選修條件：非進修部、非基礎概論性、內容不與本系重複、難度不低於本系。
3. 實作通識共同必修 3 學分不計入畢業學分（軍訓國防科技 1、體育 2、班級活動）。
4. 確認 `c.` 15 門、`d.` 54 門的意義，以及修課路徑名稱落差。

## 第 4 項的確認結果

### `c.` = 核心選修，`d.` = 選修

`114_bachelor.md` 的「核心選修 (12學分)」區塊逐門列出 15 門科目，與
`docs/COURSE_SELECTION_RULES.md` 第六節記錄的 `c.` 清單**逐門完全一致**。
因此 `c.` 為核心選修、`d.` 為選修，對應關係確定。

**1 門的差距**：文件原記 `d.` 54 門，依 `114_bachelor.md` 可逐列驗證的內容為 53 門。
本次採用 53 門建表，差距列入待確認清單與 PDF 原件核對。分類是逐門比對，不依賴總數，
因此不影響正確性。

### 修課路徑名稱以 113 課程地圖為準

課程地圖標示的三條路徑為 **嵌入式系統類／技術應用類／網路與安全類**，
支持既有 `SCHEDULING_LOGIC.md` 的寫法（「網路安全類」更正為「網路與安全類」），
而非系網課程規劃頁的「電腦系統／軟體工程／網路與資安」。

課程地圖同時提供每門課的路徑歸類，已全部建入資料檔。交叉驗證：

| 路徑 | 核心選修學分 | 與 12 學分的差 |
| --- | ---: | --- |
| 技術應用類 | 15 | 超過 3 |
| 嵌入式系統類 | 11 | 缺 1 |
| 網路與安全類 | 9 | 缺 3 |

「缺 1」與「缺 3」與 `SCHEDULING_LOGIC.md` 原本記載的差額一致，佐證歸類沒有抄錯。
但該文件原本寫的「技術應用類核心選修剛好 12 學分」是錯的（實際 15 學分），已更正。

## 影響實作方式的資料庫事實

實作前查詢了實際資料庫，三項發現改變了做法：

| 查到的事實 | 影響 |
| --- | --- |
| `Courses.type` 只有 `必修`（1760 筆）／`選修`（1326 筆）兩種值 | 排課引擎類別優先度表裡的 `核心選修`／`通識`／`系外選修` **從來沒被觸發過**，必須自行解析類別 |
| 「網路程式設計」在庫中只有通訊系 `COME3016`、「電子學」只有機電系 `MCAE3103` | 課名比對必須同時要求 `subid3` 以 `IECS` 開頭，否則他系課程會被誤判成資工核心選修 |
| 資料結構、資料結構實習開在 `資訊二合`（全年級合班） | 班別收斂必須把合班視為本班，否則資訊二甲的學生會漏掉這兩門必修 |
| `User_Profiles` 只有 7 個欄位，無班別 | 班別依使用者指示暫存於 `server/data/users.json` |

## 修改檔案清單

### 新增

| 檔案 | 內容 |
| --- | --- |
| `server/src/data/csCurriculum.js` | 114 科目表核心選修 15 門、選修 53 門，加上 113 課程地圖的路徑歸類；`classifyCsCourse()` |
| `server/src/data/generalEducation.js` | 通識共同必修不計畢業學分的判定 |
| `server/src/skills/outsideElective.js` | 系外選修範圍與四項認列條件 |
| `server/src/skills/courseCategory.js` | 課程類別解析（必修／核心選修／選修／系外選修）與 track |
| `server/test/csCurriculum.test.js` | 課程分類與資料本身的驗收 |
| `server/test/outsideElective.test.js` | 系外選修條件與畢業學分分離 |
| `docs/CHANGE_REPORTS/2026-08-04-class-scope-core-electives-and-credit-split.md` | 本報告 |

### 修改

| 檔案 | 改動 |
| --- | --- |
| `server/src/skills/courseScope.js` | `parseClassName()` 解析 `classSuffix`；scope 增加 `className`／`classSuffix`／`classMismatch`；`isRequiredForStudent()` 收斂到班別；新增 `isOwnDepartmentClass()` |
| `server/src/skills/scheduler.js` | 候選前處理 `prepareCandidates()`（類別解析 + 系外選修過濾，五個方案共用一次）；`graduationCredits` 與 `totalCredits` 分離；班別相關警告；警告訊息彙整 |
| `server/src/skills/courseQuery.js` | 新增 `getClassNames()` |
| `server/src/routes/courses.js` | 新增 `GET /api/courses/classes` |
| `server/src/services/constraintService.js` | 帶入 `className` |
| `server/src/db/database.js` | `className` 的讀寫（`users.json` 暫存） |
| `server/data/users.json` | demo 使用者加上 `"className": "資訊三甲"` |
| `client/src/services/api.js` | `coursesAPI.getClasses()` |
| `client/src/pages/SetupPage.jsx` | 基本資料加班別下拉選單，選項依系所與年級動態載入 |
| `client/src/pages/DashboardPage.jsx` | 顯示「計入畢業 N 學分」標籤 |
| `client/src/pages/SchedulePage.jsx` | 同上 |
| `client/src/components/Profile/ProfileForm.jsx` | 班別欄位 |
| `server/test/courseScope.test.js` | 班別收斂測試 |
| `server/test/scheduler.test.js` | 核心選修與 track 測試（取代已過時的「缺少 track 欄位」測試） |
| `docs/COURSE_SELECTION_RULES.md` | 第四、六、七、八、九節改為已確認並記錄實作方式；更新待確認清單 |
| `docs/SCHEDULING_LOGIC.md` | 班別收斂、類別解析、系外選修條件、學分分離、路徑名稱更正 |
| `docs/DATA_SCHEMA.md` | `className` 的暫存位置與遷移方式 |
| `docs/API_SPEC.md` | 新端點、新回應欄位、`className` 參數 |

## 主要改動內容

### 1. 必修不得換班

`isRequiredForStudent()` 在系所、學制、年級之外再比對班別。合班（`資訊二合`）視為涵蓋
全年級，因此不會漏掉開在合班的必修。

未設定班別時**維持原本的系所 + 年級判定**並警告，不因為多一個欄位就讓原本能排課的
使用者突然排不出必修。班別與系所／年級不一致時同樣忽略並警告，不靜默排除全部必修。

班別暫存於 `users.json`，讀寫集中在 `database.js` 的三個函式。等 `User_Profiles`
補上欄位後只需改這三個函式。

### 2. 系外選修條件

四個條件的可判定程度不同，處理強度也不同：

- **硬性不認列**（排除候選並記錄原因）：進修部開設、課名與本系科目表重複、大一概論性課程。
- **只警告不排除**：難度不低於本系。這個條件沒有任何可機械比較的欄位，用課號級數當代理
  指標。把猜測當成硬性規則會靜默刪掉學生其實可以修的課，比漏警告更糟。

「概論性」刻意要求**同時**滿足「大一」與「課名含概論字樣」：`人工智慧導論`、`資料探勘導論`
都是資工系的核心選修／選修，只看課名會誤殺難度相當的他系課程。

判定範圍只限「其他**系所班級**開的選修」。通識、共同科目、學院綜合班、學分學程都不是
系所班級，若當成系外選修會讓通識課被這組條件過濾掉。

### 3. 通識共同必修不計畢業學分

判定一律以課名為準（`Courses.type` 沒有通識類別，班級名稱也不可靠——`班級活動` 掛在
168 個不同的系所班級底下）。

排課結果回報兩個學分數：`totalCredits`（學期修習，含這三類，用於 12～25 上下限）與
`graduationCredits`（計入畢業，不含）。每門課另帶 `countsTowardGraduation`。

**未涵蓋**：軍訓選修（`全民國防` 2 學分、`國防政策` 2 學分）採計方式由各系修業須知自訂，
資工系科目表未提及，維持計入。

### 4. 核心選修分類與修課路徑

`courseCategory.js` 在排課前把每門課解析成「對這位學生而言」的類別，原值保留在
`sourceCategory`。這一步讓排課引擎既有的 `核心選修` 優先度**第一次真正生效**。

## 影響範圍

- 資工系學生的排課結果會改變：必修收斂到班別、核心選修取得較高優先度、
  不符合認列條件的系外選修不再出現在候選中。
- 非資工系學生：類別解析與系外選修條件不套用（只有資工系的規定經過查證），
  但班別收斂與畢業學分分離對所有系所生效。
- API 回應新增欄位，既有欄位語意不變（`totalCredits` 仍是學期修習學分）。
- `POST /api/profile` 現在接受 `className`。

## 測試與驗證結果

### 自動化

- `npm test`：**202 tests，202 pass，0 fail**（新增 42 項）。
- `node --check` 全數通過（`server/src/**/*.js`）。
- `cd client && npm run lint`：無錯誤。
- `cd client && npm run build`：成功。

### 瀏覽器實機驗證

在 `http://localhost:5173` 實際操作，四項皆有 A/B 對照。

**1. 必修不得換班（A/B）**

於 `/setup` 用新的班別下拉選單切換班別後重新排課：

| 班別 | 計算機演算法 | 專題研究(一) 課號 |
| --- | --- | --- |
| 資訊三甲 | 許芳榮 | `CE07131-…` |
| 資訊三乙 | **黃秀芬** | **`CE07132-43080`** |

課號從 `CE0713`**1** 變成 `CE0713`**2**、教師隨之改變，與資料庫中兩班的實際開課一致。
警告訊息同步變成「已排除 1585 門其他系所、學制、年級或班別的必修課（依 **資訊三乙** 判定）」。

此流程同時驗證了寫入路徑：班別確實寫進 `users.json`。

**2. 系外選修條件（A/B）**

在 `/schedule` 的課程瀏覽器選取應數系的「密碼學」（`應數三合`／`MATH3069`）：

- 資工系學生：不排入，原因為「課程內容與本系「密碼學」重複，不認列為系外選修」。
- 同一門課換成會計系學生：正常排入（該條件只對資工系套用）。

同時資通安全學程的「密碼學」（`IECS3052`）正常排入並解析為**核心選修**。

**3. 通識共同必修不計畢業學分（A/B）**

在 `/schedule` 選取「體育－羽球」與「密碼學」後排課：

| 課表內容 | 顯示 |
| --- | --- |
| 只有體育－羽球 | 🎓 1 學分 ／ 🧮 計入畢業 **0** 學分 |
| 體育－羽球 + 密碼學 | 🎓 4 學分 ／ 🧮 計入畢業 **3** 學分 |
| 沒有軍訓體育的課表（首頁 25 學分） | 只顯示 🎓 25 學分，不顯示計入畢業標籤 |

**4. 核心選修分類**

首頁課表中的人工智慧導論、數位系統設計、數位系統設計實驗、程式語言、系統分析與設計、
密碼學，`category` 皆為 `核心選修`（`sourceCategory` 為 `選修`），並帶有 `track`。

**5. 班別下拉選單（A/B）**

`/setup` 的班別選項隨年級變動：大三為「資訊三甲／乙／丙／丁／合」，
切到大二變成「資訊二甲／乙／丙／丁／合」，清單由 `GET /api/courses/classes` 現場推導。

**console 無新增錯誤。**

### 驗證過程中發現並修正的兩個問題

1. **警告訊息洗版**：系外選修的難度提醒原本每門課一條，實測產生 24 行，把其他警告全部
   淹掉。改為彙整成單行並只列前 3 門課名。
2. **警告訊息指涉錯誤**：不計畢業學分的警告原本寫「本方案」，但 `generateSchedule()`
   會把所有方案的警告聯集後回傳，使用者看到的是主推方案旁邊掛著別的方案的學分數
   （實測：主推方案沒有體育課，警告卻來自「涼課與高分優先」方案）。改為指名方案標題。

### 資料檔還原

瀏覽器測試會寫入 `server/data/users.json` 與 `user_preferences.json`。測試後已用
`git checkout` 還原，僅保留刻意加入的 `"className": "資訊三甲"` 一行。

## 對抗式審查後的修正（2026-08-04 第二輪）

初版完成後跑了一次對抗式審查，指出兩個問題，使用者裁示後修正。

### 修正一：使用者明確指定的課程被靜默剔除（high）

**問題**：`prepareCandidates()` 在 `buildPlan()` 拿到選課清單之前就把不符合系外選修
認列條件的課剔除。手動選課流程中，`POST /api/schedule/generate` 的 `courseIds` 是使用者
在課程瀏覽器親手勾的課，但它只決定候選池、**不會**進入 `selectedCourseIds`，因此那些課
被當成系統自撿的候選而移入 `excludedCourses`，回應仍是 `success: true`，畫面上只是少了
一門課，沒有任何線索。而這條規則講的是「能不能計入畢業學分」，不是「能不能修」。

**使用者裁示**：保留該課程，但標示為「不計入畢業學分」，看使用者保留還是移除。

**修正**：

- `constraintService.js` 新增 `explicitCourseIds`；`routes/schedule.js` 把 `courseIds`
  併入其中。`collectExplicitCourseIds()` 另涵蓋 `selectedCourseIds`、`mustTakeCourseIds`、
  `retakeCourseIds`。
- `prepareCandidates()` 對不認列的課分流：系統自撿的照舊剔除（不推薦不能認列的課），
  **使用者明確指定的保留並排入**，標記 `countsTowardGraduation: false`、
  `nonGraduationCategory: '系外選修未認列'`、`outsideElectiveReasons`。
- `generalEducation.js` 的 `getNonGraduationCategory()` 改為優先採用課程上既有的
  `nonGraduationCategory` 標記——那是課名看不出來的判定結果，不能被課名比對覆蓋。
- `SchedulePage` 的提示框改為同時列出 `warnings`。原本只顯示 `message`，
  使用者看得到「計入畢業 0 學分」卻不知道原因，也就無從決定要不要移除。

### 修正二：MySQL 使用者的班別可能「儲存成功」卻消失（medium）

**問題**：班別只寫進 `users.json`。存在於 `User_Profiles` 但沒有 `users.json` 對應列的
使用者，`writeClassNameOverride()` 回傳 false，`updateMysqlUserPreference()` 沒有欄位可寫
卻仍回傳成功的 profile 並提早 `return`，本機寫入被跳過。下一次排課直接退回系所 + 年級。

**使用者裁示**：等 MySQL 的 `User_Profiles` 新增 `class_name` 欄位，並讓 SQL 真正更新它。

**修正**：

- `database.js` 新增 `hasUserProfileClassNameColumn()`（`SHOW COLUMNS`，結果快取）。
  `getMysqlUserPreferences()` 依偵測結果決定是否 SELECT `class_name`，
  `updateMysqlUserPreference()` 依偵測結果決定是否 UPDATE。
  **欄位一由組員新增就自動改走 SQL，不需要再改任何程式**（需重啟後端）。
  不無條件加進 SQL：欄位不存在時整個查詢會失敗，等於所有 profile 一起壞掉。
- 欄位到位前的後備順序改為 `User_Profiles.class_name` > `user_preferences.json` >
  `users.json`。新增第 2 順位正是為了補上「MySQL 使用者但沒有 `users.json` 對應列」的破口；
  `upsertByField()` 在這個情況下不提早返回。
- 優先順序抽成純函式 `pickClassNameTarget()` 並補上測試，涵蓋審查指名的情境
  （numeric MySQL user without a users.json mirror）。

**本專案不自行執行 `ALTER TABLE`**——`User_Profiles` 與組員共用。
待辦與 DDL 記於 `docs/DATA_SCHEMA.md` 與 `docs/COURSE_SELECTION_RULES.md` 待確認清單。

### 驗證中另外修掉的兩個顯示問題

1. 警告字串用了 markdown `**`，但警告是純文字直接顯示，`**` 原樣印在畫面上。已移除。
2. 不計入畢業學分的警告寫「依校規」，但不計入的來源有兩種——通識共同必修是校規、
   系外選修未認列是系上規定，混為一談會讓使用者查不到依據。已移除「依校規」。

### 第二輪驗證

- `npm test`：**209 tests，209 pass，0 fail**（再新增 7 項）。
- `node --check`、client lint 與 build 皆通過。
- 瀏覽器實機（`preview_start` 啟動本 session 自己的 server 與 client）：
  在 `/schedule` 勾選應數系的「密碼學」後排課，該課**排入課表**，
  標籤顯示「1 門課／3 學分／🧮 計入畢業 0 學分」，提示框列出
  「你指定的課程中有 1 門不符合系外選修認列條件：密碼學（課程內容與本系「密碼學」重複，
  不認列為系外選修）。已排入課表，但學分不計入畢業，請自行決定是否移除。」
  同一門課在首頁的自動推薦流程仍被剔除（「已排除 60 門不符合系外選修認列條件的課程」），
  兩條路徑的分流正確。

## 是否 commit 與 push

**否。** 依使用者指示，尚未 commit 或 push。

## 已知未修正的缺陷

**`SetupPage` 不會帶回已儲存的班別。** 該頁的 `className` 初始值取自登入的 `user` 物件，
其中沒有 `className`，因此下拉永遠顯示「未指定班別」。後果是**進入設定頁、沒有碰班別
就按儲存，已存的班別會被清成空值**。

屬本次新增功能的資料遺失缺陷，修法為掛載時從 `GET /api/profile` 帶回 `className`。
已回報使用者，尚未決定修復時機，因此本次提交**未包含此修正**。

另見 `2026-08-01-frontend-backend-alignment-audit.md` 的 **F16**：由使用者實測發現，
直接手改 `server/data/users.json` 的班級與年級後排課不變。根因是 `department` / `grade`
的真相來源是 `user_preferences.json`，`users.json` 的同名欄位不生效，導致 profile 內部
矛盾（班別二乙 + 年級三）而觸發班別忽略邏輯。**本次只登記問題，未修改。**

## 未完成與後續

- `d.` 清單 53 門與原記錄 54 門的 1 門差距，需與 PDF 原件核對。
- **請組員在 `User_Profiles` 新增 `class_name varchar(45) NULL` 欄位。**
  程式已備妥讀寫並會自動偵測，欄位到位後重啟後端即改走 SQL，不需再改程式。
- 核心選修 12 學分的**達成度追蹤**尚未實作——目前只做到分類與優先度，未累計缺口。
- `docs/GRADUATION`／`routes/graduation.js` **未修改**：該路由不從課程資料加總學分
  （它讀 `user.earnedCredits` 的既有數字），沒有需要排除的計算。學分分離的修正落在
  排課引擎與前端顯示。
