# Agent 排課參數第二批

修改日期為 2026-11-26。這批接通上課時間、學分、教師、課程類別及指定班次。

## 改動

- 可上課時段檢查班次的每個上課節次。偏好時段參與排序。每日門數和不排晚課可一併保存。
- 支援總學分最低、最高與精準目標，也能限制或偏好每門課的學分。「18 學分」會先問目標或上限，短答接續原數字。進階條件套用帳號的學分下限和超修上限。
- 教師可指定、偏好或排除。選修類別可限定、排除或優先，亦可設定每類門數和學分。類別篩選保留正式必修，明確排除必修或其班次時會回報衝突。
- 指定班次會進入同一份候選池及必排檢查，維持同課一班、修課資格和衝堂規則。手動加選衝突時，Agent 問要保留班次還是調整條件。
- Agent 查課與換課搜尋新增課號、教師、節次及單門學分參數。永久條件顯示在設定頁，確認後才重排。
- 顯式類別配額由貪婪排課、MILP 及最終驗證器共同套用。只有成功通過條件的方案會顯示給使用者切換。

## 修改檔案

- 前端｜`client/src/pages/SetupPage.jsx`。
- 資料與偏好｜`server/src/data/constraintSchema.js`、`profileSchema.js`、`profileUpdateValidation.js`、`scheduleOptions.js`，以及 `server/src/services/memoryService.js`。
- Agent 與排課服務｜`server/src/services/agentService.js`、`chatPreferenceService.js`、`constraintService.js`、`promptService.js`、`requirementPreflight.js`、`scheduleService.js`。
- 求解及驗證｜`server/src/skills/scheduler.js`、`scheduleValidator.js`、`optimization/scheduleMipModel.js`。
- 測試和規格｜`server/test/agentScheduleOptions.test.js`、`docs/API_SPEC.md`、`DATA_SCHEMA.md`、`PROMPT_DESIGN.md`、`SCHEDULING_LOGIC.md`。

## 本機驗收

| 條件 | Chrome 對照結果 |
| --- | --- |
| 只有週四下午有空 | 回答「這次」後，週三課移除，週四可上課班次保留 |
| 這次 6 學分 | Agent 先問「排到」或「最多」。回「剛好」後，隔離課表從 10 降為 6 學分 |
| 避開指定教師 | 該教師的班次退出課表 |
| 通識一門 | 原先兩門通識變為一門 |
| 指定班次 806 | 排入指定班次，同課的另一班退出 |
| 以後只排通識 | 設定頁先顯示條件，首頁按套用後才更新課表 |

Chrome 使用本機 Vite、隔離課程及帳號、實際 Agent 處理與排課引擎，沒有應用程式 console 錯誤。HiGHS 測試也確認，加入通識門數和學分列後，求解器改選符合配額的班次。
前端 lint、build 及後端語法檢查通過。完整測試 2022 通過、14 跳過、0 失敗。共用 MySQL 和真實模型未納入這次驗收。

本批在本機工作區完成驗證，尚未提交或推送。
