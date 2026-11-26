# Agent 直接操作課表第三批

修改日期為 2026-11-26。這批完成第 15 項中的課表操作。

## 修改與範圍

- Agent 可依課名、課號或班次加課、移除、換班、鎖定與解鎖、避開與解除避開、關注與取消關注。多個班次時列出候選，接受「第二個」等短答。
- 加課與換班使用現有課表驗證。課程手動加入或鎖定後，切換方案與重排都會保留。解鎖只移除鎖定來源，原本手動加選仍保留。鎖定沿用同帳號在目前瀏覽器的保留清單。
- 未指定避開期間時先詢問。「本次」採用本次避開清單，「以後」使用帳號長期避開。移除課表課程沿用長期避開。關注不變更課表及學分。
- 比較顯示目前各方案、門數、學分及課名。切換使用同一次生成的方案，發生衝堂時保留原課表。
- 檢查以目前班次及帳號限制核對衝堂、重複班次及學分。回饋只記錄使用者明確提供的接受或調整理由，並使用目前推薦及個人化同意狀態。

## 修改檔案

- 前端｜`client/src/contexts/ScheduleContext.jsx`、`client/src/pages/DashboardPage.jsx`、`client/src/utils/applyAgentScheduleAction.js`。
- 後端｜`server/src/data/planningContextSchema.js`、`server/src/services/agentService.js`、`agentToolRegistry.js`、`planningContextService.js`、`promptService.js`、`scheduleActionService.js`、`server/src/skills/courseQuery.js`。
- 測試和文件｜`server/test/agentScheduleActions.test.js`、`agentToolRegistry.test.js`、`docs/AI_AGENT_SPEC.md`、`API_SPEC.md`、`DATA_SCHEMA.md`、`PROMPT_DESIGN.md`、`SCHEDULING_LOGIC.md`。

## 驗收

- Chrome 使用本機 Vite、隔離的帳號資料、真實 Agent 處理及課表驗證器。逐項檢查新增與長期移除、換班、鎖定及解鎖、本次與長期避開及解除、關注及取消、方案比較與切換、課表檢查、接受與調整回饋。
- 對照加課、換班及切換方案的可行與衝堂案例。可行時課表更新並儲存。衝堂時原課表、手動課程和已儲存快照均保留。
- 重複關注同一班次只寫入一次。解除避開後課程可再次加入。方案接受回饋指向實際選中的方案。
- 重新整理後再按套用，送出的保留清單仍包含手動加選與已鎖定班次。
- 前端 lint、build 與 154 個後端檔案的語法檢查通過。完整測試 2029 通過、14 跳過、0 失敗。
- 共用 MySQL 和真實模型未納入這次驗收。操作驗收使用可重現的隔離班次、方案和儲存端點。

變更保留在本機工作區，尚未提交或推送。
