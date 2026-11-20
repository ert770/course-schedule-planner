# 課程主題選單新增「人工智慧」選項、明確選擇的太常見標籤計分，並補路由測試

## 1. 修改日期

2026-11-20

## 2. 背景

1. **系上 AI 課拿不到課程主題的加分。** 資工候選池的本系 AI 課只有三門：《人工智慧導論》《人工智慧自然語言導論》《電腦視覺與擴增實境》。
   - 「人工智慧」（全校 99 門、4.9%）、「機器學習」（3.1%）、「Python」（4.0%）超過 2% 門檻，被判為 `too_common`，不能選也不計分。
   - 《人工智慧導論》能計分的標籤只剩資料科學、金融科技、醫療科技；選深度學習、生成式AI 只會加分給《人工智慧自然語言導論》。
   - 目錄的「AI」子類別和「程式」「資料與資訊系統」標籤清單完全相同，已被併進「資訊與計算：資訊科技、軟體開發、資訊安全 等」，選單上看不到 AI。
   - 使用者說明系上 AI 課選的人多，要求處理；系外先不管。
2. **路由層沒有自動化測試。** `/interest-options`、`/interest-followups`、`POST /api/profile` 的保存回應只靠瀏覽器驗收（Step G 已知缺口）。

使用者選定做法：AI 直接選項＋明確選擇豁免（決策記於 ADR-026）；路由處理邏輯抽成可注入的函式並補測試。

## 3. 修改檔案清單

- `server/src/data/interestMenuConfig.js`：新增 `CURATED_DIRECT_OPTIONS`（`curated_ai`「人工智慧」，只限資訊工程學系）
- `server/src/data/curatedInterestOptions.js`（新增）：策畫選項解析、標籤資格（清單內的 too_common 可選）、計分豁免判定、候選池命中統計、本系選單選項
- `server/src/data/interestTopicGroups.js`：本系選單最前面加上策畫選項，不佔 8 個名額
- `server/src/data/interestSelections.js`：`curated_ai` 對應到目錄「資訊與計算／AI」子類別；策畫選項的標籤對照人工清單，標記 `scoringExempt`
- `server/src/services/interestSelectionService.js`：保存驗證認得策畫選項（系所必須適用、標籤必須在候選池命中）
- `server/src/skills/tagInterestLearning.js`：先驗與 `tagInterests` 帶 `selectionScoringExempt`；`scoreCourseTagInterest()` 對這位使用者把豁免標籤算進可配對標籤
- `server/src/routes/courses.js`：抽出 `buildInterestOptionsResponse()`，行為不變
- `server/src/routes/profile.js`：抽出 `handleInterestFollowupsRequest()`、`applyInterestSelectionValidation()`、`buildProfileSaveResponse()`，行為不變
- `server/test/curatedInterestOptions.test.js`（新增，19 個）、`server/test/interestRoutes.test.js`（新增，18 個）
- `docs/DECISIONS.md`（ADR-026）、`docs/API_SPEC.md`、`docs/DATA_SCHEMA.md`、`docs/TEST_PLAN.md`
- `docs/CHANGE_REPORTS/2026-11-20-curated-ai-topic-and-route-tests.md`（本報告）、`docs/CHANGE_REPORTS/README.md`

## 4. 主要改動內容

### 4.1 「人工智慧」策畫選項

- 本系選單最前面多一個「人工智慧」直接確認選項，展開成人工清單在候選池實際命中的標籤：人工智慧、機器學習、深度學習、生成式AI、自然語言處理、語言模型、電腦視覺。
- 分類 ID 用 `curated_ai`（不用目錄 ID，避免與已含「AI」子類別的併合選項撞在同一個 `(group, categoryId)`）；`categoryInterests` 記成目錄的 AI 子類別。
- 只對資訊工程學系、只在候選池有命中時出現。

### 4.2 明確選擇的太常見標籤計分（ADR-026）

- 只有「策畫清單內的 `too_common` 標籤、從策畫選項選擇」才豁免；`explicit_generic`、只出現在一門課的標籤不豁免，Python 不在清單也不豁免。
- 從目錄「AI」子類別送「人工智慧」仍然被拒絕（`tag_not_selectable`）。
- 豁免只影響選了的使用者：先驗與 `tagInterests` 帶 `selectionScoringExempt`，單課計分時這位使用者的這些標籤算進可配對標籤；沒選的人分數完全不變。行為學習照舊不學太常見標籤。

### 4.3 路由測試

把三段路由邏輯抽成可注入假資料的函式（路由本身只剩呼叫與回應），新測試分兩層：處理函式注入假候選池／偏好／追問服務；真的 app（不連資料庫、隱私資料用記憶體）測 401、428、400、429 與缺班別。

## 5. 影響範圍

- 使用者看得到：資工學生的設定頁本系選單多了「人工智慧」選項。
- 排課計分：只有選了「人工智慧」選項的使用者，帶人工智慧／機器學習標籤的課會被加分（含系外，見 7.）。沒有改排課器本身，不需要 S1-S10。
- API：`/interest-options` 的本系組可能多一個 `nameSource: "curated"` 的選項；`interestSelections.categoryId` 可為 `curated_ai`。欄位與既有前端相容，前端不需修改。
- 未改資料表欄位；`preferences_json` 內的 profile 多一個選用欄位 `selectionScoringExempt`（已寫入 DATA_SCHEMA）。

## 6. 測試與驗證結果

### 6.1 自動化

- `npm test`：1,762 個，1,761 通過、0 失敗、1 略過（包含工作樹裡別人尚未提交的 `profileUpdateValidation` 測試）。新增 37 個。
- `server/src/**/*.js` 全部 `node --check` 通過。
- **突變測試**：拿掉計分豁免 → `curatedInterestOptions.test.js` 1 個失敗；拿掉「以驗證結果取代送來的選擇」→ `interestRoutes.test.js` 1 個失敗。還原後全過。

### 6.2 瀏覽器（demo 帳號 D1249697，資工四合；真實資料庫）

1. 本系選單第一個是「人工智慧」，其後是原本 8 個選項。
2. 勾選後展開：機器學習 3 門（人工智慧導論、人工智慧自然語言導論、智慧物聯網實務應用）、人工智慧 2 門、生成式AI、自然語言處理、深度學習、電腦視覺、語言模型各 1 門，預設勾好。
3. 保存回 200，沒有警告；`interestSelections` 有 `curated_ai` 一筆 7 個標籤；`GET /api/privacy/tag-interests` 的 7 個標籤 p₀ = 1，只有人工智慧、機器學習帶 `selectionScoringExempt`；`categoryInterests` 有「AI」子類別。
4. 排課：主方案一門通識由《系統品質建模與挑戰》換成《人工智慧入門與省思》；方案數由 2 個變 1 個。這位學生本學期的本系選修沒有排進三門 AI 課。
5. 還原後與測試前快照一致；console 沒有這輪新增的錯誤。

### 6.3 全部資工帳號 A/B（服務層，不保存、不記錄曝光；24 個帳號）

A 組在記憶體裡加上「人工智慧」選項（全部命中標籤），B 組為帳號現有偏好；方法同 Step G 報告 6.5。

- 單課 S_tag（只看先驗）：人工智慧導論 0 → 0.44、人工智慧自然語言導論 0 → 0.83、電腦視覺與擴增實境 0 → 0.17。
- 有修課紀錄的帳號中，AI 課被排進方案的情形增加，例如：
  - D0009009：人工智慧導論 0/2 → 1/3 個方案、人工智慧自然語言導論 0/2 → 2/3。
  - D0009005：人工智慧導論 1/3 → 2/2、人工智慧自然語言導論 0/3 → 2/2。
  - 帳號 2：人工智慧導論 1/2 → 2/2、人工智慧自然語言導論 0/2 → 2/2。
  - D0009001、D0009004 的人工智慧導論 0 → 1 個方案。
- 沒變的帳號：D0009002、D0009006、D0009008、D0009010 等。原因沒有逐一查（可能是本系選修名額已滿、時段衝突或基礎分差距），API 沒有回傳候選分數。
- **系外外溢**：多個帳號的 A 組新增理工單位開的系外課，例如名為「人工智慧」「自然語言處理」的課、《深度學習概論》《智慧製造》。沒有修課紀錄的 10 個帳號特別明顯。使用者決定系外先不處理，記為已知限制。

## 7. 已知問題與待決

- 豁免讓全校帶「人工智慧」「機器學習」的課都對選了的使用者加分，系外（含理工單位）外溢比 ADR-025 的情形更大。
- 《電腦視覺與擴增實境》只有「電腦視覺」一個命中標籤，加分小（0.17）。
- 「Python」不加入清單、仍不計分（使用者 2026-11-20 決定）。
- 策畫選項目前只有一個；新增項目要逐一列出標籤並對照候選池審核。

## 8. 是否 commit 與 push

是，推到 `origin backend`。`docs/API_SPEC.md`、`docs/CHANGE_REPORTS/README.md` 原本就有別人尚未提交的修改，只提交本次的區塊。
