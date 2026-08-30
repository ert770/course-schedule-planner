# Roadmap #22：有限回溯與互動式排課修復方案

## 問題與目的

目前排課器會先依 `scoreCourse()` 排序，再由 `buildPlan()` 逐門嘗試加入課表。這種 greedy
流程只能保證當下加入的課程沒有已知衝突；如果早期選錯 section，導致後續必要課程排不進去，
系統不會撤銷先前決定，因此可能在實際有解時仍回報失敗。

#22 的目的，是保留現有 greedy 作為快速 baseline，並在 baseline 無法滿足必要課程或最低學分
目標時，以有時間上限的 backtracking 撤銷局部選擇、搜尋替代 section。若仍無法產生完整合法解，
系統要保留可用資訊、提供清楚的草稿課表及結構化澄清問題，協助使用者補充真正重視的課程與條件。

## 任務邊界

### 本任務包含

- 保留現有五個 greedy variants，作為 baseline 與可預期 fallback。
- 在最佳 baseline 未通過完整條件，或所有 baseline 都未達 `minCredits` 時，啟動一次 bounded
  backtracking repair。
- 同課不同 section 視為互斥選項；正課與實習視為不可拆分的原子決策組。
- 延用 #21 的 hard／soft constraint 分類與 final validator，不另寫一套互相漂移的限制規則。
- 對 repair 設定每次排課請求共用 2 秒的總時間上限、固定 seed、節點上限與 deterministic
  tie-break。
- 區分 `solved`、`infeasible`、`timeout`、`data-insufficient`，並回傳搜尋統計、fallback、
  未滿足條件與可驗證的衝突原因。
- solver 無法提供完整合法方案時，回傳最佳可用的合法 fallback 或明確標記的草稿課表，並產生
  結構化澄清問題供 Chat 使用。

### 本任務不包含

- 先修與廣義共修資料來源或強制執行，仍由 #8 負責；在 #8 完成前 validator 繼續回報
  `unchecked`。
- 跨班、跨系、通識及學程的完整 eligibility 規則，仍由 #20 負責；solver 不把 `unknown`
  自行推定成 eligible。
- `scoreCourse()` 動態讀取 constraint schema，屬 #7。
- `maxCoursesPerDay` 是否可放寬，屬 #24，等待明確需求後再開發。
- 多學期路徑與畢業規則，分別屬 #8、#23。
- 完整 solver benchmark、量化報告與固定環境比較，屬 #35；#22 只建立本身驗收所需的最小
  greedy-trap、infeasible、timeout 與 data-insufficient fixtures。
- Claude／LLM 的正式 tool calling 接線、prompt 與對話狀態管理。#22 只提供結構化
  `clarification` 契約；後續 Chat 整合必須依 #24、#25 辦理。

## 解法與執行流程

1. `generateSchedule()` 先以現有邏輯產生五個 greedy baseline，評分、排序及去重規則維持不變。
2. 最佳 baseline 若通過 validator 且達到 `minCredits`，直接回傳，不啟動 repair。
3. 若有必要課程未排入、validator 不通過，或所有合法 baseline 都低於 `minCredits`，將候選課整理成
   決策組：
   - 同一 `catalogCourseCode` 的不同 section 為同一組內的替代選項。
   - 正課與實習必須組成同進同退的原子選項。
   - 必要課程與重補修排在前面，選修依既有 `scoreCourse()` 與穩定 tie-break 排序。
4. bounded backtracking 逐組嘗試選項。每次放置都使用與 `addCourseToPlan()` 相同的 hard constraint
   判斷；失敗時保存 constraint evidence，成功時保存可撤銷的 state delta。
5. 找到符合所有 hard constraints 的課表後，交由 `validateScheduleAgainstConstraints()` 做 final
   validation。只有 validator 通過的結果才能設為 `success: true`。
6. 已找到合法解時，以「必要課程涵蓋 → 是否達最低學分 → 使用者偏好分數 → 總學分」比較
   incumbent；剩餘時間可繼續改善，但 `solved` 不代表已證明全域最優。
7. 搜尋完整結束且證明無法滿足 hard constraints 時回傳 `infeasible`；2 秒用完但尚未完成證明時
   回傳 `timeout`，不得把 timeout 說成無解。

## Timeout、fallback 與草稿課表

「仍要丟課表」分成兩種不同安全層級，不得混為一談：

### 合法 fallback

若 greedy baseline 已通過 validator，只是未達 `minCredits` 或偏好品質不夠好，repair timeout 後可
回傳該 baseline：

- 頂層可維持 `success: true`。
- `solver.status` 為 `timeout`。
- `solver.fallbackUsed` 為 `true`。
- `solver.resultSource` 為 `greedy`。
- `warnings` 與 `unmetRequirements` 明確指出最低學分或軟目標尚未達成。

### 部分草稿

若沒有任何通過完整 validator 的方案，可回傳搜尋期間找到的最佳 hard-consistent 部分組合供使用者
參考，但它不是正式課表：

- 頂層 `success` 必須是 `false`。
- 正式 `schedule` 維持空陣列，避免舊前端誤把草稿當成功結果。
- 草稿放在獨立的 `draftSchedule`，並設定 `isDraft: true`。
- `draftSchedule` 至少不得有衝堂、重複 section、超過學分上限或違反不可放寬時段；尚缺的必要課程
  必須列入 `unmetRequirements`。
- 回傳 `conflictSet`、`clarification` 與警告文字，明確說明草稿不能視為已完成排課。
- Chat 可以展示草稿協助討論，但不得用「已成功產生課表」描述它。

如果連最低限度的安全草稿都無法建立，`draftSchedule` 回傳空陣列，不得虛構課程或忽略 hard
constraint。

## 欄位契約

### 內部 runtime options

`generateSchedule(candidateCourses, constraints, runtimeOptions)` 新增第三參數，只供後端測試、
benchmark 與受控設定使用，不直接讓前端任意放大運算資源。

| 欄位 | 預設值 | 功能 |
| --- | --- | --- |
| `solverMode` | `repair` | `repair` 依條件啟動回溯；`greedy` 供 baseline A/B。 |
| `timeoutMs` | `2000` | 整個請求中 repair 共用的時間上限。 |
| `maxNodes` | 固定安全上限 | 防止候選過大時長時間占用 Node.js event loop。 |
| `seed` | `0` | 固定同分候選的探索順序，確保結果可重現。 |
| `now` | 系統 monotonic clock | 測試可注入假時鐘，穩定驗證 timeout。 |

### `solver`

API 回應新增 `solver`，既有欄位語意不變：

| 欄位 | 功能 |
| --- | --- |
| `status` | `solved`、`infeasible`、`timeout` 或 `data-insufficient`。 |
| `repairAttempted` | 本次是否真的啟動 backtracking。 |
| `resultSource` | 最終正式結果來自 `greedy`、`repair` 或 `none`。 |
| `fallbackUsed` | 是否因 repair 未完成而退回已驗證 baseline。 |
| `timeoutMs`、`elapsedMs` | 時間預算及實際搜尋耗時。 |
| `nodesVisited`、`prunedNodes` | 已探索與提前排除的搜尋節點數。 |
| `seed` | 本次 deterministic 設定。 |
| `baseline` | greedy 的成功狀態、最低學分達成狀態與偏好分數。 |
| `improved` | repair 是否改善必要課程涵蓋、最低學分或偏好目標。 |
| `optimizationComplete` | 是否已完整搜尋並證明沒有更佳結果。 |

`status` 的語意如下：

- `solved`：存在 validator 通過的正式方案；不保證全域最優。
- `infeasible`：已完整探索合法決策空間，仍無法滿足 hard constraints。
- `timeout`：2 秒內未完成目標或證明；可能附合法 fallback 或非正式草稿。
- `data-insufficient`：必要決策缺少關鍵資料，不能據此宣稱無解。

### 草稿與未滿足條件

| 欄位 | 功能 |
| --- | --- |
| `draftSchedule` | 找不到完整合法解時，供討論用的最佳安全部分組合。 |
| `isDraft` | 明確標示 `draftSchedule` 不是正式成功結果。 |
| `unmetRequirements` | 尚未滿足的必要課程、最低學分、未知資格或其他目標。 |

`unmetRequirements[]` 每筆包含：

| 欄位 | 功能 |
| --- | --- |
| `type` | `required-course`、`credit-floor`、`unknown-eligibility` 或其他固定代號。 |
| `courseIds` | 受影響的課程或 section id。 |
| `constraintIds` | 對應 #21 constraint id。 |
| `reason` | 可直接顯示、但不含臆測的中文原因。 |
| `adjustable` | 是否屬於允許使用者重新選擇的條件。 |

### `clarification`

`clarification` 是排課器產生、供 Chat 層轉述的結構化資料，不直接依賴 Claude API：

| 欄位 | 功能 |
| --- | --- |
| `required` | 是否需要使用者補充或取捨。 |
| `reason` | `timeout`、`infeasible`、`data-insufficient` 或 `unmet-preference`。 |
| `questions` | 按影響力排序的具體問題。 |
| `adjustableConstraintIds` | 只能列出 schema 中允許調整或屬使用者偏好的限制。 |
| `relatedCourseIds` | 造成衝突或需要選擇的課程。 |

`questions[]` 每筆包含 `id`、`type`、`prompt`、`courseIds`、`constraintIds` 與可選的 `options`。
問題應優先詢問：

1. 哪些具體課程或 section 是一定要選的。
2. `minCredits` 與期望總學分是否能調整。
3. 哪些日期、節次或上下午條件最重要。
4. 在互相衝突的課程中希望保留哪一門。
5. 哪些 schema 標記為可調整的偏好可以放寬。

不得詢問使用者是否要違反衝堂、重複 section、學分硬上限或 `blockedPeriods` 等不可放寬限制。
Chat 接線完成後，只能根據 `clarification.questions` 與 evidence 提問，不得自行發明衝突原因。

## 函式功能

| 函式 | 功能 |
| --- | --- |
| `shouldAttemptRepair()` | 判斷 baseline 是否有必要課程失敗、validator 失敗或全部未達最低學分。 |
| `buildDecisionGroups()` | 將同課不同 section 與正課／實習配對整理成原子決策。 |
| `evaluateCoursePlacement()` | 從 `addCourseToPlan()` 抽出共用的純判斷，回傳是否可放置及 constraint evidence。 |
| `applyDecision()` | 原子加入決策組，更新課表、學分、每日門數與已選課號，並回傳 rollback delta。 |
| `rollbackDecision()` | 依 delta 精確撤銷分支，不讓不同搜尋分支互相污染。 |
| `compareSolverObjectives()` | 依必要課程、最低學分、偏好分數、總學分的固定順序比較 incumbent。 |
| `solveWithBoundedBacktracking()` | 執行有限回溯、timeout／node limit、剪枝及 deterministic ordering。 |
| `buildRepairConflictSet()` | 彙整探索過程的 constraint evidence；不宣稱是最小 unsat core。 |
| `buildDraftSchedule()` | 從已探索狀態選出最佳安全部分組合並列出未滿足要求。 |
| `buildClarification()` | 由 conflict、未知資料與未滿足要求產生具體且可回答的結構化問題。 |
| `finalizeSolverOutcome()` | 執行 final validator、選擇正式結果或草稿、設定狀態與 fallback 欄位。 |

搜尋核心可放在獨立 `server/src/skills/scheduleSolver.js`，由 `scheduler.js` 注入 placement、objective、
validator 與 clock callback，避免循環 import，也避免重新複製 hard constraint 邏輯。

## 測試與驗收

- Greedy trap：greedy 選錯早期 section，repair 撤銷後找到 validator 通過的方案。
- Infeasible：完整搜尋後回傳 `infeasible` 與可驗證 `conflictSet`。
- Timeout with fallback：repair timeout，回傳已驗證但未達軟目標的 greedy baseline。
- Timeout with draft：沒有完整合法方案時，正式 `schedule` 為空，`draftSchedule` 明確標為草稿，並帶
  `unmetRequirements` 與 `clarification`。
- Data insufficient：資格或必要資料未知時不誤報 `infeasible`，問題指向缺少的資料。
- Determinism：相同候選、限制與 seed 重跑，結果、探索順序與問題排序一致。
- Corequisite atomicity：正課／實習必須同時加入或同時撤銷。
- Regression：既有 greedy 已達目標時不啟動 repair，原有排序與回應欄位不變。
- Safety：任何 `success: true` 結果均通過 #21 validator；草稿永遠不被標成成功。
- Chat contract：每個問題都能追溯至 `unmetRequirements`、`conflictSet` 或未知資料，不含 LLM
  自行猜測。
- 執行完整 `npm test`、後端 JavaScript 語法檢查，以及 greedy／repair 的 fixture A/B。
- 因課表結果屬使用者可見行為，實作完成後必須啟動 client 與 server，在實際排課畫面操作到結果頁，
  驗證正常成功、合法 fallback、草稿提示及 console 無新增錯誤。

## 文件與相依任務更新

實作完成時需同步更新：

- Roadmap #22：移除過時的「卡 #21」，記錄 bounded backtracking、2 秒預算與驗收結果。
- Roadmap #24／#25：承接 `clarification` 到需求澄清對話及 structured tool calling。
- Roadmap #35：以 #22 的 greedy／repair 結果建立完整 benchmark 與量化報告。
- `docs/SCHEDULING_LOGIC.md`：記錄 repair、fallback、草稿與 status 語意。
- `docs/API_SPEC.md`：記錄新增的 additive response fields。
- `docs/TEST_PLAN.md`：加入 greedy trap、timeout、determinism、fallback 與 clarification cases。

