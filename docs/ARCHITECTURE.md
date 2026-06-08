# 系統架構

## 架構總覽

```text
React/Vite Frontend
        |
        | HTTP JSON
        v
Express Backend
        |
        +--> Routes
        +--> Services
        +--> Skills
        +--> JSON Database
        |
        +--> Gemini API
```

## 前端

位置：`client/`

職責：

- 顯示登入、設定、儀表板、搜尋、畢業學分頁。
- 管理使用者 session 與 theme。
- 呼叫後端 API。
- 顯示課表與 AI Agent 回覆。

主要檔案：

- `client/src/App.jsx`
- `client/src/services/api.js`
- `client/src/pages/*.jsx`
- `client/src/components/*/*.jsx`

## 後端

位置：`server/`

職責：

- 提供 REST API。
- 管理 JSON 資料讀寫。
- 執行排課、課程查詢、評價查詢。
- 呼叫 Gemini API 處理聊天 Agent。

主要檔案：

- `server/src/app.js`
- `server/src/routes/*.js`
- `server/src/services/*.js`
- `server/src/skills/*.js`
- `server/src/db/database.js`

## 資料層

目前使用 JSON 檔案式資料庫：

- `server/data/courses.json`
- `server/data/users.json`
- `server/data/reviews.json`
- `server/data/user_preferences.json`
- `server/data/saved_schedules.json`
- `server/data/chat_history.json`

優點：

- 適合 MVP。
- 容易展示。
- 不需額外資料庫服務。

限制：

- 不適合多人同時寫入。
- 缺少 transaction。
- 不適合正式部署。

## AI Agent

Agent 分為：

- `promptService.js`：建立 system prompt。
- `agentService.js`：處理對話、呼叫 Gemini、解析 tool call。
- `skills/*.js`：本地工具。

Agent 不直接操作資料庫事實，必須透過工具查詢。

## 排課引擎

位置：`server/src/skills/scheduler.js`

目前演算法：

- 先依硬性條件過濾。
- 必選課先排。
- 依類別與學分排序。
- 貪婪加入課程。
- 學分不足時嘗試補課。

未來需擴充：

- 多方案。
- 關注/加選分離。
- 核心選修路徑。
- 重補修優先。
- 數位課程門檻。

## API 流程範例

```text
DashboardPage
  -> scheduleAPI.generate()
  -> POST /api/schedule/generate
  -> routes/schedule.js
  -> skills/scheduler.js
  -> JSON response
  -> ScheduleGrid
```

