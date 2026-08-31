# 2026-08-31 Roadmap #23：版本化畢業規則、逐門認列追溯與補學分推薦修正

## 1. 修改日期

2026-08-31

## 2. 為什麼做這件事

使用者列出 `#23` 的五個缺口並問「可以完成嗎？」。逐一查證程式碼與**線上真實資料**後，
發現五項的性質並不一樣，其中一項的前提已經不成立：

| 原記錄的缺口 | 查證結果 |
| --- | --- |
| 沒有逐門歷史課程分類，學分是預先彙整的 `completedCredits: 118` | **已過期**。roadmap 那段標的是「2026-08-08 盤點」，但 2026-08-11 起 `getEarnedCredits()` 就是逐門推導，`completedCredits` 已從 `users.json` 移除；MySQL `User_Course_History` 每列也都有 `graduation_category`。真正缺的只是**把「哪些課湊出 61 學分」呈現出來** |
| 補學分推薦沒驗證能否補足 gap，班級活動被當通識推薦 | **真 bug，已重現**（見 4.3） |
| 每筆認列沒有規則來源與人工待確認狀態 | 確實沒有，本次補上 |
| 沒有版本化，缺 `program + degree + admissionYear + ruleVersion` 鍵 | 架構本次補上；但**系所學分維度只有 114 一版真實資料**，見第 7 節 |

## 3. 修改檔案清單

### 後端

| 檔案 | 改動 |
| --- | --- |
| `server/src/data/graduationRuleVersions.js` | **新增**。版本化規則解析，寫法沿用 `generalEducationCatalog.js` 的 `GENERAL_EDUCATION_RULES` |
| `server/src/data/admissionYear.js` | **新增**。入學年度的雙來源交叉驗證（純函式，migration 回填用） |
| `server/src/data/graduationRequirements.js` | 49 筆掛進 `114` 版並帶出處常數，**數字完全未動** |
| `server/src/data/courseHistory.js` | 新增 `getEarnedCreditsAttribution()`，與 `getEarnedCredits()` 共用同一組篩選 |
| `server/src/routes/graduation.js` | 改用版本化解析；新增 `buildCreditRecommendations()`；回應新增 `attribution` 與規則版本欄位 |
| `server/src/db/database.js` | `admission_year` 選用欄位的偵測、讀取與**防呆寫入** |
| `server/src/data/profileSchema.js` | 新增 `admissionYear` 欄位與驗證 |
| `server/src/services/promptService.js` | `update_student_profile` 加 `admissionYear`；兩處措辭修正（見 4.4、4.5） |
| `server/src/services/agentService.js` | 新增 `sanitizeProfileScopeArgs()` |
| `server/migrations/005_admission-year.{up,down}.sql`、`server/scripts/admissionYearMigration.js` | **新增** |

### 前端

`client/src/pages/GraduationPage.jsx`（推薦標籤改用 `fillsGap`、新增逐門認列展開區）、
`client/src/App.css`。

### 測試與文件

`server/test/graduationRuleVersions.test.js`、`server/test/graduationAttribution.test.js`（皆新增）；
`docs/DATA_SCHEMA.md`、`docs/API_SPEC.md`、`docs/COURSE_SELECTION_RULES.md`、
`docs/TEST_PLAN.md`、本報告與索引、roadmap `#23` 段落。

## 4. 主要改動內容

### 4.1 版本化規則模型

`resolveGraduationRule({ program, degree, admissionYear })` 回傳 `requirement` 加上
`ruleVersion`／`ruleSource`／`coverage`／`needsVerification`／`appliedFallbackVersion`。

**沒有對應版本時退回最新一版，但一定要說出來。** 112 入學生會拿到 114 版的數字，
同時得到一句「112 學年度入學適用的版本尚未取得…僅供參考」。不回傳 `null`
（畢業進度不能因為缺歷史版本就整個算不出來），也不假裝那就是他那年的規則。

### 4.2 逐門認列追溯

`getEarnedCreditsAttribution()` 與 `getEarnedCredits()` **共用
`getLatestAttemptsByCourseCode()` 與同一組篩選條件**，各分類總和恆等於既有計算。
這是刻意的：兩邊各寫一套遲早會漂移，畫面上就會同時出現「尚缺 X 學分」與一份
加起來對不上的課程清單——`completedCredits` 當初就是這樣長出來的。G10 釘住這件事。

每一筆帶 `ruleVersion`／`ruleSource`／`needsVerification`／`attributionSource`。
`attributionSource` 目前只有 `course_history_category` 一種值，欄位先存在是為了
日後取得官方逐門認列表時不必再改一次對外契約。

### 4.3 補學分推薦：先驗證補得上缺口

**改動前的行為已用線上資料重現，不是推論。** `departmentCourses[0]` 沒有排序、
沒有排除不計入畢業學分的課，資訊工程學系 119 門候選裡第一門就是 `班級活動`
（`GEID0010`，0 學分）；學生的修課歷史裡沒有它，所以也不會被已修排除濾掉。
前端再把所有非 `warning` 的推薦一律標成「💡 通識推薦：」——而它的真實分類是必修。

新的判定順序：已修排除 → `countsTowardGraduation()` → 資格排除 → 對映缺口分類 →
只留缺口 > 0 者 → 明確排序 → 同課號去重 → 取前 3 筆。全部補滿時回空陣列，不硬推。

**開發過程中自己的測試抓到一個漏洞**：第一版的分類對照表漏了原始的 `選修`。
`classifyCsCourse()` 依**課名**比對，比對不到就退回 MySQL 原始值——實測資訊工程學系
有 11 門會落在這裡（高等資訊安全、影像處理、資訊保密與安全…），它們確實是本系選修，
漏掉那一行會讓它們永遠不被推薦。已補上並加 G14 迴歸測試。

### 4.4 `admissionYear` 欄位與 migration

`User_Profiles` 原本沒有這個欄位（實查現有 14 欄）。新增 `005_admission-year`，規格比照
`courseHistoryMigration.js`：預設 dry-run、`--apply` 需併 `--confirm-shared-mysql`、
寫入前備份、重複執行不覆蓋既有值、`--rollback` 保留資料。

**回填一律交叉驗證**：`grade_level + ACTIVE_TERM` 推一次、`User_Course_History` 最早
學年度推一次，一致才寫。demo 帳號兩者皆為 `112`（`114 − 3 + 1` 與 `MIN(academic_year)`）。
不一致就留 `NULL`——錯的入學年度會靜默選到錯的規則版本。

執行期沿用 `database.js` 已有三次的選用欄位模式（`SHOW COLUMNS` + 快取 + 失敗退回
`false`），欄位不存在時 `admissionYear` 為 `null`。

### 4.5 加欄位引發的兩個真實回歸（都由測試抓到，都已修）

**(a) 模型不再呼叫 `update_student_profile`。** 加上 `admissionYear` 之後，golden set 的
`profile-correction` 由通過變成失敗——模型改成先追問入學年度，不再更正使用者已經
講明的系所／年級／班別。**用 A/B 確認因果，不是猜的**：同一句話、同一組 prompt，
帶 `admissionYear` 欄位 **3/3 不呼叫工具**，移除該欄位 **3/3 正常呼叫**。修法是在工具
說明明講「四個欄位都是選填，沒講到就直接省略，不要為了填滿欄位而追問」。修正後 4/4 恢復。

**(b) 模型改送 `admissionYear: 0` 當佔位值**（修好 (a) 後 4/4 都送 `0`）。這條會造成
**真實資料損毀**：`normalizeNumber(0, null)` 回傳 `0`，會把資料庫裡真正的 `112` 洗掉。
兩道防護：工具邊界的 `sanitizeProfileScopeArgs()` 丟掉佔位值（使用者也就不會在確認
訊息裡看到「入學年度改成 0」），寫入層再拒絕一次不合法年度並記 warn。G17 釘住。

### 4.6 順帶修掉的既有不穩定

determinism 測試在本輪出現間歇失敗，差異是 `allowRelaxation: false` 有時送、有時不送
（語意相同、位元不同）。原 prompt 寫「不要設 allowRelaxation」，模型有時理解成
「設成 false」。改成明講「整個省略這個參數，不要送 `allowRelaxation: false`」，
理由與既有的 `minCredits`／`maxCredits` 規則同一條。修正後連續 4 輪通過。

**誠實說明**：我無法斷定這條不穩定是本輪引入還是先前就存在、只是被取樣運氣蓋過去
——我的 prompt 改動確實會擾動模型輸出。但這是輸出空間過大的既有脆弱點，
兩種情況下都該修，因此照修並記錄。

## 5. 影響範圍

- `GET /api/graduation/*`：新增 `attribution`、`admissionYear`、`ruleVersion`、`ruleSource`、
  `ruleCoverage`、`appliedFallbackVersion`；`recommendations` 每筆新增
  `fillsGap`／`gapLabel`／`gapBefore`／`credits`／`ruleVersion`。既有欄位語意不變。
  **行為變更**：推薦內容改變，這正是本次要修的。
- `User_Profiles` 新增一個 nullable 欄位（additive，對組員既有讀寫無影響）。
- 排課引擎、隱私與互動記錄路徑完全沒有改動。

## 6. 測試與驗證結果

### 自動化

- `npm test`：**713 pass / 0 fail**（改動前 672，新增 41 項），連續兩輪全綠，golden set 8/8。
- `node --check`：所有改動的後端檔案通過。
- `client`：`npm run build` 成功、`npm run lint` 無輸出。

### Migration

dry-run 先跑，輸出 `columnExists: false`、`willBackfill: 1`、demo 帳號兩來源皆 112；
確認後才 `--apply --confirm-shared-mysql`。再跑一次確認 idempotent
（「已存在，跳過 ALTER TABLE，只做回填」，值不變）。

### 瀏覽器實機（真實 MySQL、demo 帳號）

畢業頁三項同時驗到：

1. **版本 fallback 警告**：「目前只有 114 學年度必選修科目表，112 學年度入學適用的
   版本尚未取得…僅供參考」。這是讀 migration 實際寫入的 `admission_year = 112`
   算出來的，不是手動塞的值。
2. **逐門追溯**：各卡片顯示「已修 61 學分（25 門）／22（8）／24（12）／11（5）」，
   與資料庫 `GROUP BY graduation_category` 的結果逐項相符。
3. **推薦修正**：班級活動消失，改為行動應用程式開發／電子商務安全／多媒體系統
   （皆 3 學分），標籤為「💡 本系選修推薦：」。

**A/B 對照**（同一份線上資料，同時跑新舊兩套邏輯）：

```text
BEFORE -> departmentCourses[0]: 班級活動 | credits: 0 | code: GEID0010
          前端會標成: 💡 通識推薦：
AFTER  -> ["行動應用程式開發(3cr, 本系選修)","電子商務安全(3cr, 本系選修)","多媒體系統(3cr, 本系選修)"]
```

順帶驗到已修排除確實生效：`系統分析與設計`（IECS2011）沒有出現在推薦裡，
因為該生已修過並通過。

## 7. 誠實的驗收標準對照

| `#23` 驗收標準 | 結果 |
| --- | --- |
| 與系辦確認的 golden student cases 逐項學分相符 | **不宣稱**。沒有系辦確認過的 golden cases；目前只有 demo 帳號一位，且其分類來自匯入的成績單而非系辦核對 |
| 0 學分班級活動不會被當成補通識或畢業學分的推薦 | **完成**，已用線上資料 A/B 驗證 |
| 相同學生在不同 rule version 下能得到可追溯差異 | **不宣稱（系所維度）**。架構支援，但校方只公布 114 一版，112／113 的 PDF 尚未取得——只有一版時「比較差異」是空的。**通識維度做得到**（三個真實版本） |
| 每個 gap 與推薦都能指出使用的規則版本與課程分類依據 | **完成**。`attribution` 每筆與每則推薦都帶 `ruleVersion`／`ruleSource`／`needsVerification` |

## 8. 明確不宣稱

- **系所學分維度的多版本比較**：只有 114 一版真實資料。取得歷史科目表前不得宣稱完成。
- **逐門認列的來源仍是匯入成績單的 `graduationCategory`**，不是官方逐門認列表。
  `attributionSource` 欄位已預留，目前只有一種值。
- `withdrawn`／`transferred`／`exempted` 多狀態模型不在本輪，需要校方對「停修是否計入」
  的正式規則（外部相依）。
- 跨院認抵 6／4 學分上限與 112-1～114-1 舊學期逐門課號比對仍缺歷史課程檢索資料。
- 推薦目前只從**本系開的課**挑（沿用既有 `departmentCourses` 範圍），因此
  `general`／`external` 缺口實務上補不到通識或他系的課。擴大候選範圍屬另一件事，
  本次未做——但缺口分類的對映與驗證已經就位。

## 9. 附帶記錄

`User_Profiles` 已有組員新增的 `program_type`／`enrolled_programs`／`college` 三個欄位，
本專案目前完全沒有讀寫。那是 `#13D`（學制、學程與特殊身分）的材料，不在本輪範圍，
但記在這裡避免下次又被當成「不存在」而重複新增。

## 10. 是否 commit 與 push

見本次 commit 紀錄。
