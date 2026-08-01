---
name: commit-push
description: 依 AGENTS.md 規範執行驗證、commit 與 push，並產出標準回報。當使用者說「commit」「push」「commit&push」「提交」「推上去」，或要求把目前工作成果提交到 git 時使用。
---

# Commit & Push：提交與推送

依 `AGENTS.md` 的「Git / GitHub 操作規範」與「Git Commit / Push 說明規範」執行。

**這個流程的每一步都不可略過。** 專案規則規定了驗證項目，但沒有機制確保它們被執行——本 skill 就是那個機制。

## 步驟 1：推前檢查

```bash
git status --short --untracked-files=all
git remote -v
git branch --show-current
```

**中止條件**——符合任一項就停止，不得 commit 或 push，直接回報原因：

- remote 不是 `https://github.com/ert770/course-schedule-planner.git`
- 有 `node_modules/`、`.env`、`dist/`、`build/`、`*.pem` 進入暫存區
- 工作區沒有任何變更

## 步驟 2：依變更範圍決定驗證項目

先看 diff 再決定跑什麼，不要盲目全跑，也不要盲目全跳過。

| 變更範圍 | 必須執行 |
| --- | --- |
| `server/src/**` | 對所有 `server/src/**/*.js` 跑 `node --check` |
| `server/src/skills/scheduler.js` | **`docs/TEST_PLAN.md` 的 S1-S10 排課測試案例** |
| `client/src/**` | `cd client && npm run build` 與 `npm run lint` |
| 只有 `docs/**` 或 `*.md` | 跳過前後端測試，回報中寫明「未修改程式邏輯」與「未執行不必要的前後端測試」 |

`client/node_modules` 不存在而需要 build 時，先跑 `npm run install:all`。

**任何驗證失敗就停止**，回報失敗內容，不要 commit。

S1-S10 這條特別容易被忽略：`AGENTS.md` 與 `docs/TEST_PLAN.md:81` 都要求「修改排課邏輯至少執行 S1-S10」，但過去曾發生改了 `scheduler.js` 卻沒跑的情況。動到排課邏輯就一定要跑。

## 步驟 3：確認文件同步

依 `AGENTS.md` 與 `docs/PROMPT_DESIGN.md` 的維護規則檢查，缺哪項就先補再提交：

| 改了什麼 | 要同步 |
| --- | --- |
| 新增或修改 API | `docs/API_SPEC.md` |
| 修改資料欄位 | `docs/DATA_SCHEMA.md` |
| 修改 tool call 格式 | `server/src/services/promptService.js` 與 `docs/PROMPT_DESIGN.md` |
| 修改排課邏輯 | 確認符合 `docs/SCHEDULING_LOGIC.md` |
| 本次修改 | `docs/CHANGE_REPORTS/` 有對應報告，且 `README.md` 索引已更新（從新到舊） |

## 步驟 4：Commit

「清楚標題 + 條列式 body」，英文撰寫，標題用 conventional commit 前綴（`feat:` / `fix:` / `docs:` / `chore:` / `refactor:`）。

body 每行一個實質改動，描述**做了什麼**而非改了哪個檔案。

結尾必須加：

```text
Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

## 步驟 5：Push

**推目前所在的分支，不要推 main。**

`AGENTS.md` 寫的 `origin main` 是假設直接在主資料夾的 main 上工作。在 worktree 的功能分支上時推分支本身，尚未設定上游則用 `git push -u origin <目前分支>`。

若目前分支就是 `main`，先停下來問使用者是否確定要直接推 main。

## 步驟 6：回報

依 `AGENTS.md` 的「Push 後回報格式」輸出：

```text
Push 完成：<commit SHA>

本次修改：
- 前端：...
- 後端：...
- AI Agent：...
- 文件：...
- 測試：...

Push 目標：
- origin <分支名>
```

沒有內容的分類直接省略該行，不要寫「無」。

推的不是 main 時，要說明推的是哪個分支、為什麼不是 main，並附上 PR 連結。

**有驗證未通過或刻意跳過的項目，必須如實寫出，不得省略。**
