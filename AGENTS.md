# AGENTS.md

本文件是給 Codex 使用的專案開發規範。每次在本專案工作前，必須先讀取並遵守此文件。

## 專案概述

本專案是「個人化課表規劃推薦系統」，使用網頁呈現，目標是協助資工系學生依照畢業學分要求、歷史修課紀錄、個人偏好與課程評價產生多個可比較的推薦課表。

## 專案架構

```text
C:/Users/yamat/Agent_project
├── client/                 # React + Vite 前端
├── server/                 # Node.js + Express 後端
├── server/data/            # 以 MySQL 為主；未設定 MySQL 或測試時的 JSON 後備資料
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
- 資料庫存取層（以 MySQL 為主，JSON 為後備）放在 `server/src/db/database.js`。
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
- **推進 roadmap 任務時，`docs/CHANGE_REPORTS/2026-08-01-personalization-roadmap.md`
  進度總覽表的「狀態」與「相依」兩欄已核對過整張表**——不是只改動到的那一列。
  完成一項任務會讓下游任務的相依過期，而那時沒人在做下游，也就沒人會發現；
  被誤記為卡住的任務不會有人去碰，等於白白擱置。細節見該文件的〈文件性質〉。
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
origin backend
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
branch：backend
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

若本機尚未與遠端 `backend` 建立追蹤關係，第一次 push 使用：

```bash
git push -u origin backend
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
git push -u origin backend
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
- origin backend
```

若本次修改只涉及文件，回報中必須明確寫出「未修改程式邏輯」與「未執行不必要的前後端測試」。

## 跨 Agent 共用記憶（om）

Claude Code 與 Codex 共用同一份記憶。記憶存在使用者本機的 Obsidian vault（obsidian-mind），不在本 repo 內，
透過名為 `om` 的 MCP server 讀寫。兩個 agent 寫進去的內容，另一個 agent 與之後的 session 都讀得到。

### 何時讀

每個 session 開始工作時呼叫**一次** `recall`（不帶參數），取得這個專案看得到的全部記憶。同一個 session 內不要再做第二次完整的 `recall`：
它每次都回傳全部記憶的全文，重複呼叫只會重複花費 token。

在以下動作**之前**要再確認一次相關記錄。先看開工時那次 `recall` 的結果是否已經涵蓋；需要再查時，
用帶 `query` 與 `limit`（5 以內）的 `recall`，或用 `search`，只取跟這個動作有關的幾則：

- 修改 `server/src/skills/scheduler.js` 或多方案（roadmap #10）相關邏輯。
- 撰寫引用論文方法的實作計畫。
- commit、push、開 PR。
- 宣告「已完成」任何使用者看得到的修改。
- 依賴共用 MySQL 的資料表欄位。

把查到的內容寫進動工前的宣告或計畫：引用了哪幾則記憶、有沒有與做法相反的記錄；查不到就明寫「記憶中沒有相關記錄」。

各工具的用途：

- `recall`：這個專案看得到的規則與教訓。先用這個。
- `search`：搜尋 vault 筆記。需要使用者本機裝有 QMD，沒裝時會直接失敗，失敗不代表沒有記錄。
- `expand`：已知某則筆記時，查它連到哪些筆記、被哪些筆記連到。
- `health`：應該有的東西查不到時，用來分辨是沒記錄還是連線有問題。
- `reason`：會另外啟動一個 Claude session 讀 vault，費用高。使用者明確要求時才用，不可主動呼叫。

寫入時也要控制長度：`remember` 只放規則與教訓本身，寫得精簡，因為它會在每次開工時被整則讀出；
過程、細節與佐證放 `record_work`，那些只有被搜尋到時才會讀取。

### 何時寫

發生以下事件時當下就寫，不要留到工作結束：

- 使用者糾正做法，或確認了一個不明顯的做法 → `remember`。
- 發現一個花了時間才找到的限制或陷阱 → `remember`。
- 做了設計決定，尤其是否決了某個替代方案 → `record_work`，`kind: "decision"`。
- 完成一項工作 → `record_work`，寫明改了什麼、怎麼驗證、還有什麼沒處理。
- 新增或大幅修改 roadmap → `record_work`，`kind: "decision"`，記下 roadmap 檔案在 repo 內的相對路徑、目標、排序理由與被否決的方向。不複製全文。
- 使用者提出新的任務或設計構想 → 當下就用 `record_work` 記下。尚未決定的要在標題與內文標明「構想，尚未決定」，其他 agent 不得把它當成定案實作。
- 一個 session 結束或工作告一段落 → `record_work`，寫明完成了什麼、怎麼驗證、卡在哪、下一步是什麼，讓接手的 agent 不必重新摸索。

roadmap 的即時進度（哪一項進行中、哪一項被卡住）以 repo 內的 roadmap 檔為準，om 不重複記錄，避免兩份內容不一致。

呼叫 `record_work` 時一律帶 `folder: "work/active/agent_project"`。不帶的話會被歸到 vault 的收件匣，那裡不在 `om` 開放的範圍內，其他 agent 讀不到。

`recall` 只會回傳 `remember` 寫的記憶，不包含 `record_work` 寫的記錄。要找回 `record_work` 的記錄得靠 `search`，
而 `search` 需要使用者本機的 QMD。所以開工時除了 `recall`，還要用 `search` 查這次任務相關的工作記錄與構想。
`search` 失敗或回傳「search unavailable」時，不代表沒有記錄：要告訴使用者「工作記錄目前查不到」，不可假裝已經讀過或已經交接。

`remember` 的範圍：只適用本專案的用 `scope: "project"`、`projects: ["agent_project"]`；
使用者個人的工作習慣（換專案仍成立）才用 `scope: "general"`。`confidence` 照實填：查證過填 `verified` 並附 `verification`，
推論的填 `inferred`，聽來未查證的填 `unverified`。記錄有錯時用 `supersedes` 重新寫一則，不要直接改 vault 內的檔案。

### 限制

- 記憶內容不得編造；會隨時間改變的事實要寫明「截至哪一天」。
- 不得把 session 網址或 vault 的本機絕對路徑寫進本 repo 的檔案、commit 訊息或 PR。
- 本節規則與記憶內容衝突時，以本文件與 `docs/*.md` 為準，並用 `supersedes` 更正該則記憶。
- session 內沒有 `om` 工具時，要告訴使用者，不可假裝已讀取或已寫入。
