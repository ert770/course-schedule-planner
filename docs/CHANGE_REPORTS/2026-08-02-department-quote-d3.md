# 2026-08-02 修復 department 含字面單引號（D3）

## 修改日期

2026-08-02

## 修改檔案清單

- `server/src/utils/text.js`（新增）
- `server/src/db/database.js`
- `server/test/text.test.js`（新增）
- `docs/DATA_SCHEMA.md`
- `docs/DEPARTMENT_MAPPING.md`
- `docs/CHANGE_REPORTS/2026-08-01-database-audit.md`
- `docs/CHANGE_REPORTS/README.md`
- `docs/CHANGE_REPORTS/2026-08-02-department-quote-d3.md`（本報告）
- `User_Profiles`（資料庫，1 筆資料清理，經使用者確認後執行）

## 問題

`User_Profiles.department` 的實際儲存值為：

```text
'資訊工程學系'
```

**包含字面單引號字元本身**，不是 SQL 語法上的引號。HEX 驗證：

```text
27E8B387E8A88AE5B7A5E7A88BE5ADB8E7B3BB27
^^                                    ^^
```

前後的 `27` 即 ASCII 單引號。任何字串比對都會失敗，且沒有任何錯誤或警告。

## 稽核問題的回答：是匯入缺陷，不是全欄位通例

稽核報告留下的問題是「這是資料匯入時的缺陷，還是所有欄位都有此問題」。本次掃描 `defaultdb` 全部 **19 個文字欄位**（`varchar` / `char` / `text` 系列），統計每個欄位開頭與結尾為單引號的筆數：

| 資料表 | 欄位數 | 有字面單引號的欄位 |
| --- | ---: | --- |
| `Courses` | 5（`course_id`、`name`、`type`、`dept`、`subid3`） | 無 |
| `Course_Sections` | 8（含 `teacher`、`room`、`time_str`、`rag_context`） | 無 |
| `Course_Reviews` | 5（含 `Reviews_tags`、`Review_content`） | 無 |
| `User_Profiles` | 1（`department`） | **`department`，1/1 筆** |

**結論：僅 `User_Profiles.department` 一個欄位受影響，屬單一欄位的匯入缺陷。**`Courses.dept` 等課程端欄位皆乾淨，因此系所對照（`#13`）不需要在課程端做同樣處理。

## 受影響範圍

| 位置 | 後果 |
| --- | --- |
| `server/src/routes/graduation.js:51` | `course.department === user.department` 恆為 false，畢業建議永遠給不出系上課程 |
| `client/src/pages/SetupPage.jsx:152` | 系所下拉選單的 value 對不上任何 `<option>`，選單顯示異常 |
| 路線圖 `#13` | 系所比對是把候選課程縮到「這位學生的系所」的前提，帶引號則整段邏輯無法成立 |

## 主要改動內容

### 新增 `server/src/utils/text.js`

- `stripWrappingQuotes(value)`：去除「整個字串被引號包起來」的情形並修剪空白。
- `normalizeDepartment(value)`：系所名稱正規化，`null` / `undefined` 原樣回傳（不會變成字串 `"null"`）。

支援的成對引號：`'`、`"`、`` ` ``、`‘’`、`“”`、`「」`、`『』`。半形與全形都收，因為匯入來源不一定一致。

**只有真正成對時才剝除**，避免誤刪內容：

| 輸入 | 輸出 | 理由 |
| --- | --- | --- |
| `'資訊工程學系'` | `資訊工程學系` | 成對包裹 |
| `"'資訊工程學系'"` | `資訊工程學系` | 重複包裹，剝到乾淨為止 |
| `O'Brien` | `O'Brien` | 單邊引號，不成對 |
| `'甲' 與 '乙'` | 原樣 | 剝除後內部仍有引號，代表引號屬於內容 |

### `server/src/db/database.js`：讀寫兩端都正規化

| 路徑 | 位置 |
| --- | --- |
| MySQL 讀取 | `mapUserProfileRow()` 經 `readProfileDepartment()` |
| 本機 JSON 讀取 | `readCollectionBySource()` 與 `getMysqlUserPreferences()` 的本機 profile 經 `normalizeProfileDepartment()` |
| 寫入（MySQL 與本機共用） | `upsertByField()` 在寫入前正規化 payload |

**寫入端也要做**，否則使用者或匯入流程送進來的帶引號值會再次污染資料庫；只修讀取端等於每次匯入都要重踩一次。

**不靜默修正**：第一次讀到髒值時寫一筆 `logger.warn`，記錄原值與正規化後的值，之後同一 `user_id` 不再重複警告。這與 D2 的 `onInvalid` 回呼採同一原則——資料層自動修正的行為必須留下痕跡，否則匯入缺陷會被永遠掩蓋。

### 資料庫清理（經使用者確認）

程式層正規化後功能已正確，但資料庫仍存著髒值。經使用者確認後執行 1 筆 `UPDATE`：

```text
BEFORE: user_id=1, department="'資訊工程學系'", HEX=27E8...B3BB27
AFTER : user_id=1, department="資訊工程學系",   HEX=E8B3...B3BB
affectedRows=1
```

`UPDATE` 帶 `WHERE user_id = ? AND department = ?` 雙條件，避免誤改其他資料。程式層的正規化仍保留——日後若再匯入髒資料，功能不會再壞一次。

## 影響範圍

- `GET /api/profile` 回傳的 `department` 不再帶引號。
- `POST /api/profile`（前端設定頁的儲存）寫入資料庫前會去除引號。
- `GET /api/graduation/:studentId` 的系所比對前提解除。**注意**：此比對目前仍不會成立，因為 `course.department` 存的是班級名稱（`資訊三甲`），與系所全名（`資訊工程學系`）本來就不同——那是 `#13` 要解的問題，不在 D3 範圍內。D3 解除的是「連乾淨的值都比不了」這一層。
- 排課引擎未使用 `profile.department`，排課結果不變。

## 測試與驗證結果

### 自動化測試

新增 `server/test/text.test.js`，共 13 項，涵蓋半形／全形引號、重複包裹、空白修剪、不成對引號、引號屬於內容、非字串輸入。

**測試總數由 93 增至 106，全數通過。**

### 靜態檢查

- `node --check` 對 `server/src/**/*.js`：全數通過。
- `npm run lint`（client）：通過，無錯誤。
- `npm run build`（client）：通過，763ms。

### 瀏覽器實測（A/B 對照）

`preview_start` 啟動 `server`（3001）與 `client`（5173）後實際操作：

| # | 情境 | 結果 |
| --- | --- | --- |
| 1 | **A：資料庫原值**（清理前直接查詢） | `'資訊工程學系'`，HEX 前後為 `27` |
| 2 | **B：同一時間的 API 回應** — 瀏覽器開啟 `/api/profile?userId=1` | `"department":"資訊工程學系"`，引號已去除 |
| 3 | 伺服器日誌 | `[WARN] [Profile] User_Profiles.department 含多餘引號，已正規化："'資訊工程學系'" -> "資訊工程學系"`，證明是程式層在處理，不是資料剛好乾淨 |
| 4 | **寫入端 A/B** — 從頁面 `fetch` POST `department: "'資訊工程學系'"` | 回應 `200`、`department` 為乾淨值；查資料庫 HEX 無 `27`，髒值沒有被存進去 |
| 5 | **設定頁實際操作** — `/setup` 選「電機工程學系」→ 點「完成設定，生成推薦課表 ✨」 | 資料庫 `user_id=1` 變為 `電機工程學系`，HEX 開頭 `E99BBB`（無引號） |
| 6 | 復原 | 同一畫面重新選「資訊工程學系」並送出，資料庫回到 `資訊工程學系`（乾淨） |
| 7 | 前端頁面載入 | Dashboard 與設定頁正常渲染，課表產生正常（含 D2 的「位於封鎖時段」排除訊息），console **無任何錯誤** |

第 1、2 項是本次的 A/B 對照核心：**同一時刻資料庫是髒的、API 是乾淨的**，差異只可能來自本次修改。第 4、5 項證明寫入端同樣有效。

### 未能以畫面驗證的部分

目前沒有任何前端畫面直接顯示 `User_Profiles.department`（設定頁的下拉選單初始值來自登入使用者，不是 `User_Profiles`）。因此可觀察的使用者介面是 API 回應與寫入結果，已如上逐項實測，未以畫面截圖代替。

## 是否 commit 與 push

- 已 commit。
- 已 push 到 `origin main`。
