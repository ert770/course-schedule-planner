# 2026-09-03 Roadmap #28：雙帳號資料隔離驗收

## 1. 修改日期

2026-09-03

## 2. 為什麼做這件事

`#28`（統一登入使用者 context）主體在 2026-08-14 就完成了——`AuthContext` 是唯一登入
狀態來源、各頁都改用 `useAuth()`、API client 移除 `default`、localStorage key 加上
學號前綴。狀態卡在 🟡 部分完成，roadmap 自己記著理由：只有一個可登入帳號，
「兩個測試帳號輪流登入，資料不交叉」這條驗收標準從來沒有真的跑過。

roadmap 也自己記著一條到期事項：「互動事件不交叉」當時無事件可測，等 `#2`。
`#2` 已完成，共用 MySQL 的 `Interaction_Events` 現在有真實資料——這條到期了。

## 3. 解決的新法

不是再寫幾個手工 identity 物件的測試去證明隔離，而是真的建第二個帳號、
在同一個瀏覽器輪流登入，走一次完整流程：登入 A → 設定偏好 → 排課 → 聊天 →
存課表 → 登出 → 登入 B → 看 B 有沒有看到任何 A 的東西 → 重新載入 → 切回 A →
確認 A 的東西都還在、沒有沾到 B 的。判準單純：任何一處在 B 的畫面上看到 A
的資料，就是 bug，當場修。

第二個帳號寫進**組員共用的 Aiven 雲端 MySQL**（`User_Profiles`），驗完用系統
自己的「刪除我的資料」清掉——這也順便把刪除功能認真測了一次，而它一開始
真的沒通過（見 5.3）。

## 4. 實作內容

### 4.1 建立第二個測試帳號

`server/data/users.json` 新增 `AC28TEST2`（企業管理學系、大一、企管一甲——
刻意選跟 A（資訊工程學系、大三、資訊三乙）不同系所年級，同系同班會讓候選課
高度重疊，交叉汙染反而看不出來），MySQL `User_Profiles` 對應寫入
`user_id=2` 一列。兩邊都要有：`users.json` 是登入與「學號↔numeric user_id」
對照的唯一來源，缺了登不進去；`User_Profiles` 是 Profile 的唯一儲存體，缺了
`POST /api/profile` 的 UPDATE 會影響 0 列（沒有 INSERT 新列的路徑），偏好會
靜默存不進去。

### 4.2 瀏覽器實跑（demo 帳號 `D1249697` / 測試帳號 `AC28TEST2`）

完整走過一輪：A 登入、設定偏好（上機實作考試／全英授課／學到較多內容）、
排課（8 門課／23 學分）、聊天、存課表 → 登出 → B 登入（首次登入走隱私同意
→ 個人化設定，只勾必要項）、看到**自己的**系所（企業管理學系）與班級選項
（企管一乙／企管一合／企管一甲，不是 A 的資訊三系列）、設定不同偏好、排課
（10 門課／18 學分，全部是會計、經濟、管理學等企管課程，與 A 的資工課程
零重疊）、聊天、存課表 → 重新載入（B 仍是 B）→ 登出 → 登回 A（A 的資工課表、
自己的偏好、`我的關注` 3 門課全部還在，沒有沾到 B 的任何東西）。

逐項核對：

| 資料 | 儲存位置 | 結果 |
| --- | --- | --- |
| Profile 偏好／系所／班級 | MySQL `User_Profiles` | 各自獨立，互不覆蓋 |
| 已存課表 | `saved_schedules.json` | 兩筆各自對應正確的 `userId`，`getSavedSchedules()` 互不可見 |
| Chat | MySQL `Chat_Messages`（HMAC `subject_id`） | B 開新對話沒有 A 的訊息；A 換頁（Dashboard→SchedulePage）後 Agent 仍記得「我是帳號A」，證明同一份記憶跨頁一致，但沒有出現 B 的任何內容 |
| 互動事件 | MySQL `Interaction_Events`（HMAC `subject_id`） | A 有 20+ 筆、B 是 0 筆——**不是 bug**：B 首次登入只勾了必要的 `service_processing`，沒勾 `personalization_learning`，`recordExposureSafely()` 依 `hasCurrentPurposeConsent()` 正確跳過寫入 |
| localStorage | 瀏覽器 | 兩帳號各自只有 `fcu:<studentId>:onboarded/setupDone` 前綴 key，登出後正確清除；只有 `fcu_theme` 沒有前綴（見 4.3） |
| 未登入 | — | `profile`／`schedule/saved`／`chat`（POST）／`graduation/me` 直接打，全部 401 |
| 跨帳號冒用 | — | 以 A 的 session 打 `profile?userId=B`／`graduation/B`／`update-watchlist{studentId:B}`，全部 403，B 的關注清單事後確認未被寫入 |

### 4.3 發現什麼、修了什麼

- **`fcu_theme` 沒有使用者前綴、登出不清**——確認會發生（B 登入後畫面沿用 A
  選的深色／淺色）。判定為裝置偏好而非個人資料：淺色／深色是這台裝置、這台
  瀏覽器的顯示偏好，跟誰登入無關，比照瀏覽器本身「記住這台電腦的深色模式」
  的慣例。裁定不加前綴、不隨帳號切換清除，並在
  [ThemeContext.jsx](../../client/src/contexts/ThemeContext.jsx) 加註解記下這個
  判斷，避免下次雙帳號驗收又被當成 bug 重新調查一次。
- **`saveCurrentSchedule()` 缺帳號世代防護**——`addCourse()`／`toggleWatchlist()`
  在 `await` 之後都會比對 `accountGenerationRef`，`saveCurrentSchedule()` 原本
  沒有。時間窗很窄（切帳號快到能插進一次 HTTP 往返之間），這輪雙帳號驗收
  沒有實際重現，但屬於同一類漏洞，補齊到
  [ScheduleContext.jsx](../../client/src/contexts/ScheduleContext.jsx) 避免不對稱。
  `removeCourse()` 檢查過是完全同步的函式（沒有 `await`），不存在這個窗口，
  不需要加。
- **`server/data/users.json` 的 `skillTree` 欄位是死欄位**——B 剛建立的帳號
  `skillTree: []`，但畫面顯示的「🌳 我的專業技能樹」（宣稱「基於歷年成績與
  修課紀錄動態生成」）跟 A 一模一樣：全部寫死在
  [DashboardPage.jsx:387-428](../../client/src/pages/DashboardPage.jsx)，
  不讀任何使用者資料。**這不是跨帳號洩漏**——兩個帳號看到的是同一份假資料，
  不是彼此的真資料——所以不在這次改動範圍內，已另開任務追蹤（見 7）。

### 4.4 意外發現並修復：刪除帳號的 deletion intent 一律判定已過期

驗收結束要用系統自己的「刪除我的資料」清掉 B，結果 `DELETE /api/privacy/data`
不論怎麼重試都回 `刪除確認已失效或不正確`（`INVALID_DELETION_INTENT`），
即使是**剛建立完立刻消費**。

追下去：`privacyService.js` 全程以 UTC 語意寫入 `DATETIME(3)` 欄位
（`toMysqlDate()` 就是 `toISOString()` 去掉時區字尾），但 `mysql2` 讀回
`DATETIME` 值時，沒有明講時區就會**用執行環境的本地時區**建構 JS
`Date`——伺服器在 `Asia/Taipei`（UTC+8），讀回的值因此比寫入時晚了 8 小時，
`consumeDeletionIntent()` 的 `new Date(row.expires_at) <= nowDate()`
於是永遠成立，intent 建立當下就被判定已過期：

```
node -e "console.log(new Date('2026-09-03 02:17:46.058').toISOString())"
// → 2026-09-02T18:17:46.058Z（少了 8 小時，不是原本要的 UTC 02:17:46）
```

這條路徑此前從未在真實 MySQL 上被自動化測試跑過——`privacyService.test.js`
的既有測試全部刻意用 `PRIVACY_STORE=memory`，那條分支比對的是記憶體裡本來就是
UTC 字串的值，不經過 mysql2 的日期還原，因此完全不受影響、也就測不出這個問題。

修法是驅動層設定：[mysql.js](../../server/src/db/mysql.js) 的連線池加上
`timezone: 'Z'`，讓每個讀回的 `DATETIME`／`TIMESTAMP` 都被當成 UTC 解析，
一次修正這個檔案裡所有受影響的比較（deletion intent 過期判定、consent／
subject state 顯示時間），不必逐一改各處的比較邏輯。既有走 SQL 端比較的地方
（例如 `Chat_Messages` 用 `WHERE expires_at > UTC_TIMESTAMP(3)`）本來就不經過
這個轉換，不受影響、也不會被這個修正動到。

修完直接對真實 MySQL 重跑：

```
intent: {"requestId":"...","token":"...","expiresAt":"2026-09-03T10:19:42.646Z",...}
CONSUMED OK
```

### 4.5 清理

用系統自己的刪除流程（`POST /api/privacy/deletion-intents` →
`DELETE /api/privacy/data`，需確認詞「刪除我的資料」）刪除 B，API 回報
`profileRowsDeleted:1, savedSchedulesDeleted:1, accountRowsDeleted:1,
interactionEventsDeleted:0`。**沒有只信這個數字**，直接查表逐一確認：

| 表 | 結果 |
| --- | --- |
| `User_Profiles`（`user_id=2`） | 0 列 |
| `User_Course_History`（`user_id=2`） | 0 列 |
| `Interaction_Events`（B 的 `subject_id`） | 0 列 |
| `Chat_Messages`（B 的 `subject_id`） | 0 列 |
| `users.json` | 只剩 `D1249697` |
| `saved_schedules.json` | 只剩 A 的一筆 |
| `Privacy_Subject_State`／`Privacy_Consents`／`Privacy_Audit_Log` | **依政策保留**，各 1～3 列，只含 HMAC subject_id 與同意/稽核紀錄，不含學號或其他個資 |
| `Privacy_Data_Requests` | 6 列（除錯過程中失敗的 4 筆待處理、成功刪除的 2 筆已完成）——這個表是刪除流程自己的請求紀錄，不在 `deleteUserServiceData()` 的清除範圍內，比照稽核類記錄保留；只含 HMAC subject_id 與 token 雜湊 |

## 5. 影響範圍

- `client/src/contexts/ScheduleContext.jsx`：`saveCurrentSchedule()` 補上帳號
  世代檢查。既有行為不變，只新增一個帳號切換當下的邊界情境。
- `client/src/contexts/ThemeContext.jsx`：新增註解，沒有改行為。
- `server/src/db/mysql.js`：連線池新增 `timezone: 'Z'`。**這個修正影響所有讀
  `DATETIME`／`TIMESTAMP` 欄位回 JS 的地方**，不只是這次踩到的刪除流程——
  範圍包含 `privacyService.js` 裡 consent／subject state 的顯示時間換算。
  行為上是**修正**（原本回傳的時間一律少 8 小時），沒有任何呼叫端依賴舊的
  錯誤值（此前這條路徑在真實 DB 上從未被驗證過、也沒有任何自動化測試通過
  這個分支）。
- `server/data/users.json`、共用 MySQL `User_Profiles`：驗收用帳號已於本次
  完整移除。

## 6. 測試與驗證結果

### 自動化

- 新增 `server/test/accountIsolation.test.js`（AC1-AC6，6 項），用真的能登入的
  固定帳號（`test/fixtures/account-isolation/users.json`）走 HTTP + cookie，
  取代先前手工 identity 物件的作法。
- `npm test`：**850 pass / 0 fail**（改動前 --，本輪含 #27 的 PM/CF 測試一併
  計入；純 #28 新增 6 項），golden set 8/8。
- `node --check` 全數通過。
- client `npm run build`／`npm run lint` 皆通過。

### 瀏覽器實機（見 4.2 完整流程）

同一瀏覽器連續操作：登入 A → 設偏好 → 排課 → 聊天 → 存課表 → 登出 → 登入 B →
（確認乾淨）→ 設偏好 → 排課 → 聊天 → 存課表 → 重新載入 → 登出 → 登回 A →
（確認乾淨）→ 未登入直接打 API（401）→ 以 A 的 session 冒用 B（403）。
`read_console_messages` 全程無新增錯誤。

### 未完成／如實記錄

- **這次沒有留下截圖檔案**——用 `get_page_text`／`javascript_tool` 直接讀
  DOM 文字與呼叫實際 API 逐項核對（課程清單、localStorage keys、資料庫查詢
  結果），文字層級的比對能逐字核對「B 是否真的沒看到 A 的內容」，但計畫
  裡承諾的是截圖；這裡沒有做到，如實記錄，不假裝已經截過圖。
- `Privacy_Data_Requests` 表留下 6 筆與 B 綁定的請求紀錄（見 4.5），是刪除
  流程本身的請求 bookkeeping，不受 `deleteUserServiceData()` 涵蓋；只含 HMAC
  subject_id 與 token 雜湊，不含可識別個資。

## 7. 明確不做

- **不建立前端自動化測試框架**（`client/` 目前沒有任何測試框架）——這輪的
  前端驗收是人工＋逐項 API／DOM 核對，導入 vitest／playwright 是獨立的一件事。
- **不修復假的技能樹區塊**（`DashboardPage.jsx` 的「我的專業技能樹」）——
  這不是跨帳號洩漏（兩帳號看到同一份假資料），是獨立的既有 bug，已另開任務
  追蹤，不在這輪範圍內。
- **不處理明碼密碼**：`users.json` 的密碼是明碼、無 rate limit，是既有狀況，
  屬於安全議題不是 `#28` 的隔離議題，記錄不改。
- **不清除 `Privacy_Data_Requests` 的殘留列**——那是系統設計上不透過
  一般刪除流程清除的紀錄類資料，手動去 DELETE 會偏離「只用系統自己的刪除
  功能」這個驗收前提。
