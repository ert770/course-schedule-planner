# Roadmap #22：bounded backtracking repair

## 修改日期

2026-08-30

## 修改檔案

- `server/src/skills/scheduleSolver.js`
- `server/src/skills/scheduler.js`
- `server/src/services/scheduleService.js`
- `server/src/services/promptService.js`
- `server/test/scheduler.test.js`
- `server/test/scheduleService.test.js`
- `server/test/prompt.test.js`
- `docs/SCHEDULING_LOGIC.md`
- `docs/API_SPEC.md`
- `docs/PROMPT_DESIGN.md`
- `docs/TEST_PLAN.md`
- `docs/CHANGE_REPORTS/2026-08-01-personalization-roadmap.md`
- `docs/CHANGE_REPORTS/2026-08-30-roadmap-22-bounded-backtracking-repair.md`

## 主要改動

- 保留既有五個 greedy 排課方案作為 baseline；主推 baseline 未通過 #21 validator，或所有合法
  baseline 都低於最低學分時，啟動 bounded backtracking repair。
- 新增與課程領域規則分離的 DFS 搜尋核心。決策組前處理與搜尋合計上限 2 秒，另設 50,000
  nodes 上限與固定 seed；同一輸入可重現相同分支順序。
- 同課不同 section 互斥，正課／實習共同必修以原子 option 同進同退；分支實際放置沿用
  `scheduler.js` 的 hard rules，正式輸出再經獨立 validator 驗證。
- solver 結果明確區分 `solved`、`infeasible`、`timeout`、`data-insufficient`。timeout 若已有合法
  greedy baseline 則安全 fallback；沒有完整合法解時，正式 `schedule` 為空，部分組合只放草稿欄位。
- 新增 `unmetRequirements` 與 `clarification`，讓 Chat 依實際證據追問必要課程／班次、最低學分、
  不可上課時段與衝突課程取捨；草稿不得被當成成功或記錄為接受方案。

## 影響範圍

- 排課 REST 與 Chat 工具共用的 `scheduleService` 回應新增 additive 欄位；既有欄位與事件格式不變。
- 一般已有合法且達最低學分的排課不啟動 repair，維持既有主路徑。
- #21 的 hard/soft schema、validator 與放寬階梯不變；廣義先修／共修仍由 #8 負責。
- `scoreCourse()` schema 驅動權重仍屬 #7；偏好型每日門數限制仍待 #24 的明確需求。
- #25 的 structured/native tool calling 未在本次實作；目前只建立可被後續工具層消費的澄清契約。

## 測試與驗證

- `node --check src/skills/scheduler.js`：通過。
- `node --check src/skills/scheduleSolver.js`：通過。
- Roadmap #22 目標測試：154/154 通過。新增 Z1–Z7，涵蓋 greedy trap、真正無解、timeout
  fallback、timeout 草稿、資料不足、deterministic seed、正課／實習原子性。
- 完整 `npm test`：531/531 通過（114 suites）。
- 全部 `server/src/**/*.js` 的 `node --check`：通過。
- `client` 的 `npm run lint` 與 `npm run build`：通過；Vite production build 完成。
- 瀏覽器實機驗收使用隔離的 `BROWSER01` fixture，不讀寫正式 `server/data/users.json`：正常設定
  產生 9 門／25 學分；開啟「星期一排空」後仍為 9 門／25 學分，但偏好符合度由 17% 變 25%、
  未排入數由 218 變 217，課程組合由「軟體框架設計」換成「資訊安全管理」。console 無 error/warn。
- 同一實機 API 回應為 `solver.status:'solved'`、`repairAttempted:false`、
  `resultSource:'greedy'`、`isDraft:false`、`clarification.required:false`，證明合法且達最低學分的
  baseline 不會誤啟 repair。repair 本身的同輸入因果 A/B 由 Z1 固定 fixture 驗證：greedy 3 學分，
  repair 撤銷早期選擇後為 6 學分。

## Commit 與 push

- 未 commit。
- 未 push。
