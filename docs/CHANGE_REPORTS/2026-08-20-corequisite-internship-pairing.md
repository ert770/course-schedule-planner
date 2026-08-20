# 2026-08-20 實習課程需與同名正課一併排入（Roadmap #15）

## 修改日期

2026-08-20

## 修改檔案清單

**新增**：

- `docs/CHANGE_REPORTS/2026-08-20-corequisite-internship-pairing.md`（本檔）

**修改**：

- `server/src/skills/scheduler.js`
- `server/src/data/constraintSchema.js`
- `server/src/skills/scheduleValidator.js`
- `server/test/scheduler.test.js`
- `docs/SCHEDULING_LOGIC.md`
- `docs/DATA_SCHEMA.md`
- `docs/API_SPEC.md`
- `docs/CHANGE_REPORTS/README.md`
- `docs/CHANGE_REPORTS/2026-08-01-personalization-roadmap.md`（#15 狀態更新）

## 背景

排課引擎先前把正課與同名實習（例如「會計學(二)」與「會計學(二)實習」）當成完全不相干的兩門課排課。`getCourseKey()` 早已確保兩者不會被誤判成同一門課的兩個班次（B3 測試釘住），但**沒有任何機制強制兩者一起排入或一起排除**。實測會出現「只有實習沒有正課」這種在真實選課上不成立的課表。

#15 自己的「開始前必須具備」要求先驗證 `P` 後綴規則是否涵蓋所有實習並整理例外清單——本次規劃階段已用**唯讀 SQL 對目前連線的 shared MySQL 做完**，重現 2026-08-05 稽核（15 天內數字零漂移），確認全庫無小寫 `p`，並找出 3 個真實例外（見下方「配對規則與例外」）。

## 主要改動內容

### 配對規則與例外

`catalogCourseCode`（即 `Courses.subid3`）以 `P` 結尾者為實習，去掉 `P` 的字串即為對應正課代碼。**純字串規則，不看學分、不看系所**——已驗證的兩個會被學分或系所條件誤判掉的真實案例：

- `LAND2012P`（測量平差實習）實際 1.0 學分（一般實習慣例是 0），正課 `LAND2012` 配對正確。
- `MKT2020P` 與正課 `MKT2020` 的 `dept` 完全不重疊（合班命名差異），配對仍正確。

`P` 後綴但候選池中完全查不到對應正課的例外（`BUS1121P`、`HY2073P`）：系統依規則（P 後綴 + 找不到 base code）自動視為一般課程，不強制卡住，並在 `warnings` 彙總提醒一次，不逐課發、不寫死課號。

### 實作

- `server/src/skills/scheduler.js`：新增 `deriveBaseCourseCode()`（純字串推導）與 `annotateCorequisite()`（在 `prepareCandidates()` 對候選池的原始輸入建索引，幫每門課標記 `corequisiteCode`／`corequisiteRole`，五個排課方案共用，也讓 `tryRelaxationLadder()` 重試時自動沿用）；新增 `addCorequisitePairToPlan()`（快照/回滾包裝 `addCourseToPlan()` 兩次呼叫，整組原子排入，`addCourseToPlan()` 本身不變）；接進 `buildPlan()` 的必修排入迴圈與貪婪填充迴圈；`buildConflictSet()` 小幅擴充支援 `pairedCourse` 欄位。
- `server/src/data/constraintSchema.js`：新增 `COREQUISITE_PAIR_INCOMPLETE`（`category:hard`、`relaxable:false`、`source:DERIVED_SCHEDULE`、`confidence:1`、`enforced:true`），並以註解明確區分這是 #15 窄範圍、資料已驗證的規則，不是 #21／#8 負責的廣義先修/共修概念（`enforced:false`）。
- `server/src/skills/scheduleValidator.js`：新增 `checkCorequisitePairs()`，對「字面上給定的課表」複查配對完整性，不套用必修豁免（沒有 scope 可用）。

### 學分：無需特殊處理

`addCourseToPlan()` 既有的 `credits = course.credits || 0` 已經逐課正確加總——0+3 或 `LAND2012P` 的 1+2 都自動正確。**沒有**新增任何把實習學分強制歸零的邏輯。

### 單向設計

只有「正課必修 → 一併帶入實習」；使用者若只把實習的 id 放進 `mustTakeCourseIds`，系統不會反向把正課升級為必修。

## 測試

- `node --check` 對所有變更檔案全數通過。
- `node --test test/scheduler.test.js`：102/102 通過，含 S1-S17／M1-M4／W1-W2／U1-U4／B1-B5（尤其 B3，正課/實習不被誤判為重複班次）／C1-C6／V20-V28／N1-N15／X1-X14 全數不變，新增 Y1-Y9 全數通過。
- `npm test`：完整 server 測試套件 455/455 通過，零回歸。
- Y1-Y9 涵蓋：雙方皆可排入、貪婪填充中實習衝堂拖累正課不排、正課衝堂拖累實習不排、必修排入迴圈只指定正課仍一併帶入實習、必修正課的實習因非本學期被排除時以「找不到對應實習」明確失敗（區別於一般衝堂原因）、貪婪填充自然選中配對、正課因學分上限排不進去時實習不單獨排入、P 後綴找不到正課的例外課程正常排入並附警告、非 0 學分實習正確加總不歸零。
- 規劃階段已用唯讀查詢實際連上 shared MySQL 驗證例外清單；本次為純後端排課邏輯與資料驗證，未修改 `client/src`，依專案慣例（`只有 docs/** 或程式邏輯未變更 client 時可跳過前端 build/lint`）未執行不必要的前端測試。
