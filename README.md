# [cite_start]個人化課表規劃推薦系統 (Personalized Schedule Planning Recommendation System) [cite: 11]

## 專案簡介
[cite_start]本系統旨在解決大學生排課耗時且容易衝突的問題 [cite: 16][cite_start]，並整合分散的課程評價資訊 [cite: 17]。
[cite_start]透過建立一個個人化課表規劃推薦系統 Agent [cite: 55][cite_start]，系統能根據使用者的個人限制條件（如不排早八等）[cite: 16][cite_start]，運用演算法自動生成無衝突的最佳化課表 [cite: 19]。

## 系統架構規劃
本專案採用四層式架構進行開發：

### 1. 互動展示層 (Web User / 前端 UI/UX)
[cite_start]負責處理使用者介面與互動，建構高互動性課表介面 [cite: 30]。
* [cite_start]**技術棧**: React.js 或 Vue.js [cite: 1, 30]。
* **核心功能**: 
  * [cite_start]**視覺化操作介面**: 實作具備拖曳功能的課表展示區 [cite: 1, 22]。
  * [cite_start]**對話需求輸入**: 允許使用者以自然語言輸入排課需求 [cite: 1]。
  * [cite_start]**個人化表單**: 讓使用者手動輸入已修學分與時段限制，以解決無法從校方直接取得個資的問題 [cite: 1, 55]。

### 2. Agent 核心控制層 (LMS Agent / 後端 API)
[cite_start]負責處理 API 請求、Prompt 管理與 LLM 推理 [cite: 1, 31]。
* [cite_start]**技術棧**: Node.js 或 Python [cite: 1]。
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
* [cite_start]**技術棧**: MySQL 或 MongoDB [cite: 2, 32]。
* **核心模組**:
  * [cite_start]**課程與使用者資料庫**: 儲存全校課程資訊與使用者偏好 [cite: 2, 55]。
  * [cite_start]**評價清洗資料庫**: 儲存已萃取好關鍵字的評論資料 [cite: 2]。
  * [cite_start]**獨立背景任務**: 使用 Python (BeautifulSoup / Selenium) 定期抓取 Dcard 論壇討論，並搭配 NLP 套件進行關鍵字萃取 [cite: 3, 33]。