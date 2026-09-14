# 2026-09-13 退役 Profile v0 相容層

## 修改日期

2026-09-13

## 背景

前一份報告（[Profile 欄位去重、課程評量欄位接線與 v0 相容層修復](./2026-09-13-profile-field-dedup-and-evaluation-columns.md)）
修復了 2026-09-11 課程年級改名誤刪 `gradeLevel` v0 別名的 regression，並把
「是否整組退役 v0 相容層」列為待決事項。本次執行退役。

退役的依據是**v0 資料在這個系統裡不存在**，逐項查證：

- profile 的唯一儲存體是 MySQL `User_Profiles`，欄位名為 `grade_level`／`max_credits`／
  `avoid_time`，經 `mapUserProfileRow()` 出來一律是 v1 名稱，產不出 v0 鍵。
- `server/data/user_preferences.json`（曾經的第二儲存體）已於 2026-08-11 刪除。
- 版本偵測欄位 `profile_schema_version` **在共用 MySQL 根本不存在**——直接查
  `information_schema` 確認 migration 001 的三欄只套用了 `class_name`，
  `student_id` 與 `profile_schema_version` 都沒套上。因此 `storedSchemaVersion`
  算出來永遠是 0。
- 前端只送 v1 名稱；Agent 的 `update_preferences`／`update_student_profile` 工具
  schema 是 `additionalProperties: false` 且只宣告 v1 名稱。

## 修改檔案

- `server/src/data/profileSchema.js`
- `server/src/db/database.js`
- `server/test/profileSchema.test.js`
- `server/test/databaseProfileContract.test.js`
- `docs/DATA_SCHEMA.md`

## 主要改動

### 退役的 5 項（皆經 grep 確認零生產呼叫端）

| 項目 | 原位置 |
| --- | --- |
| `gradeLevel` 的 `?? profile.grade` 別名 | `profileSchema.js` |
| `targetCreditsMax` 的 `?? profile.maxCredits` 別名 | `profileSchema.js` |
| `blockedPeriods` 的 `?? profile.avoidTime` 別名 | `profileSchema.js` |
| `migrateProfileV0ToV1()` 與 `delete normalized.grade`／`delete normalized.avoidTime` | `profileSchema.js` |
| `storedSchemaVersion`（v0 偵測欄位） | `database.js` 的 `mapUserProfileRow()` |

`migrateProfileV0ToV1()` 的輸出**恆等於** `normalizeProfile()`——後者本來就無條件寫入
`schemaVersion: PROFILE_SCHEMA_VERSION`，那層 spread 是多餘的；它從誕生（`a2c4a5f`）
起就沒有生產呼叫端，只有測試在用。

### 對外行為變更（僅此一項）

寫入端 `updateMysqlUserPreference()` 的兩個對應別名（`item.avoidTime`、`item.maxCredits`）
一併移除。這兩個名稱從未寫進 `docs/API_SPEC.md`，前端與 Agent 都不送，因此沒有已知
呼叫端受影響，但技術上它們過去是可用的輸入。

### `maxCredits` 不在「純 v0」之列，要分清楚

`maxCredits` 同時是 **constraints 命名空間裡活著的公開參數**
（`POST /api/schedule/generate`、`docs/API_SPEC.md:407`、Agent 的 `run_csp_scheduler`、
`scheduler.js` 的 `plan.maxCredits`、前端 `DashboardPage.jsx`），與 profile 的
`targetCreditsMax` 由 `services/constraintService.js:60` 銜接。本次移除的只是
「把 constraints 形狀的物件當 profile 正規化」這條沒人走的路，**constraints 那邊完全未動**。

### 保留

`PROFILE_SCHEMA_VERSION` 與 `validateProfile()` 的版本檢查刻意保留——那是擋下
「繞過 normalize 自己組一份 profile」的防呆，不是遷移設施。

### 順帶修掉一個被這次退役暴露出來的既有 bug

實機 A/B 時踩到：只送 v0 名稱的 `POST /api/profile` 回 **HTTP 500**，訊息是
「找不到對應的資料列」——但那一列好好地存在。

根因是 `updateMysqlUserPreference()` 對兩種**語意完全不同**的情況共用 `return null`：

1. `result.affectedRows === 0`＝真的查無此列（是錯誤）。
2. `updates.length === 0`＝這次沒有任何可寫欄位（是 no-op，不是錯誤）。

而 `upsertByField()` 把 `null` 一律當成第 1 種並拋錯。這個 bug 在退役之前就存在
（送任何無法辨識的欄位都會踩到），只是 `maxCredits`／`avoidTime` 從「認得的別名」
變成「不認得的欄位」後才變得容易觸發。

修法：抽出 `currentProfileRow()`，讓第 2 種情況回傳目前的資料列（真正的 no-op），
第 1 種維持 `null` 讓呼叫端拋錯。

## 影響範圍

- Profile 讀寫：v1 名稱行為完全不變；v0 名稱從「靜默被接受」變成「被忽略」。
- 只送無法辨識欄位的 `POST /api/profile`：從 HTTP 500 改為 200 且不變更任何欄位。
- 排課、AI Agent、constraints 命名空間：未動。
- 共用 MySQL schema 與資料：未變更（A/B 測試用的暫時值已還原並逐列核對）。
- 本次未推進 roadmap 任一編號任務，故未更動進度總覽表。

## 測試與驗證

- `server/src/**/*.js`：80 個檔案 `node --check` 全數通過。
- 後端測試（排除已知會 hang、與本次無關的 `interactionEvents.test.js`）：
  **1032/1032 通過**（較退役前 1028 多 4 筆，即本次新增的回歸測試）。
- 新增回歸測試：
  - `profileSchema.test.js` 的 `P3-B`：三組 v0 別名**一起**釘死
    （`grade`／`maxCredits`／`avoidTime` 都必須不被辨識），避免重演 2026-09-11
    只掃掉其中一組的半殘狀態；另檢查 `migrateProfileV0ToV1` 確實不再被匯出。
  - `databaseProfileContract.test.js` 的 `B13`：釘住「no-op 回傳目前資料列、
    查無此列才回 null」，兩種情況不得再共用同一個回傳值。
- `client npm run lint`：通過。
- `client npm run build`：通過（1,778 modules）。
- 瀏覽器 A/B（demo 帳號 `D1249697`，`POST /api/profile`）：
  - **A（v1 名稱）**：`targetCreditsMax` 25 → 21、`blockedPeriods` `[]` →
    `[{day:3,period:1}]`，寫入正常。
  - **B（v0 名稱）**：送 `{ maxCredits: 18, avoidTime: [...] }` → HTTP 200、
    `success: true`，`targetCreditsMax` 維持 25、`blockedPeriods` 維持 `[]`，
    確認 v0 名稱被忽略且不再 500。
  - `GET /api/profile` 回應中已無 `storedSchemaVersion` 欄位。
  - 還原後直接查 MySQL 核對 4 筆 `User_Profiles`：`max_credits` 25、
    `avoid_time` `[]`，與測試前一致。
  - Dashboard 完整流程（登入→同意→設定→生成課表）結果與退役前相同：
    8 門課、23 學分、顯示名稱「黃思瑜」；最近一批 `/api/*` 請求全為 200。

## Commit / Push

- 依使用者指示建立 commit 並推送至 `origin/backend`。
