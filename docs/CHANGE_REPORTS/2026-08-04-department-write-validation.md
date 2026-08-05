# 2026-08-04 department 寫入型別檢查與髒值警告去重修正（D3 後續）

## 修改日期

2026-08-04

## 修改檔案清單

- `server/src/utils/text.js`
- `server/src/db/database.js`
- `server/src/routes/profile.js`
- `server/test/text.test.js`
- `docs/API_SPEC.md`
- `docs/DATA_SCHEMA.md`
- `docs/CHANGE_REPORTS/README.md`
- `docs/CHANGE_REPORTS/2026-08-04-department-write-validation.md`（本報告）

## 來源

D3 修復（`2026-08-02-department-quote-d3.md`）後的對抗式審查指出兩個問題。兩者都不是引號處理本身的錯，而是「把正規化當成資料清理層」帶來的副作用。

## 問題一：正規化變成型別轉換層（嚴重）

`normalizeDepartment()` 原本對非 null 值一律 `String(value)`。`POST /api/profile` 的 `department` 會經過這裡再寫入 `User_Profiles.department`，因此錯誤型別會被轉成**看起來正常的字串**存進資料庫：

| 送進來的值 | 寫入資料庫的值 |
| --- | --- |
| `{}` | `[object Object]` |
| `{ "name": "資訊工程學系" }` | `[object Object]` |
| `["資訊工程學系", "電機工程學系"]` | `資訊工程學系,電機工程學系` |
| `123` | `123` |
| `true` | `true` |

這類值在資料庫與 API 回應中都像一般字串，不會拋錯、不會被察覺，但所有系所比對都會失敗——等於用另一種形式重現 D3。這是信任邊界的問題，不是清理邏輯的問題。

### 修法

**1. 正規化不再做型別轉換。** `normalizeDepartment()` 只接受字串，其餘型別（含 `null`、`undefined`）一律回傳 `null`。

**2. API 邊界擋下並回 400。** `POST /api/profile` 新增檢查，`department` 若有帶但不是非空字串，回：

```json
{ "error": "department 必須是非空字串" }
```

**3. 資料層再擋一次。** `upsertByField()` 的 `normalizeProfileForWrite()` 會丟棄型別錯誤的 `department` 並寫入警告，`updateMysqlUserPreference()` 也改以 `isDepartmentInput()` 判斷是否納入 UPDATE。API 檢查擋的是前端與外部呼叫，資料層這道擋的是繞過 API 的其他呼叫路徑（例如匯入腳本）。

空字串同樣拒絕：`User_Profiles.department` 為 `NOT NULL`，`""`、`"   "`、`"''"` 都不是合法輸入。

## 問題二：警告去重掩蓋持續發生的髒資料匯入（中等）

去重鍵原本只有 `row.user_id`。同一位使用者第一次髒值警告過後，**之後任何髒值都會被靜默正規化**——匯入流程若持續寫回帶引號的值，整個行程生命週期只會留下一行日誌，看不出上游還在壞，也看不出影響多少筆。

### 修法

去重鍵改為 `user_id + 原始值` 的指紋，並累計本行程的正規化次數與相異髒值種類數：

```text
[WARN] [Profile] User_Profiles.department 需正規化（user_id=1）："'資訊工程學系'" -> "資訊工程學系"；本行程累計正規化 1 次、相異髒值 1 種
```

相同髒值仍只警告一次（避免每次請求刷版面），但**換一個髒值就會再警告一次**，且累計數字讓日誌能回答「上游是不是還在持續寫入髒資料」。

## 影響範圍

- `POST /api/profile`：`department` 型別錯誤或空字串由「靜默寫入髒值」改為 `400`。**行為變更**，但先前的行為是資料損壞。
- `normalizeDepartment()` 的契約改變：`undefined` 由原樣回傳改為回傳 `null`；非字串由強制轉換改為 `null`。
- 排課的 `buildStudentScope()` 因此對錯誤型別的系所判定為「無法判定」，會走既有的「未設定系所或年級」警告路徑。

## 測試與驗證結果

### 自動化測試

`server/test/text.test.js` 新增型別轉換與寫入檢查案例（物件、巢狀物件、陣列、數字、布林、函式、空字串、只有引號或空白的字串）。

**測試總數由 147 增至 151，全數通過。**

### 靜態檢查

`node --check` 對 `server/src/utils/text.js`、`server/src/db/database.js`、`server/src/routes/profile.js`：通過。

### 瀏覽器與真實資料庫實測

`preview_start` 啟動 `server`（3001）與 `client`（5173）：

| # | 情境 | 結果 |
| --- | --- | --- |
| 1 | 由頁面 POST `department` 為 `{}`、`["資訊工程學系","電機工程學系"]`、`123`、`""`、`"   "` | 五種全部回 **400 `department 必須是非空字串`** |
| 2 | 上述請求後查資料庫 | `department` 仍為 `資訊工程學系`（HEX `E8B3...`），**沒有寫入 `[object Object]`** |
| 3 | 髒值 A（`'資訊工程學系'`）連續讀兩次 | 只出現 **1 行** WARN |
| 4 | 改成髒值 B（`「資訊工程學系」`）再讀 | **再出現 1 行** WARN，附「累計正規化 3 次、相異髒值 2 種」。修正前這一筆會完全靜默 |
| 5 | 髒值 A 再次出現 | 不重複警告 |
| 6 | 繞過 API 直接呼叫 `upsertByField()` 寫入 `{}`、陣列、`123`、`""` | 四種全部被丟棄並警告，資料庫值不變 |
| 7 | 合法字串 `'電機工程學系'`（帶引號） | 正常寫入為 `電機工程學系`，引號仍被去除 |
| 8 | 前端登入 → onboarding → 設定頁送出 | `GET /api/profile?userId=D1249697` 回 `資訊工程學系` / `grade 3`，console 無錯誤 |

第 3～5 項是問題二的 A/B 對照：**同一位使用者、不同髒值**，修正前只會警告第一次。

實測用的髒值皆於腳本內還原，資料庫最終值為 `資訊工程學系`。

## 是否 commit 與 push

- 未 commit。
- 未 push。
