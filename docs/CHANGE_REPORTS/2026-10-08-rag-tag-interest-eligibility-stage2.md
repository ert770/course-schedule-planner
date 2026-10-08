# rag_tag 逐課資格計算器與唯讀報表（階段 2）

## 修改日期

2026-10-08

## 修改檔案

- `server/src/data/interestTagEligibility.js`（新增）：純函式逐課標籤資格計算器。
- `server/scripts/interestTagEligibilityReport.js`（新增）：唯讀 MySQL 資格摘要／JSON 報表工具。
- `server/test/interestTagEligibility.test.js`（新增）：逐課資格與多班次合併測試。
- `docs/PLANS/2026-10-08-rag-tag-interest-v1-plan.md`：記錄資格重算邏輯、目前資料庫阻塞、必修事件層責任與階段狀態。
- `docs/CHANGE_REPORTS/2026-08-01-personalization-roadmap.md`：更新 #43 的階段狀態、相依與當前阻塞；重新核對進度總覽整張表。
- `docs/CHANGE_REPORTS/README.md`：新增本報告索引。
- 本變更報告。

## 主要改動

- 依 `catalogCourseCode`、`courseCode`、`courseId`、`code` 的穩定識別順序合併同一門課的多個班次；不使用 `sectionId`／班次 ID 當課程鍵，缺少穩定課號的班次不列入課數分母。
- 使用現有標籤目錄解析器套用核准的 13 組別名，按 `canonical_tag_id` 在每門課去重，再計算每個標籤出現於多少門不同課程。
- 主分類／子分類是 tag metadata，不會因一個標籤有多條分類路徑而重複增加課數。
- 通用標籤與出現在超過 2% 課程的高頻標籤，學習與跨課配對資格皆為 false；僅出現在一門課的標籤可保留興趣學習資格，但跨課配對資格為 false；其餘映射標籤兩種資格皆為 true。恰好 2% 不視為超過門檻。
- 無法映射的原始標籤會進入報表診斷；程式不改寫原始資料，也不變更 `interestTagCatalog.json` 的 pending 資格欄位。
- 報表透過既有 MySQL 課程讀取 API 取得資料，預設輸出摘要；`--json` 輸出完整結果。工具沒有資料庫寫入或檔案輸出路徑。
- 必修資格是學生個別 scope，不是全域的課程類別；因此本階段只算全域標籤頻率，未把必修課錯誤刪出母體。後續每筆行為／探索事件仍必須按使用者 scope 排除必修課標籤學習。

## 資料重算狀態

已實際執行 `node scripts/interestTagEligibilityReport.js`。MySQL DNS 查詢回 `ENOTFOUND`，因此尚未讀到逐課 rag_tag、沒有可核對的實際資格統計，也未寫回任何資格。目錄維持 `pending_post_alias_course_recount`，執行期仍 fail closed。

## 影響範圍

新增離線診斷計算與唯讀報表，沒有修改資料庫 schema、課程 API、興趣事件、前端或排課器，故不改變使用者看見的推薦或課表結果。取得資料庫連線後，可重跑報表並審核合併後的資格，再規劃如何版本化資格資料。

## 測試與驗證

- 新增資格測試與目錄測試：9/9 通過，涵蓋核准別名 canonical 去重、同課多班合併、多分類路徑、單課／通用／高頻資格、2% 邊界、穩定課號 fallback 與未知標籤診斷。
- `node --check`：`server/src` 下 100 個 JavaScript 檔案，以及本次新增報表與測試檔通過。
- `npm run lint`：通過。
- `npm run build`：通過。
- `npm test`：未通過。HTTP 整合測試無法在 sandbox 連線 `127.0.0.1`（`EACCES`）；模型 golden set 網路呼叫回 `Connection error`。這與本次純函式單元測試分開記錄，完整套件結果未驗證成功。
- MySQL 唯讀報表：因 `ENOTFOUND` 無法取得課程資料；資格欄位未更新。
- 未做瀏覽器驗收：沒有使用者可見畫面或行為改動。
- `git diff --check`：通過；Git 僅提示既有 Markdown 檔案將採 CRLF 換行。
- Roadmap 全表狀態／相依複核：#43 更新為「計算器與報表已交付、資料重算待連線」；其餘項目的狀態及相依未因本階段改變，並保留 #6、#8、#9、#10、#23、#32、#36、#38、#39 等既有狀態。

## Commit 與 Push

- 未 commit。
- 未 push。
