# PR #41 合入最新 main 並解衝突

日期：2026-11-24

## 背景

PR #41（`backend`：課程主題摘要與保存偏好後重排）從 PR #36 之後的 main 分出，之後 main 多了 13 個 commit（MyFCU 整合、探索頁三種相近程度、排除共同必修等），GitHub 顯示衝突、無法合併。使用者決定（2026-11-24）：解衝突。

## 衝突與解法

只有 `client/src/pages/DashboardPage.jsx` 衝突，兩邊改的是不同功能，全部保留：

| 位置 | main（PR #37 MyFCU） | PR #41 | 解法 |
| --- | --- | --- | --- |
| import | `Link`、`controlledBrowserAPI` | 無 | 用 main 的（PR #41 的 import 是子集） |
| 元件開頭 | MyFCU 本機同步入口的狀態與查詢 | 無 | 保留 main 的 |
| 回到首頁的 effect | 匯入修課紀錄後重排（`generateInitialSchedule`） | 保存偏好後重排（`generateSchedule('preference_regenerate')`） | 兩個分支都保留：先處理保存偏好，再處理匯入；匯入改呼叫 PR #41 改名後的 `generateSchedule()`（trigger 仍是 `initial_load`，與原本相同） |
| effect 結尾 | `generateInitialSchedule` | `generateSchedule` | 用 PR #41 的 |

其他檔案（`API_SPEC.md`、`DATA_SCHEMA.md` 等）自動合併。

## 測試與驗證

- 前端 lint、build 通過；後端 `node --check` 全部通過。
- `npm test`：1,960 項，1,912 通過、0 失敗、32 略過（worktree 沒有 `.env` 時，18 項會呼叫模型的 golden set 略過，其餘 14 項與平常相同）。
- 瀏覽器（合併後版本，D1249697）：
  - 首頁同時有 main 的「歷史修課紀錄」「同步 MyFCU 修課紀錄」與 PR #41 的「套用偏好排課」、方案說明。
  - 回到首頁的四種情境，看 `POST /api/schedule/generate` 的 trigger：
    - 沒有狀態：不重排（0 次）。
    - `preferencesSavedFor`＝本人：重排 1 次，`preference_regenerate`，狀態清掉。
    - `courseHistoryImported: 3`：重排 1 次，`initial_load`，狀態清掉。
    - `courseHistoryImported: 0`：不重排。
  - 後端重啟後所有 API 皆 200，只有既有的 `/api/controlled-browser/config` 404。

## Commit 與 push

merge commit 在 `merge/pr41-main`（以 `origin/backend` 為基底合入 `origin/main`），推上去另開 PR 或併回 `backend` 由使用者決定。
