# 2026-08-01 新增 commit-push 提交流程 skill

## 修改日期

2026-08-01

## 修改檔案清單

- `.claude/skills/commit-push/SKILL.md`（新增）

## 主要改動內容

新增專案層自訂 skill `commit-push`，把 `AGENTS.md` 的「Git / GitHub 操作規範」與「Git Commit / Push 說明規範」固化成可重複執行的流程：

1. 推前檢查（`git status` / `git remote -v` / `git branch`），remote 不符或有 `node_modules`、`.env`、`dist/`、`build/`、`*.pem` 即中止。
2. **依變更範圍決定驗證項目**，不盲目全跑也不盲目全跳過。動到 `server/src/skills/scheduler.js` 時強制執行 `docs/TEST_PLAN.md` 的 S1-S10。
3. 文件同步檢查（`API_SPEC` / `DATA_SCHEMA` / `PROMPT_DESIGN` / 變更報告索引）。
4. 條列式 commit message 加 `Co-Authored-By`。
5. 推目前分支而非 main；若當前分支為 main 則先詢問使用者。
6. `AGENTS.md` 的標準 push 回報格式，未通過或刻意跳過的驗證必須如實寫出。

### 動機

`AGENTS.md` 與 `docs/TEST_PLAN.md:81` 都要求「修改排課邏輯至少執行 S1-S10」，但沒有任何機制確保它被執行。實際上在 `#1`（方案排序修正）提交時就漏跑了，直到對抗式審查後才補做。本 skill 即為該機制。

### 路徑慣例

本桌面版 app 的自訂指令路徑為 `.claude/skills/<名稱>/SKILL.md`（每個指令一個資料夾，檔名固定 `SKILL.md`，frontmatter 需含 `name` 與 `description`）。

`.claude/commands/<名稱>.md` 是 Claude Code CLI 的慣例，在此不會被載入。初次建立時曾放錯位置導致指令無法使用。

### 命名

初版名為 `ship`，同日改為 `commit-push` 以符合實際用途。

使用者原本要求命名為 `commit&push`，但 `&` 在 slash 指令解析與目錄名稱上皆有風險（shell 需跳脫、指令解析器可能截斷），故實際名稱採用 `commit-push`。

這不影響使用：`description` 已將「commit&push」列為觸發語，直接以自然語言輸入 `commit&push` 仍會啟動同一流程。

## 影響範圍

- 僅影響開發流程，不影響任何執行期程式碼。
- 前端、後端、API、資料格式皆未變動。
- `description` 中列出觸發語（commit、push、提交、推上去），因此自然語言請求也會套用同一流程。

## 測試與驗證結果

- 未修改程式邏輯，未執行不必要的前後端測試。
- skill 註冊狀態：已確認 `ship` 出現在可用 skill 清單中。

## 是否 commit 與 push

- 已 commit。
- 已 push 至 `origin claude/personalized-schedule-algorithm-6324a3`。
