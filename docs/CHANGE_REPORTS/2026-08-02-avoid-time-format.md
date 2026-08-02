# 2026-08-02 修復 avoid_time 格式不符導致封鎖時段靜默失效（D2）

## 修改日期

2026-08-02

## 修改檔案清單

- `server/src/utils/periods.js`（新增）
- `server/src/db/database.js`
- `server/src/services/constraintService.js`
- `server/src/skills/scheduler.js`
- `server/test/periods.test.js`（新增）
- `docs/DATA_SCHEMA.md`
- `docs/SCHEDULING_LOGIC.md`

## 問題

`User_Profiles.avoid_time` 的實際內容為**時間字串陣列**：

```json
["08:00"]
```

但 `server/src/skills/scheduler.js` 的 `hardConstraintReason()` 期待的是：

```json
[{ "day": 1, "period": 3 }]
```

`normalizeBlockedPeriods()` 原本只是原樣回傳陣列，未做格式轉換。因此比對時 `bp.day` 為 `undefined`，`block.dayOfWeek !== bp.day` 恆為真而跳過，**使用者設定的避開時段完全不生效，且沒有任何錯誤或警告**。

### 同一欄位有兩種格式

追查寫入路徑後發現問題比原本記錄的更複雜。`database.js` 的更新邏輯把 `blockedPeriods` 直接 JSON 存進 `avoid_time`：

```js
if (item.blockedPeriods !== undefined || item.avoidTime !== undefined) {
  updates.push('`avoid_time` = ?');
```

所以同一個欄位可能存在兩種格式：

| 來源 | 格式 |
| --- | --- |
| 外部匯入的原始資料 | `["08:00"]` 時間字串 |
| 本系統寫回 | `[{ day: 1, period: 3 }]` 物件 |

轉換必須同時支援兩者，只處理其中一種會讓另一種靜默失效。

## 主要改動內容

### 新增 `server/src/utils/periods.js`

後端原本沒有節次與實際時間的對照表，只有前端 `ScheduleGrid` 有。轉換發生在後端，因此把對照表建立在後端，內容與前端一致。

- `PERIOD_TIMES`：14 節的開始與結束時間。
- `toMinutes(time)`：解析 `HH:MM`，容忍全形冒號與前後空白，無效輸入回傳 `null`。
- `findPeriodByTime(time)`：找出涵蓋該時間的節次。
- `normalizeBlockedPeriods(value, onInvalid)`：把各種來源統一成 `{ day, period }`。

### 時間對應節次的規則

採「**第一個尚未結束的節次**」：

| 輸入 | 結果 | 理由 |
| --- | --- | --- |
| `08:00` | 第 1 節 | 第 1 節 08:10 開始，使用者說「避開八點」指的是早八 |
| `09:30` | 第 2 節 | 落在 09:10-10:00 之內 |
| `13:05` | 第 6 節 | 第 5 節 13:00 已結束，取下一節 |
| `23:00` | `null` | 超出最後一節 22:10 |

### 時間字串沒有星期資訊

`["08:00"]` 只有時間、沒有星期，因此視為**每天的該節次都要避開**，展開為 7 筆 `{ day: 1..7, period: 1 }`。

### 排課引擎自己負責正規化

正規化邏輯放在 `utils/periods.js`，由三處呼叫：

- `database.js` 讀取 `User_Profiles.avoid_time` 時
- `constraintService.js` 合併 request 與已儲存偏好時
- **`scheduler.js` 的 `generateSchedule()` 進入點**

最後一項是關鍵。原本只修前兩條路徑，等於要求**每個呼叫端**都記得先轉換——每新增一條呼叫路徑就多一次踩同一個坑的機會，而這正是 D2 發生的原因。改成排課引擎在進入點統一正規化後，不論呼叫端是誰、有沒有先處理，封鎖時段都會生效。

已實測繞過 `constraintService` 直接送 `["08:00"]` 給 `generateSchedule`，第 1 節的課同樣被正確排除。

`constraintService` 原本自帶的 `PERIODS_PER_DAY = 14` 也改為引用共用定義。

### 無法解析的項目不再靜默忽略

`normalizeBlockedPeriods` 接受 `onInvalid` 回呼。`database.js` 傳入 logger，無法解析的項目會寫進伺服器日誌，不再無聲丟棄。

## 影響範圍

- `POST /api/schedule/generate` 與 `POST /api/chat` 的排課工具。
- `GET /api/profile` 回傳的 `blockedPeriods` 現在是正規化後的 `{ day, period }`。
- **行為變更**：先前 `avoid_time` 為時間字串的使用者，其封鎖時段從「完全無效」變成「實際生效」，排課結果會改變。這正是修復目的。

## 測試與驗證結果

新增 `server/test/periods.test.js`，共 22 項，涵蓋時間解析、節次對應、格式正規化與端到端行為。

**測試總數由 74 增至 94，全數通過。**

初版曾寫了一項斷言「未正規化的時間字串會被忽略」的測試，用來記錄修復前的行為。該測試把缺陷鎖進測試套件——一旦有人讓排課引擎防禦性地自行正規化（也就是改進），測試反而會失敗。已改為斷言正確行為：直接送時間字串給 `generateSchedule` 時，封鎖時段必須生效。

### 真實資料驗證

以 `User_Profiles` 中唯一一筆使用者（`avoid_time` 為 `["08:00"]`）與 3560 筆課程實測：

| 項目 | 結果 |
| --- | --- |
| 正規化後的封鎖時段 | 7 筆（週一至週日的第 1 節） |
| 不套用封鎖時段 | 課表 21 門，其中**第 1 節開始的有 3 門** |
| 套用 `avoid_time` | 課表 21 門，其中**第 1 節開始的有 0 門** |
| 因封鎖時段被排除 | 260 門 |

修復前這個設定對排課結果毫無影響。

### 其他驗證

- `npm test`：93 項全數通過。
- `npm run lint`、`npm run build`：通過。
- `node --check` 對 `server/src/**/*.js`：全數通過。

## 是否 commit 與 push

- 未 commit。
- 未 push。
- PR #1 已於 2026-08-02 合併，本次修改需另開分支與 PR。
