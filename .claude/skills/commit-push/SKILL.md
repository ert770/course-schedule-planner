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
| `client/src/**` | `npm run build`、`npm run lint`，**以及實際跑起來在瀏覽器驗收** |
| 任何影響使用者可見行為的修改 | **實際跑起來在瀏覽器驗收** |
| 只有 `docs/**` 或 `*.md` | 跳過前後端測試，回報中寫明「未修改程式邏輯」與「未執行不必要的前後端測試」 |

`client/node_modules` 不存在而需要 build 時，先跑 `npm run install:all`。

**任何驗證失敗就停止**，回報失敗內容，不要 commit。

S1-S10 這條特別容易被忽略：`AGENTS.md` 與 `docs/TEST_PLAN.md:81` 都要求「修改排課邏輯至少執行 S1-S10」，但過去曾發生改了 `scheduler.js` 卻沒跑的情況。動到排課邏輯就一定要跑。

### 瀏覽器驗收（不可略過）

**這一步應該在宣告「已完成」時就做完，而不是拖到 commit 才補。** 見 `AGENTS.md` 的「完成標準」。到了這裡若還沒做過，代表先前的「已完成」是誤報，現在補做並在回報中說明。

**build、lint 與 `npm test` 通過都不等於功能正確。** 只要修改會影響使用者看得到的東西，就必須把 app 跑起來實際操作。

**必須做 A/B 對照。** 只看修好後的結果無法證明因果——要能指出「有此設定」與「無此設定」的差異。例如 `avoid_time` 的驗收不是「第 1 節沒有課」，而是「有 `avoid_time` 的使用者 0 門、沒有的 2 門」。

流程：

1. `preview_start` 啟動 `server`（port 3001）與 `client`（port 5173）兩個設定，定義於 `.claude/launch.json`。
2. 用 demo 帳號登入：學號 `D1249697`、密碼 `123`（來源 `server/data/users.json`）。
3. **操作到會觸發本次修改的畫面**，不能只確認首頁有載入。
4. **截圖並實際看過**。空白畫面等於啟動失敗。
5. 用 `read_console_messages` 確認沒有新的 console 錯誤。

**同時驗證正常路徑與失敗路徑。** 只看成功情境會漏掉整類問題——例如排課提示曾發生「後端把 `warnings[0]` 當作 `message`，前端兩處都渲染導致訊息重複」，build、lint 與單元層級驗證全部通過，只有實際跑起來才看得出來。

沒有 `.env` 時後端會自動退回 `server/data/*.json`，可正常啟動；但 AI 聊天會回傳「伺服器未設定 OPENAI_API_KEY」，這是預期行為，不是故障。

驗收結果要寫進回報的「測試」欄位，包含**跑了哪些畫面與情境**，不能只寫「build 通過」。

## 步驟 3：確認文件同步

依 `AGENTS.md` 與 `docs/PROMPT_DESIGN.md` 的維護規則檢查，缺哪項就先補再提交：

| 改了什麼 | 要同步 |
| --- | --- |
| 新增或修改 API | `docs/API_SPEC.md` |
| 修改資料欄位 | `docs/DATA_SCHEMA.md` |
| 修改 tool call 格式 | `server/src/services/promptService.js` 與 `docs/PROMPT_DESIGN.md` |
| 修改排課邏輯 | 確認符合 `docs/SCHEDULING_LOGIC.md` |
| 本次修改 | `docs/CHANGE_REPORTS/` 有對應報告，且 `README.md` 索引已更新（從新到舊） |
| **任何推進 roadmap 任務的修改** | **`2026-08-01-personalization-roadmap.md` 進度總覽表的「狀態」與「相依」兩欄，見下方** |

### roadmap 的「狀態」與「相依」兩欄（不可略過）

**核對整張表，不是只改你剛動到的那一列。**

理由是具體的：完成任務 A 會讓「相依 A」的 B、C、D 一起過期，而那時候沒有人在做
B、C、D，也就沒有人會發現。2026-08-31 核對時實際抓到**五項**（`#10`、`#26`、`#34`、
`#35`、`#28`）的前置相依早已全部完成卻仍被記成卡住，其中 `#10`、`#26` 的內文還寫著
「仍卡 #21、#22」——那兩項分別在 08-29、08-30 就完成了。**被誤記為卡住的任務不會有
人去碰，等於白白擱置。**

每次提交前確認：

1. 本次動到的任務，狀態是否改變；仍是部分完成的要寫清楚**還缺什麼**。
2. **有沒有任務因為本次完成而解除阻塞**——把它們的相依欄標成「均已完成」，
   並在狀態欄明講可繼續／可開始，必要時更新「現在可以動工的任務」一節。
3. 外部阻塞（缺校方規則、缺資料、缺樣本）要寫進**相依欄**，不能只寫在內文，
   否則從表格看會誤判成單純排程問題。
4. 狀態依**實際程式碼**判定，不依印象：標「已完成」要指得出實作位置或測試。

只有純文件修改（未推進任何任務）可以跳過這一項，並在回報中寫明。

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
