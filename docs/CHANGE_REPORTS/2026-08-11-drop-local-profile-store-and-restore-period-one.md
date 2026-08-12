# 刪除本機 profile 檔，並讓 `avoid_time` 恢復第 1～14 節

日期：2026-08-11

## 摘要

兩件互相獨立的改動：

1. **刪除 `server/data/user_preferences.json`**，並拆掉所有會重新產生它的路徑。
   `User_Profiles` 成為 profile 的唯一儲存體。
2. **推翻「決策 C」**。`avoid_time` 恢復保存第 1～14 節；`#不排早八` 只管第 1 節
   但涵蓋每一天。兩者互相獨立、可重疊，排課時取聯集。

## 一、為什麼推翻決策 C

決策 C 規定「第 1 節只能用 `#不排早八` 標籤設定，`avoid_time` 只管第 2～14 節」，
理由是「同一個限制存在兩處必然漂移」。

**那個前提是錯的：兩者根本不是同一個限制。**

| 設定 | 涵蓋範圍 | 語意 |
| --- | --- | --- |
| `avoid_time` | 第 1～14 節，逐格指定星期 | 「星期三第 1 節我不要」 |
| `#不排早八` | 只有第 1 節，但跨整週 | 「每天第一節我都不要」 |

把第 1 節從 `avoid_time` 剝掉，等於讓使用者**無法表達「只避開某一天的早八」**。
更糟的是讀取時的反向推導：`avoid_time` 含第 1 節就自動補上 `#不排早八` 標籤，
把「星期三第 1 節」放大成「每天第一節」，而且偏好面板上會出現使用者從沒勾過的標籤。

排課引擎本來就分別判定這兩個條件（`scheduler.js` 的 `hardConstraintReason()`
檢查 `noMorningClasses` 的 `startPeriod <= 1`，另外迴圈檢查 `blockedPeriods`），
**聯集是現成行為，不需要任何額外處理**。整套剝除／推導邏輯是純粹的多餘複雜度。

### 拆掉的東西

| 檔案 | 移除內容 |
| --- | --- |
| `server/src/utils/periods.js` | `findMorningPeriodEntries()`、`stripMorningPeriods()` |
| `server/src/db/database.js` | `normalizeAvoidTime()` 的第 1 節剝除、`avoidTimeImpliesNoMorning()`、`mapUserProfileRow()` 的 `impliedTags` 推導、寫入時的第 1 節剝除 |
| `server/src/routes/profile.js` | 對含第 1 節的 `blockedPeriods` 回 `400` 的守門 |
| `client/src/components/Setup/AvoidTimePicker.jsx` | 第 1 節列的 `disabled` 與「請改用 #不排早八」提示 |
| `client/src/constants/periods.js` | `MORNING_PERIOD`、`SELECTABLE_PERIODS`（後者本來就無人使用） |
| `client/src/App.css` | `.avoid-time-row-disabled`、`.avoid-time-cell:disabled` |

`server/src/utils/periods.js` 保留 `MORNING_PERIOD` 常數與說明兩者分工的註解。

## 二、為什麼刪除 `user_preferences.json`

該檔對 demo 使用者只剩 `{ id, userId, updatedAt }`，沒有任何實質欄位。它的存在
造成同一份 profile 有兩個儲存位置，各自演化——實測就出現過 MySQL 說「避開早八」
而 JSON 說「不避」，而且沒有任何東西能判斷誰對。

刪檔本身不夠：`writeCollection()` 會直接建檔，任何殘留的寫入路徑都會讓它長回來。
因此連同下列路徑一併拆除：

| 位置 | 動作 |
| --- | --- |
| `MYSQL_ONLY_COLLECTIONS` | 加入 `'user_preferences'`，未設定資料庫時拋出明確錯誤 |
| `assertMysqlAvailable()` | 新增；**讀寫兩端都套用**，`upsertByField()` 也擋 |
| `readCollectionBySource()` | 移除本機 profile 的正規化分支 |
| `getMysqlUserPreferences()` | 移除本機 profile 的串接 |
| `readClassNameOverrides()` | 移除讀本機 profile 的順位 |
| `writeLocalProfileClassName()` | 整支刪除 |
| `pickClassNameTarget()` | 移除 `'localProfile'`，無處可存時回傳 `null` |
| `upsertByField()` | 移除落回本機 JSON 的後路，改為拋錯 |

### 取捨：班別可能無處可存

`User_Profiles` 目前**沒有 `class_name` 欄位**（`SHOW COLUMNS` 確認：只有
`user_id, department, grade_level, preference_tags, avoid_time, completed_courses,
max_credits`）。本機 profile 檔唯一剩餘的用途，就是接住「在 `User_Profiles` 裡、
但 `users.json` 沒有對應列」的使用者的班別。

刪掉之後這種使用者的班別無處可存。**處理方式是明確拋錯，不是靜默丟棄**——
最早的那個 bug 正是班別「儲存成功」地消失，下一次排課無聲地退回系所 + 年級。

實務上這條路徑打不到：demo 使用者 `D1249697` 在 `users.json` 有列且
`className` 為「資訊三乙」。組員補上 `class_name` 欄位後這個限制自然消失。

## 三、驗證

`npm test` 257 通過（原 255；`identity.test.js` 的 C1 從 3 個案例改寫成 4 個，
`courseScope.test.js` 的 `pickClassNameTarget` 從 4 個增為 5 個）、
`npm run lint`、`npm run build`、`node --check src/app.js` 皆通過。後端冷啟動正常。

共用 MySQL `User_Profiles.user_id=1` 驗證前記錄、驗證後已還原為
`preference_tags: ["#不排早八","#星期一排空"]`、`avoid_time: []`。

### 瀏覽器實測

| 情境 | 結果 |
| --- | --- |
| Setup 點選「星期三 第 1 節」→ 儲存 | 不再回 400；MySQL `avoid_time` 存入 `[{"day":3,"period":1}]` |
| 重新整理 Setup | 第 1 節的勾選保留（讀取不再剝除）；98 格全部可點、`disabled` 為 0 |
| 同時選星期一與星期三的第 1 節 | 兩筆都存進 `avoid_time`——這正是舊規則無法表達的需求 |
| **取消 `#不排早八`，只留 `avoid_time` 第 1 節** | API 回傳 `selectedTags: []`，且 **`noMorningClasses` 完全不存在**（不是 `false`）。標籤不再被反向推導出來 |
| 封鎖星期三第 3、11 節 → 排課 | 9 門 25 學分 → 8 門 23 學分；`系統安全`（三 3-4）與 `資訊實務案例探討`（三 11-12）都回報「位於封鎖時段」 |
| Setup 儲存 → Dashboard | 側邊 13 項偏好與 MySQL 一致；`localStorage` 無 `fcu_initial_prefs` |
| Dashboard 勾選偏好 | 立即寫入 MySQL，無錯誤訊息 |
| 刪檔後完整跑一次登入 → Setup → Dashboard → 排課 | `server/data/user_preferences.json` **未被重新產生** |
| 畢業進度 | 資訊工程學系、118/128、無警告——`getUserPreferences()` 失去本機來源後仍正常 |
| 未帶身分 / 未知使用者 | 401「未提供有效的使用者身分，請先登入」／404「找不到使用者」 |
| 全新分頁 console | 無錯誤 |

### 順帶驗證「合成 false」問題

排課時 Memory 層印出的 profile 只含 `noMorningClasses: true` 一個旗標，
其餘 12 個旗標**完全不存在**，不是 `false`。`tagsToFlags()` 只展開為 true 的項目，
缺席即代表未勾選——合成值覆蓋真實值的成立條件已不存在。刪除
`user_preferences.json` 之後更連「第二個來源」都沒有了。

## 四、發現但未處理

**AI 聊天目前無法使用，原因是 Gemini 模型已下架，不是配額用盡。**
後端日誌：

```
[ERROR] [AgentCore] Agent 聊天發生錯誤：{"error":{"code":404,
"message":"This model models/gemini-2.5-pro is no longer available to new users..."}}
```

同一筆日誌顯示身分解析、profile 載入（含 `blockedPeriods`、`preferenceTags`、
`className`、53 筆 `completedCourseCodes`）全部正常，失敗發生在呼叫模型那一步，
**與本次改動無關**。需更換模型 id，屬另一件事。

## 五、本次未做

Step 2（課號統一，`subid3` = `catalogCourseCode`）與移除 Setup
「2. 已經修過的選修課程」區塊延後。`User_Profiles.completed_courses` 這個
共用欄位的處理方式屬該範圍，本次未動。

過程中量到的相關事實：demo 使用者 53 個 `completedCourseCodes` 中有 38 個
在當期 `Courses` 有開（對應 485 個 sections）；該生 16 門的候選池裡有 **6 門是
已經修過並通過的課**（`IECS3003` 計算機結構學、`IECS3002` 計算機演算法、
`IECS4926` 專題研究(一) 三門必修，以及 `IECS3059` 人工智慧導論的 3 個班次）。
本次驗證產出的課表確實含有這 3 門必修——已修排除機制目前完全失效。
