# 2026-09-18 Roadmap #10 方案塌縮診斷

## 修改日期

2026-09-18

## 修改檔案

### 後端與測試

- `server/src/skills/scheduler.js`
- `server/scripts/planDiversityAcceptanceReport.js`
- `server/test/planDiversityDiagnostics.test.js`（新增）
- `server/test/reports/plan-diversity-diagnostics-latest.json`（新增量測報告）
- `server/test/reports/plan-diversity-acceptance-latest.json`（重新量測）

### 文件

- `docs/SCHEDULING_LOGIC.md`
- `docs/TEST_PLAN.md`
- `docs/CHANGE_REPORTS/2026-08-01-personalization-roadmap.md`
- `docs/CHANGE_REPORTS/2026-09-18-roadmap-10-collapse-diagnostics.md`（本檔）

## 主要改動

1. `generateSchedule()` 新增 opt-in 的 `runtimeOptions.includePlanDiagnostics`。正式 API 不設定此
   選項，只有唯讀 benchmark 會取得大型診斷資料。
2. 保存 `uniquePlans()` 去重前每個策略的完整課程集合，並用 `duplicateOfVariantId` 指出與哪個
   先出現的策略具有相同 section 集合。
3. 保存每次貪婪選課的前 4 名候選、總分及 `computeScoreComponents()` 的完整分數組成，直接
   沿用正式排序公式，沒有另外實作診斷專用評分。
4. 將每門未入選候選歸入既有 constraint、流程性跳過、同課其他班次或停止條件；每個 case
   均可用「入選＋未入選」對回原始候選池。
5. benchmark 繼續輸出小型驗收摘要，另寫完整診斷 sidecar，避免驗收報告被大量決策軌跡淹沒。

## 實際量測

執行：

```bash
npm run bench:plan-diversity --prefix server -- --markdown
```

四個 case 的候選池均為 362 門；每個策略皆排入 10 門、未入選 352 門，最後都到達 25 學分。

| Case | 策略 | 去重後歸屬 | 決策步數 | 課程集合差異 |
| --- | --- | --- | ---: | --- |
| 集中偏好 | 個人化綜合 | 保留 | 145 | 基準 10 門 |
| 集中偏好 | 集中加重 | 合併至綜合 | 145 | 無 |
| 集中偏好 | 較多學分 | 合併至綜合 | 145 | 無 |
| 無偏好對照 | 個人化綜合 | 保留 | 176 | 基準 10 門 |
| 無偏好對照 | 較多學分 | 合併至綜合 | 176 | 無 |
| 挑戰偏好 | 個人化綜合 | 保留 | 55 | 基準 10 門 |
| 挑戰偏好 | 挑戰加重 | 合併至綜合 | 54 | 無 |
| 挑戰偏好 | 較多學分 | 合併至綜合 | 92 | 無；處理順序不同 |
| 涼課偏好 | 個人化綜合 | 保留 | 26 | 基準 10 門 |
| 涼課偏好 | 涼課加重 | 合併至綜合 | 26 | 無 |
| 涼課偏好 | 較多學分 | 保留為第二方案 | 154 | 移除 `IECS4944`、`IINE1803`；加入 `IECS4943`、`ATHL3071` |

第一個決策點可直接看出「分數改變」不等於「名次跨界」：集中 persona 的前三名
`IECS4943`、`IECS4073`、`IECS4942` 在綜合策略都是 912 分；集中加重後一起變成 892 分；
較多學分策略則一起變成 984 分。三門的相對次序沒有改變，後續仍依固定 section id 破同分。

挑戰 persona 的較多學分策略確實把第二、三順位從 `IECS4071`／`IECS4942` 對調，但兩門最後
都排入，因此最終集合仍相同。涼課 persona 則只有較多學分策略讓兩門課跨過入選邊界，形成
第二個實際不同方案。

### 未入選原因

| Case／策略 | 學分上限 | 衝堂 | 已修通過 | 早課限制 | 無時間 | 同課異班 | 同系列 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 集中（三個策略皆同） | 215 | 78 | 35 | 13 | 6 | 3 | 2 |
| 無偏好（兩個策略皆同） | 200 | 90 | 35 | 16 | 6 | 3 | 2 |
| 挑戰／綜合 | 284 | 27 | 32 | 0 | 6 | 1 | 2 |
| 挑戰／挑戰加重 | 284 | 27 | 32 | 0 | 6 | 1 | 2 |
| 挑戰／較多學分 | 268 | 43 | 32 | 0 | 6 | 1 | 2 |
| 涼課／綜合與涼課加重 | 308 | 5 | 28 | 0 | 6 | 3 | 2 |
| 涼課／較多學分 | 253 | 60 | 28 | 0 | 6 | 3 | 2 |

各列合計皆為 352。最大宗是 `CREDIT_CEILING`：課表到達 25 學分後，後段候選不再處理。
因此 362 門原始候選不代表有 362 門能在最終十門中自由互換；分數加重必須讓課程在到達學分
上限前跨過排序與衝堂造成的入選邊界，才會留下不同方案。

## 影響範圍

- 沒有修改策略權重、硬限制、方案排序、去重規則、API route 或前端。
- 診斷資料只在 benchmark 明確 opt-in 時建立；一般 `generateSchedule()` 回應不含
  `generationDiagnostics`。
- 診斷報告使用匿名 case，不含姓名、學號、密碼或帳號識別資料。
- #10 仍為部分完成；本次取得根因資料，尚未修復方案塌縮，也沒有降低驗收門檻。
- roadmap 進度總覽的狀態與相依兩欄已整表核對，本次沒有相依變更。

## 測試與驗證

- `node --test test/planDiversityDiagnostics.test.js test/planDiversityAcceptance.test.js`：
  13 pass / 0 fail。
- 排除兩個已知不穩定／不退出檔案後的完整後端套件：1067 pass / 0 fail。
- `agentGoldenSet.test.js` 單獨重跑：16 pass / 0 fail，模型題庫 13/13 通過。完整 `npm test`
  第一次執行時此測試曾出現一次「三次輸出需逐位元相同」的非決定性失敗，單獨重跑通過；
  本次沒有修改 Agent 或模型呼叫。
- `interactionEvents.test.js` 畫面列出的 39 項斷言全部通過；完成後仍因既有 open handle 不退出，
  因此人工終止。本次沒有修改該模組。
- 真實 MySQL benchmark 正常寫出摘要與診斷報告；exit code 1 代表 #10 驗收仍未通過。
- `server/src/**/*.js` 與 `server/scripts/**/*.js` 共 97 個檔案語法檢查：通過。
- 前端 `npm run lint`、`npm run build`：通過。
- 本次不影響使用者可見行為，不需要瀏覽器驗收。

## Commit / Push

- 未 commit。
- 未 push。
