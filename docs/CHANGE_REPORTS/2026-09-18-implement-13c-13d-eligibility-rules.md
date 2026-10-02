# 實作 roadmap #13C／#13D：B～F 班級適用規則、同系跨年級選修、本系優先排序

## 修改日期

2026-09-18

## 為什麼做這件事

roadmap #13C（B～F 類的正式適用規則）與 #13D（學制、學程與特殊身分）原本卡在「等系辦／校方
書面規則」，B～F 班級的課一律回 `eligibility: unknown`、排課保守排除。真實資料上這讓
Persona C 與 U1 都有 211 個班次被排除，可競爭課程只剩 7 門、16 門，是多方案塌縮（#10）、
推薦理由內容稀少（#26）與已修排除理由被擠出畫面（K27）的共同根源。

專案負責人於 2026-09-18 逐項口頭回答了全部待確認問題（記錄於 `docs/DEPARTMENT_MAPPING.md`，
另見 `2026-09-18-department-mapping-13c-answers.md`），並同意以「本人確認，2026-09-18」
作為規則來源。本次把這些規則寫進程式。

## 修改檔案清單

程式：

- `server/src/data/classKindCatalog.js`：新增 `ELIGIBILITY_RULES`（71 個 B～F 班級中 69 個
  有規則）、`COLLEGE_DEPARTMENTS`、`getEligibilityRule()`、`getStudentColleges()`
- `server/src/skills/courseScope.js`：`resolveCourseEligibility()` 套用規則；新增
  `isOwnDepartmentElective()`、`isCrossYearOwnDepartmentElective()`；`ELIGIBILITY_SOURCE`
  新增 `CONFIRMED_RULES`
- `server/src/skills/courseQuery.js`：排課候選池新增 `schedulingPool` 選項
- `server/src/skills/scheduler.js`：年級閘門放行同系選修；新增 `ELIGIBILITY_INELIGIBLE`
  排除與 warning；本系優先階層（`departmentTierComponents()`）；同一系列 (一)(二) 不排同學期
- `server/src/skills/scheduleValidator.js`：年級檢查放行同系選修；新增 `ELIGIBILITY_INELIGIBLE` 檢查
- `server/src/data/constraintSchema.js`：新增 `ELIGIBILITY_INELIGIBLE`、`SAME_SERIES_SAME_TERM`
- `server/src/routes/graduation.js`：補學分推薦對 B～F 仍只推通識（見下方「學分歸屬」）

測試：

- `server/test/courseScope.test.js`、`courseQuery.test.js`、`courseGradeLevel.test.js`、
  `graduationAttribution.test.js`、`scheduler.test.js`

文件：

- `docs/DEPARTMENT_MAPPING.md`、`docs/SCHEDULING_LOGIC.md`、`docs/DATA_SCHEMA.md`、
  `docs/API_SPEC.md`、`docs/CHANGE_REPORTS/2026-08-01-personalization-roadmap.md`
- 推甄資料包（`docs/application-portfolio/`）：已知限制、真實帳號驗證（新增 V7）、演算法章節、
  P0 表、Roadmap、驗收標準、風險、Demo 腳本、教授提問；證據存於
  `07_測試與評估/evidence/13c-13d-eligibility-2026-09-18/`

## 主要改動

### 1. B～F 適用規則

| 類別 | 規則 |
| --- | --- |
| B | 人文藝術與社會經典教育、軍訓(一年級) 限一年級；大二英文綜合班限二年級；國文綜合班、核心必修綜合班限一、二年級；其他不限年級 |
| C | 學院綜合班：該學院學生可修（系所欄是該綜合班，或系所屬於該學院）；創能、社會創新學院綜合班任何人可修；碩士綜合班大學部不可修 |
| D | 獨立學制，不在 `User_Profiles.department` 的值域內 → 不可修 |
| E | 不需報名 → 任何人可修 |
| F | 排除於系統外 → 不可修 |

仍回 `unknown`：`進修英班`／`大二進修英班`（沒有規則）、研究生對碩士綜合班、系所不在學院
對照裡、年級資料缺漏。`eligibilitySource` 標為 `class-catalog:owner-confirmed-2026-09-18`，
讓 API 與推薦理由看得出這是口頭確認的規則，不是校方文件。

`COLLEGE_DEPARTMENTS` 的系所名稱一律用 A 表全名。本人提供的人社學院清單裡的「公共事務與社會
創新研究所」不在 A 表，沒有列入；財務金融學系同時屬商學院與金融學院（依本人提供的資料原樣）。

### 2. 同系其他年級的選修（#13C-5）

本人確認：同系其他年級開的選修可以修，但本年級優先。`Courses.target_grade` 對同系選修只代表
開課年級，因此排課候選池、`prepareCandidates()` 的年級閘門與獨立驗證器都放行（判定：
`isOwnDepartmentElective()`）。必修不適用。課程搜尋頁與 Agent 查課不變，那兩條路徑的年級是
使用者選的篩選條件。

### 3. 本系優先的排序階層（實作過程中發現問題後由本人決定）

**第一版只套用適用規則，結果不能用。** 真實帳號實測：

| | 修改前 | 第一版 |
| -- | -- | -- |
| Persona C（涼課優先） | 4 門 11 學分，全是資工課 | 12 門 25 學分，**只剩 1 門資工課**：韓文(一)(二)、日文(一)(二)、越南文、多益… |
| U1（英文授課偏好） | 8 門 23 學分，全是資工課 | 11 門 25 學分，**只剩 1 門資工課**：6 門應用英語… |

原因是有評價的課集中在外語與通識（之前被排除的 68 門有評價課），涼課偏好讓它們的涼度都在
上限；U1 的英文授課偏好則命中應用英語課的描述。偏好照設計運作，但候選池放大後，排課就沒有
「資工系學生以本系課為主」的概念。

停下來請本人決定後，改成排序階層：本人必修（+5,000）→ 本年級本系選修（0）→ 他年級本系選修
（`crossYearElective` −2,500）→ 非本系課程（`outsideOwnDepartment` −5,000）。階層間距 2,500
大於偏好能造成的最大分差（興趣、集中各 ±480、涼度 ±240、內容偏好 ±320、學分係數約 72，
合計約 2,150），偏好只在同一階層內決定順序；學分還沒滿時下一階層照樣補進去。只在學生系所年級
可判定時生效。

### 4. 同一系列的 (一)(二) 不排同學期（本人決定）

第一版也暴露日文(一) 與日文(二)、韓文(一) 與韓文(二) 被排在同一學期。資料庫沒有先修資料，
本人決定加一條依課名推測的規則：課名只差結尾中文數字的課同學期只排一門（`SAME_SERIES_SAME_TERM`）。
本人必修與使用者明確指定的課豁免；只認中文數字（`程式設計(III)`／`(IV)` 是學校安排同學期修的
必修）；獨立驗證器不複查（`enforced: false`，列在驗證結果的 `unchecked`）。**這條規則也套到
校外專業實習(一)～(四)**：Persona C 原本同學期排 (二)(三)，現在只排 (四)。

### 5. 學分歸屬（沒有處理，刻意保守）

`eligibility` 只回答能不能修。學院綜合班、學程課的類別多半是 MySQL 原始的 `選修`，而畢業頁
補學分推薦的 `CATEGORY_TO_GAP` 會把 `選修` 對到**本系選修**。為避免錯誤歸屬，`graduation.js`
對 B～F 仍只推通識。排課回應的 `graduationCredits` 則暫時把它們計入（K29）。

## 測試與驗證

- 新增／改寫測試：B～F 規則逐類、依年級、資料不足回 unknown、系所欄是學院綜合班、財金系屬兩學院、
  每個 B～F 班級都有規則（只有兩個進修英班留白）、`CONFIRMED_RULES` 來源、排課候選池範圍、
  跨年級選修（CY1–CY5）、本系優先階層（DT1–DT3）、系列規則（SS1–SS4）、`ELIGIBILITY_INELIGIBLE`
  的排除／明確指定／驗證器。
- 改寫的既有測試都是**規則改變的預期結果**，逐一確認過不是程式改壞：例如「國文綜合班一律資格
  待確認」改成依年級判定；有幾個測試原本靠國文被整門排除才通過，其實已經沒在驗證標題寫的事
  （例如「非本人必修不得靠必修優先權壓過本系選修」），改成讓兩門課真的進入比較。
- 後端全套：**1,087 測試、1,084 通過、3 失敗**；3 個失敗仍是 `authRoutes`、`privacyRoutes`、
  `scheduleRoutes` 在 Windows 上的 libuv 結束 assertion（K22），子測試全部通過。
- `database-contract.test.js`（真實共用資料庫）：18/18。
- 真實帳號（瀏覽器 session 打 API，不改 profile）：

| | 修改前 | 最終版 |
| -- | -- | -- |
| Persona C | 4 門 11 學分；可競爭 7 門；資格待確認 211 | **10 門 25 學分：資工 9 門（本年級 3、他年級 6）＋ 創能學院 1 門**；可競爭 362 門；資格待確認 0；方案 2 種 |
| U1 | 8 門 23 學分；可競爭 16 門；資格待確認 211 | **10 門 25 學分：資工 9 門（本年級 8、他年級 1）＋ 華語教師學程 1 學分**；可競爭 365 門；資格待確認 0；方案 1 種 |

- Chromium 實際操作 Dashboard（按「套用偏好排課」）截圖：課表格、方案比較、提示區都正常顯示；
  console 只有登入前預期的 2 筆 401。
- **附帶效果**：兩個帳號排除清單的前 5 筆都變成「已修過並通過」（原本全是資格待確認），畫面上
  看得到已修排除理由。K27 的症狀在目前資料上消失，但清單仍然沒有排序。

## 影響範圍

- **排課結果大幅改變**：所有有系所年級資料的學生，候選池都會放大（同系他年級選修、學院綜合班、
  學分學程、外語選修…）。推甄 Demo 腳本鏡頭 6 的 A/B 數字是修改前量的，錄影前要重跑。
- **方案數**：候選池放大，但本系優先讓方案在本系課程上高度重疊，實測 Persona C 2 種、U1 1 種
  （P0-5 需以目前版本重新量測）。
- **沒有改的**：課程搜尋頁與 Agent 查課的範圍、A 類必修的判定、已修排除本身、他系選修範圍
  （系統只服務資工系）。
- **共用資料庫**：只讀；排課請求會照既有機制寫曝光事件，並可能觸發學習權重重算（P0-3）。沒有
  修改任何帳號的 profile。
- **規則來源的限制**：全部規則來自本人口頭確認，不是校方書面文件。日後取得校方文件時要回頭核對
  `ELIGIBILITY_RULES` 與 `COLLEGE_DEPARTMENTS`。

## 是否 commit 與 push

**否。**
