# 開發決策紀錄

## ADR-001：MVP 使用 JSON 檔案式資料庫

日期：2026-06-08

背景：

專題 MVP 需要快速展示課程、使用者、評價、偏好與課表資料。

決策：

目前使用 `server/data/*.json` 作為資料來源。

理由：

- 不需要額外資料庫服務。
- 方便展示與修改測試資料。
- 適合 MVP 開發速度。

影響：

- 不適合多人同時寫入。
- 未來正式部署需改成 SQLite、MySQL 或 PostgreSQL。

## ADR-002：排課邏輯先用規則式演算法，不完全交給 LLM

日期：2026-06-08

背景：

排課需要符合衝堂、學分、必修、重補修等硬性限制。

決策：

排課由 `server/src/skills/scheduler.js` 執行規則式演算法，LLM 只負責理解需求與呼叫工具。

理由：

- 硬性限制需要可驗證。
- LLM 可能編造或忽略限制。
- 規則式演算法較容易測試。

影響：

- 排課邏輯需寫成明確規格。
- Agent prompt 必須禁止直接編造課表。

## ADR-003：AI Provider 目前使用 Gemini

日期：2026-06-08

背景：

目前後端依賴 `@google/genai`。

決策：

MVP 階段使用 `GEMINI_API_KEY` 呼叫 Gemini。

理由：

- 目前程式已完成 Gemini client。
- 可透過 `.env` 設定。

影響：

- 無 API key 時聊天功能不可用。
- 若未來改 OpenAI，需同步更新 service、prompt 與 `.env.example`。

## ADR-004：不使用 GitHub connector

日期：2026-06-08

背景：

本專案使用共用 ChatGPT / Codex 帳號開發，不應將個人 GitHub 權限授權到共用 connector。

決策：

所有 GitHub 操作使用本機 Git 與 GitHub CLI 認證，不使用 GitHub connector。

理由：

- 避免個人 repository 權限被共用帳號中的其他使用者存取。
- 權限邊界較清楚。

影響：

- Codex 只能在本機專案資料夾內執行 Git。
- push 前必須確認 remote 與 branch。

