# 2026-09-17 刪除 project-guide 專案說明文件集（12 檔）

## 修改日期

2026-09-17

## 為什麼做這件事

`docs/project-guide/`（commit `8df7039` 新增，見 [2026-09-13 變更報告](./2026-09-13-project-guide-documentation-set.md)）與同一天開始建立的 `docs/application-portfolio/` 功能重複：兩者都是「面向第一次接觸本專案的人」的整合說明文件。`application-portfolio` 是逐項核對程式碼、schema、測試與 Git 紀錄後重新撰寫的版本，且已記錄 `project-guide` 內超過 20 項與程式不符之處（見 `docs/application-portfolio/01_目前已完成/07_已知限制.md` 的 D7–D25），留著舊版容易讓讀者看到錯誤內容。使用者決定刪除。

## 修改檔案清單

- `docs/project-guide/README.md`（刪除）
- `docs/project-guide/01-project-positioning.md`（刪除）
- `docs/project-guide/02-system-architecture.md`（刪除）
- `docs/project-guide/03-features-and-user-flows.md`（刪除）
- `docs/project-guide/04-data-model.md`（刪除）
- `docs/project-guide/05-api-reference.md`（刪除）
- `docs/project-guide/06-personalized-scheduling.md`（刪除）
- `docs/project-guide/07-scenario-simulation.md`（刪除）
- `docs/project-guide/08-ai-agent.md`（刪除）
- `docs/project-guide/09-privacy-and-security.md`（刪除）
- `docs/project-guide/10-testing-and-deployment.md`（刪除）
- `docs/project-guide/11-known-limitations.md`（刪除）
- `docs/application-portfolio/` 內 17 個檔案：在原本引用 `docs/project-guide/*` 當作證據來源的地方，補上「已刪除，見 commit `8df7039`」，避免刪除後連結失效、證據找不到出處
- `docs/application-portfolio/05_推甄前預計完成/00_Roadmap.md`、`02_P1加分工作.md`：P2-2（更新過時文件）不再包含 `project-guide`

## 主要改動

- 刪除整個 `docs/project-guide/` 資料夾（12 檔，約 2,511 行）。內容仍可從 commit `8df7039` 找回，不是永久遺失。
- `application-portfolio` 內所有原本單靠 `project-guide/XX` 這個路徑當「文件與程式不一致」（D7–D25、D31、D32）或已知限制（K12、K13、K21 等）證據來源的地方，都補上指回 commit `8df7039` 的說明，確保刪除後這些條目仍可追溯查證。
- `01_目前已完成/07_已知限制.md` 用一段標頭說明取代逐列重複標註，其餘檔案（`02_目標使用者與使用情境.md`、`03_後端與API.md`、`05_ER_Diagram.md`、`01_System_Prompt說明.md`、`06_Faithfulness_Validation.md`、`03_軟性偏好.md`、`02_Integration_Test.md`、`00_個人貢獻摘要.md`、`04_設計文件.md`、`專題完整報告.md`）逐處補上「已刪除」註記。
- PR／commit 歷史紀錄類的引用（`06_專題時程.md`、`08_個人貢獻證明/03_PR與Issue紀錄.md` 與 `evidence/*`）維持原樣：這些是「PR #22 當時新增了 project-guide」的歷史事實敘述，刪除後仍然成立，不需要修改。

## 測試與驗證

- 純文件刪除／編輯，沒有修改任何 `server/`、`client/` 底下的功能程式碼。
- 用 Grep 對 `docs/application-portfolio/` 全文搜尋 `project-guide`，確認所有引用都已補上「已刪除」註記或是合理保留的歷史敘述，沒有遺漏。
- 重新用 `@mermaid-js/mermaid-cli` 驗證本次編輯過的 Mermaid 圖（`05_ER_Diagram.md`、`00_Roadmap.md`），確認仍能解析。
- `git status` 確認變更僅限於 `docs/project-guide/`（刪除）與 `docs/application-portfolio/`（編輯），`git diff --stat -- server client` 為空。

## 後續調整（同一天）

本人追問「跟 project-guide 不一致的也要刪掉吧？」之後，改為更徹底的做法：

- `01_目前已完成/07_已知限制.md` 的 D7–D23、D31、D32（共 19 項，原本只補註「已刪除」）**整列刪除**，因為對照的文件已經不存在，繼續留著「文件說 X，實際是 Y」的比較沒有意義。這些項目發現的事實（33 支 API、17 種違規碼、`Saved_Schedules` 已存在等）本來就已經是本資料包其他章節的正式內容，刪除這幾列不會遺失資訊。
- K12、K13 的證據來源從 `project-guide/11` 改成獨立於 project-guide 的真實依據（`docs/CHANGE_REPORTS/2026-09-13-profile-field-dedup-and-evaluation-columns.md`、`database.js` 程式碼本身）。
- `03_後端與API.md`、`05_ER_Diagram.md`、`01_System_Prompt說明.md`、`06_Faithfulness_Validation.md`、`02_Integration_Test.md` 裡原本補注「已刪除」的個別段落，同樣整段刪除或改寫成不依賴 project-guide 的獨立敘述。
- `00_Roadmap.md`、`02_P1加分工作.md`、`04_設計文件.md`、`專題完整報告.md` 的 D 項目統計數字，從「D1–D30」更新為實際剩下的 6 項（D1、D2、D5、D24、D25、D30）。
- 重新用 `@mermaid-js/mermaid-cli` 驗證全部 17 個 Mermaid 圖，確認仍能解析；`git diff --stat -- server client` 仍為空。

## 是否 commit 與 push

已用 `git rm` 刪除並暫存（staged），尚未 commit，等待使用者指示。
