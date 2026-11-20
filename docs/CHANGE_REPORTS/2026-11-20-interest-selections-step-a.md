# 課程主題選擇改版 Step A：interestSelections 資料模型

## 1. 修改日期

2026-11-20

## 2. 背景

設定頁「想接觸的課程主題」預計改成「類別 → 追問具體標籤 → 標籤先驗」的流程，使用者勾選的結果要能
進入 S_tag（`rag-tag-interest-v1`）。整個改版分成多個 step 逐段審核，這份報告只涵蓋 **Step A：資料模型**。
設計草案與盤點結果在計畫檔，不在本 repo。

## 3. 修改檔案清單

- `server/src/data/interestPreferences.js`
- `server/src/data/interestTagEligibility.js`
- `server/src/data/profileUpdateValidation.js`
- `server/src/data/profileSchema.js`
- `server/src/services/memoryService.js`
- `server/src/services/preferenceLearningService.js`
- `server/test/interestPreferences.test.js`
- `server/test/profileUpdateValidation.test.js`
- `server/test/profileSchema.test.js`
- `docs/API_SPEC.md`、`docs/DATA_SCHEMA.md`
- `docs/CHANGE_REPORTS/2026-11-20-interest-selections-step-a.md`（本報告）、`docs/CHANGE_REPORTS/README.md`

## 4. 主要改動內容

- **新的偏好鍵 `interestSelections`**（存在 `preferences_json.values`，不改資料表）：陣列，每筆
  `{ group, categoryId, level, mode, tagIds }`，以 `(group, categoryId)` 為鍵。
  - 不用兩個全域陣列（分類 ID、標籤 ID）的原因：通識的「語言」與系外的「語言」各自選了日語與韓語時，
    兩個陣列無法還原答案分屬哪一組，取消其中一組也撤不乾淨。
  - `normalizeInterestSelections()` 只做形狀正規化：未知組別、空 `categoryId`、非物件項目丟掉；
    `tagIds` 去空白去重；同一個鍵以最後一筆為準；`level` 缺漏時由 ID 前綴推得；`mode` 只接受 `direct`。
  - `readInterestPreferences()` 與 `mergeInterestPreferences()` 接上新鍵；更新其他興趣欄位時不會洗掉它。
- **輸入驗證**：`POST /api/profile` 在邊界擋下型別錯誤的 `interestSelections`（不是陣列、項目不是物件、
  未知 `group`、空 `categoryId`、非字串 `tagIds`、超過 48 筆）。
- **`memoryService.updateUserPreferences()` 的 `jsonFields` 白名單**加入新鍵（漏了會被靜默丟棄）。
- **`hasExplicitPreferences()`**：只選了課程主題的使用者也算「有表達偏好」。
- **共用資格判定 `isSelectableInterestTag()`**：標籤必須同時可學習（`interestLearningEligible`）且可跨課配對
  （`crossCourseMatchEligible`）。排課時 `scoreCourseTagInterest()` 只計可跨課配對的標籤，所以只可學習、
  不可跨課的標籤存進先驗也不會改變別的課的分數。之後的選單、追問、保存驗證與先驗建構都要共用這一個判定。
- **刻意沒做**：類別與標籤是否存在於標籤目錄、標籤是否屬於所選組別，這一步不驗，留給後續的保存驗證。
  標籤目錄本身會 import `interestPreferences.js`，兩者放在同一個模組會循環 import。
- **舊的 `buildInterestOptions()` 保留**：它曾被移除又放回，因為 `routes/courses.js` 還在用；
  等新的分組選單接上後再一起移除。

## 5. 影響範圍

- **使用者看得到的行為沒有改變**：設定頁、追問流程、排課結果都還沒接上新欄位；沒有任何前端或排課器的修改。
- API：`POST /api/profile` 多接受 `interestSelections`，送其他欄位的呼叫端不受影響。
- 資料：`preferences_json.values` 多一個可選的鍵，舊資料讀取時得到空陣列。
- 未動 `scheduler.js`，不需要 S1-S10。
- 未推進 roadmap 任務的狀態（#43 的約定範圍已於 2026-10-11 完成，這是它之後的延伸改版，尚未完成），
  所以沒有修改進度總覽表。

## 6. 測試與驗證結果

- 新增 20 個測試：`interestPreferences.test.js` 的 IS1～IS12（形狀正規化、跨組不混、同鍵以最後一筆為準、
  合併不洗掉其他鍵、清空、讀取冪等、資格判定、`hasExplicitPreferences`）、`profileUpdateValidation.test.js`
  的 IV1～IV5、`profileSchema.test.js` 的 IP1～IP3；更新 1 個既有測試（`readInterestPreferences` 的
  `deepEqual` 多了 `interestSelections: []`）。
- 後端完整測試：1,614 個，1,613 通過、0 失敗、1 略過。
- 修改過的 6 個後端檔案與 `server/src/**/*.js` 的 `node --check` 通過。
- 這一步沒有前端或 API 路由的行為改變，所以沒有做瀏覽器驗收；瀏覽器 Persona A/B 驗收留到最後一個 step。

## 7. 是否 commit 與 push

是，推到 `origin backend`。`profileUpdateValidation.js` 與其測試、`docs/API_SPEC.md`、
`docs/CHANGE_REPORTS/README.md` 原本就有別人尚未提交的修改，這次只提交屬於 Step A 的區塊，
其餘沒有一起提交。
