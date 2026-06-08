# Documentation Checklist

本清單用來追蹤本專案在開發前需要補齊的 Markdown / 規範文件。

檢查日期：2026-06-08

## Status Legend

- `Done`：已有對應正式文件，且內容足以作為開發依據。
- `Partial`：已有相關內容或雛形，但位置、格式、完整度或可讀性不足。
- `Missing`：尚未建立對應文件。

## Summary

正式系統規範已建立於 `AGENTS.md`、`docs/*.md` 與 `.env.example`。

Word 檔 `C:\Users\yamat\OneDrive\Downloads\課程推薦系統_排課邏輯與學分要求.docx` 已納入排課邏輯與需求規格來源，重點包含資工系畢業學分結構、數位課程門檻、關注/加選課程狀態、大二以上排課流程、核心選修路徑與多方案課表需求。

| File | Status | Notes |
| --- | --- | --- |
| `AGENTS.md` | Done | 已建立 Codex 專用開發規範，包含專案架構、啟動/驗證指令、前後端慣例、完成標準與 Git/GitHub 操作限制。 |
| `docs/REQUIREMENTS.md` | Done | 已整理使用者、核心問題、MVP 功能、排課需求、AI Agent 需求、非功能需求與不做範圍。 |
| `docs/SCHEDULING_LOGIC.md` | Done | 已整理 Word 檔中的學分要求、關注/加選、必修/重補修、核心選修路徑、多方案課表與目前程式差距。 |
| `docs/AI_AGENT_SPEC.md` | Done | 已定義 Agent 能力、禁止事項、資料不足回覆、工具使用時機、語氣與正確性規範。 |
| `docs/API_SPEC.md` | Done | 已列出目前後端 API endpoint、method、request、response 與錯誤格式。 |
| `docs/DATA_SCHEMA.md` | Done | 已整理 JSON 檔案式資料庫的 course、user、preference、review、saved schedule 與課程狀態欄位。 |
| `docs/TEST_PLAN.md` | Done | 已建立排課邏輯、API、前端操作與 AI Agent 測試案例。 |
| `docs/UX_FLOW.md` | Done | 已整理登入、初始設定、搜尋、推薦課表、關注/加選、AI Agent 與畢業學分流程。 |
| `docs/PROMPT_DESIGN.md` | Done | 已整理 system prompt 目的、tool call 格式、Observation、final answer、few-shot example 與維護規則。 |
| `docs/ARCHITECTURE.md` | Done | 已整理前端、後端、資料層、AI Agent、排課引擎與 API 流程。 |
| `docs/DECISIONS.md` | Done | 已建立 JSON database、規則式排課、Gemini provider、不使用 GitHub connector 等決策紀錄。 |
| `.env.example` | Done | 已建立環境變數範例，未包含真實 API key。 |

## Current Documentation Set

```text
AGENTS.md
.env.example
docs/REQUIREMENTS.md
docs/SCHEDULING_LOGIC.md
docs/AI_AGENT_SPEC.md
docs/API_SPEC.md
docs/DATA_SCHEMA.md
docs/TEST_PLAN.md
docs/UX_FLOW.md
docs/PROMPT_DESIGN.md
docs/ARCHITECTURE.md
docs/DECISIONS.md
docs/DOCUMENTATION_CHECKLIST.md
```

## Follow-Up Recommendations

1. 修正 README 與既有 `report/` 文件的中文亂碼。
2. 根據 `docs/SCHEDULING_LOGIC.md` 改寫 `server/src/skills/scheduler.js`。
3. 將 `關注` / `加選` 狀態加入資料格式與前端互動。
4. 擴充 `/api/schedule/generate`，支援多方案課表。
5. 依 `docs/TEST_PLAN.md` 補上自動化測試。

