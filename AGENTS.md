# AGENTS.md

本文件是給 Codex 使用的專案開發規範。每次在本專案工作前，必須先讀取並遵守此文件。

## 專案概述

本專案是「個人化課表規劃推薦系統」，使用網頁呈現，目標是協助資工系學生依照畢業學分要求、歷史修課紀錄、個人偏好與課程評價產生多個可比較的推薦課表。

## 專案架構

```text
C:/Users/yamat/Agent_project
├── client/                 # React + Vite 前端
├── server/                 # Node.js + Express 後端
├── server/data/            # JSON 檔案式資料庫
├── docs/                   # 正式系統規範
├── report/                 # 專題報告與展示素材
├── package.json            # 根目錄工作區腳本
└── .env.example            # 環境變數範例
```

## 啟動與安裝指令

安裝前後端依賴：

```bash
npm run install:all
```

課程與評價資料一律來自後端 MySQL 資料庫（`server/.env` 的 `DB_*` 設定），不再有種子資料指令。原本的 `npm run seed` 與 `server/src/db/seed.js` 產生的是模擬課程，已於 2026-08-02 移除。

同時啟動前後端：

```bash
npm run dev
```

只啟動前端：

```bash
npm run dev:client
```

只啟動後端：

```bash
npm run dev:server
```

## 驗證指令

前端 build：

```bash
cd client
npm run build
```

前端 lint：

```bash
cd client
npm run lint
```

後端語法檢查：

```bash
cd server
node --check src/app.js
```

若修改多個後端檔案，需對 `server/src/**/*.js` 做語法檢查。

## 前端開發慣例

- 使用 React + Vite。
- API 呼叫集中在 `client/src/services/api.js`。
- 路由集中在 `client/src/App.jsx`。
- 新頁面放在 `client/src/pages/`。
- 共用元件放在 `client/src/components/`。
- 狀態 context 放在 `client/src/contexts/`。
- UI 文字必須使用可讀中文，不得新增亂碼字串。
- 新功能完成後至少執行 `npm run build`。

## 後端開發慣例

- 使用 Express。
- API route 放在 `server/src/routes/`。
- 核心服務放在 `server/src/services/`。
- 排課、課程查詢、評價查詢等工具放在 `server/src/skills/`。
- JSON 檔案式資料庫工具放在 `server/src/db/database.js`。
- 不得把真實 API key 寫入程式或文件。
- 若新增 API，需同步更新 `docs/API_SPEC.md`。
- 若修改資料欄位，需同步更新 `docs/DATA_SCHEMA.md`。

## 排課邏輯開發規範

- 排課邏輯以 `docs/SCHEDULING_LOGIC.md` 為規格來源。
- 修改 `server/src/skills/scheduler.js` 前，必須先確認是否符合學分要求與課程狀態規則。
- `關注` 課程只用於視覺化與比較，不應計入正式衝堂。
- `加選` 課程會佔用時段，同時間不可加選多門課。
- 必修與重補修優先於選修、通識與系外選修。
- 系統應支援多個課表方案，而不是只產出單一結果。

## AI Agent 開發規範

- Agent 行為以 `docs/AI_AGENT_SPEC.md` 與 `docs/PROMPT_DESIGN.md` 為準。
- Agent 不得編造不存在的課程、教師、學分、評價或畢業要求。
- 當資料不足時，Agent 必須明確告知資料不足，並要求使用者補充或改用查詢工具。
- Tool call 格式改動時，必須同步更新 `server/src/services/promptService.js` 與 `docs/PROMPT_DESIGN.md`。

## 不要亂改的內容

- 不要提交 `node_modules/`。
- 不要提交 `.env` 或任何包含真實金鑰的檔案。
- 不要任意重寫 `server/data/*.json`，除非任務明確需要更新測試資料。
- 不要刪除 `report/` 的展示素材。
- 不要修改 GitHub remote，除非使用者明確要求。

## 完成標準

每次開發完成前，至少確認：

- 功能符合相關 `docs/*.md` 規格。
- 前端可 build。
- 後端語法檢查通過。
- `npm test` 全數通過。
- **修改若影響使用者看得到的行為，必須在瀏覽器實際跑過並驗證。**
- API 或資料格式有改動時，文件已同步更新。
- 沒有新增 `.env`、`node_modules/` 或其他不應提交的檔案。

### 瀏覽器驗收是完成的一部分，不是提交前的最後一關

**build 與 lint 通過不等於功能正確，測試通過也不等於。** 只要修改會影響使用者看得到的東西——排課結果、畫面顯示、API 回應內容——就必須把 app 跑起來實際操作過，才能宣告完成。

在說出「已完成」「修好了」之前就要做完，不是等到 commit 時才補。

必要條件：

1. `preview_start` 啟動 `server` 與 `client`（定義於 `.claude/launch.json`）。
2. 操作到**會觸發本次修改的畫面**，不能只確認首頁有載入。
3. **做 A/B 對照。** 只看修好後的結果無法證明因果——要能指出「有此設定」與「無此設定」的差異。
4. 檢查 console 有無新增錯誤。
5. 回報中寫出**跑了哪些畫面與情境**，不能只寫「build 通過」。

實例：`avoid_time` 的修復曾只跑 node 層測試就宣告完成。node 測試無法證明使用者在真實 profile 下的排課結果會改變；實機 A/B 對照（有 `avoid_time` 的使用者第 1 節 0 門、無的 2 門）才是證據。

## Git / GitHub 操作規範

本專案使用共用 ChatGPT / Codex 帳號進行開發，因此不得將個人 GitHub 帳號授權到 ChatGPT / Codex 的 GitHub connector，以避免個人 repository 權限被共用帳號中的其他使用者存取。

### 基本原則

1. 不使用 GitHub connector。
2. 不將 `ert770` GitHub 帳號授權到共用 ChatGPT / Codex 帳號。
3. 所有 GitHub push / pull / commit 操作皆使用本機 Git 與 GitHub CLI 認證。
4. Codex 只允許在本機專案資料夾內操作 Git。
5. push 前必須確認目前資料夾、branch、remote 與 `.gitignore` 狀態。

### 專案路徑

所有 Git 操作必須在以下路徑執行：

```text
C:/Users/yamat/Agent_project
```

### GitHub Repository

本專案對應的 GitHub repository 為：

```text
https://github.com/ert770/course-schedule-planner.git
```

遠端名稱應為：

```text
origin
```

push 目標應為：

```text
origin main
```

### 每次 commit / push 前必須檢查

執行：

```bash
git status
git remote -v
git branch
```

確認結果應符合：

```text
目前路徑：C:/Users/yamat/Agent_project
remote：origin https://github.com/ert770/course-schedule-planner.git
branch：main
```

若 remote 不是上述 repository，必須停止操作，不得 commit 或 push。

### 禁止 commit 的內容

不得將以下內容加入 Git：

```text
node_modules/
.env
.env.local
.env.*.local
dist/
build/
.next/
out/
.DS_Store
Thumbs.db
npm-debug.log*
yarn-debug.log*
yarn-error.log*
pnpm-debug.log*
```

若 `.gitignore` 不存在，必須先建立 `.gitignore` 並加入上述內容，再進行 `git add`。

### 建議的 `.gitignore`

```gitignore
node_modules/
.env
.env.local
.env.*.local

dist/
build/
.next/
out/

.DS_Store
Thumbs.db

npm-debug.log*
yarn-debug.log*
yarn-error.log*
pnpm-debug.log*
```

### 第一次 push 指令

若本機尚未與遠端 `main` 建立追蹤關係，第一次 push 使用：

```bash
git push -u origin main
```

第一次 push 成功後，後續可使用：

```bash
git push
```

### Codex 操作限制

Codex 執行 Git 操作時必須遵守：

1. 不得使用 GitHub connector。
2. 不得嘗試登入、切換或授權任何 GitHub 帳號。
3. 不得修改 GitHub connector 設定。
4. 不得將 remote 改成其他 repository，除非使用者明確要求。
5. 不得 commit `node_modules/` 或任何 `.env` 檔案。
6. push 前必須先顯示或確認 `git status` 與 `git remote -v`。
7. 若遇到權限錯誤、remote 不一致或 branch 不明確，必須停止並回報使用者。

### 推薦 commit 流程

```bash
cd C:/Users/yamat/Agent_project
git status
git remote -v
git branch
git add .
git status
git commit -m "chore: initialize project repository"
git push -u origin main
```

## 專案修改確認與報告規範

每次 Codex 要修改本專案前，必須先向使用者宣告：

1. 預計修改或新增哪些檔案。
2. 每個檔案預計修改或新增哪些內容。
3. 是否會執行測試、commit 或 push。

必須等使用者明確確認後，才可以開始修改檔案。

每次修改完成後，必須新增一份變更報告，放在：

```text
docs/CHANGE_REPORTS/
```

報告內容至少包含：

1. 修改日期。
2. 修改檔案清單。
3. 主要改動內容。
4. 影響範圍。
5. 測試與驗證結果。
6. 是否 commit 與 push。

## Git Commit / Push 說明規範

每次 commit 與 push 的說明必須具備可讀性，不能只使用模糊的一行訊息。

### Commit message 格式

commit message 應使用「清楚標題 + 條列式 body」：

```text
feat: update scheduling engine and workflow rules

- Fix frontend lint issues by splitting context hooks.
- Rewrite scheduling engine based on SCHEDULING_LOGIC.md.
- Connect schedule API and AI Agent scheduler parameters.
- Add UTF-8 editor settings.
- Add change report for lint, scheduling, encoding, and browser tests.
```

標題應簡短描述主要目的，body 應列出該次 commit 的主要修改內容。

### Push 後回報格式

push 完成後，Codex 必須用條列式回報該次 push 的修改內容，至少包含：

1. commit SHA。
2. commit 標題。
3. push 目標。
4. 修改檔案分類。
5. 主要修改內容。
6. 測試與驗證結果。

回報範例：

```text
Push 完成：3a69e8e

本次修改：
- 前端：修正 React lint 與 context hook 結構。
- 後端：重寫排課引擎，支援多方案與關注/已選課程狀態。
- AI Agent：補齊 scheduler 參數與 prompt 規範。
- 文件：新增修改前確認規則與變更報告。
- 測試：lint、build、node --check、browser 測試通過。

Push 目標：
- origin main
```

若本次修改只涉及文件，回報中必須明確寫出「未修改程式邏輯」與「未執行不必要的前後端測試」。
