# [cite_start]個人化課表規劃推薦系統 (Personalized Schedule Planning Recommendation System) [cite: 11]

## 專案簡介
[cite_start]本系統旨在解決大學生排課耗時且容易衝突的問題 [cite: 16][cite_start]，並整合分散的課程評價資訊 [cite: 17]。
[cite_start]透過建立一個個人化課表規劃推薦系統 Agent [cite: 55][cite_start]，系統能根據使用者的個人限制條件（如不排早八等）[cite: 16][cite_start]，運用演算法自動生成無衝突的最佳化課表 [cite: 19]。

## 從乾淨的 Git checkout 啟動

1. 安裝 Node.js 24。在專案根目錄執行 `npm ci`，接著執行 `npm ci --prefix client` 與 `npm ci --prefix server`。
2. 參考 `.env.example` 設定 `server/.env`。課程與歷史修課功能需要團隊提供的 MySQL 連線設定與 TLS CA。可把 CA 放在 `server/ca.pem`，並依範例設定 `DB_SSL_CA_PATH`。Agent 呼叫模型時需要自己的 `OPENAI_API_KEY`。
3. 一般開發在專案根目錄執行 `npm run dev`。前端送往相對路徑 `/api` 的請求由 Vite 代理到後端，後端預設使用 `3001`。

### Windows 本機 MyFCU 同步

1. 安裝 Google Chrome，確認 `server/.env` 已填妥 Aiven MySQL 連線與 TLS CA 設定，並先停止占用 `5173` 或 `27151` 的開發服務。
2. 讓前端使用相對路徑 `/api`。如果有 `client/.env.local`，可設定 `VITE_API_BASE=/api`，也可以省略這個設定以使用預設值。若固定為 `http://localhost:3001/api`，瀏覽器會直接打到 `3001`，繞過 MyFCU 的代理。
3. 在專案根目錄執行 `npm run dev:myfcu`，並開啟 [本機前端](http://localhost:5173/)。此指令將 MyFCU 後端啟動於 `127.0.0.1:27151`，並將 Vite 的 `/api` 代理目標設為 `http://127.0.0.1:27151`。

匯入及核對步驟見 [MyFCU 操作文件](docs/AIVEN_HISTORY_MIGRATION_RUNBOOK.md)。資料庫連線與金鑰放在後端本機設定，前端只需 API 路徑。

### 探索向量索引

「從一門課出發」會直接讀取隨版本提供的 `server/simulation-runs/course-exploration-embeddings/index.json`。需要指定其他索引時，可設定 `COURSE_EXPLORATION_EMBEDDINGS_PATH`，建議使用絕對路徑。下列指令均從專案根目錄執行。

| 指令 | 用途 |
| --- | --- |
| `npm --prefix server run exploration:index:check` | 載入索引，以隔離修課及班次驗證已修課能選取並完成比較。無須 MySQL 或模型金鑰 |
| `npm --prefix server run exploration:index:audit` | 唯讀盤點 MySQL 課程範圍與缺少快取的文字 |
| `npm --prefix server run exploration:index:build` | 由維護者更新索引，僅對快取未命中的課程文字呼叫向量 API |

更新後先檢查課程來源和涵蓋範圍，再執行檢查指令。`simulation-runs/` 只交付索引，向量快取和其他產物留在本機。

## 系統架構規劃
本專案採用四層式架構進行開發：

### 1. 互動展示層 (Web User / 前端 UI/UX)
[cite_start]負責處理使用者介面與互動，建構高互動性課表介面 [cite: 30]。
* [cite_start]**技術棧**: React（Vite） [cite: 1, 30]。
* **核心功能**: 
  * [cite_start]**視覺化操作介面**: 實作具備拖曳功能的課表展示區 [cite: 1, 22]。
  * [cite_start]**對話需求輸入**: 允許使用者以自然語言輸入排課需求 [cite: 1]。
  * [cite_start]**個人化表單**: 讓使用者手動輸入已修學分與時段限制，以解決無法從校方直接取得個資的問題 [cite: 1, 55]。

### 2. Agent 核心控制層 (LMS Agent / 後端 API)
[cite_start]負責處理 API 請求、Prompt 管理與 LLM 推理 [cite: 1, 31]。
* [cite_start]**技術棧**: Node.js（Express 5，ESM） [cite: 1]。
* **核心功能**:
  * [cite_start]**記憶體模組 (Memory)**: 包含記錄當次聊天的短期記憶，以及儲存使用者偏好的長期記憶 [cite: 1]。
  * [cite_start]**提示詞工程 (Prompt Manager)**: 將自然語言與限制條件包裝成系統 Prompt [cite: 1]。
  * [cite_start]**推理與決策引擎 (LLM Core)**: 判斷使用者需求並決定呼叫對應的 Skill [cite: 2]。

### 3. 技能與工具層 (Skills / Tools)
[cite_start]Agent 根據推理結果執行特定工具 [cite: 2]。
* [cite_start]**Skill 1 (課程資料庫查詢)**: 查詢由老師端取得的完整課程資訊與大綱 [cite: 2, 55]。
* [cite_start]**Skill 2 (評價與涼度檢索)**: 檢索網路爬蟲抓取的文字評價（好評/負評標籤、重點摘要），以此作為成績分佈缺失的替代推薦依據 [cite: 2, 55]。
* [cite_start]**Skill 3 (排課演算法)**: 執行「限制滿足問題」(CSP) 演算法，產出無衝突課表 [cite: 2, 43]。

### 4. 資料基礎建設層 (Data & Database)
[cite_start]負責資料的儲存、清理與背景抓取任務 [cite: 2, 33]。
* [cite_start]**技術棧**: MySQL（Aiven，共用資料庫） [cite: 2, 32]。
* **核心模組**:
  * [cite_start]**課程與使用者資料庫**: 儲存全校課程資訊與使用者偏好 [cite: 2, 55]。
  * [cite_start]**評價清洗資料庫**: 儲存已萃取好關鍵字的評論資料 [cite: 2]。
  * [cite_start]**獨立背景任務**: 抓取 Dcard、歐趴糖等論壇的課程評價，寫入本系統共用的 `Course_Reviews` 表 [cite: 3, 33]。爬蟲程式本身在另一個獨立 repo（由組員 A 負責），**不在本 repo 內**，連結待補：[組員 A 的評論爬蟲 repo]()。
