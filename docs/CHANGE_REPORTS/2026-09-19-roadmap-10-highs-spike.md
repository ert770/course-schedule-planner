# 2026-09-19 Roadmap #10 任務 1：HiGHS 求解器 spike

## 修改日期

2026-09-19

## 背景

roadmap #10 的多方案改寫拆成四個任務，本報告屬於任務 1（多方案核心，依據 Petit & Trapp 2015，並以 Hebrard 2005、Trapp & Konrad 2015 補充）。

設計審查的結論有兩點：
- 替代方案改用 MILP 求解器 HiGHS，搭配 Dinkelbach 法。
- 綜合平衡方案 S₀ 保留現行 greedy。P&T 允許起點不是最佳解，所以這樣做成立。

正式改寫前，要先用真實候選池確認基本模型的速度、求解狀態，以及結果能否通過現有的 validator。本次只做這個隔離實驗，沒有接進正式排課流程。

## 修改檔案

### 後端

- `server/package.json`、`server/package-lock.json`
  - 新增 `highs` 1.15.3，鎖定精確版本。
  - 這個套件是第三方的 highs-js 包裝，MIT 授權，沒有 runtime 依賴；求解核心 HiGHS 由愛丁堡大學團隊開發。
- `server/src/skills/scheduler.js`
  - 新增 opt-in 的 `runtimeOptions.includeMipInputs`。
  - 開啟時，擷取「固定課程排完、貪婪填充開始前」的候選與狀態，並以不可列舉屬性掛在結果上。
  - 預設不開啟，正式行為與 API 回應都不變。
- `server/src/skills/optimization/highsRuntime.js`（新增）
  - WASM 只載入一次。
  - 把求解狀態對應成 `optimal`／`feasible-time-limit`／`infeasible`／`solver-error`。
  - 每個 model 求解後在 `finally` 裡 dispose。
- `server/src/skills/optimization/scheduleMipModel.js`（新增）：MILP 基本模型。
- `server/scripts/highsSpike.js`（新增）：只讀資料的量測 runner。
- `server/scripts/lib/demoCaseLoader.js`（新增）
  - 從 `planDiversityAcceptanceReport.js` 抽出 demo persona 的載入函式，兩支 runner 共用同一份。
  - 抽出時邏輯沒有改動。
- `server/test/scheduleMipModel.test.js`（新增）：7 個合成案例。
- `server/test/reports/highs-spike-latest.json`（新增量測報告）

## 模型內容

採用設計審查的兩層變數：
- `s_j`：是否選擇班次 j。
- `z_k`：是否選擇課號 k。
- 兩者的關係：`Σ_{j∈k} s_j = z_k`。

限制條件：
- **衝堂**：每個（星期, 節次）時段一條限制，`Σ s_j ≤ 1`，可以正確處理多時段課程。
- **學分**：總學分介於上下限之間，固定課的學分移到右側常數。
- **每日課數**：每天的課程數不超過上限。
- **共同必修**：`z正課 = z實習`。
- **同系列**：同一系列的課號 `Σ z ≤ 1`，明確指定的課豁免。

固定課程沿用 S₀ 已排入的班次。候選課先用正式的 `evaluateCoursePlacement()`，對「只排了固定課」的狀態做靜態檢查，所以規則只有一份，沒有另外實作。

目標函數只用 greedy 在同一狀態下的逐課分數，這是 spike 用來量測的簡化版本，不是正式的方案目標。

## 量測結果

執行指令：`node scripts/highsSpike.js --markdown`。環境為 Node v24.14.1，每個 case 做 20 次 warm solve。WASM 冷啟動約 27 ms。

| case | 班次／課號變數 | 限制 | nonzero | 狀態 | gap | p50 | p95 | 重跑一致 | validator |
| --- | ---: | ---: | ---: | --- | ---: | ---: | ---: | :---: | :---: |
| persona-compact | 298／218 | 286 | 2078 | optimal | 0 | 19.8 ms | 34.1 ms | ✓ | 0 violation |
| 無偏好對照 | 298／218 | 286 | 2078 | optimal | 0 | 15.8 ms | 19.8 ms | ✓ | 0 violation |
| persona-challenge | 324／225 | 301 | 2241 | optimal | 0 | 21.6 ms | 23.0 ms | ✓ | 0 violation |
| persona-easy | 328／222 | 297 | 2262 | optimal | 0 | 22.2 ms | 26.2 ms | ✓ | 0 violation |

**結論是 GO**，四項標準全部通過：
- 全部回傳 optimal。
- validator 沒有任何違規。
- p95 最高 34 ms，遠低於 200 ms 的預算。
- 同一輸入重跑的結果一致。

建模時間 1～3.5 ms，LP 文字約 25 KB。RSS 只有第一次成長 37 MB（WASM heap 擴張），之後每次都在 10 MB 以內。

## 下一份設計要處理的發現

### 1. greedy 的分數只負責「排順序」，不代表「值不值得選」

- S₀ 會把學分一路填到 25 學分上限。後段選入的課扣除本系優先階層的懲罰後，靜態分數是負的，所以 S₀ 填充課的分數總和約為 −10,000。
- 基本模型以「分數總和最大」為目標，只要達到 9 學分下限就停，結果只排了 10～11 學分。
- 因此，正式模型必須明確寫出「在上限內排滿」這條產品語意。可以把學分目標寫成限制條件，或用字典序目標（先比學分，再比品質）。
- 也證實了設計審查的顧慮：U(S₀) ≤ 0 的情況真的會發生，品質尺度一定要用 `max(|U(S₀)|, MIN)`。

### 2. 同樣學分下，MILP 明顯優於 greedy

限制學分不少於 S₀ 之後，四個 case 仍然全部是 optimal，validator 也都是 0 violation。

| case | S₀ 分數 | MILP 分數 | 相對 S₀ 移除／加入的課號 |
| --- | ---: | ---: | ---: |
| persona-compact | −10,814 | −6,690 | 6／5 |
| 無偏好對照 | −11,620 | −7,500 | 5／4 |
| persona-challenge | −9,486 | −5,568 | 3／2 |
| persona-easy | −10,144.5 | −6,274.7 | 3／2 |

這個比較有一個限制：這裡的分數是「貪婪填充開始時」的靜態分數。greedy 實際選課時，集中度這一項會隨已選的課逐步改變，這個比較沒有算進去。所以結果只能說明「在同一套靜態分數下，MILP 找到更好的組合」，不能說 greedy 產出的課表整體比較差。

## 影響範圍

- 正式排課、API、前端與 schema 都沒有改動。`includeMipInputs` 只有 spike 會開啟。
- 新增一個執行時依賴 `highs`。套件的 `solve()` 是同步執行，會阻塞 event loop；正式接入多人使用時，要改到 `worker_threads` 執行，這已列入下一份計畫。
- `planDiversityAcceptanceReport.js` 只換成共用的載入模組，行為相同。重構後實際執行一次 bench 確認能正常跑完，這次執行也更新了該 bench 的報告檔。

## 測試與驗證

- `node --test test/scheduleMipModel.test.js`：7 pass / 0 fail。
  - 涵蓋同時段取高分、同課只選一個班次、greedy 會選錯的組合、學分上下限、共同必修、同系列豁免，以及與固定課衝突的候選會在建模前排除。
- 後端全套測試：1116 個測試中 1113 pass。失敗的 3 個是已知的 Windows libuv 檔案層級問題（authRoutes、privacyRoutes、scheduleRoutes），與本次改動無關。
- 這次改動使用者看不到，因此不做瀏覽器驗證。

## 是否 commit 與 push

否，依使用者規則只回報，等使用者指示。
