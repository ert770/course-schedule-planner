# 2026-08-01 PR #1 稽核與自動化測試

## 修改日期

2026-08-01

## 背景

合併 PR #1 前對全部 42 個檔案做一次稽核，確認變更是否都與「個人化排課演算法」有關、是否有誤改或重複檔案，並執行專案現有的檢查指令。

## 修改檔案清單

- `.agents/skills/commit-push/SKILL.md`（刪除）
- `docs/CHANGE_REPORTS/README.md`
- `server/package.json`
- `package.json`
- `server/src/skills/reviewStats.js`
- `server/test/fixtures.js`（新增）
- `server/test/scheduler.test.js`（新增）
- `server/test/constraints.test.js`（新增）
- `server/test/reviewStats.test.js`（新增）
- `server/test/prompt.test.js`（新增）
- `docs/TEST_PLAN.md`

## 稽核發現與處置

### 1. 重複且失效的 skill 檔案（已刪除）

`.agents/skills/commit-push/SKILL.md` 是 `.claude/skills/commit-push/SKILL.md` 的近乎相同副本，唯二差異：

| | `.claude` 版 | `.agents` 版 |
| --- | --- | --- |
| 路徑引用 | `.claude/launch.json` | `.Codex/launch.json` |
| 署名 | Claude Opus 5 | Codex Opus 5 |

`.Codex/launch.json` 在本 repo 中**不存在**，且全專案沒有任何文件說明 `.agents/` 慣例。判定為失效副本並刪除。

### 2. 兩份變更報告漏登索引（已補上）

`2026-08-01-fix-course-reviews-d1.md` 與 `2026-08-01-department-mapping-confirmation.md` 存在但未列入 `docs/CHANGE_REPORTS/README.md`，違反 `2026-06-08-change-report-index-order.md` 的索引規則。

### 3. 檢查通過的項目

- 無 `.env`、`.pem` 或任何金鑰進入版控。
- 無 `node_modules/`、`dist/`、`build/` 等建置產物。
- 無暫存腳本殘留。
- `server/data/*.json` **完全未改動**，符合 `AGENTS.md:121`。
- 校對規則處理已統一為 `BINARY`，`getMysqlCourses()` 與 `getMysqlReviews()` 兩處一致。

### 4. 專案缺少自動化測試（已補上）

稽核 `package.json` 後確認：

| | lint | build | test |
| --- | --- | --- | --- |
| 根目錄 | 無 | 無 | 無 |
| client | `eslint .` | `vite build` | 無 |
| server | 無 | 無 | 無 |

`docs/TEST_PLAN.md` 列出 S1-S17、M1-M4、W1-W3、U1-U4、P1-P3 共 30 餘個案例，但**全部是人工項目**。先前所有驗證都是跑完即刪的臨時腳本，沒有任何機制阻止回歸。

## 新增的自動化測試

使用 Node 內建的 `node:test`，**不新增任何依賴**。

| 檔案 | 涵蓋案例 |
| --- | --- |
| `server/test/scheduler.test.js` | S1-S4、S5/S6（資料缺漏警告）、S7-S10、S13-S14、M1-M4、W1-W2、U1-U4 |
| `server/test/constraints.test.js` | S11、S12、S15，以及布林型合併與本次操作狀態的語意 |
| `server/test/reviewStats.test.js` | 評價加權：評論數加總、平均加權、情緒加權、缺值處理 |
| `server/test/prompt.test.js` | P1-P3：28 個排課參數、6 個工具、偏好摘要 |
| `server/test/fixtures.js` | 課程與評價的測試建構器 |

**設計決定：測試不連資料庫。** 排課邏輯是純函式，用合成資料才能穩定重現邊界情境，也讓測試在沒有 `.env` 與 MySQL 連線的環境仍可執行。

`P1` 的參數清單刻意寫死在測試中，`agentService` 新增排課參數卻沒同步 `promptService` 時測試會失敗——這正是先前發生過的漏同步。

## 新增的指令

根目錄 `package.json`：

```json
"test": "cd server && npm test",
"lint": "cd client && npm run lint",
"build": "cd client && npm run build",
"verify": "npm run lint && npm run build && npm test"
```

`server/package.json`：

```json
"test": "node --test \"test/**/*.test.js\""
```

## 測試抓到的實際缺陷

`weightedAverageScore()` 的缺值判斷有誤：

```js
const value = Number(review[field]);
if (!Number.isFinite(value)) return null;
```

`Number(null)` 是 `0` 且為有限數，因此**缺值的評分會被當成「0 分」計入平均並拉低結果**。已改為先擋掉 `null`、`undefined` 與空字串再轉數字。

資料庫目前五個評分欄位皆無空值，因此線上尚未觸發，屬潛在缺陷。

## 測試與驗證結果

| 指令 | 結果 |
| --- | --- |
| `npm run lint` | 通過，無錯誤與警告 |
| `npm run build` | 通過 |
| `npm test` | **74 項全數通過** |
| `npm run verify` | 通過 |
| `node --check` 對 `server/src/**/*.js` | 22 檔全數通過 |

刪除 `.agents/` 後重跑上述全部指令，無回歸。

## 是否 commit 與 push

- 已 commit 並 push 至 `origin claude/personalized-schedule-algorithm-6324a3`。
