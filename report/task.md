# Task List — 個人化課表規劃推薦系統

## Phase 1: 專案初始化
- [x] 建立 root package.json (workspace)
- [x] 初始化 Vite + React 前端 (client/)
- [x] 初始化 Node.js + Express 後端 (server/)

## Phase 2: 資料基礎建設層
- [x] 建立 SQLite/JSON 資料庫連線 (database.js)
- [x] 建立資料表結構 (schema/models)
- [x] 建立種子資料 (seed.js) — 50+ 課程, 100+ 評價

## Phase 3: 技能與工具層
- [x] Skill 1: 課程資料庫查詢 (courseQuery.js)
- [x] Skill 2: 評價與涼度檢索 (reviewSearch.js)
- [x] Skill 3: CSP 排課演算法 (scheduler.js)

## Phase 4: Agent 核心控制層
- [x] Agent 推理服務 (agentService.js)
- [x] 記憶體模組 (memoryService.js)
- [x] Prompt 管理 (promptService.js)
- [x] API 路由 (chat, courses, schedule, profile)
- [x] Express 入口 (app.js)

## Phase 5: 互動展示層 (前端)
- [x] Design System & 全域樣式 (CSS)
- [x] Layout 元件 (Navbar)
- [x] Schedule 元件 (ScheduleGrid, TimeSlot, CourseBlock)
- [x] Chat 元件 (ChatPanel, MessageBubble)
- [x] Profile 元件 (ProfileForm)
- [x] CourseCard 元件
- [x] 頁面組裝 (HomePage, SchedulePage, ProfilePage)
- [x] API 服務層 & Hooks
- [x] App.jsx 整合路由

## Phase 6: 驗證
- [x] 啟動後端並確認 API 運作
- [x] 啟動前端並確認 UI 渲染
- [x] 端對端功能測試 (已完成: 意圖解析修復 + 排課演算法效能優化成功)


