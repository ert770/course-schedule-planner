# 測試規劃

## 自動化測試

```bash
npm test
```

於根目錄執行，等同 `cd server && npm test`。使用 Node 內建的 `node:test`，不需額外依賴。

測試位於 `server/test/`，涵蓋下方「排課邏輯測試」與「AI Agent 契約測試」的案例。這些測試**刻意不連資料庫**：排課邏輯是純函式，用合成資料才能穩定重現邊界情境，也讓測試在沒有 `.env` 與 MySQL 連線的環境仍可執行。

**例外：`server/test/database-contract.test.js` 直接連真實 MySQL。** 見下方「資料庫契約測試」。

一次跑完 lint、build 與測試：

```bash
npm run verify
```

## 驗證指令

前端 build：

```bash
cd client
npm run build
```

前端 lint：

```bash
cd client
npm run lint
```

後端語法：

```bash
cd server
node --check src/app.js
```

## 排課邏輯測試

| 編號 | 情境 | 預期結果 |
| --- | --- | --- |
| S1 | 兩門加選課同天同時段 | 判定衝堂 |
| S2 | 兩門關注課同天同時段 | 不判定衝堂 |
| S3 | 必修課與選修衝堂 | 優先保留必修 |
| S4 | 必修不及格且本學期有開課 | 優先排入重補修 |
| S5 | 資工系選修且課號為 `IECS`、課名在必選修科目表核心選修清單中 | 解析為 `核心選修` 並帶出修課路徑 |
| S5 | 同名但課號非 `IECS` 的他系課程（`網路程式設計 COME3016`） | 不得解析為資工系核心選修 |
| S6 | 指定 `preferredTrack` 但候選中沒有該路徑的課程 | 回報警告而非靜默通過 |
| S7 | 設定不上早八 | 不排入第一節開始課程 |
| S8 | 設定週一空堂 | 週一不排正式加選課 |
| S9 | 學分低於最低門檻 | 回傳警告或補課建議 |
| S10 | 無法滿足所有硬性限制 | 回傳失敗原因 |
| S11 | request 送空陣列偏好，但使用者有已儲存偏好 | 退回已儲存偏好，不得清空 |
| S12 | request 送非空陣列偏好 | 覆蓋已儲存偏好 |
| S13 | 表達興趣偏好且候選充足 | 興趣方案即使學分較少仍為 `plans[0]` |
| S14 | 未表達任何軟性偏好 | `hasExpressedPreference` 為 false 並回傳警告 |
| S15 | Agent 送 `mondayFree` | 展開為週一 1-14 節封鎖並與既有封鎖時段合併 |
| S16 | 候選課程全為關注狀態 | `success` 為 true、`watchOnly` 為 true、回傳關注課程與對應訊息 |
| S17 | 指定必修排不進去且有關注課程 | `success` 為 false，但 `watchedCourses` 仍完整回傳 |
| M1 | 多時段課程與其**第二個以後**的時段重疊 | 判定衝堂 |
| M2 | 多時段課程與任一時段皆不重疊 | 不判定衝堂 |
| M3 | 封鎖時段命中多時段課程的非第一段 | 該課程被排除且理由為封鎖時段 |
| M4 | 多時段課程跨多天 | 單日課程數上限對每一天分別計算 |
| W1 | 週六課程 | 可被排入且顯示於課表 |
| W2 | 週日課程 | 可被排入且顯示於課表 |
| W3 | 課表顯示 | 課表格含週一至週日共七欄 |
| U1 | 候選含無時間課程 | 不進入 `schedule`，貪婪填充不主動加入 |
| U2 | 無時間課程被指定為必要課程 | 排入 `unscheduledCourses` 並發出警告 |
| U3 | 排入無時間課程後 | `courseCount` 含之，訊息說明門數與學分的組成 |
| U4 | 候選含大量 0 學分課程 | 貪婪迴圈不會跑到候選清單耗盡 |
| R1 | 學生為資訊系一年級，候選含 `資訊一甲`、`資訊三甲`、`會計一甲`、`運輸物流碩二` 的必修 | 只排入 `資訊一甲` 的必修，其餘不進候選 |
| R2 | 同一批候選改以三年級學生排課 | 改為排入 `資訊三甲` 的必修，不含一年級必修 |
| R3 | 未設定系所或年級 | 不把任何課當成必修，並回傳「未設定系所或年級」警告 |
| R4 | 候選含 `國文綜合班` 等共同科目必修 | 保留為候選，但不享有必修優先度，且回傳「尚無適用對象規則」警告 |
| R5 | 班級名稱為 `建設英班`、`商學院綜合班`、`商學一(UQ)` 等 | 不得被誤判為系所班級 |
| B1 | 同一課號（`catalogCourseCode`）的兩個班次，時段不衝突 | 只排入一個班次，另一個理由為「已排入同一門課的其他班次」 |
| B2 | 第一個班次違反硬性限制 | 改排同一門課的另一個班次 |
| B3 | 正課 `MATH1005` 與實習 `MATH1005P` | 視為不同課號，不受一課一班次限制 |
| B4 | `POST /api/schedule/validate` 收到同一門課的兩個班次 | `valid` 為 false 並回傳 `duplicates`，不得報成衝堂 |
| B5 | 課程無 `catalogCourseCode` | 以課程名稱作為同一門課的後備判定 |
| C1 | 未指定學分上限 | 上限為校規的 25 學分（非舊值 22） |
| C2 | 未指定學分下限且總學分不足 | 警告「低於最低目標 12」（非舊值 15） |
| C3 | `gradeLevel` 為 4 且排入 9 學分 | 視為已達下限，不發出學分不足警告 |
| C4 | `allowCreditOverload` 為 true | 上限放寬至 30 學分；未開啟時維持 25 |
| C5 | 同一天 6 門不衝堂的課 | 全部可排入，無「每日 N 門」限制 |
| C6 | 呼叫端指定 `maxCoursesPerDay: 3` | 該日只排入 3 門 |

### 班別收斂（必修不得換班）

| 編號 | 情境 | 預期結果 |
| --- | --- | --- |
| K1 | 學生班別為 `資訊三甲`，候選含 `資訊三甲`／`資訊三乙` 的必修 | 只排入 `資訊三甲` 的必修 |
| K2 | 學生班別為 `資訊二甲`，必修開在合班 `資訊二合` | 視為本班必修，仍排入 |
| K3 | 未設定班別 | 維持系所 + 年級判定，並警告「未設定班別」 |
| K4 | 班別的**系所**與 profile 不符（`電機三甲` 對資工） | 忽略班別並警告，年級沿用 profile，不得靜默排除全部必修 |
| K5 | 班別儲存位置決策 | 欄位存在→`column`；否則有 `users.json` 對應列→`usersJson`；皆無→`localProfile` |
| K6 | 班別為本系班級但**年級**與 profile 不符（`資訊二乙` 對三年級） | 年級改依班別，回報 `gradeOverriddenByClass` 並警告兩邊的年級 |
| K7 | 只改班別（三甲 → 二乙），其餘不變 | 課表換成該年級該班的必修 |
| K8 | 系所填了但對不到 A 表（`資訊工程學糸`） | 回報**失敗**並指名系所，不得混為「未設定系所」 |
| K9 | 只缺年級 | 訊息只提年級，不提系所 |
| K10 | **明確指定**他班或他系的必修 | 豁免整批排除，排入並警告需自行向系辦確認 |

### 系外選修認列條件（資工系）

| 編號 | 情境 | 預期結果 |
| --- | --- | --- |
| E1 | 他系所班級的選修 | 判定為系外選修 |
| E2 | 通識、共同科目、學院綜合班、學分學程 | **不**判定為系外選修，不套用認列條件 |
| E3 | 進修部開設的他系選修 | 不認列 |
| E4 | 課名與本系必選修科目表重複（`密碼學 MATH3069`） | 不認列 |
| E5 | 大一且課名含概論字樣 | 不認列 |
| E6 | 非大一的導論課 | 認列，不因課名被誤殺 |
| E7 | 大一層級課號 | 認列，但回報難度需自行確認的警告 |
| E8 | 系統自撿的候選不符合認列條件 | 剔除候選並記錄原因 |
| E9 | **使用者明確指定**的課程不符合認列條件 | **保留並排入**，標記不計入畢業學分並說明原因 |
| E10 | 難度警告涉及數十門課 | 彙整成單行，且警告文字不得含 markdown 語法 |
| E11 | 非資工系學生 | 不套用這組條件 |

### 畢業學分與學期學分分離

| 編號 | 情境 | 預期結果 |
| --- | --- | --- |
| G1 | 課表含軍訓國防科技、體育、班級活動 | `totalCredits` 含之，`graduationCredits` 不含 |
| G2 | 排入的每門課 | 帶 `countsTowardGraduation` 與 `nonGraduationCategory` |
| G3 | `POST /api/schedule/validate` | 同樣分開回報兩個學分數 |
| G4 | 軍訓選修（`全民國防`、`國防政策`） | 維持計入（各系採計方式未確認） |
| G5 | 系所查不到官方對照表（`getGraduationRequirement()` 回傳 `null`） | `required`／`totalRequired`／`gaps` 皆為 `null`，`warnings` 含「此系所不存在，請檢查是否輸入錯誤」 |
| G6 | 系所查得到官方對照表 | 回傳正確學分拆解，不帶警告；對照現有資訊工程學系資料的迴歸基準 |

`server/test/graduation.test.js`。`routes/graduation.js` 先前零測試覆蓋——本檔是第一份。
專案沒有 supertest 之類的 HTTP 路由測試設施，因此把判斷抽成純函式
`resolveRequiredCredits()` 並匯出，不必啟動整個 Express app 就能測。

### 已修課程排除與修課歷史派生運算

已修排除的判定依據是課號（`courseHistory[].courseCode` 比對 `course.catalogCourseCode`），
不是每學期都會改變的 section id；`data/courseHistory.js` 提供的三支派生函式
（`getPassedCourseCodes()`／`getEarnedCredits()`／`getTotalEarnedCredits()`）
是排課、畢業頁共用的唯一來源，取代了先前各自獨立、彼此可能不一致的
`completedCourseIds`／`completedCourseCodes`／`completedCredits`／`earnedCredits`。

`server/test/courseHistory.test.js`：

| 編號 | 情境 | 預期結果 |
| --- | --- | --- |
| H1 | 課程 `passed: false` | 不列入 `getPassedCourseCodes()` 的已修課號 |
| H1 | 課程 `graduationCategory: nonGraduation`（如體育） | 仍列入已修課號——「修過」與「計不計學分」是兩件事 |
| H1 | `courseHistory` 為空、未帶或 `null` | 回傳空陣列，不噴例外 |
| H2 | 課程未通過 | `getEarnedCredits()` 不計其學分 |
| H2 | 課程分類為 `nonGraduation` | 不計入任何分類，也不進總學分 |
| H2 | `graduationCategory` 缺漏或不在已知清單 | 歸入 `unspecified`，不靜默丟棄學分 |
| H2 | `courseHistory` 為空 | 回傳全 0 物件而非 `undefined` |
| H3 | demo 使用者（`D1249697`）真實 53 筆資料 | 分類學分 `61/22/24/11`、總學分 `118`——與整併前的既有值逐項相符 |
| H3 | 同一批真實資料 | 53 個已修課號皆不重複 |
| H3 | 整併後的 `users.json` | `completedCourseCodes`／`completedCourseNames`／`completedCourseIds`／`completedCredits`／`earnedCredits` 五個欄位皆不存在 |

`server/test/scheduler.test.js`（`generateSchedule()` 端到端，不是只測合併函式）：

| 編號 | 情境 | 預期結果 |
| --- | --- | --- |
| H4 | 已修課號有多個候選班次 | **每一個班次**都被排除，各自附上「已修過並通過（課號 XXX）」 |
| H5 | 同一課號換成不同 section id（模擬跨學期） | 仍被排除——本次改動要修的核心目的 |
| H6 | 最新紀錄為 `passed: false` 的必修 | 由 `courseHistory` 自動映射本學期同課號 section 並排入，不接受手動 `retakeCourseIds` |
| H6 | 舊學期不及格、較新學期通過 | 只視為完成，不再成為重補修候選 |
| H6 | 本學期必修與重補修衝堂 | 保留本學期必修，並提示重補修未排入 |
| H6 | 不及格必修本學期沒有開課 | 回傳提醒下學期重修的明確 warning |
| H7 | 候選課程沒有 `catalogCourseCode` | 不以課名 fallback 誤判為已修 |
| H8 | 課號比對 | 精確字串比對，不做 trim 或大小寫正規化（已實測兩側格式一致，見 `docs/DATA_SCHEMA.md`） |

`server/test/databaseProfileContract.test.js`（原始碼掃描，防止 A5 回歸）：

| 編號 | 斷言 |
| --- | --- |
| A1/A5 | `database.js` 原始碼不再出現 `completed_courses`，也不再產生或接受 `completedCourseCodes`、`completedCourseNames`、`completedCourseIds`、`completedCourses`、`completedCredits`、`earnedCredits` 等修課歷史衍生欄位 |

## 資料庫契約測試

`server/test/database-contract.test.js`。合成資料的測試不會在**資料庫變動時**失敗，
這個檔案補上該缺口：它把「程式默默假設成立、一旦不成立就靜默出錯」的前提全部寫成斷言。

| 編號 | 斷言 | 對應踩過的坑 |
| --- | --- | --- |
| D1 | `Courses.subid3` 全部非空 | 空值會讓班次去重退回課名比對 |
| D2 | 同一 `subid3` 對到多個 `course_id`（含 `IECS3002`） | 一課多班次是班次去重的整個前提 |
| D3 | 相異 `dept` 值數量不得大幅偏離基準 | 資料不完整會讓其他斷言失去意義 |
| D4 | `dept` 可解析為系所班級的比例不得低於基準 | 解析規則被改壞會立刻紅燈 |
| D5 | 假陽性名單為空（英語班、國際學程、學院綜合班…） | 只比前綴會把它們判成系所班級 |
| D6 | 解析成功的班級都對得到系所全名 | A 表缺漏會讓整個系所的必修判不出來 |
| D7 | `User_Profiles.department` 全部對得到 A 表 | 組員把系所名稱打錯會被抓到 |
| D8 | `Courses.type` 只有 `必修`／`選修` | 類別解析的前提；`核心選修` 等值由程式產生 |
| D9 | `time_str` 可解析率不得低於基準 | 解析不出時段的課不受任何限制，會被貪婪填充無限塞入 |
| D10 | 解析失敗的 `time_str` 都有可解釋的原因（節次 `00`、`未決定`） | 出現新格式代表解析規則漏了規則 |

基準值以 2026-08-04 實測為準（562 個相異 `dept`、85.9% 解析率、3086 筆 `Courses`、
3560 筆 section、93.7% 時間可解析率），比例容忍 5%、數量容忍 25%。門檻是用來抓
「規則被改壞」或「資料大幅變動」，不是鎖死每一筆資料。

**未設定 `DB_*` 時整組標記為 skip**，輸出顯示 `skipped 10` 而非靜默通過——
「沒跑」與「跑過且通過」必須分得出來。

## AI Agent 契約測試

| 編號 | 情境 | 預期結果 |
| --- | --- | --- |
| P1 | `buildSystemPrompt` 輸出 | 含 `run_csp_scheduler` 的所有可用參數 |
| P2 | 使用者有已儲存興趣關鍵字 | prompt 的偏好摘要列出這些關鍵字 |
| P3 | `agentService` 新增排課參數 | `promptService.js` 與本文件同步更新 |

## API 測試

| API | 測試項目 |
| --- | --- |
| `/api/health` | 回傳 `status: ok` |
| `/api/auth/login` | 正確登入、錯誤密碼、缺少欄位；成功時設定簽名 HttpOnly session cookie |
| `/api/auth/me` | 未登入 401；登入後由 session 回傳 canonical student ID |
| `/api/courses` | keyword、department、category、period 查詢 |
| `/api/schedule/generate` | 無 courseIds、指定 courseIds、偏好限制 |
| `/api/schedule/validate` | 有衝堂、無衝堂 |
| `/api/profile` | DB-less CI 驗證未登入 401、改送另一個 ID 時在資料存取前回 403；成功讀取／更新 session 使用者偏好須在已設定 MySQL 的整合環境驗證，schema v1 另由純函式測試固定契約 |
| `/api/reviews/easy` | limit 正常運作 |
| `/api/graduation/me` | 學分缺口與推薦 |
| `/api/chat` | 無 message、正常 message、無 API key |

## 前端操作測試

- 登入後導向 onboarding 或 dashboard。
- 初始偏好可儲存。
- 課程搜尋可查詢並顯示結果。
- 儀表板可產生課表。
- 課表格可顯示不同星期與節次。
- 畢業學分頁可顯示缺口。
- AI 聊天輸入後可顯示回覆。
- 自動重補修瀏覽器 A/B 使用 `server/test/fixtures/browser-with-failed` 與
  `browser-without-failed`，由 `DATA_DIR` 指向隔離資料，不修改正式
  `server/data/users.json`。兩組只改 `IECS3059` 的 `passed`，其餘登入與 Profile 條件相同。
  `browser-not-offered` 另驗證本學期沒有對應 section 時的使用者 warning。
  測試 client 可在 DEV 設定 `VITE_E2E_BYPASS_SETUP=true`；此開關只接受 `BROWSER*`
  fixture 帳號，避免為了進 Dashboard 寫入 shared MySQL Profile。

## AI Agent 測試

| 情境 | 預期 |
| --- | --- |
| 問「幫我排不要早八」 | 呼叫排課工具並套用 `noMorningClasses` |
| 問「找涼課」 | 查詢評價或 easy courses |
| 問不存在課程 | 不得編造，需說明查無資料 |
| 問畢業門檻 | 回答 128 學分與分類要求 |
| 資料不足 | 說明限制並要求補充 |

## 每次開發完成驗收

1. 確認相關文件已更新。
2. 執行前端 build。
3. 執行必要的 lint 或語法檢查。
4. 確認 `.env` 與 `node_modules/` 沒有被加入 Git。
5. 若修改排課邏輯，至少執行排課測試案例 S1-S10。

