# Roadmap #29：Interaction Event Schema 基礎

## 問題與解法

目前系統沒有一致的互動事件契約，因此無法可靠區分：

- 使用者沒有看見課程，或看見後拒絕。
- 因興趣選課，或因為必修不得不接受。
- 因衝堂移除，或是真的不喜歡課程。
- 同一次 React 操作重送，或兩次獨立操作。

本次只完成 #29 的 schema 基礎：建立事件型別、欄位驗證、版本遷移與純函式 idempotency 邏輯。不建立 API、不寫入真實事件，也不修改前端埋點；持久化與 UI 接線留給完成 #33 隱私規則後的 #2。

## 功能與資料契約

新增 `InteractionEvent v1`，欄位固定為：

- 基本資料：`schemaVersion`、`eventId`、`eventType`、`userId`、`timestamp`、`requestId`、`actionId`、`idempotencyKey`。
- 課程識別：`course.catalogCourseCode` 表示穩定課號，`course.sectionId` 表示實際班次；非課程事件可為 `null`。
- 學期：`term.academicYear` 與正規化後的 `term.semester: first | second`。
- 方案與位置：`plan.planId`、`plan.variantId`，以及一律從 1 起算的 `position.planRank`、`position.courseRank`。
- 曝光環境：頁面來源、觸發方式、依排序保存的完整候選集與實際顯示清單。
- 版本快照：`profileSchemaVersion`、`modelVersion`、可為 `null` 的 `recommendationReasonVersion`；#26 尚未完成時不得捏造理由版本。
- 來源分類：`explicit_selection`、`required`、`system_recommendation`、`exploration`。
- 移除原因：`time`、`content`、`instructor`、`workload`、`full`、`eligibility`、`other`；本版不收自由文字，避免在 #33 前引入額外個資。

Event type 定義：

- `recommendation_exposed`
- `course_viewed`
- `course_favorited`／`course_unfavorited`
- `course_selected`／`course_deselected`
- `recommendation_accepted`
- `course_removed`
- `course_withdrawn`
- `schedule_regenerated`

目前 UI 尚不存在的收藏、正式接受、移除及退選操作只先定義契約，不宣稱已埋點。

## Code 實作方式

新增 `server/src/data/interactionEventSchema.js`：

- 匯出所有 enum 與 `INTERACTION_EVENT_SCHEMA_VERSION = 1`。
- `normalizeInteractionEvent()` 統一 ID、學期、空值與欄位形狀。
- `validateInteractionEvent()` 拒絕未知 event type、非法原因、錯誤 UUID、非 ISO timestamp、無效 section、零或負數位置及缺少事件必要欄位。
- `createInteractionEvent(identity, input)` 只接受可信的 authenticated identity；由伺服器產生 `eventId`、`timestamp`，不得相信 client 傳入的 user ID 或時間。
- `migrateInteractionEventV0ToV1()` 將尚未版本化的草稿形狀轉成 v1；明確拒絕未知的未來版本。
- `buildInteractionIdempotencyKey()` 對 `requestId + actionId + eventType + plan/course subject` 的 canonical payload 計算 SHA-256；不把 timestamp 或 eventId 放入 key。
- `resolveIdempotentAppend(existingEvents, event)` 採純函式行為：
  - `(userId, idempotencyKey)` 不存在：回傳可新增事件。
  - key 與 payload 相同：回傳既有事件並標示 duplicate。
  - key 相同但 payload 不同：回傳 conflict，不允許靜默覆寫。

新增 `server/test/interactionEventSchema.test.js`，其餘修改：

- `docs/DATA_SCHEMA.md`：記錄完整 v1 schema、事件語意及哪些欄位由 server 提供。
- `docs/DECISIONS.md`：記錄「#29 不收集資料」及 idempotency 衝突策略。
- `docs/TEST_PLAN.md`：加入 #29 測試案例。
- 路線圖：將 #29 標為完成，說明 #33 已解鎖、#2 仍須等待 #33；#28 仍要等實際埋點後才能驗證事件隔離。
- 新增 `docs/CHANGE_REPORTS/2026-08-21-interaction-event-schema.md`，並更新變更報告索引。

不修改 `client/src`、Express routes、MySQL、`server/data/*.json` 或公開 API。

## 測試與驗收

- 正常建立曝光、查看、選擇、移除、退選及重新規劃事件。
- 曝光事件可重建候選排序、實際顯示內容、方案及版本快照。
- 必修事件保留 `source=required`，不會與興趣選擇混淆。
- `course_removed + reason=time` 可與內容負回饋明確區分。
- 同一 logical action 重送只得到原事件；相同 key、不同 payload 回報 conflict。
- v0 草稿可遷移到 v1；未知未來版本與 malformed input 被拒絕。
- 執行所有 `server/src/**/*.js` 語法檢查、`npm test`、前端 lint 與 build。
- 因沒有 API、前端或使用者可見行為變更，不執行瀏覽器 A/B；變更報告需明確記錄原因。
- 不 commit、不 push；除非使用者後續另外要求。
