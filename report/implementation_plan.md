# 個人化課表規劃推薦系統 — Implementation Plan

## 背景

根據 README.md 規格，本系統採用**四層式架構**：
1. **互動展示層** — React 前端 UI/UX
2. **Agent 核心控制層** — Node.js 後端 API
3. **技能與工具層** — 排課演算法、課程查詢、評價檢索
4. **資料基礎建設層** — 資料庫與爬蟲

---

## User Review Required

> [!IMPORTANT]
> **LLM API Key**: 系統規格中提到 LLM 推理引擎。本計畫將先建立完整架構並使用 **規則式推理 + 模擬 LLM 回應** 作為預設，未來可輕鬆接入 OpenAI / Gemini API。是否需要現在就接入真正的 LLM？若是，請提供 API Key。

> [!IMPORTANT]
> **爬蟲功能**: README 提到使用 Python 爬取 Dcard 評價。本原型版本將使用 **mock 評價資料**，爬蟲模組作為獨立腳本提供框架。是否同意此做法？

> [!WARNING]
> **資料庫選擇**: README 建議 MySQL 或 MongoDB。為了降低安裝門檻，本計畫使用 **SQLite**（透過 better-sqlite3），允許零配置即可運行。是否同意？或希望使用 MySQL/MongoDB？

---

## Proposed Changes

### 專案結構總覽

```
agent project/
├── client/                    # 前端 (React + Vite)
│   ├── public/
│   ├── src/
│   │   ├── components/
│   │   │   ├── Layout/        # 主佈局、導航
│   │   │   ├── Schedule/      # 課表展示、拖曳
│   │   │   ├── Chat/          # 對話需求輸入
│   │   │   ├── Profile/       # 個人化表單
│   │   │   └── CourseCard/    # 課程卡片
│   │   ├── pages/
│   │   │   ├── HomePage.jsx
│   │   │   ├── SchedulePage.jsx
│   │   │   └── ProfilePage.jsx
│   │   ├── hooks/             # 自訂 hooks
│   │   ├── services/          # API 呼叫
│   │   ├── utils/             # 工具函式
│   │   ├── styles/            # CSS 檔案
│   │   ├── App.jsx
│   │   └── main.jsx
│   ├── index.html
│   ├── vite.config.js
│   └── package.json
│
├── server/                    # 後端 (Node.js + Express)
│   ├── src/
│   │   ├── routes/            # API 路由
│   │   │   ├── chat.js
│   │   │   ├── courses.js
│   │   │   ├── schedule.js
│   │   │   └── profile.js
│   │   ├── services/          # 業務邏輯
│   │   │   ├── agentService.js    # Agent 核心控制
│   │   │   ├── memoryService.js   # 記憶體模組
│   │   │   └── promptService.js   # Prompt 管理
│   │   ├── skills/            # 技能與工具層
│   │   │   ├── courseQuery.js     # Skill 1: 課程查詢
│   │   │   ├── reviewSearch.js    # Skill 2: 評價檢索
│   │   │   └── scheduler.js      # Skill 3: CSP 排課
│   │   ├── db/                # 資料庫
│   │   │   ├── database.js        # DB 連線
│   │   │   ├── schema.sql         # 資料表結構
│   │   │   └── seed.js            # 種子資料
│   │   └── app.js             # Express 入口
│   └── package.json
│
├── README.md
└── package.json               # Root workspace
```

---

### Layer 1: 互動展示層 (Frontend)

#### [NEW] `client/` — React + Vite 前端

| 檔案 | 說明 |
|------|------|
| `components/Schedule/ScheduleGrid.jsx` | 週課表格元件，支援拖曳（react-beautiful-dnd） |
| `components/Schedule/TimeSlot.jsx` | 時段格子元件 |
| `components/Schedule/CourseBlock.jsx` | 課程方塊，含顏色與資訊 |
| `components/Chat/ChatPanel.jsx` | 右側對話面板，自然語言輸入 |
| `components/Chat/MessageBubble.jsx` | 訊息氣泡 |
| `components/Profile/ProfileForm.jsx` | 個人化表單（已修學分、時段限制） |
| `components/CourseCard/CourseCard.jsx` | 課程資訊卡片（含評價摘要） |
| `components/Layout/Navbar.jsx` | 頂部導航列 |
| `components/Layout/Sidebar.jsx` | 側邊欄 |
| `pages/HomePage.jsx` | 首頁 — 功能介紹 + 快速開始 |
| `pages/SchedulePage.jsx` | 主頁面 — 課表 + 對話 |
| `pages/ProfilePage.jsx` | 個人設定頁面 |
| `styles/index.css` | 全域樣式、Design System |
| `styles/schedule.css` | 課表專用樣式 |
| `styles/chat.css` | 對話面板樣式 |

**設計重點**:
- 深色主題 + 玻璃態效果 (glassmorphism)
- 課表使用鮮豔漸層色塊區分課程
- 對話面板有打字動畫效果
- 響應式設計，支援行動裝置

---

### Layer 2: Agent 核心控制層 (Backend)

#### [NEW] `server/` — Node.js + Express 後端

| 檔案 | 說明 |
|------|------|
| `app.js` | Express 伺服器入口，CORS、中介層 |
| `routes/chat.js` | `POST /api/chat` — 接收自然語言需求 |
| `routes/courses.js` | `GET /api/courses` — 課程查詢 |
| `routes/schedule.js` | `POST /api/schedule/generate` — 生成課表 |
| `routes/profile.js` | `GET/POST /api/profile` — 使用者偏好 |
| `services/agentService.js` | Agent 核心 — 解析意圖、分派 Skill |
| `services/memoryService.js` | 短期記憶（對話歷史）+ 長期記憶（用戶偏好） |
| `services/promptService.js` | 組裝系統 Prompt |

**Agent 推理流程**:
```
使用者輸入 → promptService 包裝 → agentService 解析意圖
  → 判斷需要哪個 Skill → 執行並回傳結果
```

---

### Layer 3: 技能與工具層 (Skills)

| 檔案 | 說明 |
|------|------|
| `skills/courseQuery.js` | **Skill 1**: 查詢課程資料庫（支援關鍵字、時段、學分篩選） |
| `skills/reviewSearch.js` | **Skill 2**: 檢索課程評價（好評/負評標籤、關鍵字摘要） |
| `skills/scheduler.js` | **Skill 3**: CSP 排課演算法（回溯搜尋 + MRV 啟發式） |

**CSP 演算法設計**:
- **變數**: 使用者想修的課程
- **域**: 各課程的可用時段/班次
- **約束**: 時段不重疊、不排早八、必修優先、學分上限
- **求解**: 回溯搜尋 + Forward Checking + MRV 啟發式

---

### Layer 4: 資料基礎建設層 (Data)

| 檔案 | 說明 |
|------|------|
| `db/database.js` | SQLite 連線管理 |
| `db/schema.sql` | 資料表：courses, reviews, users, preferences |
| `db/seed.js` | 種子資料 — 50+ 門模擬課程、100+ 則模擬評價 |

**資料表設計**:

```sql
-- 課程資料表
CREATE TABLE courses (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,           -- 課程名稱
  code TEXT UNIQUE,             -- 課程代碼
  instructor TEXT,              -- 授課教師
  department TEXT,              -- 開課系所
  credits INTEGER,              -- 學分數
  day_of_week INTEGER,          -- 星期幾 (1-5)
  start_period INTEGER,         -- 開始節次
  end_period INTEGER,           -- 結束節次
  location TEXT,                -- 教室
  capacity INTEGER,             -- 容量
  category TEXT,                -- 類別 (必修/選修/通識)
  description TEXT              -- 課程大綱
);

-- 課程評價
CREATE TABLE reviews (
  id INTEGER PRIMARY KEY,
  course_id INTEGER,
  sentiment TEXT,               -- positive/negative/neutral
  summary TEXT,                 -- 摘要
  keywords TEXT,                -- 關鍵字 (JSON)
  source TEXT,                  -- 來源
  FOREIGN KEY (course_id) REFERENCES courses(id)
);

-- 使用者偏好
CREATE TABLE user_preferences (
  id INTEGER PRIMARY KEY,
  user_id TEXT UNIQUE,
  completed_credits INTEGER,    -- 已修學分
  blocked_periods TEXT,         -- 禁排時段 (JSON)
  preferred_categories TEXT,    -- 偏好類別 (JSON)
  max_credits INTEGER,          -- 學分上限
  preferences_json TEXT         -- 其他偏好 (JSON)
);
```

---

## Open Questions

> [!IMPORTANT]
> 1. **LLM 整合**: 是否需要現在就接入 OpenAI/Gemini API？還是先用規則式推理即可？
> 2. **資料庫**: SQLite（零配置）是否可以接受？
> 3. **課程資料**: 是否有特定學校的真實課程資料需要匯入？或使用模擬資料即可？
> 4. **爬蟲**: Dcard 評價爬蟲是否需要在此階段實作？

---

## Verification Plan

### Automated Tests
1. 啟動後端伺服器：`cd server && npm run dev`
2. 啟動前端：`cd client && npm run dev`
3. 使用瀏覽器驗證：
   - 課表頁面正確渲染
   - 對話面板可輸入訊息並收到回應
   - 個人化表單可儲存偏好
   - CSP 演算法產出無衝突課表
   - 拖曳功能正常運作

### Manual Verification
- 請使用者在瀏覽器中操作完整流程
- 確認 UI 設計符合預期美觀標準
