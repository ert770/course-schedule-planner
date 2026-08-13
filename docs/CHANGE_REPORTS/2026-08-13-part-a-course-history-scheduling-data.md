# Part A：`courseHistory` 成為修課歷史唯一來源，排課依課號排除已修課程

## 修改日期

2026-08-12 ～ 2026-08-13

## 本報告的定位

本報告整合原本分散的四份報告——`2026-08-12-a2-course-history-constraint-passthrough.md`、
`2026-08-12-a3-exclude-passed-courses-by-code.md`、`2026-08-12-a5-stop-completed-courses-io.md`、
`2026-08-12-a6-remove-completed-course-agent-param.md`——加上 A1／A4／A7（先前沒有獨立
報告的部分），完整記錄 `docs/CHANGE_REPORTS`（規劃檔 `step2-plan-staged-liskov.md`）
Part A 的 A1～A7。原本四份報告的實測數據保留在下方，不重新驗證。原四份檔案本次刪除。

## Context：為什麼要做這件事

排課引擎的已修排除機制**從未生效過**。`scheduler.js` 用 `completedCourseIds` 比對
候選課的 `course.id`，但這個欄位存的是當學期 section id——`users.json` 的
`completedCourseIds` 一路是空陣列（2026-08-06 匯入成績單時刻意清空，避免把歷史課程
誤連到當期 section），空集合排除不了任何課。同一份修課歷史資料又在 `users.json`
上被拆成 `completedCourseCodes`、`completedCourseNames`、`completedCredits`、
`earnedCredits`、`courseHistory` 五、六份各自維護，MySQL `User_Profiles.completed_courses`
是第三個位置。同一份事實有多個代表，只要有一個沒同步更新，就會出現「排課引擎說
沒排除、畢業頁說已經修過」這種各說各話的狀態。

**唯一的真相來源收斂成 `courseHistory`**（`users.json`，MyFCU 成績單匯入），
已修課號、已修學分、分類學分彙總一律從它當場算，其餘五個欄位與 MySQL 對應欄位
全部停止使用。

## A1：`courseHistory` 欄位整併

**修改檔案**：`server/src/data/courseHistory.js`（新檔）、`server/data/users.json`、
`server/src/services/memoryService.js`、`server/test/courseHistory.test.js`（新檔）。

- 新增 `getPassedCourseCodes()`／`getEarnedCredits()`／`getTotalEarnedCredits()`
  三支純函式，統一放在 `data/` 而非 `services/`——`scheduler.js` 只 import
  `utils/`、`skills/`、`data/`，放進 services 會讓排課引擎反向相依服務層。
- `users.json` 移除 `completedCourseIds`、`completedCourseCodes`、`completedCourseNames`、
  `completedCredits`、`earnedCredits` 五個欄位；`courseHistory` 每筆新增 `passed`
  布林（`score >= 60`，一次寫入 53 筆），供已修排除與重補修共用同一個事實。
- `memoryService.js` 的 `emptyProfile()`／`readCourseHistory()` 不再產生或回傳這五個
  欄位的派生版本——profile 物件上只留 `courseHistory` 本尊，需要課號或學分的呼叫端
  當場算，不在記憶體裡重新造出「courseHistory 之外的第二個代表」。

**實測**：由 `courseHistory` 現算的分類學分 `{required:61, elective:22, general:24,
external:11}`、總學分 `118`，與整併前 `users.json` 存的既有值逐項相符——整併只是
換了計算方式，沒有改變畢業進度的數字。

## A2：排課限制條件改為 `courseHistory` 直通

**修改檔案**：`server/src/services/constraintService.js`、`server/test/constraints.test.js`。

`completedCourseIds` 的 `pickList()` 合併邏輯改為 `courseHistory: prefs.courseHistory ?? []`
純直通、不接受 request 覆蓋。`pickList()` 的用途是「request 可以覆蓋已儲存偏好」，
但修課歷史沒有任何呼叫端會在 request 裡送——寫成雙來源合併只會暗示一個不存在的
覆蓋能力，還可能讓模型塞入捏造的修課紀錄。

**驗證**：`node --test test/constraints.test.js` 10 項全數通過；根目錄 `npm test`
270 項全數通過。A2 是內部限制物件的 staged 修改，尚未形成使用者可見行為。

## A3：排課引擎依課號排除已通過課程

**修改檔案**：`server/src/skills/scheduler.js`、`server/test/scheduler.test.js`、
`client/src/pages/DashboardPage.jsx`。

- `buildPlan()` 呼叫 `getPassedCourseCodes(constraints.courseHistory)`，已修排除改用
  `course.subid3` 精確字串比對，取代原本恆為空的 `completedCourseIds`（比對 `course.id`）。
- 一課多班次時**每一個班次**都排除；同一課號換不同 section id（跨學期）仍能正確排除
  ——這正是本次改動要修的核心目的。
- 被排除的課推入 `excludedCourses`，附上「已修過並通過（課號 XXX）」，不再靜默消失。
- 課號比對**不做**任何正規化（`trim`／大小寫轉換），也不沿用有課名 fallback 的
  `getCourseKey()`——已實測 `courseHistory.courseCode` 與 `Courses.subid3` 兩側格式
  完全一致（皆無前後空白、無非大寫、無空值），加正規化是為不存在的資料狀態寫防禦。
- **不需要額外的重補修豁免邏輯**：`passed: false` 的課從一開始就不在已修集合裡，
  與 `retakeCourseIds` 天生互斥。
- `DashboardPage.jsx` 補上：成功排課但仍有 `excludedCourses` 時也要顯示提示，
  否則 A3 排除的理由會在畫面上靜默消失。

**實測**（真實使用者 `D1249697`）：候選池 16 門中 6 個已修班次（計算機結構學、
計算機演算法、專題研究（一）、人工智慧導論 3 個班次）全部回傳已修排除原因，
均未出現在課表；課表由 9 門 25 學分變成 8 門 23 學分。`node --test test/scheduler.test.js`
45 項全數通過（含 5 項新案例）；根目錄 `npm test` 275 項全數通過；`npm run lint`／
`npm run build` 通過；後端冷啟動成功；Browser console 無新增 error 或 warning。

## A4：畢業頁改用 `courseHistory` 派生函式

**修改檔案**：`server/src/routes/graduation.js`、`server/test/graduation.test.js`（新檔）、
`client/src/pages/GraduationPage.jsx`、`client/src/App.css`、`docs/API_SPEC.md`、
`docs/TEST_PLAN.md`。

`graduation.js` 有三處讀 `users.json` 上已刪除的欄位，全部改讀 `user.courseHistory`
並呼叫 A1 的三支派生函式：

- **已修課程排除**（`建議補足系上課程」推薦邏輯）：`new Set(user.completedCourseIds)`
  比對 `course.id` → `new Set(getPassedCourseCodes(user.courseHistory))` 比對
  `course.subid3`，與排課引擎共用同一套已修判定，兩處不會對「這位學生修過什麼」
  給出不同答案。
- **已修學分與分類彙總**：`getDefaultEarnedCredits()`（讀 `user.earnedCredits`）
  整支刪除，改呼叫 `getEarnedCredits(user.courseHistory)`／
  `getTotalEarnedCredits(user.courseHistory)`。
- **`hasCourseHistory()` 簡化**：先前驗證 `user.earnedCredits` 的物件形狀與
  `user.completedCredits` 是不是有限數字，那套防禦是為了確保「獨立存的兩個欄位」
  沒有壞掉；學分不再獨立存之後，只需判斷 `user.courseHistory` 有沒有資料。
- **查無官方系所對照時不再猜數字**：後端回傳 `required`、`totalRequired`、`gaps`
  為 `null` 並附明確 warning；前端不再用 `128` 代替未知門檻，改顯示 `—`，也會
  實際渲染後端 warnings。這是 A4 移除舊 `requiredCredits`／`totalRequired` 後備路徑
  的完整前後端契約，並以 G5/G6 測試及 API 文件固定。

**已修排除實測**：系上課程池從 119 降到 55（排除 64 個班次、21 門相異已修課，
含計算機演算法、資料結構、資料庫系統等）；畢業頁學分數字 `118/128`、
`61/22/24/11` 與改動前逐項相同——只是換了計算方式，沒有改變結果。

## A5：停止讀寫 MySQL `completed_courses`

**修改檔案**：`server/src/db/database.js`、`server/test/databaseProfileContract.test.js`（新檔）。

`mapUserProfileRow()` 不再解析 `completed_courses`、`getMysqlUserPreferences()` 的
SELECT 清單移除該欄位、`updateMysqlUserPreference()` 移除對應寫入分支——即使呼叫端
payload 仍帶 `completedCourseIds`／`completedCourses`，也不會被寫進 MySQL。
新增原始碼掃描測試防止這些名稱被誤加回來。

**共用 MySQL schema 的取捨**：**未執行 `ALTER TABLE`**。`User_Profiles.completed_courses`
欄位仍存在於組員共用的資料庫，只是本專案程式已停止讀寫；未來若要刪除欄位，
須與共用資料庫的其他使用者另行協調。

**驗證**：`node --test test/databaseProfileContract.test.js` 2 項通過；根目錄
`npm test` 277 項通過；獨立後端冷啟動成功，`GET /api/profile?userId=D1249697`
不含 `completedCourseIds`／`completedCourses`，仍正常回傳 53 筆 `courseHistory`；
Dashboard 實機驗證 profile 載入與排課正常，A3 已修排除提示仍正常顯示。

## A6：移除 AI Agent 已修課程參數

**修改檔案**：`server/src/services/promptService.js`、`server/test/prompt.test.js`、
`docs/PROMPT_DESIGN.md`。

- `run_csp_scheduler` 的模型可用參數移除 `completedCourseIds`；`courseHistory` 也
  不加入工具參數——修課歷史由後端已載入的 `prefs` 自動直通 `constraints.courseHistory`
  （見 A2），已修排除對 Chat 自動生效，模型完全不需要知道這件事。即使模型在
  `args` 裡塞一個 `courseHistory`，也會被忽略（A2 是純直通，不合併 `input`）。
- 保留 `retakeCourseIds`——那是使用者當次對話可表達的需求。
- 新增 prompt 契約測試，禁止 `completedCourseIds` 與 `courseHistory` 出現在
  system prompt。

**驗證**：`node --test test/prompt.test.js` 33 項通過；根目錄 `npm test` 277 項通過；
獨立後端冷啟動，profile 正常載入 53 筆 `courseHistory` 且不含 `completedCourseIds`；
瀏覽器 `/schedule` Chat 送出訊息，後端日誌確認 profile 載入（含 53 筆 `courseHistory`）
正常、system prompt 正確組成，失敗發生在呼叫外部模型那一步（`gemini-2.5-pro`
已不再提供給新使用者），與本次改動無關。

## A7：移除 Setup「已經修過的選修課程」

**修改檔案**：`client/src/pages/SetupPage.jsx`。

修課歷史已由成績單匯入 53 筆，這個手動勾選 UI 寫入的 `completedCourseIds` 從
A2 起就沒有任何後端在讀——不是移除一個還在運作的功能，是移除一個已經失效、
只是還留著讓人誤以為有用的介面。移除 `electives`／`checkedCourses`／
`electiveError`／`loading`／`courseSearchScope` state、`loadElectiveCourses()`／
`toggleCourse()`、對應的 `useEffect`、`CLASS_REQUIRED_MESSAGE`；`prefData` 不再送
`completedCourseIds`；區塊編號「3. 排課偏好設定」改為「2.」；順手清掉因此變成
多餘的 `useCallback` import 與一句過期註解。`courseSearchScope` 只刪 Setup 頁
自己的區域變數——`SearchPage.jsx`／`SchedulePage.jsx` 各自獨立向 `GET /api/profile`
取得同名欄位，後端該欄位不動。

**實測**：畫面「2. 已經修過的選修課程」整塊消失，「排課偏好設定」正確從 3. 變成 2.；
`GET /api/courses`（選修搜尋）不再被呼叫；攔截 `POST /api/profile` 確認送出的
body 完全沒有 `completedCourseIds` 欄位；共用 MySQL 驗證前後值一致（送出的是
同一份資料，未寫壞）。

## 累計測試與驗證結果

- **`npm test`：282 項全數通過**（A1-A7 逐項累計：270 → 275 → 277 → 277 → 280，
  含 A1 的 `courseHistory.test.js` 11 項、A3 的 `scheduler.test.js` 新增 5 項、
  A4 的 `graduation.test.js` 3 項、A5 的 `databaseProfileContract.test.js` 2 項；
  提交前審查再加入 2 項課程類別優先度回歸測試）。
- `npm run lint`、`npm run build` 全過。
- 後端每次改動皆以獨立冷啟動驗證，未混用同一個殘留行程。
- 全程共用 MySQL 僅在必要時短暫寫入驗證用值，驗證後立即還原或確認未寫壞既有資料；
  未為了驗證單一項目而變更組員共用的其他有效偏好欄位。

## 發現但未處理

**AI 聊天目前無法使用，原因是 Gemini 模型已下架，不是配額用盡、也與本次改動無關**：

```
[ERROR] [AgentCore] Agent 聊天發生錯誤：{"error":{"code":404,
"message":"This model models/gemini-2.5-pro is no longer available to new users..."}}
```

同一筆日誌顯示身分解析、profile 載入（含 53 筆 `courseHistory`）、system prompt
組成全部正常，失敗發生在呼叫模型那一步。需更換模型 id，屬另一件事。

## 本次未做

**Part B**（`course.subid3` → `course.catalogCourseCode` 改名）留待下一輪。
跟 Part A 是兩件不相關的事：Part A 整併的是 `courseHistory`（欄位本來就叫
`courseCode`），Part B 要改名的是候選課程物件的 `course.subid3`——兩者是不同
資料來源與物件形狀。A3 新增了一個 `course.subid3` 消費端，Part B 執行時
連同既有 4 處一併處理（共 5 處）。

## 提交前審查補正與 Git 分支規範

**修改檔案**：`server/src/db/database.js`、`server/test/databaseProfileContract.test.js`、
`server/test/scheduler.test.js`、`AGENTS.md`。

- 移除 `mapUserProfileRow()` 漏掉的 `completedCredits: 0`；profile API 不再回傳
  與 53 筆 `courseHistory` 現算 118 學分互相矛盾的合成值。
- 擴充資料層契約測試，禁止 `completedCredits` 等修課歷史衍生欄位重新出現在 profile。
- 保留 2026-08-07 `f1dc3d5` 已建立的 `一般選修: 2` 排序規則，新增兩項精準測試，
  驗證一般選修不落入未知類別預設值，且非系所班級必修會降為一般選修優先度。
- 依使用者確認，專案的 commit／push 工作分支由 `main` 改為 `backend`，目標改為
  `origin/backend`；remote repository 不變。
- 提交前 profile API A/B：修正前回傳 `completedCredits: 0`，修正後欄位消失，
  53 筆 `courseHistory` 保持不變。Dashboard 實際產生 1 個方案、5 門課、14 學分，
  console 無 error 或 warning；前端 build、後端語法檢查與 282 項測試全數通過。

## Commit 與 Push

- Commit：是，與本報告同一提交。
- Push：是，目標 `origin/backend`。
