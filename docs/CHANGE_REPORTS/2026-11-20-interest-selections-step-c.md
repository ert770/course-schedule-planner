# 課程主題選擇改版 Step C：選單分組、設定檔與候選池快取

## 1. 修改日期

2026-11-20

## 2. 背景

接續 [Step A](./2026-11-20-interest-selections-step-a.md)（資料模型）與
[Step B](./2026-11-20-interest-selections-step-b.md)（S_tag 先驗）。這一步建立設定頁新的課程主題選單：
從標籤目錄的類別分三組，每組只放 S_tag 實際作用的課。設定頁與追問流程尚未接上。

## 3. 修改檔案清單

- `server/src/data/interestMenuConfig.js`（新增）
- `server/src/data/interestTopicGroups.js`（新增）
- `server/src/services/interestMenuService.js`（新增）
- `server/src/routes/courses.js`
- `server/test/interestTopicGroups.test.js`（新增）
- `server/test/interestMenuService.test.js`（新增）
- `docs/API_SPEC.md`
- `docs/CHANGE_REPORTS/2026-11-20-interest-selections-step-c.md`（本報告）、`docs/CHANGE_REPORTS/README.md`

## 4. 主要改動內容

- **三組選單**：本系用子類別，通識與系外用大類別。分組**直接用排課器的 `getGraduationBucket()`**
  （本系選修、通識、系外），選單的範圍與 S_tag 實際作用的桶一致，不另寫一份分類邏輯。必修與「其他」桶
  （應用外語、體育、學院綜合班、學分學程）不列入：勾了也不會影響排課。
- **只統計可選標籤**：標籤先經別名解析，再用 Step A 的 `isSelectableInterestTag()` 篩，所以不會出現
  「點進去卻沒有可計分標籤」的類別。同一門課開多個班只算一次；每組依課程數排序，最多 8 個。
- **重複子類別併成一個選項**：同一組「池內可選標籤集合」完全相同的子類別（例如「程式」「資料與資訊系統」
  「AI」），併成一個選項，其餘 ID 放在 `aliasIds`。**名稱一律用目錄原名，不做顯示名稱對照**（使用者決定
  不做）；代表者的選法：白名單優先，其次名稱較長者，最後以 ID 排序讓結果可重現。
- **`direct` 只給白名單**（目前只有「資訊安全與隱私」）：不追問，直接展開候選池裡實際命中的標籤供確認。
  不用「標籤數 ≤ N」判斷，因為盤點顯示小不等於一致。
- **理工排除只適用系外組**：資電、工程與科學、建設三個學院加上設定檔明列的單位（環境工程與科學學系、
  航太與系統工程學系、人工智慧技術與應用學士學位學程、應用數學系、創能學院綜合班）。只排除選單，不影響
  排課計分；S_tag 依全域標籤配對，理工系外課仍可能因共享標籤被加分（已知限制）。
- **候選池快取**：重建一次約 2 秒，以系所、年級、班別與學期為鍵快取 10 分鐘；失敗不快取、同時發生的
  呼叫只查一次、最多 200 份。候選池與分桶用排課同一個 `buildStudentScope()`。
- **`GET /api/courses/interest-options`** 多回 `topicGroups`；舊的 `topics` 與 `topicCourseCount` 暫時保留，
  設定頁改讀 `topicGroups` 之後移除。

## 5. 影響範圍

- **使用者看得到的畫面沒有改變**：設定頁仍讀舊的 `topics`；沒有排課器修改，不需要 S1-S10。
- API：`/interest-options` 多一個欄位，既有欄位與值不變。
- 未推進 roadmap 任務的狀態（#43 延伸改版，尚未完成）。

## 6. 測試與驗證結果

- 新增 28 個測試：`interestTopicGroups.test.js` 12 個（TG1～TG10 與 TG5b，純函式分組）、
  `interestMenuService.test.js` 16 個（SV1～SV15，理工判定、分桶、快取、假候選池端到端）。
- 後端完整測試：1,669 個，1,668 通過、0 失敗、1 略過。
- `server/src/**/*.js` 共 118 個檔案加上 3 個新檔 `node --check` 通過。
- **真實資料庫唯讀實測**：直接呼叫 `/interest-options` 的路由處理函式，資工、企管、外文三年級都回 HTTP 200；
  候選池第一次 1.7～3.2 秒、快取後約 15 毫秒。資工三年級：本系 8 個選項（其中「資訊安全與隱私」為 `direct`，
  展開資訊安全、數據保護）；系外組有「語言、文學與溝通」（17 門、29 個可選標籤）。
  這次實測**不是可重複執行的自動化測試**（路由依賴資料庫）。
- 沒有前端畫面改變，所以沒有做瀏覽器驗收；瀏覽器 Persona A/B 驗收留到最後一個 step。

## 7. 已知問題（待使用者審核）

- 資工三年級的本系選單有兩個內容混雜的選項（「人力資源與營運」「航太與製造」），下一個變更處理。
- 通識組對資工與企管學生都會出現「資訊與計算」「工程與製造」這類大類別：通識課本身有這些主題，但可能只是
  因為課程帶了 Chat GPT、AI工具之類的附帶標籤，勾選後可能推錯課程。目前**沒有過濾**，等使用者審核。

## 8. 是否 commit 與 push

是，推到 `origin backend`。`docs/API_SPEC.md`、`docs/CHANGE_REPORTS/README.md` 原本就有別人尚未提交的
修改，這次只提交屬於本次的區塊。
