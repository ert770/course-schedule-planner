# 2026-09-13 新增 project-guide 專案說明文件集（12 檔）

## 修改日期

2026-09-09（撰寫與審查完成）～2026-09-13（提交）

## 修改檔案

- `docs/project-guide/README.md`
- `docs/project-guide/01-project-positioning.md`
- `docs/project-guide/02-system-architecture.md`
- `docs/project-guide/03-features-and-user-flows.md`
- `docs/project-guide/04-data-model.md`
- `docs/project-guide/05-api-reference.md`
- `docs/project-guide/06-personalized-scheduling.md`
- `docs/project-guide/07-scenario-simulation.md`
- `docs/project-guide/08-ai-agent.md`
- `docs/project-guide/09-privacy-and-security.md`
- `docs/project-guide/10-testing-and-deployment.md`
- `docs/project-guide/11-known-limitations.md`

## 主要改動

新增一套面向「第一次接觸本專案的開發者、指導教授或評審」的整合說明文件（共
2,511 行），以現有 `docs/*.md` 為輔助來源、實際程式碼為主要依據撰寫：

- 01～03：專案定位、系統架構、功能與使用者流程盤點。
- 04～05：資料模型（ER diagram、逐表欄位、儲存層差異）、API 參考（32 支
  API 總表與一致性檢查）。
- 06、08（★ 標記，工程細節最深）：個人化排課的完整評分公式與常數、
  AI Agent 的 system prompt 規則與 7 個工具、忠實度稽核。
- 07：情境模擬與 30 項情境測試矩陣。
- 09～11：Privacy 與安全、測試與部署盤點、28 項已知限制與風險（含嚴重度
  與證據位置）。

撰寫完成後另做過一輪對照 8 個深度查證項目的 adversarial 技術審查
（排課演算法、約束與評分、多班次／共同必修處理、情境模擬資料隔離、
AI Agent 工具 schema、忠實度驗證、前後端／schema 一致性、隱私同意的
race condition），依審查結果修正過文件內容，僅修正文件敘述，未修改任何
功能程式碼。

## 影響範圍

- 僅新增文件，不影響任何前端、後端、資料庫 schema 或既有測試。
- `docs/project-guide/README.md` 明確聲明「不取代既有文件，而是提供整合入口」，
  並列出與 `API_SPEC.md`／`DATA_SCHEMA.md`／`SCHEDULING_LOGIC.md`／`TEST_PLAN.md`／
  `PROMPT_DESIGN.md`／`DECISIONS.md`／roadmap 的對應關係，避免與既有文件產生
  权威來源衝突。
- 文件標記「最後更新：2026-09-09」的時間點快照（例如測試檔數、測試總數），
  之後幾天的變更（如 2026-09-13 的 profile 欄位去重與 v0 相容層退役）未回填
  進本文件集，屬於已知的滾動落後，不在本次提交範圍內修正。

## 測試與驗證

- 純文件新增，未修改程式邏輯，未執行前後端 build／lint／測試。
- 撰寫與 adversarial 審查階段已對照實際程式碼逐項核實內容（見上方「主要改動」）。

## Commit / Push

- 依使用者指示分批提交：本次連同 `.gitignore`／PDF 變更報告的清理批次分開，
  單獨成一個 commit 並推送至 `origin/backend`。
