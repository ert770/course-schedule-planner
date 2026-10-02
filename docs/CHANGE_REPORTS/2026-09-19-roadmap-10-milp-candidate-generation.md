# Roadmap #10 任務 1：HiGHS MILP＋Dinkelbach 候選池

## 修改日期

2026-09-19

## 問題

舊版多方案只把某個偏好權重放大，候選課的前後順序雖然會變，最後塞進 25 學分的課程集合
卻常常相同。另一個量級問題是「跨年級 −2500、系外 −5000」遠大於每門約數十分的偏好差，
若把兩者一起放進 87% 品質下限，替代方案幾乎不能更換任何低階層課。

## 解法

- 綜合平衡方案 S₀ 保留原 greedy；替代方案由 HiGHS 求解 Dinkelbach 的 MILP 子問題。
- 87% 改為「同階層內的偏好品質」下限：品質效用扣除固定基準與兩個階層懲罰。
- 本系優先改由硬限制保護：替代方案的跨年級、系外競爭課門數各自與 S₀ 相同，因此可以在
  同一階層換課，不會因偏好分數而偷渡更多低階層課。
- 每個替代方案學分不少於 S₀，並和 S₀、同主軸先前候選雙向至少換入／換出 2 門。
- 興趣、輕鬆／挑戰、集中三個主軸各產生最多 3 個候選；沒有資料訊號或模型不可行時合併並
  回傳結構化原因。
- 真實資料校準把 `minGain` 從 0.05 調為 0.02；87% 品質、學分、換課、階層限制皆未放寬。

## 修改檔案

### 後端

- `server/src/skills/optimization/highsRuntime.js`：保留原始 HiGHS 狀態，分類 optimal、限制停止、
  infeasible、unbounded 與 solver error，支援暖啟動。
- `server/src/skills/optimization/scheduleMipModel.js`：加入正式班次／課號模型、品質、階層配額、
  主軸、換課、學分、共同必修、系列與每日課數限制。
- `server/src/skills/optimization/diversePlanSolver.js`：新增 Dinkelbach、centroid diversity、共用
  deadline、候選診斷與不可行原因判定。
- `server/src/skills/optimization/milpPlanChecks.js`：新增獨立結果檢查，包含階層配額。
- `server/src/skills/scheduler.js`：保留 S₀，接入三個 MILP 主軸、暫時挑選器、推薦排序、比較與
  fallback；修正不及格低年級必修的重補修路徑。
- `server/src/app.js`：啟動時預載並注入 HiGHS runtime。
- `server/src/skills/planStrategies.js`、`scoringPolicy.js`、`planComparison.js`、
  `personalizationMetrics.js`、`recommendationReason.js`、`planDiversityAcceptance.js`：改用新主軸、
  推薦識別與正式驗收指標。
- `server/src/services/scheduleService.js`、`server/src/data/interactionEventSchema.js`：曝光與事件
  改讀 `recommendedPlanId`，保存 MILP policy／solver metadata，舊事件仍相容。
- `server/src/skills/scheduleValidator.js`：驗證器與重補修的低年級必修規則對齊。
- `server/scripts/highsSpike.js`、`server/scripts/lib/demoCaseLoader.js`、
  `server/scripts/planDiversityAcceptanceReport.js`：補固定課真實案例、500 次 RSS 觀測、候選收斂與
  品質／距離報表；bench 可用 `--axis-min-gain` 重播校準。

### 前端

- `client/src/components/Schedule/PlanSwitcher.jsx`：顯示主推方案與每個合併原因。
- `client/src/components/Schedule/PlanComparison.jsx`：顯示相較 S₀ 的加退課、品質保留與上課日數。
- `client/src/contexts/ScheduleContext.jsx`、`client/src/pages/DashboardPage.jsx`、
  `client/src/pages/SchedulePage.jsx`、`client/src/services/interactionLog.js`：傳遞並使用
  `recommendedPlanId`。

### 測試與文件

- 新增 `server/test/diversePlanSolver.test.js`、`highsRuntime.test.js`、`milpAxisSignal.test.js`、
  `milpPlanChecks.test.js`、`schedulerMilpIntegration.test.js`，並更新既有排課、事件、策略與驗收測試。
- 更新 `docs/SCHEDULING_LOGIC.md`、`API_SPEC.md`、`DATA_SCHEMA.md`、`TEST_PLAN.md`、本 roadmap
  與 spike 報告。
- 更新 `server/test/reports/highs-spike-latest.json`、
  `plan-diversity-acceptance-latest.json`，新增診斷 sidecar。

## 影響範圍

- `/api/schedule/generate` 最多回傳 S₀ 加三個主軸方案；求解器不可用時安全退回 S₀。
- 替代方案的說明改為相較 S₀ 加入／移除哪些課、品質與主軸變化；不再偽裝成 greedy 的逐步
  勝負理由。
- HiGHS `run()` 仍是同步呼叫，會占用 Node event loop；多人部署前應改到 worker thread。
- 任務 2 的最終候選挑選尚未實作，目前挑選器有固定主軸順序偏差。

## 測試與驗證結果

- 真實 MySQL 多方案 bench：5 個 case 中 3 個通過。集中 persona、無偏好對照、固定課案例
  通過；挑戰 persona 與涼課 persona 因訊號／主軸可行性不足未通過。所有被保留的替代方案
  品質保留率為 0.90～1.00、學分不低於 S₀、每對至少換 2 門，validator 與 MILP checks 都
  沒有 violation。
- `minGain` 校準：0.04 時無偏好案例仍只有 2/3；0.02 時達 3/3。其餘硬限制未改。
- 後端目標測試 273/273 通過。後端全套 1160 個測試有 1157 個通過；3 個失敗皆為既有的
  Windows libuv `UV_HANDLE_CLOSING` 問題（`authRoutes`、`privacyRoutes`、`scheduleRoutes`），
  與本次修改無關。
- `server/src/**/*.js` 語法檢查、前端 lint 與 build 全數通過。
- HiGHS 500 次 warm solve 觀測維持 GO：5 個 case 都是 optimal、MIP gap 0、重跑一致且
  validator 0 violation；冷啟動 23.1 ms，正式模型 warm p95 最高 34.42 ms。RSS 樣本約
  243.71～276.20 MB，未觀察到隨輪次單調上升；這是有限次觀測，不代表長期記憶體保證。
- 瀏覽器以 demo 帳號 `D1249697` 實際產生並切換方案。興趣導向與綜合方案同為 9 門、
  25 學分；興趣方案相較綜合方案換出「系統安全、電腦視覺與擴增實境」，換入「人工智慧
  自然語言導論、嵌入式系統」，品質保留 94%。畫面顯示主推標記、比較表及兩個
  `axis-threshold-infeasible` 的中文合併原因；切換兩個分頁時課表內容同步變動，console 沒有
  error 或 warning。

## Roadmap 狀態

`#10` 維持「部分完成」。任務 1 的正式候選池已實作，但 5 case 尚未全數通過，任務 2～4
也尚未完成。整張進度表的狀態與相依欄已重新核對，沒有其他列需要調整。

## Commit 與 push

本次依使用者要求未 commit、未 push。
