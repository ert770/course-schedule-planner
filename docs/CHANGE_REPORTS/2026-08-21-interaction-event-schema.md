# 2026-08-21 定義 InteractionEvent schema 與回饋原因（Roadmap #29）

## 修改日期

2026-08-21

## 修改檔案清單

**新增**：

- `server/src/data/interactionEventSchema.js`
- `server/test/interactionEventSchema.test.js`
- `docs/PLANS/2026-08-21-roadmap-29-interaction-event-schema-plan.md`
- `docs/CHANGE_REPORTS/2026-08-21-interaction-event-schema.md`（本檔）

**修改**：

- `docs/DATA_SCHEMA.md`
- `docs/DECISIONS.md`（新增 ADR-016）
- `docs/TEST_PLAN.md`
- `docs/CHANGE_REPORTS/2026-08-01-personalization-roadmap.md`（#29 狀態與下游相依更新）
- `docs/CHANGE_REPORTS/README.md`

## 問題

系統原本沒有一致的互動事件契約，無法可靠區分「使用者沒看見」與「看見後拒絕」，
也無法區分必修接受、興趣選課、衝堂移除與內容負回饋。若直接把這些操作當成相同的
正／負 label，後續 #30 的偏好學習會往錯誤方向更新；React 重送同一 request 時也可能
產生雙重事件。

同時，實際蒐集互動屬 roadmap #2，且必須先完成 #33 的 consent、匿名化與保存規則。
因此 #29 只能先固定資料語意與去重契約，不能在隱私邊界尚未建立時寫入真實學生事件。

## 主要改動內容

### InteractionEvent v1

- 定義 `schemaVersion`、event/user/course/section/term/plan/position、timestamp、request/action ID、idempotency key、exposure context 與版本快照。
- `eventType` 涵蓋推薦曝光、查看、收藏／取消收藏、選擇／取消選擇、接受、移除、退選與重新規劃。
- `source` 固定區分 `explicit_selection`、`required`、`system_recommendation`、`exploration`。
- 移除／退選原因固定為 `time`、`content`、`instructor`、`workload`、`full`、`eligibility`、`other`；不收自由文字。
- 課程同時保存穩定的 `catalogCourseCode` 與實際 `sectionId`；學期統一為 `first`／`second`。
- 曝光保存 ordered `candidateSet` 與 `displayedSet`，後者必須是前者子集，才能重建真正看見的內容。
- `recommendationReasonVersion` 在 #26 完成前允許 `null`，不捏造不存在的理由版本。

### Server-authoritative envelope 與驗證

- `createInteractionEvent()` 只接受 authenticated identity 的 canonical ID；client 傳入的 `userId`、`eventId`、`timestamp`、`schemaVersion`、`idempotencyKey` 一律由 server 覆寫。
- validator 檢查 UUID、UTC ISO timestamp、event/source/reason enums、正整數 section/rank、學期、方案、版本快照與 event-specific required fields。
- `migrateInteractionEventV0ToV1()` 將無版本 flat draft 轉成 v1 nested shape；未知未來版本直接拒絕。

### Idempotency

- SHA-256 key 由 `requestId + actionId + eventType + plan/course subject` 的 canonical payload 計算，不含重送時本來就可能改變的 `eventId`／`timestamp`。
- `(userId, idempotencyKey)` 未出現時回 `append`；key 與 logical payload 均相同時回 `duplicate` 並保留第一筆；key 相同但 context 改變時回 `conflict`，不覆寫。
- `resolveIdempotentAppend()` 是 storage-agnostic pure function，只操作呼叫端傳入的陣列。

## 影響範圍

- #29 已具備可供 #33、#2 使用的穩定事件契約；#33 的相依條件已滿足，可開始定義隱私與 consent。
- #2 仍未開始，正式環境不會產生任何 interaction event。
- #28 的「兩個帳號互動事件不交叉」仍須等待 #2 實際埋點後驗收。
- 未新增 Express route、MySQL table、runtime JSON collection 或前端呼叫。
- 未修改排課、搜尋、登入、Profile 或 AI Agent 的現行行為。

## 測試與驗證結果

- `node --check`：`server/src` 45 個 JavaScript 檔案全數通過。
- `node --test test/interactionEventSchema.test.js`：10/10 通過。
- `npm test`：102 suites / 471 tests 全數通過，零回歸；包含真實 MySQL 契約測試。
- `client npm run lint`：通過。
- `client npm run build`：通過（Vite 1750 modules transformed）。
- `git diff --check`：通過；只有既有 Git 行尾正規化提示，沒有 whitespace error。
- 本次沒有 API、UI 或其他使用者可見行為變更，因此未執行瀏覽器 A/B；瀏覽器不會產生任何可驗收的新互動行為。

## Commit 與 push

- 本報告與 #29 變更納入 `feat: define versioned interaction event schema` commit。
- 依使用者要求推送至 `origin backend`。
