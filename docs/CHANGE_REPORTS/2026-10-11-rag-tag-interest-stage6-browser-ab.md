# rag-tag-interest-v1 階段 6：單方案指標與驗收狀態

## 修改日期

2026-10-11

## 範圍

- 在單一方案時顯示方案標籤興趣分與標籤證據覆蓋率，沿用多方案比較頁的指標定義。
- 重新執行完整驗證與隔離 MySQL 持久化整合測試。
- 按計畫重跑 10 位 Persona 的瀏覽器 `off`／`active` A/B；要求瀏覽器呼叫真實 HTTP API，並由 API 讀寫 MySQL 隔離測試資料庫。

## 程式修改

- `client/src/components/Schedule/PlanSwitcher.jsx`：單方案時讀取 `planMetrics.planTagScore` 與 `planMetrics.tagInterestCoverage`，呈現正負分、無證據狀態及覆蓋率。
- `client/src/index.css`：新增單方案標籤摘要的樣式。
- 未修改後端計分、API、資料表或部署預設；推薦啟用預設仍為 `off`。

## 瀏覽器 A/B 狀態

以下是單方案 UI 修正後的首輪嘗試紀錄；後續已重新啟動前後端並完成 Persona A/B，結果見本報告末尾的「後續續驗」。

先前的 20 次 Persona 瀏覽器 A/B 使用 mock API，發生在單方案指標修改之前。它們找到了單方案指標不顯示的 UX 缺口，不能當作本次修正後的驗收結果。

本次已依使用者指示，將 `off` 與 `active` API 和前端啟動在 localhost，API 僅設定連線至 `rag_tag_interest_test`。兩支 `/api/health` 均回傳 `ok`。但在開啟 `http://127.0.0.1:5181/login` 前，瀏覽器工具兩次都回覆「saved user permission setting blocks this action」。使用者雖已表示允許 localhost，瀏覽器安全設定仍回報封鎖。未改用其他瀏覽器、底層自動化或替代路徑；未登入測試帳號、未呼叫排課 API、未產生曝光／行為事件。

因此以下驗收尚未完成：

- 單方案標籤分與覆蓋率的實際畫面檢查。
- 10 位 Persona × `off`／`active` 共 20 次的瀏覽器操作。
- 瀏覽器 → 真實 HTTP API → MySQL 的端到端資料持久化檢查。
- 本次改動後的 console error／warning 檢查。

臨時 API／前端服務已停止。隔離資料庫中的合成瀏覽器 fixture 暫時保留，供權限解除後續跑；未連線或寫入 `defaultdb` 作為本次 A/B 資料來源。

## 測試與驗證

- `CI=true npm run verify`：通過；前端 lint、build 及後端完整測試通過，1,480 passed、0 failed、1 skipped。CI 依規則略過需連線 live model 的案例。
- 明確指定 `DB_NAME=rag_tag_interest_test` 與 `TAG_INTEREST_TEST_DB_NAME=rag_tag_interest_test` 執行 `node --test test/tagInterestMysqlIntegration.test.js`：1/1 通過，涵蓋同意、事件冪等、標籤快照、profile 重算／快取與刪除清理。
- `npm run eval:tag-interest`：合成標籤興趣案例 9/9 通過；不宣稱真人準確率。
- `node --check`：`server/src` 105 個 JavaScript 檔案全數通過。
- `git diff --check`：待最終檢查。

### 測試資料庫範圍說明

完整 `npm run verify` 未覆寫 `.env` 的 `DB_NAME`；專案既有 `test/database-contract.test.js` 因而執行了對預設資料庫的唯讀課程／評價／使用者資料契約查詢。該檔案使用 `SELECT`，沒有寫入語句；測試目錄中其餘 SQL 寫入語句只存在於明確啟用的 MySQL 整合測試，該次測試已明確指向 `rag_tag_interest_test` 並自行清理測試 subject。這次對預設資料庫的資料列讀取超出原本隔離測試範圍；不會再連線讀取。之後應在隔離 DB 設定下執行完整測試，或先調整資料庫契約測試的安全設定。

## Roadmap 與設計稿

- 首輪嘗試當時，階段 6 仍為部分完成；後續續驗已完成 10 位 Persona 的 `off`／`active` 瀏覽器流程。
- Roadmap #43 與介接設計稿依後續續驗更新；Persona UX 依使用者決定作為正式代表使用者驗收方式，真人時間切分列為未來成效研究。
- roadmap 狀態與相依欄已依專案規範重新核對；#43 沒有未完成的工程前置或下游相依。

## 修改檔案

- `client/src/components/Schedule/PlanSwitcher.jsx`
- `client/src/index.css`
- `docs/PLANS/2026-10-10-rag-tag-interest-v1-stage6-interface-design.md`
- `docs/CHANGE_REPORTS/2026-08-01-personalization-roadmap.md`
- `docs/CHANGE_REPORTS/2026-10-11-rag-tag-interest-stage6-browser-ab.md`

## Commit／Push

本報告首輪阻擋時尚未 commit／push。後續續驗與預設啟用的文件及程式變更仍未 commit／push。

## 後續續驗與預設啟用（2026-10-11）

使用者要求只用 10 位 Persona UX 帳號，並同意以 Persona UX 作為本專案正式的代表使用者驗收方式，後續階段沿用。以下測試結果描述這些 Persona 案例；資料本質為模擬互動，不寫成實際真人事件或真人統計。

- 前後端重新啟動：前端 `http://127.0.0.1:5176/`、後端 `http://localhost:27151`；Chrome 操作登入首頁與排課流程。
- 10 位 Persona 各跑 `off` 與 `active`，共 20 次；頁面呈現單方案／多方案的標籤分與覆蓋率，瀏覽器請求走真實 HTTP API 並連接 MySQL `defaultdb`。
- 僅核對這 10 個測試 subject 的資料：`Learned_Tag_Interests` 10 列、`interest_exploration_feedback` 58 筆、`plan_chosen` 10 筆、`recommendation_accepted` 10 筆、`recommendation_exposed` 21 筆、`schedule_regenerated` 21 筆。P08 為連線確認多重排一次，故曝光與重排各 21 筆。
- A/B 是同一批帳號先跑 `off` 再跑 `active`；`off` 階段的推薦接受事件會被後續 `active` profile 讀取。因此這驗證完整功能路徑與持久化，不是隔離乾淨、可估因果效果的隨機實驗。
- 先前以 mock API 執行的 20 次 A/B 仍只算修正前基線；不替代上述真實 API／DB 流程。
- 預設啟用改動後，本次重新啟動的 Chrome 能載入 `/login`，該頁 console error／warning 為 0；但 CUA 對後端 `27151` 的直接瀏覽被 `ERR_BLOCKED_BY_CLIENT` 擋下，故本輪沒有再登入帳號重跑排課。未設定模式的 `active` fallback 由單元測試確認；排課 A/B 的完整畫面與資料流以本節前述 20 次結果為驗收證據。
- 本次沒有新增或重跑 Persona 資料；上述 DB 列數是先前 A/B 完成後的唯讀核對結果。

專案使用者已決定把 Persona UX 視為正式代表使用者驗收對象，未來不用等待真人事件才完成 UX 驗收或啟用功能；真人事件時間切分只在未來要評估真人場域成效時另做。實際模式預設改為 `active`，仍可用 `TAG_INTEREST_RANKING_MODE=off` 回復。
