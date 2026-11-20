# 課程主題選擇改版 Step F：ADR、資料結構與測試計畫文件

## 1. 修改日期

2026-11-20

## 2. 背景

接續 [Step E](./2026-11-20-interest-selections-step-e.md)。Step A–E 已把程式做完並提交；這一步只補文件，記錄決策、更正過時敘述、登記測試。**沒有修改任何程式。**

## 3. 修改檔案清單

- `docs/DECISIONS.md`：新增 ADR-025
- `docs/DATA_SCHEMA.md`：更正標籤目錄「尚未接入」的過時敘述
- `docs/TEST_PLAN.md`：新增「課程主題選擇改版」編號區塊
- `docs/CHANGE_REPORTS/2026-08-01-personalization-roadmap.md`：#43 段落加一則延伸改版註記
- `docs/CHANGE_REPORTS/2026-11-20-interest-selections-step-f.md`（本報告）、`docs/CHANGE_REPORTS/README.md`（加索引）

## 4. 主要改動內容

- **ADR-025**：記錄設定頁追問是第一個非聊天的執行期 OpenAI 呼叫，只送類別與標籤名稱；沿用 `service_processing` 同意、不升 `PRIVACY_POLICY_VERSION`，並明寫隱私文字字面上未涵蓋這個用途的缺口與 `INTEREST_FOLLOWUP_MODE=fixed` 的緩解；「類別不展開」規則只對白名單小子類別（資訊安全與隱私）有限例外；理工排除只限選單與追問，計分維持全域配對（外溢 1–7 門）；以 (group, categoryId) 為鍵保存；子類別層沒有鑑別力的盤點發現與內容命名；被否決的做法與後果。
- **DATA_SCHEMA**：第 730 行「這份目錄尚未接入興趣事件、API、前端或排課器」改成現況（已接入興趣學習、S_tag 與設定頁選單／追問／保存驗證）。
- **TEST_PLAN**：列出 8 個測試檔與覆蓋內容（15＋18＋9＋23＋16＋18＋13＋4＝116 個，本次實測全數通過），並誠實註明路由層沒有自動化測試、前端沒有元件測試。
- **roadmap**：#43 段落加註延伸改版進度。

## 5. 影響範圍

只有文件。沒有 API、資料欄位或排課器變動，不需要 S1-S10。

roadmap 進度總覽表已整體核對：#43 狀態不變（延伸改版尚未完成，Step G 驗收未做），沒有其他總表任務以這次改版為前置，其他任務的狀態與相依不受影響。

## 6. 測試與驗證結果

- 未修改程式邏輯，未執行前後端 build 與完整測試。
- 登記進 TEST_PLAN 的 8 個測試檔已逐一單獨執行：共 116 個測試，116 通過、0 失敗。
- 以腳本編輯，保留各檔原本的換行（CRLF／LF），`git diff --stat` 只有預期的檔案與行數。

## 7. 已知問題與待決

- Step G（Persona A/B、`fixed` 模式、無 `OPENAI_API_KEY`、手機寬度、`unverified` 對話框畫面、`CI=true npm run verify`）尚未做。
- `docs/CHANGE_REPORTS/README.md` 與 `docs/API_SPEC.md` 原本就有別人尚未提交的修改，提交時要只挑本次區塊。

## 8. 是否 commit 與 push

否，等你指示。
