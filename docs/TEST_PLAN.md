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
| R4 | 候選含 `國文綜合班` 等 B～F 類課程，且未明確指定 | 搜尋回應保留 `eligibility=unknown`；排課保守排除、保留原因並回傳「資格待確認」警告 |
| R5 | 班級名稱為 `建設英班`、`商學院綜合班`、`商學一(UQ)` 等 | 不得被誤判為系所班級 |
| R6 | 使用者明確指定 B～F 類 `eligibility=unknown` 課程 | 保留並排入，但警告課名與資格待確認原因 |
| R7 | MySQL 現行 562 個相異班級名稱 | 全部具有 `classKind`；非系所名稱與 71 筆 B～F 目錄完全一致 |
| T1 | 候選課程學年或學期與 `ACTIVE_TERM` 不符 | `term.isActiveTerm` 為 false；`GET /api/courses` 搜尋直接過濾掉，不出現在結果中 |
| T2 | 候選課程未標註學年學期 | `term.isActiveTerm` 視為 true，不受過濾影響（相容既有無 term 資料的測試與資料） |
| T3 | 排課時系統自撿到非本學期候選（明確 `courseIds` 或 #19 重補修查找繞過搜尋直接查資料庫） | 排除並附開課學期原因，彙整成一則警告 |
| T4 | 使用者以 `courseIds`／`selectedCourseIds`／`mustTakeCourseIds` 明確指定非本學期課程 | 保留並排入，警告「非本學期開課」，不靜默排除 |
| T5 | 不及格必修課號唯一對應的 section 是舊學期資料 | 該 section 被 T3 排除，`本學期沒有開課，請下學期記得重修` 警告仍正確觸發，不被靜默滿足 |
| T6 | 每門候選課的回應內容 | 附帶 `eligibilitySource`（`eligibility` 結論的規則代號）、`term`（`{academicYear, semester, isActiveTerm}`）、`scopeReason`（融合 term／類別／eligibility／系外選修認列結果的白話說明） |
| T7 | 系外選修算出認列結果後 | `scopeReason` 由 `annotateCourseCategory()` 給的預設文字，覆寫為認列結果的精修文字（不計入畢業學分／須系辦確認／符合認列條件） |
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
| V20 | 同批候選，A 帶 `courseReviews`、B 不帶 | 有評價時 `easy_score` 方案選涼課；無評價時中性分相同、`breakdown.easy` 為 `null` |
| V21 | 「有評價且很硬」vs「完全沒評價」 | 優先排入沒評價那門，證明無評價未被當成 0 |
| V22 | 描述含「涼」字但無評價 vs 真正有涼課評價 | 後者勝出，前者不因關鍵字取得涼課加分（釘住關鍵字誤判的修復） |
| V23 | `preferEasyCourses: true` 且候選全無評價 | `breakdown.easy` 為 `null`、`reviewCoverage.ratio` 為 0、發出警告 |
| V24 | 同 V23 併設 `preferCompact: true` | `preferenceScore` 只由 compact 軸決定，不被 null 的 easy 軸拖累成 0 |
| V25 | 完全不帶 `courseReviews`（呼叫端漏接） | `reviewDataLoaded` 為 `false` 並發出警告；不影響既有排序邏輯 |
| V26 | 4 則全高分 vs 8 則中高分 | 收縮後差距小於未收縮差距的一半 |
| V27 | `schedule[]` 每門課 | 都有 `reviewEvidence` 鍵；無評價時為 `null` 而非 `undefined` |
| V28 | 有評價的課因 `eligibility === 'unknown'` 被排除 | 警告統計「有課程評價但因資格待確認未納入」的門數與則數 |
| N1 | `noMidterm: true`，候選課描述含「期中考」 | 課程仍在候選集／`schedule` 中，不再進入 `excludedCourses` |
| N2 | `weightDaily: true`，候選池多數不含「平時／作業／出席」（重現 1.7% 命中率情境） | 候選集不再歸零，`plan.success` 可為 `true` |
| N3 | 對全部 8 個旗標各自設 true，構造一門「未命中」的候選課 | `excludedCourses` 不再因這 8 個旗標出現排除原因 |
| N4 | `mustTakeCourseIds`／`selectedCourseIds` 指定一門「未命中」內容偏好的課 | `plan.failures` 不再含這門課，`success` 不再被拖成 `false` |
| N5 | `noMidterm: true`，兩門其餘條件相同的課，一門命中、一門不命中 | 命中的那門分數較低（排序較後），但兩門都在候選集內 |
| N6 | `practicalExam: true`，兩門其餘條件相同的課，一門命中、一門不命中 | 命中的那門排序較前 |
| N7 | 通識課命中多個內容偏好 vs 核心選修課全不命中，兩者衝堂 | 核心選修仍勝出（驗證內容偏好加總不蓋過類別優先度 120 級距） |
| N8 | `noEveningClasses: true`，候選含晚課 | 該課被排除，理由含「晚課」（既有邏輯，先前無測試釘住） |
| N9 | `lunchBreakFree: true`，候選課時段涵蓋第 5 節 | 該課被排除，理由含「午休」（同上） |
| N10 | 候選池中 `noMidterm` 命中率 < 5% | `warnings` 含「訊號極弱」字樣 |
| N11 | 候選池中某旗標命中率 > 95% | `warnings` 含「無法有效區分課程」字樣 |
| N12 | 候選池中某旗標命中率落在 5%~95% 之間 | 不觸發該警告 |
| N13 | 訊號可靠度警告觸發時 | `allWarnings`（5 個方案聯集去重後）只出現一次 |
| N14 | 未設定任何內容偏好旗標 | 不產生相關警告，排序與改動前一致（回歸測試） |
| N15 | `englishTaught: true`，候選課 `course.language === 'English'` 但描述不含「英文」 | 仍視為命中（驗證 `extra` 判定路徑，不只靠關鍵字） |
| X1 | `allowRelaxation` 未設定（預設），選修因時段偏好排不出課表 | 行為與改動前一致（`success:false`），無 `relaxedConstraints` |
| X2 | `allowRelaxation:true` 且指定 `timePreferencePriority` | 依使用者順序逐步放寬並成功排課，`relaxedConstraints` 反映該順序 |
| X3 | `allowRelaxation:true`，但無解原因是 `blockedPeriods` | 放寬階梯不生效，仍然失敗（`BLOCKED_PERIODS` 永不放寬） |
| X4 | 兩門候選各因不同限制排除（`noMorningClasses`／`blockedPeriods`） | `conflictSet` 含兩者，`relaxable` 標記分別為 `true`／`false` |
| X5 | 一次成功的 `generateSchedule()` 結果 | 其 `schedule` 交給 `validateScheduleAgainstConstraints` 檢查回傳 `valid:true` |
| X6 | 手造兩門衝堂的課，不帶 `constraints` 呼叫 `validateScheduleAgainstConstraints` | 回傳 `TIME_CONFLICT` violation，不需要 `constraints` |
| X7 | 帶 `maxCredits` 的超額課表 vs 省略 `maxCredits` 的正常課表 | 前者出現 `CREDIT_CEILING` violation，後者採用預設值且不出錯 |
| X8 | 任意呼叫 `validateScheduleAgainstConstraints` | `unchecked` 永遠包含 `PREREQUISITE`／`COREQUISITE` |
| X9 | 舊版 `validateSchedule(courses)`（不帶 `constraints`） | 回傳形狀逐欄位維持不變（回歸釘住） |
| X10 | 兩門必排課（`mustTakeCourseIds`）同天，`maxCoursesPerDay: 1` | 第二門因每日上限排不進去，正確回報 `success:false` 與失敗原因（修復先前的靜默消失） |
| X11 | 檢查 `constraintSchema.js` 的 `CONSTRAINTS` 表 | 每個條目都有定義必要欄位，且沒有重複 id |
| X12 | 正式必修（`isRequiredForStudent()===true`）違反 `noMorningClasses` | 仍被排入，`warnings` 含「必修優先」與偏好名稱的揭露訊息 |
| X13 | 同一門正式必修改為違反 `blockedPeriods` | 仍會被排除（必修豁免不適用於 `BLOCKED_PERIODS`） |
| X14 | `mustTakeCourseIds`（非正式必修）違反 `noMorningClasses` | 仍受排除，行為與 S10 一致（確認豁免範圍夠窄） |
| Z1 | 同時段 3 學分高分課會讓 greedy 錯過兩門合計 6 學分課 | baseline 未達最低學分後啟動 repair，撤銷早期選擇並找到 6 學分合法解 |
| Z2 | 兩門互相衝堂且都列為必要課程 | 完整搜尋回 `infeasible`；正式 `schedule` 為空，草稿與 conflict evidence 可驗證 |
| Z3 | 將 node budget 壓到 1，greedy baseline 合法但低於最低學分 | 回 `timeout` 且使用經 validator 驗證的 greedy fallback，不把部分搜尋結果冒充正式課表 |
| Z4 | 將 node budget 壓到 2，必要課程衝突且沒有合法 baseline | 回 `timeout`、正式 `schedule` 為空，最佳部分組合只出現在 `draftSchedule` |
| Z5 | `mustTakeCourseIds` 指向候選資料不存在的 ID | 回 `data-insufficient` 與澄清問題，不誤報 `infeasible` |
| Z6 | 相同候選、constraints、seed 重跑 repair | 課程、solver status 與節點統計一致 |
| Z7 | repair 候選包含需共同必修的正課與實習 | 兩者以原子決策同進同退，結果通過 validator |

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

### 版本化畢業規則與逐門認列（Roadmap #23）

`server/test/graduationRuleVersions.test.js`：

| 編號 | 情境 | 預期結果 |
| --- | --- | --- |
| G7 | 114／115 學年度入學生 | 選到 `114` 版，`appliedFallbackVersion` 為 `false`，附 `ruleSource` 與 `coverage` |
| G8 | 112 學年度入學生 | 退回 `114` 版，`appliedFallbackVersion` 為 `true`，`fallbackReason` 明講「該學年度版本尚未取得…僅供參考」 |
| G8 | `admissionYear` 為 `null` 或完全不給參數 | 同樣退回並說明，不丟例外 |
| G9 | 查不到的系所／未支援的學制 | `requirement` 為 `null` 但版本資訊照給；學制無資料時標示退回 |
| G9 | `normalizeAdmissionYear()` | `0`／負數／小數／超範圍／非數字一律 `null`，不強行轉換 |
| G9 | 版本清單 | 目前**只有 1 版**真實資料；數量改變時測試失敗以提醒同步更新文件 |

`server/test/graduationAttribution.test.js`：

| 編號 | 情境 | 預期結果 |
| --- | --- | --- |
| G10 | 逐門追溯 vs `getEarnedCredits()` | 各分類 `credits` **恆等於**既有計算；逐門加總也等於該分類總數（防止長出第二套算法） |
| G10 | demo 53 筆分佈 | `61／22／24／11`，總計 `118` |
| G11 | `nonGraduation`／未通過／重修／未知分類 | 分別為不列入、不列入、只算最新一次、歸入 `unspecified` |
| G12 | 每一筆認列 | 帶 `ruleVersion`／`ruleSource`／`attributionSource`／`needsVerification`；未傳 rule 時三者為 `null`；依修課時間排序 |
| G13 | 班級活動、體育、國防科技 | **不得出現在補學分推薦裡**（本次核心迴歸：改動前 `departmentCourses[0]` 實測就是 0 學分的班級活動） |
| G14 | 每筆推薦 | 其 `fillsGap` 分類的缺口必須 > 0；缺口補滿或 `gaps` 為 `null` 時回空陣列 |
| G14 | 未被課程地圖細分的本系選修 | 仍算進 `elective` 缺口（實測有 11 門會落在原始的 `選修`） |
| G15 | 一課多班次／已修過／輸入順序不同 | 只推一次；已修不推；排序穩定 |
| G17 | `update_student_profile` 送 `admissionYear: 0` | 佔位值被丟棄，其他欄位保留（實測模型 4/4 次送 `0` 湊滿欄位；寫入層另有一道防護） |
| G16 | 入學年度交叉驗證 | 兩來源一致才採用；不一致或只有單一來源時回 `null` 並說明理由 |

### 已修課程排除與修課歷史派生運算

已修排除的判定依據是課號（`courseHistory[].courseCode` 比對 `course.catalogCourseCode`），
不是每學期都會改變的 section id；`data/courseHistory.js` 提供的三支派生函式
（`getPassedCourseCodes()`／`getEarnedCredits()`／`getTotalEarnedCredits()`）
是排課、畢業頁共用的唯一來源，取代了先前各自獨立、彼此可能不一致的
`completedCourseIds`／`completedCourseCodes`／`completedCredits`／`earnedCredits`。
執行期資料由 MySQL `User_Course_History` 映射，不讀 `users.json.courseHistory`。

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
| H3 | 53 筆合成回歸資料 | 分類學分 `61/22/24/11`、總學分 `118`，53 個課號皆不重複 |

`server/test/courseHistoryDatabase.test.js`：

| 編號 | 情境 | 預期結果 |
| --- | --- | --- |
| H8 | MySQL row 映射 | 完整回傳既有 11 欄 camelCase 契約 |
| H8 | `passed=0` | 映射為 `false`，不受字串 truthiness 影響 |
| H8 | 必要欄位缺漏 | 回報 `503 COURSE_HISTORY_UNAVAILABLE` |
| H8 | runtime source scan | `memoryService`／graduation 不再讀 `users.json.courseHistory`，JSON 欄位已刪除 |

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

### 課程評價派生與涼課排行一致性

`Course_Reviews` 一列代表彙總後的多則評價（見 `docs/DATA_SCHEMA.md`）。涼度評分改用結構化評分
（`sweetness`／`coolness`／`workload`／`overall`）取代課程描述關鍵字，並以 m-estimate 收縮
（`(n×raw + m×prior)/(n+m)`，`m=5`）避免小樣本極端值支配排序。編號比照 `courseHistory.test.js`
（H1–H3）→ `scheduler.test.js`（H4–H8）的既有慣例：純函式測試在前，端到端測試接續其後，
同一序列橫跨多個檔案。

`server/test/reviewStats.test.js` 的 `shrinkEasiness()` 測試（V1–V5）：

| 編號 | 情境 | 預期結果 |
| --- | --- | --- |
| V1 | 人工算好的 m-estimate 值 | 精確符合公式計算 |
| V2 | `n` 增大（4 → 50） | 結果單調趨近 `rawEasiness` |
| V3 | `priorEasiness` 為 `null` 或非有限數 | 原樣回傳 `rawEasiness`，不噴例外 |
| V4 | `rawEasiness` 為 `null` | 回傳 `null`，缺證據不可能收縮出分數 |
| V5 | `m <= 0` | 原樣回傳 `rawEasiness`（收縮關閉） |

`server/test/courseReviewStats.test.js`（課程 ↔ 評價對應，V6–V15）：

| 編號 | 情境 | 預期結果 |
| --- | --- | --- |
| V6 | `review.courseId` 與 `course.id` 型別不一致 | index 仍對得上（統一用 `String()`） |
| V7 | 評價列 `courseId` 為 `null`（section join 失敗） | 該列丟棄，不會全聚成同一鍵 |
| V8 | 課程沒有任何評價 | 回 `null`，不是 0 也不是空物件 |
| V9 | 評價列存在但四個涼度維度全缺 | 仍回 `null`（有列 ≠ 有證據） |
| V10 | `easinessToScore`：1／3／5／0.5／6 | 0／50／100／0／100（超界 clamp） |
| V11 | 一列 `reviewCount:8` vs 八列 `reviewCount:1` | 結果相同，證明重用 `weightedAverageScore`，沒有自己重寫一份未加權版 |
| V12 | `buildReviewPrior` | 只由有評價的課算，每門貢獻一次；與之後查詢哪門課無關 |
| V13 | `getNeutralEasyScore(prior)` | 等於先驗換算後的分數；先驗缺失時退回 50 |
| V14 | `deriveReviewEvidence` 完整組裝 | 同時含未收縮 `easiness` 與收縮後 `adjustedEasiness`、`easyScore`（0–100） |
| V15 | `deriveReviewEvidence` 對沒有評價的課 | 回傳 `null` |

`server/test/reviewSearch.test.js`（`rankEasyCourses()` 純函式，V16–V19）——這是「涼課排行榜與排課
引擎不一致」的直接迴歸測試：

| 編號 | 情境 | 預期結果 |
| --- | --- | --- |
| V16 | 課 A（4 則、原始分較高）vs 課 B（8 則、原始分較低） | 收縮後排序不再機械地把 A 排第一 |
| V17 | 排行結果中任一課程 | 同時帶 `easiness`（未收縮）與 `adjustedEasiness`（收縮後），對低樣本課不相等 |
| V18 | 課程 `reviewCount === 0` | 被排除，不出現在結果中 |
| V19 | 對同一組 `reviews` 分別呼叫 `buildReviewPrior()` 與 `rankEasyCourses()` 內部算出的先驗 | 兩者相等，證明排行榜與排課引擎共用同一個母體先驗 |

`server/test/scheduler.test.js`（`generateSchedule()` 端到端，V20–V28）見上方主表。

`server/test/database-contract.test.js`（連真實 MySQL）：釘住 `Course_Reviews` 覆蓋率、五個評分
欄位值域、`review.courseId` 可對回實際 section、母體 easiness 落在合理範圍，資料漂移時測試會響。

### 內容偏好從硬過濾改成軟懲罰

Roadmap #3。8 個內容偏好（免期中考／免分組報告／討論課／重視平時成績／實作評量／期末報告／
英文授課／學到較多內容）原本是 `hardConstraintReason()` 的硬性排除條件，判定依據全部是課程
描述關鍵字比對。真實資料庫命中率兩極化（0.1%～97.6%），改為 `scoreCourse()` 裡的軟性加分，
維持硬性的只剩 4 個時段類檢查（早八／晚課／封鎖時段／午休）。`server/test/scheduler.test.js`
的 N1–N15（見上方主表）為端到端測試；這批純函式（`getContentPreferenceScore()`、
`computeContentPreferenceSignal()`、`buildContentPreferenceWarnings()`）沒有跨模組共用或連 DB
的需求，因此比照 `getInterestScore`／`getEasiness` 的既有慣例，只透過 `generateSchedule()`
端到端測試涵蓋，不另開純函式測試檔案。

真實資料驗證（node 層，連正式 MySQL）：對資工三學生的 227 門候選課，`weightDaily: true` 在
舊版硬性排除下會把候選集壓縮到 3 門（1.3%），新版軟性加分後排課仍正常成功，候選集不再歸零。

### Hard/Soft Constraint Schema、獨立 Validator、放寬階梯（Roadmap #21）

`server/test/scheduler.test.js` 的 X1–X14（見上方主表）。涵蓋四個面向：

- **opt-in 放寬階梯**（X1–X4）：預設 `allowRelaxation:false` 時行為不變；啟用後依使用者提供的
  `timePreferencePriority` 逐步放寬並成功排課；`BLOCKED_PERIODS` 永不進入放寬清單；失敗回應
  的 `conflictSet` 具備正確的 `constraintId`／`relaxable` 標記。
- **獨立 validator**（`server/src/skills/scheduleValidator.js`，X5–X9）：`generateSchedule()`
  成功時對自己的主推方案做自我檢查；`validateScheduleAgainstConstraints()` 不需要 `constraints`
  也能檢查衝堂；帶 `maxCredits` 時檢查學分上限；`unchecked` 永遠列出先修／共修（沒有資料來源）；
  舊版 `validateSchedule()` 回傳形狀維持不變（回歸釘住）。
- **每日上限失敗回報修復**（X10）：先前必排課因每日上限被排除時不會推入 `plan.failures`，
  會靜默消失而不回報失敗原因，X10 釘住修復後的行為。
- **`constraintSchema.js` 完整性**（X11）與**正式必修的時段偏好豁免**（X12–X14）：豁免範圍嚴格
  限定在 `isRequiredForStudent()===true`，不含 `blockedPeriods`，也不含使用者手動指定的
  `mustTakeCourseIds`——後者與 S10 行為完全一致，未受影響。

先修／共修（prerequisite/co-requisite）**只定義層級，不強制執行**：`server/src` 與
`docs/DB_AUDIT_REPORT_2026-08-05.md` 皆確認沒有這方面的資料來源，屬 roadmap #8（尚未開始）的
負責範圍，因此沒有對應的執行邏輯測試，只有 X8 釘住 validator 誠實回報 `unchecked`。

## #12B 通識分類測試

| 編號 | 情境 | 預期結果 |
| --- | --- | --- |
| G1 | 學年度 111／112／114／115 | 分別選到 `through-111`／`112-114`／`112-114`／`from-115` |
| G2 | 114 課程的 `dept` 是官方四領域之一 | 分類為 `通識`，領域與 `dept` 相同 |
| G3 | 課號以 `GE` 開頭但沒有正式領域或認抵資料 | 不猜成通識 |
| G4 | 115 課程仍帶舊領域來源標記 | 分類為通識，但 `generalEducationDomain = null` |
| G5 | 114-2 `IINE2832`／`IINE2833`／`HSS1007` | 依官方認抵表分類為世界格局與歷史地理視野 |
| G6 | 明確搜尋 `category=通識` | 跨本人班級範圍回傳直接通識及認抵課 |
| G7 | 一般未指定分類搜尋 | 維持 F7；排課候選則額外納入通識 |

## #29 InteractionEvent schema 測試

`server/test/interactionEventSchema.test.js`。這組測試只操作 pure functions，不連 MySQL、
不建立 runtime JSON。實際埋點與持久化由下方 IL 系列（#2）涵蓋。

| 編號 | 情境 | 預期結果 |
| --- | --- | --- |
| I29-1 | client 嘗試帶入 user／event／timestamp／idempotency 欄位 | 全部由 authenticated identity 與 server envelope 覆寫；學期正規化為 `first`／`second` |
| I29-2 | 推薦曝光 | 完整保留 ordered candidate set、displayed subset、方案順位與版本快照 |
| I29-3 | displayed section 不在 candidate set | validator 拒絕不一致曝光資料 |
| I29-4 | 必修推薦被接受 | `source=required` 保留，不會混成興趣正回饋 |
| I29-5 | 移除／退選原因 | 只接受 7 個 enum；其他 event type 禁止夾帶原因 |
| I29-6 | 同一 request/action 重送但 eventId／timestamp 不同 | `(userId, idempotencyKey)` 命中 duplicate，維持一筆事件 |
| I29-7 | 相同 key 但 logical payload 改變 | 回 conflict，不覆寫既有事件 |
| I29-8 | actionId 不同 | 產生不同 key，可 append 為獨立操作 |
| I29-9 | 無版本 flat draft | migration 轉為合法 v1 nested shape |
| I29-10 | 未知未來版本、未知 event type、無身分、非法順位 | 明確拒絕，不補猜值 |

## IL #2 互動 log 埋點與持久化測試

`server/test/interactionEvents.test.js`。使用記憶體 privacy store，不需 MySQL。

| 編號 | 情境 | 預期結果 |
| --- | --- | --- |
| IL-1 | 未同意 `personalization_learning` 時上報 | `recorded:false`、`reason=CONSENT_NOT_GRANTED`，DB 零列 |
| IL-1b | 同上，經 `POST /api/interactions` | 回 **200 而非 428**——可選用途不該把使用者推到同意牆 |
| IL-2 | 同意後寫入一般事件 | 寫入一列；序列化後不含學號、不含 subject ID；版本快照由 server 填入 |
| IL-2b | 伺服器自己寫入的曝光事件 | 同樣不含學號、不含 subject ID |
| IL-3 | 同一 `actionId` 重送 | `duplicate`，仍只有一列 |
| IL-3b | 不同 `actionId` | 視為兩次操作，各自 append |
| IL-4 | 相同 key 但 payload 改變 | `conflict`，不覆寫既有事件 |
| IL-5 | `displayedSet` 不是 `candidateSet` 子集 | `rejected` 並回報錯誤，不寫入 |
| IL-6 | 必修被選入 | `source=required` 保留，不混成興趣正回饋 |
| IL-7 | 七個 `feedbackReason` 全數上報；非移除事件夾帶原因 | 前者逐一保存、後者拒絕 |
| IL-7b | 使用者略過原因 | `feedbackReason` 為 `null`，不猜一個值 |
| IL-8 | 未登入 | 401，不寫入 |
| IL-9 | 兩個帳號 | 事件完全隔離 |
| IL-10 | 保存期限清理 | 只刪過期資料，未到期保留 |
| IL-11 | 帳號刪除 | 該 `subject_id` 事件歸零 |
| IL-12 | 排課回應 | 帶 `requestId`；每個方案帶 `planId`／`variantId`，成功與失敗路徑皆然 |
| IL-13 | `record_schedule_feedback` | `accepted` → plan 層級 `recommendation_accepted`；`rejectedCourses` → 逐筆 `course_withdrawn` + 原因 |
| IL-13b | 重送同一份確認 | `duplicate`，不重複計為兩次接受 |
| IL-13c | requestId 造假或原因不合法 | 明確回報，不寫入 |
| IL-13d | 使用者尚未回答 | 拒絕代為記錄 |
| IL-13e | requestId 沒有對應的曝光紀錄 | 拒絕——模型可以編出格式合法但從未存在的推薦 |
| IL-13f | 拿別人的 requestId 當自己的回饋來源 | 拒絕；曝光查詢以 subject 為範圍 |
| IL-13g | 捏造的 variant、或只進候選但未顯示過的課程 | 兩者皆拒絕；使用者不可能退掉沒看過的課 |
| IL-14 | 已撤回服務的 subject 再寫入 | `rejected`，不寫入 |
| IL-14b | 寫入與帳號刪除並行 | 無論搶先落地或被拒絕，最終皆為零列 |
| IL-15 | 舊版政策下的 consent（`granted:true` 但 `policyVersion` 過期） | 不算目前有效同意，`recorded:false` |
| IL-15b | 目前版本但 `granted:false` | 同樣不算有效同意 |
| IL-17 | client 自己捏一組格式合法的 `recommendation_exposed` | 一律拒絕，不因格式合法而放行 |
| IL-17b | 直接呼叫 `recordInteractionEvents` 送出 `system_recommendation` 來源退選，未先造曝光 | 拒絕；證明繞過 `scheduleFeedbackService` 也擋得住 |
| IL-17c | 曝光紀錄存在且班次確實顯示過，直接呼叫 `recordInteractionEvents` | 成功，不必經過 Agent tool |
| IL-17d | 伺服器帶 `allowExposureWrite:true` 寫入曝光 | 成功，且不做來源驗證（它就是來源本身） |
| IL-18 | 並行請求撞上相同 idempotency key 但內容不同 | 一個 `append`、一個 `conflict`，不誤報成 `duplicate` |
| IL-18b | 並行請求撞上相同 key 且內容也相同 | 才回 `duplicate` |
| IL-19 | `/api/interactions` 每分鐘請求數超過上限 | HTTP 429、`code=RATE_LIMITED` |
| IL-20 | 每日事件量配額 `wouldExceedDailyQuota()` | 未超過時 false，超過時 true |

`server/test/rateLimiter.test.js`（RL-1～RL-3）：固定視窗節流器本身的單元測試——
視窗內第 limit 次仍允許、第 limit+1 次起拒絕、不同 key 互不影響、limit 為 0 時全擋。

IL-13e～g、IL-14 來自第一輪對抗式審查；IL-15、IL-17～20 與 RL-1～3 來自第二輪
（針對 `98bf7ac..218358a` 的再次審查），修的是 consent 版本檢查與撤回競態、
`/api/interactions` 完全信任 client 宣稱的曝光來源、並行撞鍵誤報 duplicate、
以及節流／配額完全缺席。全部都不是實作瑕疵，是原本設計沒有涵蓋的情境。

修改互動埋點時，另須確認 P 系列的 prompt 契約（排課後確認章節與七個原因 enum）仍通過。

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
| D11 | 114-2 四領域至少 167 個課號、208 個班次且零缺課號 | 通識分類資料不得被資料庫變動靜默破壞 |
| D12 | 114-2 三門跨院認抵課可由正式課號唯一對回課名與學分 | PDF 課名與 MySQL 正式課號對照不得漂移 |

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
| `/api/courses` | keyword、department、category、period 查詢；多時段課程可命中第二段以後，day + period 必須落在同一個 time block |
| `/api/schedule/generate` | 無 courseIds、指定 courseIds、偏好限制 |
| `/api/schedule/validate` | 有衝堂、無衝堂 |
| `/api/profile` | DB-less CI 驗證未登入 401、改送另一個 ID 時在資料存取前回 403；成功讀取／更新 session 使用者偏好須在已設定 MySQL 的整合環境驗證，schema v1 另由純函式測試固定契約 |
| `/api/reviews/easy` | limit 正常運作 |
| `/api/graduation/me` | 學分缺口與推薦 |
| `/api/chat` | 無 message、正常 message、無 API key |
| `/api/privacy/policy` | 公開政策含三用途、Raw Chat 30 天與研究 k≥5 |
| `/api/privacy/consents` | 未同意預設拒絕；必要同意後可用；兩個可選用途維持 false；政策改版要求重同意 |
| `/api/privacy/chat` | 只刪登入者 Raw Chat，不影響他人與結構化 Profile |
| `/api/privacy/deletion-intents` | token 短效、subject scoped、單次使用，錯誤確認詞不得刪除 |

## #33 隱私與加密測試

| 編號 | 情境 | 預期 |
| --- | --- | --- |
| PR1 | canonical ID 經 HMAC | 固定為 `v1:<64 hex>`，輸出不含學號，不同學生不同值 |
| PR2 | AES-256-GCM round-trip | 密文不含明文且可正確還原 |
| PR3 | ciphertext／auth tag 被竄改 | 以 `CHAT_INTEGRITY_ERROR` 拒絕，不回傳部分明文 |
| PR4 | 兩位已同意使用者各有聊天 | 歷史完全隔離，清除 A 不影響 B |
| PR5 | 未同意呼叫個人 Chat API | HTTP 428 `CONSENT_REQUIRED`；同意必要用途後才通過 middleware |
| PR6 | 選擇性同意未勾 | 核心服務仍可使用，不產生可學習／研究資料 |
| PR7 | legacy chat cleanup 不帶 apply | 只回報筆數與日期區間，不顯示內容或 ID，也不刪檔 |

## 前端操作測試

- 登入後導向 onboarding 或 dashboard。
- 啟用 privacy enforcement 時，未同意先導向 Privacy Center；必要用途同意後才能進入 onboarding/dashboard，兩個可選項保持未勾仍可使用核心服務（A/B）。
- 初始偏好可儲存。
- 課程搜尋可查詢並顯示結果；通識篩選需顯示四領域，並與一般分類搜尋做 A/B。
- 搜尋結果可加入共用課表與更新關注清單；加入前必須等待 `/api/schedule/validate` 明確通過，衝堂／重複班次／API 失敗皆不得 fail-open。
- 搜尋卡片加退選 A/B：未加入時顯示藍色「加入課表」；成功加入後同一卡片改為紅色「取消加選」，點擊後課程立即從共用草稿課表移除。
- 關注清單持久化 A/B：未關注課程不出現在「❤️ 我的關注」；關注後以後端保存的 section ID 還原完整課程卡，重新整理仍存在，取消關注後立即移出清單。
- 兩種搜尋表單的重設按鈕只清除可編輯條件；依系所查詢保留 Profile 派生的系所、年級與班級。
- 登入送出期間學號、密碼、密碼顯示與提交控制皆停用，提交按鈕具有 loading 狀態；密碼顯示按鈕可由鍵盤操作並有動態 accessible name。
- Dashboard、排課、搜尋及畢業進度的使用者選單，點擊選單外或按 Escape 後關閉；點擊選單內功能仍正常執行。
- 課表只在使用者按下「儲存課表」時呼叫 `/api/schedule/save`；重新整理後載入最新已存版本，未儲存的畫面修改不冒充持久化資料。
- 登出或切換帳號時先清空共用課表與關注狀態；舊帳號尚未完成的非同步回應不得覆寫新帳號狀態。
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

### Tool allowlist 與工具結果信封（Roadmap #25）

`server/test/agentToolRegistry.test.js`（AR1-AR4）：

| 編號 | 情境 | 預期結果 |
| --- | --- | --- |
| AR1 | 登記表 vs `getAgentTools()` schema vs `executeAgentTool()` 的 switch | 三處工具名稱集合完全一致（讀原始碼比對，不是人工同步） |
| AR2 | 需要兩段式確認的工具（`update_preferences`／`update_student_profile`） | schema 必須有 `confirmationToken`；其餘工具不得有 |
| AR3 | 全部 7 個工具的 schema | `additionalProperties` 為 `false` |
| AR4 | `isRenderableTool()`／`getConfirmationChangeType()`／`listConfirmationChangeTypes()` | 回傳值與登記表定義逐項相符 |

`server/test/agentTools.test.js` 新增：

| 編號 | 情境 | 預期結果 |
| --- | --- | --- |
| AG14 | `watchingCourseIds` 含查無對應課程的 id | 該 id 不會出現在傳給 `generateSchedule()` 的 constraints 裡；結果 `warnings` 附上「已略過」說明，且不覆蓋既有 warning |
| AG14 | 全部合法／完全沒帶 `watchingCourseIds` | 不受影響（反例，避免誤判） |
| AG15 | `buildToolResultEnvelope()` | 含 `schemaVersion`／`dataSource`／`warnings`／`errorCode`／`result` 五個欄位；陣列型結果一樣能包裝；只有課程類工具附 `term`；`errorCode` 正確透出 |
| AG15 | `applyToolOutcome()` 寫進 `/api/chat` 回應 `data` 的值 | **不得被信封污染**——仍是原始 `result`，不含 `schemaVersion` 等信封欄位 |

`server/test/prompt.test.js` 新增 P7：system prompt 提到信封五個欄位、
`json-fallback` 是「暫時性限制」而非資料不存在、`errorCode` 不為 `null` 時
「不要宣稱已完成」。

### 推薦理由（Roadmap #26）

`server/test/recommendationReason.test.js`（純函式，不需網路或資料庫）：

| 編號 | 情境 | 預期結果 |
| --- | --- | --- |
| R1 | 主要原因代號 | 本人必修優先於使用者指名；關注／重補修由 placementReason 判定；每份理由帶版本 |
| R2 | 信心度 | 資格待確認或系所無法解析 → `low`；涼度是 proxy 或無評價 → `medium`；其餘 `high` |
| R3 | 資料來源 | 沒有評價的課**不得**列 `Course_Reviews`（proxy 涼度不算查過評價） |
| R4 | 競爭狀態 | 「沒有落選者」回 `no-competitors`、未走競爭路徑回 `not-applicable`，**不得都用空陣列** |
| R5 | 分數組成 | 只列非 0 元件，但 `scoreTotal` 仍含 0 值元件；沒命中偏好時是空陣列，不硬掰 |
| R6 | 證據原樣帶出 | 無評價時 `reviewEvidence` 為 `null`；必修豁免時段偏好記成 `constraintTradeoffs` |

`server/test/scheduler.test.js` 的 R7-R10（整合）：

| 編號 | 情境 | 預期結果 |
| --- | --- | --- |
| R7 | 分數組成 vs 實際總分 | `scoreBreakdown` 總和 **恆等於** `scoreTotal`（防兩份公式漂移，比照 #23 的 G10） |
| R8 | 改一個偏好 | 命中的課多出 `matchedPreferences` 且 `contentPreference` 分數真的增加；**沒命中的課不受影響**（A/B 兩次排課比對） |
| R9 | 落選者 | 最後也被排入的課**不得**出現在任何落選清單；沒有競爭者時回 `no-competitors`；真落選者要附 `notScheduledBecause` |
| R10 | 誠實邊界 | 無評價的課理由裡 `reviewEvidence` 為 `null` 且不列評價來源；**理由不得改變排課決策本身** |

`server/test/agentTools.test.js` 的 AG6 另驗：理由有送進模型、`scoreBreakdown` 不送、
沒有理由時不憑空生一個。

### 方案比較與 counterfactual（Roadmap #27）

`server/test/scheduler.test.js` 的 PM1-PM6（`planMetrics`／`planDiversity`，不需網路或資料庫）：

| 編號 | 情境 | 預期結果 |
| --- | --- | --- |
| PM1 | 上課天數一致性 | `planMetrics.usedDays` 與 `preferenceBreakdown.compact` 用的日集合大小相同（防兩份定義漂移） |
| PM2 | 早八／空堂界線 | 早八課只算 `startPeriod<=1`；空堂只算「同一天有課、中間沒課」的節次，不含上課日前後 |
| PM3 | 塌縮結構化 | `planDiversity` 的合併數、方案數、可競爭池大小三個數字與 `describePlanCollapse()` 產生的句子一致；沒有塌縮時 `collapsed` 是空陣列不是 `null` |
| PM4 | 涵蓋每條路徑 | 成功、失敗、放寬、repair 路徑回傳的每個 plan 都帶 `planMetrics` |
| PM5 | 欄位一致 | `planMetrics.preferenceScore`／`preferenceBreakdown`／`reviewCoverage` 與 plan 本身同名欄位相同 |
| PM6 | 不改變決策 | 加了 `planMetrics` 前後，排出來的課程集合不變 |

`server/test/planComparison.test.js` 的 CF1-CF4（純函式，不需網路或資料庫）：

| 編號 | 情境 | 預期結果 |
| --- | --- | --- |
| CF1 | 方案差異比較 | `diffPlans()` 只比課程集合，不比排序；`unscheduledCourses` 也算在比較範圍內 |
| CF2 | 裝飾性重複判定 | `summarizeMetricDifferences()` 分辨真的有差異與到處相同；浮點數尾數誤差不誤判為有差異 |
| CF3 | 三態不得混用 | 沒開的偏好一律 `not-applicable`（不去重排）；開著但不影響結果時是 `unchanged` 並附原因，不是空陣列充數；`changed` 必須附 `removed`／`added`／`metricsDelta` |
| CF4 | 不改變決策 | 呼叫 `buildCounterfactuals()` 前後，同一組輸入排課結果不變 |

`server/test/scheduleService.test.js` 另驗 `buildExposureDraft()`（純函式）：`displayedSet`
是全部方案課程的聯集、不是只有主推方案；`displayedPlanIds` 列出這次曝光顯示過的每個
`planId`；`plan`／`position` 仍指向主推方案；同一門課出現在多個方案裡只列一次。

`server/test/interactionEvents.test.js` 的 IL-17e/f/g（實測瀏覽器時發現的真實 bug 的
回歸測試——切到非主推方案再按「符合」被誤判成偽造來源而拒絕寫入）：

| 編號 | 情境 | 預期結果 |
| --- | --- | --- |
| IL-17e | 接受曝光時顯示過、但非主推的方案 | 必須成功（`append`），不是被 `assertProvenance()` 誤判成偽造 |
| IL-17f | 接受一個從未顯示過的方案 | 仍然要被拒絕（`rejected`）——修法不能連基本的來源驗證都放寬 |
| IL-17g | 舊曝光事件沒有 `displayedPlanIds` | 退回只認主推 `planId`，維持相容 |

### 帳號隔離驗收（Roadmap #28）

`server/test/accountIsolation.test.js` 的 AC1-AC6——與既有 IL-9、privacy chat 隔離、
I1/I2 不同，這組**用真的能登入的固定帳號**（`test/fixtures/account-isolation/users.json`，
`DATA_DIR` 指向該 fixture，不碰 `server/data/`）走真正的 `/api/auth/login` → cookie →
後續請求，比對實際的 HTTP 邊界，而不是手工捏 identity 物件在 service 層測：

| 編號 | 情境 | 預期結果 |
| --- | --- | --- |
| AC1 | 已存課表跨帳號可見性 | A 存的課表不出現在 B 的 `GET /schedule/saved`；A 自己的清單只有 A 存的那筆 |
| AC2 | 存課表時冒充另一學號 | `POST /schedule/save` 帶 `userId=B` 被 403 擋下，A、B 的清單都不多出這筆 |
| AC3 | 冒充更新關注清單 | `POST /auth/update-watchlist` 帶另一學號被 403 擋下，對方的關注清單不受影響 |
| AC4 | 冒充查詢畢業進度 | `GET /graduation/:studentId` 查另一人被 403 擋下 |
| AC5 | 冒充聊天（query string） | `POST /chat?studentId=B` 被 403 擋下——`requireIdentity` 對任何路由都認 `query.studentId`，不只限有明寫該欄位的路由 |
| AC6 | 未登入 | `schedule/saved`、`schedule/save`、`update-watchlist`、`chat`、`graduation/me`、`graduation/:id`、`profile` 一律 401，不落到任何使用者 |

這組跑在 `PRIVACY_STORE=memory` 且刪除 `DB_*` 環境變數（比照 `authRoutes.test.js`），
不需要連真實 MySQL；`afterEach` 清掉 fixture 目錄下測試自己寫出的 `saved_schedules.json`，
不留下執行痕跡。

**只能靠瀏覽器人工驗收的部分**（無法在這組自動化測試裡重現）：Profile 偏好、修課歷史、
`Interaction_Events`、`Chat_Messages` 這幾個真正落在共用 MySQL 的表，跨帳號隔離已在
2026-09-03 用兩個真帳號（demo 帳號與臨時建立的測試帳號）實際跑過一輪並直接查表確認，
記錄在對應的變更報告；沒有寫成自動化測試——需要一個第二個能登入且已寫進共用 MySQL
`User_Profiles` 的帳號，不適合留在會被 CI 反覆執行的測試裡。

### Per-user 偏好學習管線（Roadmap #30）

`server/test/preferenceLearning.test.js` 的 PL1-PL10——純函式測試，覆蓋
`server/src/skills/preferenceLearning.js` 的 `learnPreferenceWeights()`：

| 編號 | 情境 | 預期結果 |
| --- | --- | --- |
| PL1 | 可重播 | 同一批事件跑兩次逐位元相同；打亂輸入順序結果不變 |
| PL2 | 兩位互動不同的學生分化 | 顯式設定相同，一位常以 `time` 退課、一位常以 `workload` 退課（或分別接受 `compact`／`easy_score` 方案），學到的軸不同 |
| PL3 | 單次誤點不翻盤 | 一長串一致行為後插入一次相反的單一事件，主要偏好方向不變 |
| PL4 | 顯式優先 | 顯式設定的軸沒有任何行為訊號時仍維持顯式值；訊號足夠時可以往上調（不能被壓到基準以下） |
| PL5 | 三態不得混用 | 事件不足回 `insufficient` 並附還差多少（權重回退為顯式設定）；沒有事件時 `missingAxes` 列出全部三軸 |
| PL6 | 可追溯 | 每個非零權重都能列出貢獻它的 `eventId` 與規則代號 |
| PL8 | 弱訊號不得翻盤 | 30 筆 `course_viewed` 對 1 筆強訊號，累計貢獻的效果恰好等於再一筆強訊號（不隨筆數線性成長） |
| PL9 | 看了又退不算正向 | 同一門課先看後退，那次瀏覽被排除；時間對調後（先退後看）該次瀏覽要被計入——證明真的在看時序 |
| PL10 | 事件類型邊界 | `recommendation_exposed`／`schedule_regenerated` 不投票；接受方案沒有對照組（只有 1 個曝光方案）或找不到對應曝光時不計入 |

`server/test/preferenceLearningService.test.js` 的 PL7——服務層對隱私路徑的整合測試，
刻意刪除 `DB_*` 環境變數走純記憶體 store（比照 `authRoutes.test.js`），不連真實 MySQL：

| 情境 | 預期結果 |
| --- | --- |
| 未同意 `personalization_learning` | 回 `no-consent`，不寫入任何列 |
| 同意後重算 | 寫入一列，讀回內容與計算結果一致 |
| 刪除 | 直接用讀取路徑再查一次確認沒有殘留，不只信刪除回報的數字 |
| 重複重算 | 覆寫同一列（`subject_id` 為主鍵），不是往後累加；同一批事件兩次重算逐位元相同 |

`GET /api/privacy/export` 帶 `data.learnedPreferenceWeights`（沒算過時為 `null`，
不是整個欄位缺席）**沒有寫成 CI 測試**——這條路由本來就需要真實 MySQL 讀 Profile
（既有限制，與這次改動無關），CI 刻意不設定 DB secret（見 `.github/workflows/ci.yml`
的註解）。第一次嘗試把它寫進 `privacyRoutes.test.js` 時 CI 就以 `500` 打回來，
才發現這個檔案先前只測 `/chat`、`/consents`，從沒有案例真正走到過 MySQL。這條欄位
的接線邏輯很薄（就是把 `getStoredLearnedWeights()` 的結果接上 response），實質行為
已由下面完全不連 MySQL 的 PL7 覆蓋，因此不另外補一條會在 CI 出錯的測試。

**真實 MySQL 的驗證**（不寫進自動化測試，記錄在對應的變更報告）：對 demo 帳號
（`D1249697`）跑過一次完整管線——讀到真實的 92 筆事件、正確篩出可用的行為事件、
`sufficiency.status` 為 `insufficient`（`31/50`，符合實測「今天資料不夠」的結論）；
對同一批真實事件重播兩次結果逐位元相同；直接查表確認一個合成 subject 的
`Learned_Preference_Weights` 列在呼叫 `deleteLearnedWeights()` 後真的消失，不只信
回傳值。

**這輪不接進排課**：`buildPreferenceProfile()` 不讀這張表，`#5B` 仍記為未完成。

### 自然語言 golden set（`server/test/agentGoldenSet.test.js`，Roadmap #24）

**這個檔案會真的呼叫模型**，是 `npm test` 裡唯一會連外網、唯一會消耗 API 額度的測試。
8 題中文題庫在 `server/test/fixtures/agentGoldenSet.json`，另有一題「同一句話重跑三次
得到逐位元相同的結構化結果」。斷言邏輯本身是純函式（`goldenSetAssertions.js`），
另由 GA1-GA5 測試，不需要網路。

斷言的是**語意性質而非逐字相同**——推理模型的輸出不保證每次一樣（此模型也不接受
`temperature`）。要求逐字重現只會做出一個間歇性失敗的測試。

**本機一律執行，CI 一律不執行。** 兩者都是明確的決定：

| 環境 | 行為 | 理由 |
| --- | --- | --- |
| 本機、有 key | 每次 `npm test` 都實跑並回報通過率 | 這是 golden set 的正常執行環境 |
| 本機、無 `OPENAI_API_KEY` | **硬失敗**並說明「這是環境未設定，不是程式壞掉」 | 本機一定有 `server/.env`，缺 key 代表環境沒設好。開發者**不能**自己跳過 |
| CI（不論有沒有 key） | 跳過這 9 題並印出明顯說明，其餘照跑 | **決定於 2026-08-31：不讓 golden set 在 CI 跑。** 要跑就得把 API key 放進 public repo 的 secret，且每次 push 都消耗額度 |

判定**只看 `process.env.CI`**（GitHub Actions 固定設 `CI=true`），**不看有沒有 key**。
這樣即使日後為了別的用途在 CI 加了 `OPENAI_API_KEY` secret，這幾題也不會無聲無息地
開始每次 push 都呼叫模型——要恢復在 CI 執行必須是刻意的動作（改
`agentGoldenSet.test.js` 的 `SKIP_REASON`），不是設個 secret 就自動生效。

這**不是給開發者的開關**：本機沒有任何方式能繞過。

驗證方式（四種情境都要能重現）：

```bash
# 本機有 key：實跑並回報通過率（713 pass / 0 fail，golden set 8/8）
npm test --prefix server

# 本機無 key：硬失敗
env -u OPENAI_API_KEY -u CI DOTENV_CONFIG_PATH=/nonexistent/.env npm test --prefix server

# CI 無 key：跳過，0 fail（703 pass）
env -u OPENAI_API_KEY CI=true DOTENV_CONFIG_PATH=/nonexistent/.env npm test --prefix server

# CI 有 key：仍然跳過（防止 secret 意外啟用它）
CI=true npm test --prefix server
```

## 每次開發完成驗收

1. 確認相關文件已更新。
2. 執行前端 build。
3. 執行必要的 lint 或語法檢查。
4. 確認 `.env` 與 `node_modules/` 沒有被加入 Git。
5. 若修改排課邏輯，至少執行排課測試案例 S1-S10；若修改的是
   `scheduler.js`／`scheduleValidator.js`／`constraintSchema.js`，一併執行 N1-N15 與 X1-X14。
