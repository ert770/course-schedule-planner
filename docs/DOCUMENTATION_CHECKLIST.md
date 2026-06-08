# Documentation Checklist

本清單用來追蹤本專案在開發前需要補齊的 Markdown / 規範文件。

檢查日期：2026-06-08

## Status Legend

- `Done`：已有對應正式文件，且內容足以直接作為開發依據。
- `Partial`：已有相關內容或雛形，但位置、格式、完整度或可讀性不足。
- `Missing`：尚未建立對應文件。

## Summary

目前專案根目錄沒有 `AGENTS.md`，正式 `docs/` 規範文件集仍未完成。既有內容主要集中在 `README.md` 與 `report/`，可以作為整理來源，但多數文件存在中文亂碼，且不是正式開發規範格式。

本次已補充讀取 Word 檔來源：`C:\Users\yamat\OneDrive\Downloads\課程推薦系統_排課邏輯與學分要求.docx`。該檔案提供排課邏輯與學分要求的重要需求來源，應納入 `docs/SCHEDULING_LOGIC.md`、`docs/REQUIREMENTS.md`、`docs/DATA_SCHEMA.md`、`docs/API_SPEC.md`、`docs/TEST_PLAN.md` 與 `docs/UX_FLOW.md`。

| File | Status | Existing Related Files | Notes |
| --- | --- | --- | --- |
| `AGENTS.md` | Missing | None | 尚未建立 Codex 專用開發規範。 |
| `docs/REQUIREMENTS.md` | Partial | `README.md`, `report/期中專題進度報告.md`, `report/implementation_plan.md`, Word 排課邏輯檔 | 有系統目標、架構與功能雛形；Word 檔補充資工系畢業學分、關注/加選狀態、大二以上排課情境，但仍缺少正式需求文件。 |
| `docs/SCHEDULING_LOGIC.md` | Partial | Word 排課邏輯檔, `report/implementation_plan.md`, `server/src/skills/scheduler.js` | Word 檔已提供排課需求核心：128 學分、數位課程門檻、關注/加選、必修與重補修優先、核心選修路徑、多方案課表；仍需整理成正式規格與測試案例。 |
| `docs/AI_AGENT_SPEC.md` | Partial | `report/系統操作指南.md`, `report/implementation_plan.md`, `server/src/services/agentService.js`, `server/src/services/promptService.js` | 有 Agent 能力與 ReAct/tool call 雛形，但缺少明確行為邊界、不可亂編資料、資料不足回覆規則、工具使用時機與安全規範。 |
| `docs/API_SPEC.md` | Partial | `server/src/app.js`, `server/src/routes/*.js`, `client/src/services/api.js`, Word 排課邏輯檔 | API 已在程式中存在；Word 檔指出排課 API 需支援關注/加選、多方案、學分要求與重補修需求，但尚未有獨立 API 規格。 |
| `docs/DATA_SCHEMA.md` | Partial | `server/src/db/schema.sql`, `server/src/db/database.js`, `server/data/*.json`, `report/implementation_plan.md`, Word 排課邏輯檔 | 有 schema.sql 與 JSON 資料；Word 檔補充課程狀態、學分分類、修課紀錄、路徑類別等欄位需求，需要整理成正式資料格式。 |
| `docs/TEST_PLAN.md` | Partial | `report/implementation_plan.md`, `report/task.md`, Word 排課邏輯檔 | 有驗證計畫與任務清單；Word 檔提供排課測試情境來源，但缺少可執行測試案例、API 測試、排課邏輯測試與 AI Agent 測試。 |
| `docs/UX_FLOW.md` | Partial | `report/系統操作指南.md`, `client/src/App.jsx`, `client/src/pages/*.jsx`, Word 排課邏輯檔 | 有頁面與操作說明雛形；Word 檔補充關注/加選互動語意與多方案比較流程，但缺少正式使用者流程。 |
| `docs/PROMPT_DESIGN.md` | Partial | `server/src/services/promptService.js`, `report/系統操作指南.md` | Prompt 已寫在程式中，但缺少 system prompt 設計目的、tool call 格式、few-shot examples、禁止事項與維護規則。 |
| `docs/ARCHITECTURE.md` | Partial | `report/implementation_plan.md`, `README.md` | 有架構圖與分層描述雛形，但缺少正式架構文件、資料流、模組責任與前後端互動圖。 |
| `docs/DECISIONS.md` | Partial | `report/implementation_plan.md`, `report/個人化課表規劃系統 — 開發進度與 MVP 完工報告.md` | 有部分技術取捨描述，例如 JSON/SQLite、Gemini/OpenAI、排課演算法，但沒有整理成決策紀錄。 |
| `.env.example` | Missing | None | 尚未建立環境變數範例。 |

## Required Files

### `AGENTS.md`

Status: `Missing`

Purpose: 給 Codex 看的專案開發規範。

應包含：

- 專案架構：`client/`, `server/`, `server/data/`, `report/`, `docs/`
- 啟動指令：`npm run dev`, `npm run dev:client`, `npm run dev:server`
- 安裝與初始化指令：`npm run install:all`, `npm run seed`
- 驗證指令：`cd client && npm run build`, `cd client && npm run lint`, `node --check`
- 不要亂改的內容：資料檔、報告檔、API key、既有使用者資料
- 前端慣例：React/Vite、路由、API service、UI 文字與亂碼處理
- 後端慣例：Express route、JSON database、skills/services 分層
- 完成標準：功能可操作、build/lint/語法檢查通過、文件同步更新

### `docs/REQUIREMENTS.md`

Status: `Partial`

可參考：

- `README.md`
- `report/期中專題進度報告.md`
- `report/implementation_plan.md`

缺少：

- 使用者角色與情境
- 要解決的核心問題
- MVP 功能範圍
- 非功能需求，例如效能、可維護性、資料安全
- 明確列出不做項目

### `docs/SCHEDULING_LOGIC.md`

Status: `Partial`

可參考：

- `C:\Users\yamat\OneDrive\Downloads\課程推薦系統_排課邏輯與學分要求.docx`
- `server/src/skills/scheduler.js`
- `report/implementation_plan.md`

Word 檔已提供的排課需求：

- 資工系總畢業學分為 128 學分。
- 學分結構：通識基礎 16、通識選修 12、必修 63、核心選修 12、選修 16、系外選修 9。
- 特殊畢業門檻：畢業前須修習 2-6 學分數位課程。
- 課程狀態分為 `關注` 與 `加選`：
  - `關注`：顯示在課表上，供學生觀察時間分佈；同時可關注多門課，不計入正式排課衝突。
  - `加選`：顯示在課表上，且正式佔用該時段；同時間不可加選多門課，否則為衝堂。
- 大二以上排課流程：
  1. 讀取學生過去修習紀錄與歷史成績。
  2. 優先安排必修課。
  3. 若必修曾被當，需檢查當學期是否開授重補修課程，並優先排入。
  4. 必修確定後，依序安排核心選修、一般選修、通識、系外選修。
- 核心選修與選修需支援三條修課路徑：嵌入式系統類、技術應用類、網路安全類。
- 技術應用類核心選修剛好 12 學分，其他類別可能缺 1 或 3 學分，需允許跨類別核心選修補齊。
- 選修推薦需考慮學生非典型路徑偏好，例如興趣、教授容易度、課程難易度。
- 排課需支援集中排課與空出整天休息日；若為了空出一天導致學分不足，系統需找其他課補足。
- 系統應產出多個課表方案，讓學生比較與挑選。
- 通識與系外選修推薦需考慮興趣、高分課、涼課、免考試/報告課等因素。

缺少：

- 排課輸入資料格式
- 硬性限制與軟性偏好的定義
- 條件優先順序
- 衝堂判定規則
- 學分上下限規則
- 必修、選修、通識規則
- 推薦分數算法
- 失敗情境與錯誤訊息
- 可驗收的測試案例

備註：Word 檔已可作為正式 `docs/SCHEDULING_LOGIC.md` 的主要來源，但仍需轉成可實作、可測試的規格格式。

### `docs/AI_AGENT_SPEC.md`

Status: `Partial`

可參考：

- `server/src/services/agentService.js`
- `server/src/services/promptService.js`
- `report/系統操作指南.md`

缺少：

- Agent 能力清單
- Agent 禁止事項
- 回答語氣與格式
- 何時呼叫課程查詢、評價查詢、排課、偏好更新工具
- 資料不足時的回覆策略
- 不可亂編課程、學分、教師、評價資料的規範
- 工具呼叫格式與失敗處理

### `docs/API_SPEC.md`

Status: `Partial`

可參考：

- `client/src/services/api.js`
- `server/src/app.js`
- `server/src/routes/auth.js`
- `server/src/routes/courses.js`
- `server/src/routes/schedule.js`
- `server/src/routes/chat.js`
- `server/src/routes/profile.js`
- `server/src/routes/reviews.js`
- `server/src/routes/graduation.js`

缺少：

- Endpoint 表格
- Method
- Request body / query params
- Response body
- Error response
- 前端使用位置

### `docs/DATA_SCHEMA.md`

Status: `Partial`

可參考：

- `server/src/db/schema.sql`
- `server/src/db/database.js`
- `server/data/courses.json`
- `server/data/users.json`
- `server/data/reviews.json`
- `server/data/user_preferences.json`
- `server/data/saved_schedules.json`

缺少：

- 實際 JSON 欄位定義
- 欄位型別
- 必填/選填
- 範例資料
- 欄位命名規則
- `schema.sql` 與實際 JSON 資料的差異說明

### `docs/TEST_PLAN.md`

Status: `Partial`

可參考：

- `report/task.md`
- `report/implementation_plan.md`

缺少：

- 排課邏輯測試案例
- 衝堂測試
- 學分上下限測試
- 必修課加入失敗測試
- API 測試案例
- 前端操作測試
- AI Agent 問答與工具呼叫測試
- 每次開發完成後的驗收流程

## Recommended Files

### `docs/UX_FLOW.md`

Status: `Partial`

可參考：

- `client/src/App.jsx`
- `client/src/pages/LoginPage.jsx`
- `client/src/pages/OnboardingPage.jsx`
- `client/src/pages/SetupPage.jsx`
- `client/src/pages/DashboardPage.jsx`
- `client/src/pages/SearchPage.jsx`
- `client/src/pages/GraduationPage.jsx`
- `report/系統操作指南.md`

缺少：

- 登入到排課完成的完整流程
- 每個頁面的進入條件
- 主要按鈕與操作結果
- 錯誤狀態
- 空資料狀態
- 手機與桌面流程差異

### `docs/PROMPT_DESIGN.md`

Status: `Partial`

可參考：

- `server/src/services/promptService.js`
- `server/src/services/agentService.js`

缺少：

- System prompt 的設計目的
- Tool call JSON 格式
- Few-shot examples
- Observation 格式
- Final answer 格式
- 禁止事項
- Prompt 更新流程

### `docs/ARCHITECTURE.md`

Status: `Partial`

可參考：

- `report/implementation_plan.md`
- `report/assets/Agent架構圖_ver.1.png`
- `client/src/services/api.js`
- `server/src/app.js`

缺少：

- 前端、後端、資料層、Agent、排課引擎的正式架構圖
- 資料流
- 模組責任
- 主要 API 呼叫流程
- 本地開發與部署架構差異

### `docs/DECISIONS.md`

Status: `Partial`

可參考：

- `report/implementation_plan.md`
- `report/個人化課表規劃系統 — 開發進度與 MVP 完工報告.md`

缺少：

- 每個決策的日期
- 背景
- 選項
- 決策
- 理由
- 影響
- 後續是否要重評估

## Non-Markdown File

### `.env.example`

Status: `Missing`

應包含：

```env
PORT=3001
GEMINI_API_KEY=your_api_key_here
```

可選：

```env
NODE_ENV=development
```

注意：`.env.example` 只能放範例值，不可放真實 API key。

## Recommended Creation Order

1. `AGENTS.md`
2. `docs/SCHEDULING_LOGIC.md`
3. `docs/AI_AGENT_SPEC.md`
4. `docs/DATA_SCHEMA.md`
5. `docs/API_SPEC.md`
6. `docs/TEST_PLAN.md`
7. `docs/REQUIREMENTS.md`
8. `docs/UX_FLOW.md`
9. `docs/PROMPT_DESIGN.md`
10. `docs/ARCHITECTURE.md`
11. `docs/DECISIONS.md`
12. `.env.example`

## Current Conclusion

正式規範文件尚未完成。現有 `report/` 文件可作為素材來源，但不能直接取代正式規範，主要原因是：

- 檔名與位置不是開發規範慣例。
- 多數中文內容有亂碼，會影響團隊與 Codex 理解。
- 缺少 API、資料格式、測試案例、Agent 邊界、排課規則等可驗收細節。
- 沒有 `AGENTS.md`，Codex 每次開發時缺少固定專案規則。
