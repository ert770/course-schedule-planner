# 2026-08-04 以官方選課規則取代寫死的學分數字

## 修改日期

2026-08-04

## 修改檔案清單

**新增**

- `docs/COURSE_SELECTION_RULES.md`
- `server/src/data/graduationRequirements.js`
- `docs/CHANGE_REPORTS/2026-08-04-official-course-selection-rules.md`（本報告）

**修改**

- `server/src/skills/scheduler.js`
- `server/src/services/constraintService.js`
- `server/src/services/memoryService.js`
- `server/src/services/promptService.js`
- `server/src/db/database.js`
- `server/src/routes/graduation.js`
- `client/src/pages/DashboardPage.jsx`
- `client/src/components/Profile/ProfileForm.jsx`
- `server/test/scheduler.test.js`
- `docs/SCHEDULING_LOGIC.md`、`docs/REQUIREMENTS.md`、`docs/PROMPT_DESIGN.md`、`docs/TEST_PLAN.md`
- `docs/CHANGE_REPORTS/README.md`

## 問題

排課與畢業判定用的數字**沒有一個有出處**：

| 位置 | 寫死的值 | 官方規則 |
| --- | --- | --- |
| `scheduler.js` | 學分下限 15、上限 22 | 下限 **12**（四年級 **9**）、上限 **25**、超修 **30** |
| `scheduler.js` | 每日最多 4 門課 | **校方無此規定** |
| `graduation.js` | 必修 60／選修 40／通識 20／系外 8，總計 128 | 依系所而定；資工系為 63／28／9／16／12 |
| `REQUIREMENTS.md` | 總畢業學分 128（當成全校通用） | 128／130／131／134／**156**（建築五年制） |

`SCHEDULING_LOGIC.md` 與 `graduation.js` 兩份文件對畢業學分的拆法**互相矛盾**，且兩份都沒有來源。

## 資料蒐集

自逢甲大學註冊課務組「114學年度新生必選修科目」（2025-08-28 公告）索引頁取得**日間學士班 49 個單位**的必選修科目表 PDF，逐份讀取後彙整。

41 份可用 `pypdf` 直接抽取文字；8 份商學院科目表為圖片式 PDF（無文字層，`pdftotext` 與 `pypdf` 皆只能取出 1–2 個字元），逐份人工判讀。節次時間對照表另從官方 PDF 取得。

## 主要改動內容

### 新增 `docs/COURSE_SELECTION_RULES.md`

記錄校級規則與出處，並明確標示未確認項目。程式端三個資料檔（`graduationRequirements.js`、`departmentMapping.js`、`periods.js`）以本文件為唯一真相來源。

### 新增 `server/src/data/graduationRequirements.js`

49 個學士班單位的畢業學分結構：`total`、`deptRequired`、`deptElective`、`outsideElective`、`generalBasic`、`generalElective`、`unspecified`。

三個標記：

- `needsVerification`：抽取結果可疑（財金、風保、財精的本系選修為 0、未列明學分達 29–34；資電學院學士班全為 0），未經人工複核前不得作為判定依據。
- `commonFirstYear`：大一共同學士班／不分系，畢業學分於分流後依所屬系所計算。

### 學分上下限依校規

- 未指定時上限 25、下限 12；`gradeLevel` 為 4 時下限 9。
- 超修上限 30，**必須由使用者明確開啟**（`allowCreditOverload`），系統不得預設。
- 每日課程數上限移除預設值（改為 `Infinity`），呼叫端仍可自行指定。

### 畢業學分改查對照表

`graduation.js` 依學生系所查 `getGraduationRequirement()`。**查不到對照時明確回報警告**，不再用臆測的數字讓畫面看起來正常。

### 使用者資料上的舊學分數字（實測才發現）

改完 `graduation.js` 後實測 `GET /api/graduation/D1249697`，發現**仍回傳舊的 60／40／20／8**。原因是 `server/data/users.json` 自帶 `requiredCredits` 與 `totalRequired`，而路由寫成 `user.requiredCredits || 官方對照表`——使用者資料優先，官方值被蓋掉且毫無跡象。這正是這批捏造數字能存活至今的原因。

- `graduation.js`：改為**官方對照表優先**，使用者自帶的值只在查不到對照時作為後備。
- `users.json`：移除捏造的 `requiredCredits` 與 `totalRequired`；`earnedCredits` 的 key 由中文（必修／系內選修／通識／系外選修）改為與對照表一致的 `required`／`elective`／`general`／`external`，否則缺口會拿 `undefined` 相減而等於整份要求。
- `client/src/pages/GraduationPage.jsx`：新增 key 對中文標題的對照，否則畫面會顯示「尚缺 required」。

### 節次時間對照

官方「上課節次時間對照表」共 14 節，與 `server/src/utils/periods.js` 的 `PERIOD_TIMES` **逐節核對完全一致**，不需修改。

## 已確認但尚未實作（記錄於規則文件與路線圖）

- **必修不得換班**（資工系明文）：必修範圍應收斂到班別（資訊三甲／三乙），但 `User_Profiles` 沒有班別欄位。
- **系外選修條件**（資工系）：非進修部、非基礎概論性、內容不與本系重複、難度不低於本系。
- **通識共同必修 3 學分不計入畢業學分**：軍訓國防科技 1、體育 2、班級活動。目前排課會排入但學分計算尚未排除。
- **資工系選修 `c.`／`d.` 分類**：`c.` 15 門、`d.` 54 門，`c.` 疑似核心選修，但官方文件未定義，**未採用**。
- **修課路徑名稱落差**：系網與獨立來源均寫「電腦系統／軟體工程／網路與資安」，專案文件寫「嵌入式系統／技術應用／網路安全」，待確認以何者為準。

## 影響範圍

- **行為變更**：每學期可排入的學分由 15–22 變為 12–25，課表門數會增加；同一天不再受 4 門限制。
- `GET /api/graduation/:studentId` 的學分要求改為依系所查表，查無對照時回傳警告。
- AI Agent 的 `run_csp_scheduler` 新增 `allowCreditOverload`、`department`、`gradeLevel` 參數。

## 測試與驗證結果

`server/test/scheduler.test.js` 新增 C1–C6，對應 `docs/TEST_PLAN.md`：上限 25、下限 12、四年級下限 9、超修 30、每日無上限、呼叫端可自訂每日上限。

**測試總數由 151 增至 157，全數通過。** `node --check`（server/src 全部）、client `lint` 與 `build` 通過。

### 瀏覽器實測

以 demo 帳號 `D1249697` 登入操作：

| # | 情境 | 結果 |
| --- | --- | --- |
| 1 | `POST /api/schedule/generate` 未指定學分 | **25 學分**（修改前為 22） |
| 2 | 帶 `allowCreditOverload: true` | **30 學分** |
| 3 | 帶 `gradeLevel: 4` | 25 學分、4 門課，不因 9 學分下限而誤判不足 |
| 4 | 帶 `maxCoursesPerDay: 2` | 仍為 25 學分但改變分佈，呼叫端指定值有效 |
| 5 | `GET /api/graduation/D1249697`（修正前） | **仍回傳舊值 60／40／20／8** ← 據此發現 users.json 的覆蓋問題 |
| 6 | 同上（修正後） | 本系必修 63、本系選修 28、外系 9、通識 28、總計 128 |
| 7 | 畢業學分頁面 | 顯示「已修學分 107 / 128」「尚缺本系必修 13」「尚缺通識 12」，標題為中文 |
| 8 | console | 無錯誤 |

## 是否 commit 與 push

- 未 commit。
- 未 push。
