# 2026-09-18 Roadmap #10 多方案量化驗收

## 修改日期

2026-09-18

## 修改檔案

### 後端與測試

- `server/src/skills/planDiversityAcceptance.js`（新增）
- `server/scripts/planDiversityAcceptanceReport.js`（新增）
- `server/test/planDiversityAcceptance.test.js`（新增）
- `server/test/reports/plan-diversity-acceptance-latest.json`（新增）
- `server/package.json`

### 文件

- `docs/SCHEDULING_LOGIC.md`
- `docs/TEST_PLAN.md`
- `docs/CHANGE_REPORTS/2026-08-01-personalization-roadmap.md`
- `docs/CHANGE_REPORTS/2026-09-18-roadmap-10-acceptance.md`（本檔）

## 主要改動

1. 把 #10 的「方案要真的不同」改成可重跑的量化門檻：策略保留率至少 75%、有偏好至少
   3 個方案、無偏好至少 2 個、中位 Jaccard 不高於 0.75，且每對方案至少有一門正式課號
   不同。
2. 比較前排除必修、重補修與使用者指定課程，避免所有方案必然相同的部分把重疊率拉高。
3. 使用 `catalogCourseCode` 而非 section ID 判定實際課程；同一門課只換班次不能冒充新方案。
4. 新增唯讀 MySQL runner。它直接呼叫正式 `generateSchedule()`，不走推薦曝光寫入路徑；
   learned weights 由既有事件在記憶體重算，不寫回資料庫。
5. 報告只保存匿名 case、候選池 hash、聚合指標與 validator 結果，不保存姓名、學號或完整課表。

## 量測結果

執行：

```bash
npm run bench:plan-diversity --prefix server -- --markdown
```

四個 case 的候選池均為 362 門，hash 均為
`6cb9fe29eb053c88bca3cbeb0613a15022cda453a3b283db594a3a24b1bd379e`。

| Case | requested | distinct | meaningful | retention | median Jaccard | 實際差異 | safety | 結果 |
| --- | ---: | ---: | ---: | ---: | ---: | :---: | :---: | :---: |
| 集中偏好 | 3 | 1 | 1 | 0.3333 | 無比較對象 | 失敗 | 通過 | 失敗 |
| 無偏好對照 | 2 | 1 | 1 | 0.5000 | 無比較對象 | 失敗 | 通過 | 失敗 |
| 挑戰偏好 | 3 | 1 | 1 | 0.3333 | 無比較對象 | 失敗 | 通過 | 失敗 |
| 涼課偏好 | 3 | 2 | 2 | 0.6667 | 0.6667 | 通過 | 通過 | 失敗 |

涼課 persona 證明量測能辨識真正不同的方案：兩個方案各有 10 門競爭課程，共有 8 門相同，
對稱差為 4，Jaccard similarity 為 0.6667。它仍因方案數 2/3、保留率 66.67% 而未通過。

## 影響與結論

- 本次沒有修改排課策略或使用者畫面，正式排課結果不因加入驗收工具而改變。
- 四個 case 的 hard constraint validator 都是 0 violation。
- #10 的現版重測已完成，但驗收結果為 FAIL，因此 roadmap 維持「部分完成」，不能改成完成。
- 後續修復應針對集中、挑戰及較多學分策略為何得到相同課程集合分析；不能降低門檻或只改方案名稱。
- 進度總覽整張表的狀態與相依欄已核對：#27 改為明確區分「已取得所需介面」與「#10
  完整驗收尚未完成」，#10 也已列回目前可直接動工的工程項目；其他任務的狀態與相依不變。

## 測試與驗證

- `node --test server/test/planDiversityAcceptance.test.js`：8 pass / 0 fail。
- 新驗收加相關排課回歸：194 pass / 0 fail。
- 後端完整可退出套件（排除既有 open-handle 的 `interactionEvents.test.js`）：
  1078 pass / 0 fail；模型 golden set 13/13 通過。
- `interactionEvents.test.js` 單獨執行：畫面列出的 39 項斷言全部通過；完成後程序仍因
  既有 open handle 不退出，因此人工終止。本次未修改該模組。
- 真實 MySQL benchmark：正常產出報告；exit code 1 代表驗收未通過，不是 runner 例外。
- 前端 `npm run lint`、`npm run build`：通過。
- `server/src/**/*.js` 與 `server/scripts/**/*.js` 共 97 個檔案語法檢查：通過。
- 未修改使用者可見行為，因此不執行瀏覽器驗收。

## Commit / Push

- 未 commit。
- 未 push。
