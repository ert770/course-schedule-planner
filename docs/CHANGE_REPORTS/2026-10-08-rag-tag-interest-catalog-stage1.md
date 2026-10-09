# rag_tag 興趣目錄與多路徑標籤解析（階段 1）

## 修改日期

2026-10-08

## 修改檔案

- `server/scripts/importInterestTagCatalog.py`（新增）：從核准版 Excel 與別名 JSON 建立分類目錄。維護端需要 Python `openpyxl`；執行中的 Node.js 服務只載入產出的 JSON，不依賴 Python。
- `server/src/data/interestTagCatalog.json`（新增）：包含版本化分類、canonical tags、原始標籤寫法、分類路徑及來源工作表／列號。
- `server/src/data/interestTagCatalog.js`（新增）：提供原始標籤與核准別名解析、canonical ID 去重、多分類路徑回傳，以及資格 fail-closed 判斷。
- `server/test/interestTagCatalog.test.js`（新增）：驗證匯入統計、多路徑、別名、去重、未知標籤與待重算資格。
- `docs/PLANS/2026-10-08-rag-tag-interest-v1-plan.md`：將標籤分類關係修正為多對多，記錄實作階段與目前資格限制。
- `docs/CHANGE_REPORTS/2026-08-01-personalization-roadmap.md`：更新 #43 與目前可動工項目，核對進度總覽相依；修正 #10 舊有 4/5 初測敘述與 2026-10-02 修正後 1/5 benchmark 的不一致。
- `docs/CHANGE_REPORTS/README.md`：新增本報告索引。
- 本變更報告。

## 主要改動

- 從核准活頁簿的 31 張分類分頁匯入 19 個主分類、78 條分類路徑、15,113 筆來源對應及 6,846 個原始標籤。
- 套用已核准的 13 組語意別名後，產生 6,769 個 canonical tags；使用穩定的名稱雜湊產生分類與標籤 ID。
- 保留標籤對應多條分類路徑。目錄中 2,709 個原始寫法與 2,705 個 canonical tags 各自對應多條路徑；每條來源對應可回查 Excel 工作表和列號。
- 匯入工具重跑後輸出逐位元一致，沒有依賴工作表分頁順序作為分類 ID。
- 活頁簿頻率屬別名合併前快照，因此所有標籤的學習與跨課配對資格維持 `pending_post_alias_course_recount`，欄位值為 `null`。解析器只接受資格明確為 `true` 的標籤，不會將待重算標籤當成可用訊號。
- 此階段未新增資料庫欄位、API、互動事件、前端畫面或排課接線。

## 影響範圍

完成標籤目錄與執行期解析基礎，可供下一階段重算課程資格及建立標籤興趣事件使用。目前沒有消費者把這個目錄接入推薦或排課，因此不改變使用者看到的推薦結果。

下一步需取得可讀取的逐課 `rag_tag` 成員資料，按課號去重並套用別名後，才能重算高頻／單課資格及排除必修課興趣訊號。重算前目錄不提供興趣更新或新課程配對分數。

## 測試與驗證

- `server/test/interestTagCatalog.test.js`：5/5 通過。
- 重新匯入後 JSON SHA-256 不變，確認產物可重現。
- `node --check`：`server/src` 下 99 個 JavaScript 檔案通過。
- `npm run lint`：通過。
- `npm run build`：通過。
- `npm test`：未通過。完整測試中的 HTTP 測試無法在目前 sandbox 綁定／連線 `127.0.0.1`（`EACCES`）；模型 golden set 連線失敗，後續依賴測試被取消。這與本次目錄單元測試分開記錄，完整套件結果仍未驗證成功。
- 未做瀏覽器驗收：此階段沒有使用者可見 UI 或 API 行為變更。
- `git diff --check`：無空白錯誤；Git 顯示既有 Markdown 檔案的 LF／CRLF 提示。

## Commit 與 Push

- 未 commit。
- 未 push。
