# 10 測試、執行與部署

> 最後更新：2026-09-08
> 完整測試案例清單見 `docs/TEST_PLAN.md`（1093 行）。

## 本機環境需求

| 項目 | 需求 |
| --- | --- |
| Node.js | 支援 ESM 與 `node:test`（CI 使用的版本見 `.github/workflows/ci.yml`） |
| 資料庫 | 共用 MySQL（Aiven）；無 `.env` 時課程／評價功能不可用 |
| 套件管理 | npm（`package-lock.json` 已納入版控，CI 用 `npm ci`） |

## 啟動方式

```bash
# 安裝（前後端）
npm run install:all

# 後端（port 3001）
cd server && npm run dev      # node --watch src/app.js

# 前端（port 5173）
cd client && npm run dev      # vite
```

開發時亦可用 `.claude/launch.json` 定義的兩個設定（`server`、`client`）。

## npm scripts（`server/package.json`）

| 指令 | 用途 |
| --- | --- |
| `npm run dev` | `node --watch src/app.js` |
| `npm start` | `node src/app.js` |
| `npm test` | `node --test "test/**/*.test.js"` |
| `npm run migrate:profile` | migration 001 |
| `npm run migrate:privacy` | migration 002 |
| `npm run migrate:interactions` | migration 003 |
| `npm run migrate:course-history` | migration 004 |
| `npm run migrate:admission-year` | migration 005 |
| `npm run migrate:learned-weights` | migration 006 |
| `npm run seed:demo-personas` | 匯入 demo persona 資料 |
| `npm run bench:personalization` | 個人化 baseline／五軸 sweep |
| `npm run bench:scheduler` | 排課 benchmark |
| `npm run eval:golden-set` | Agent 理解成績單 |
| `npm run configure:privacy` | 隱私環境設定 |
| `npm run cleanup:privacy` | 保存期限清理 |
| `npm run cleanup:legacy-chat` | 舊聊天清理 |

## Migration

| 編號 | 檔案 | 內容 |
| --- | --- | --- |
| 001 | `001_profile_schema_v1` | `User_Profiles` 加 `student_id`／`class_name`／`profile_schema_version` |
| 002 | `002_privacy-foundation` | 5 張隱私表 |
| 003 | `003_interaction-events` | `Interaction_Events` |
| 004 | `004_course-history-v1` | `User_Course_History`（經 runner `RENAME TABLE`） |
| 005 | `005_admission-year` | `User_Profiles.admission_year` |
| 006 | `006_learned-preference-weights` | `Learned_Preference_Weights` |

每個 migration 都有 `.up.sql` / `.down.sql` 與獨立 runner script，
runner 內含**前置條件檢查**（例如 003 要求 `Privacy_Subject_State` 已存在）
與**部分套用拒絕**（001 要求三個欄位同時缺席才執行）。

## 測試盤點

**測試檔案 56 個，`npm test` 目前 1046 個測試全數通過**（實測）。
測試框架為 Node.js 內建 `node:test`，**沒有 Jest／Vitest／Mocha**。

| 類別 | 代表檔案 | 案例代號 | 涵蓋 |
| --- | --- | --- | --- |
| 排課引擎 | `scheduler.test.js` | S1-S17、N1-N15、X1-X18、Z1-Z7 | 衝堂、必修優先、重補修、時段偏好、放寬階梯、solver 四態、共修原子性、可重現性 |
| 排課 benchmark | `schedulerBenchmark.test.js` | SB（12 則） | 五類情境跨科系題庫 |
| 驗證器 | `scheduler.test.js` 的 X 系列 | X5-X18 | 獨立驗證、`unchecked` 清單、每日上限 |
| 評分 policy | `scoringPolicy.test.js`、`planStrategies.test.js` | PS1-PS6 | 權重邊界、方向反轉、動態策略數 |
| 偏好學習 | `preferenceLearning.test.js` | PL1-PL30 | 可重播、弱訊號 cap、衰減、單調性、`axisSignal` |
| 偏好學習服務 | `preferenceLearningService.test.js` | PL7、PL18-21、PL25-27 | 隱私路徑、重設、四態來源、過期判定 |
| 個人化 baseline | `personalizationBaseline.test.js`、`personalizationMetrics.test.js` | PB0-PB14、PN1-PN8 | B0/B1/P、五軸方向檢查、量測純函式 |
| **Agent（呼叫真實模型）** | `agentGoldenSet.test.js` | golden set 13+2 題 | 意圖理解、澄清／拒絕、tool schema 硬閘門 |
| Agent 工具 | `agentTools.test.js`、`agentToolRegistry.test.js` | — | 工具執行、allowlist 一致性 |
| 忠實度 | `explanationFaithfulness.test.js` | F1-F24b | 24+ 情境，含捏造偵測、同名班次、工具終態 |
| Prompt | `prompt.test.js` | P1-P9 | 參數同步、prompt 邊界 |
| 需求閘門 | `requirementGate.test.js`、`requirementPreflight.test.js` | RP 系列 | 矛盾偵測、永久寫入確認 |
| 隱私 | `privacyService.test.js`、`privacyRoutes.test.js`、`privacyPolicy.test.js` | PL22-PL23 等 | consent、刪除、匯出、撤回連帶刪除 |
| 身分隔離 | `accountIsolation.test.js`、`identity.test.js`、`authRoutes.test.js` | AC 系列 | 401／403、雙帳號無交叉 |
| 互動事件 | `interactionEventSchema.test.js`、`interactionEvents.test.js` | — | schema、idempotency、provenance |
| **真實 MySQL 契約** | `database-contract.test.js`、`courseHistoryDatabase.test.js`、`databaseProfileContract.test.js` | — | 對真實資料庫的欄位契約 |
| 並行 | `rateLimiter.test.js`、`ttlCache`（TC1-TC5） | TC1-TC5 | TTL 快取競態、rate limiting |
| 畢業規則 | `graduation.test.js`、`graduationAttribution.test.js`、`graduationRuleVersions.test.js` | — | 版本化規則、逐門認列 |

### 不是 hermetic 的測試

| 測試 | 外部相依 | 風險 |
| --- | --- | --- |
| `agentGoldenSet.test.js` | **真實 OpenAI API** | 消耗額度；**已知間歇性失敗**（`no-invented-constraints` case 在本專案歷史上多次偶發失敗，重跑即過） |
| `database-contract.test.js` 等 | **真實 MySQL** | 資料庫不可用時失敗 |

### 測試缺口

| 缺口 | 說明 |
| --- | --- |
| **前端測試 0 個** | `client/src` 下沒有任何 `.test.*`／`.spec.*` 檔案 |
| **E2E／瀏覽器自動化 0 個** | 沒有 Playwright／Cypress；瀏覽器驗收全靠人工（由 `commit-push` 流程強制） |
| API 層整合測試 | 有 `authRoutes`／`scheduleRoutes`／`privacyRoutes` 等，但非全部路由 |
| 負載／效能測試 | 無 |

## CI/CD

`.github/workflows/ci.yml`，兩個 job：

| Job | 步驟 |
| --- | --- |
| **Frontend lint and build** | `npm ci` → `npm run lint` → `npm run build` |
| **Backend tests and syntax** | `npm ci` → `npm test` → 對所有 `server/src/**/*.js` 跑 `node --check` |

**沒有 CD**（無自動部署）。

## 環境變數

> **只列名稱，不含任何值。**

| 變數 | 用途 |
| --- | --- |
| `PORT` | 後端埠號 |
| `NODE_ENV` | 執行環境 |
| `CLIENT_ORIGIN` | CORS 允許來源 |
| `DATA_DIR` | JSON 後備資料目錄 |
| `DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASSWORD` / `DB_NAME` | MySQL 連線 |
| `DB_SSL_CA_PATH` | MySQL SSL CA 憑證路徑 |
| `DB_CONNECTION_LIMIT` | 連線池上限 |
| `OPENAI_API_KEY` | Agent 模型金鑰 |
| `OPENAI_MODEL` | 模型 id（預設 `gpt-5.6-luna`） |
| `AGENT_MAX_STEPS` | tool loop 步數上限（夾在 20 以內） |
| `SESSION_SECRET` | session cookie 簽名金鑰 |
| `PRIVACY_DATA_KEY_V` | 假名化／加密金鑰 |
| `PRIVACY_ENFORCEMENT_ENABLED` | 隱私強制執行開關 |
| `PRIVACY_STORE` | 隱私資料儲存模式 |
| `ACTIVE_ACADEMIC_YEAR` / `ACTIVE_SEMESTER` | 覆寫當前學年學期（換學期不必改程式） |
| `REVIEWS_CACHE_TTL_MS` | 評價快取 TTL（預設 60000） |
| `GEMINI_API_KEY` | **未使用**（`@google/genai` 仍在依賴中，但 Agent 已改用 OpenAI） |

**Secret 管理原則**：`.env` 不進版控；`commit-push` 流程明訂
`.env`／`node_modules`／`dist` 進入暫存區即中止提交。

## 無 `.env` 時的行為

| 功能 | 行為 |
| --- | --- |
| 後端啟動 | ✅ 正常（退回 `server/data/*.json`） |
| 課程／評價查詢 | ❌ `assertMysqlAvailable()` 擋下 |
| Profile | ⚠️ 僅 `users.json` 後備 |
| AI 聊天 | ⚠️ 回「伺服器未設定 OPENAI_API_KEY」（預期行為，非故障） |
| Session | ⚠️ 使用暫時密鑰，重啟後所有登入失效 |

## 資料庫連線設定

`server/src/db/mysql.js`：連線池、SSL（`DB_SSL_CA_PATH`）、
**`timezone: 'Z'`**——所有 `DATETIME`／`TIMESTAMP` 欄位一律以 UTC 讀寫
（該檔案有長註解說明，roadmap #28 曾因時區導致刪除功能全部失敗）。

## 正式部署

**尚未部署**。roadmap `#39`「架設正式網站與 Production rollout」為 ⬜ 未開始，
卡在「選哪個部署平台」這個人的決定，不是程式相依。
需要的項目已列出：平台 secret store、`NODE_ENV=production`、`CLIENT_ORIGIN`、
Secure cookie、health check、deploy 前 migration、回滾流程、備份、監控。
