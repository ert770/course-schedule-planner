# 階段 4：課程文字向量本機原型與探索 A/B

- 修改日期：2026-10-14（Asia/Taipei）。
- 分析基準：`backend`，HEAD `d63c193`；本次變更尚未 commit 或 push。
- 計畫來源：`2026-10-14-cf-user-embedding-design.md` 3.2.2 用途 2、3.7 與第 7 節階段 4。
- 使用者決定：向量先存本機；明確授權公開課名、canonical 標籤與課程簡介傳至 OpenAI API。

## 1. 實作與檔案

| 檔案 | 改動 |
| --- | --- |
| `server/src/skills/courseTextVector.js`（新增） | 穩定課號文件合併、canonical 標籤去重、文字雜湊、向量驗證／正規化、dense cosine |
| `server/scripts/courseTextEmbeddingStage4.js`（新增） | 預設 SELECT 盤點；`--apply` 才批次呼叫 API，內容雜湊快取、原子寫檔與斷點續做 |
| `server/src/services/courseTextEmbeddingService.js`（新增） | 讀本機產物、版本與雜湊檢查；按檔案更新時間與課程快取陣列重建記憶體索引 |
| `server/src/services/explorationService.js` | `representation=tfidf|embedding`；共用原本的候選與分散規則；缺產物時明確回報，不混用方法 |
| `server/src/skills/courseExploration.js` | 排名函式接受相似度函式，原本預設 TF-IDF 不變 |
| `server/src/routes/exploration.js` | 傳遞 representation，非法值回 400 |
| `client/src/services/api.js` | 集中組合表示法參數 |
| `client/src/pages/ExplorePage.jsx` | 共同用詞／語意相似切換、固定起點、實際共同標籤與缺檔回退按鈕 |
| `server/test/courseTextVector.test.js`（新增）、`server/test/explorationService.test.js` | 資料合併、雜湊、過期／損壞產物、表示法 A/B 與原本候選保護 |
| `.env.example`、`docs/DATA_SCHEMA.md`、`docs/API_SPEC.md`、`docs/SCHEDULING_LOGIC.md` | 本機路徑、產物契約、API 與演算法規則 |
| 計畫、roadmap、報告索引與本報告 | 記錄本機原型及剩餘工作；核對 roadmap 全表狀態與相依 |

工作樹原有的 14 個標籤降權、`formalTagClassify.js`、`readFormalTagDecisions.py` 及相關報告修改保留，
不是這次新增的工作；其他未追蹤交付文件與活頁簿也未納入本階段。

## 2. 資料與演算法

每個 `catalogCourseCode` 一份文件：同課號取最長的名稱／簡介（平手以固定字串順序決定）、
標籤轉為目前 canonical 名稱後取去重聯集。輸入只組合「課名＋主題＋簡介」，最多 1,800 code points。
內容雜湊包含文字規則版本與實際送出文字；同班次數不增加文件權重。

`similarity = dot(L2(course_vector), L2(favorite_vector))`，只列正相似候選。
排名使用當學期、資格確定、有時間且未通過的候選；每系／通識領域一門、每組最多 5 門，
講課與實習課合併。課號仍為推薦單位；加入課表的班次物件沿用既有格式。

| 實際產物 | 結果 |
| --- | --- |
| DB 公開課程 SELECT | 3,560 班次 → 2,004 穩定課號 |
| 簡介／截斷 | 2,004 門有簡介，0 門截斷 |
| 模型／維度／目錄 | `text-embedding-3-large`／3,072／`rag-tag-catalog-2026-10-14-v3` |
| 首次 API 用量 | 658,197 tokens |
| 固定排序後補算 | 1 門、337 tokens；兩次合計 658,534 tokens |
| 最後產生時間 | 2026-10-14 18:38:21 Asia/Taipei |
| 產物位置 | `server/simulation-runs/course-text-embeddings/index.json`，約 121 MB；另有內容雜湊快取 |

產物與快取均為 Git 忽略的本機檔案，沒有新增或寫入 MySQL 向量表。新 checkout 或另一台機器需離線重建。
runtime 只讀本機產物，不即時呼叫 OpenAI。目錄不合／格式損壞回 `text-embeddings-invalid`；
缺檔回 `text-embeddings-unavailable`；個別課的文件雜湊不同則停用該向量。

`semanticMatch.commonTags` 是兩門課實際 canonical 標籤的交集。它不是 embedding 分數的因果解釋，
不創作標籤理由。profile 模式的使用者標籤向量與正式排課的 `rag-tag-interest-v1` 計分未改。

## 3. 測試與瀏覽器驗收

- 相關單元與服務測試：31/31 通過（包含 7 項新增測試）。
- 前端 lint／build 通過。110 個 `server/src/**/*.js` 與新增腳本語法檢查通過；固定排序修正後另檢查該模組。
- 完整 `npm test`：首次 1,528 passed／0 failed／1 skipped；排序修正後一輪 1,526 passed／2 failed／1 skipped，
  原因為既有 Agent golden set 的 `no-invented-constraints` 中模型多回傳 schema 不允許的 `sourcePhrases`，
  同一題與整體通過率各失敗一項。未修改 Agent、schema 或測試斷言；再次執行為 1,528 passed／0 failed／1 skipped。
  golden set 首次與最後均 13/13，pass@1 均 62%；中間為 12/13。這反映既有模型回傳波動，不據此宣稱穩定率。
- 略過的項目為隔離 MySQL 整合測試，需指定隔離測試 DB；沒有改連共用 DB 執行寫入整合。
- 日誌：`tmp/course-text-stage4-npm-test.log`、`...-final.log`、`...-confirm.log`，均本機驗收產物。

### Chrome → 真實 HTTP API → MySQL 課程／歷史資料

使用 Persona `D0009001`（模擬帳號），不是研究參與者。頁面 `http://localhost:5173/explore`，
前端代理到 `http://localhost:27151`；讀取既有 MySQL 課程與該 Persona 的歷史、Profile。
沒有 mock API。兩組 A/B 都固定同一使用者、起點、學期與修課 scope。

| 起點 | 共同用詞（TF-IDF） | 語意相似（課程文字向量） |
| --- | --- | --- |
| `MATH1005P` 微積分(一)實習：跨系 | 坐標幾何、財務金融數量方法、電路學、租稅原理、管理與統計 | 坐標幾何、聰明消費與財富進階指南、管理與統計、租稅原理、會計學(二) |
| `MATH1005P`：通識 | 奈米科技與生活、我是誰？內在探索與世代對話、兩岸關係與大陸研究、生態環境保育 | 幸福會計學、微型創業入門、網際網路資訊的甄別與運用、材料與生活 |
| `IECS1005` 計算機概論：跨系 | 資訊網路、車輛碰撞學、坐標幾何、財務金融數量方法、文學作品導讀 | 資訊網路、電路學、無人機基本操作、管理與統計、智能化數位行銷 |
| `IECS1005`：通識 | 資訊隱私與法律知能、5G應用與人文社會發展、日本人文與地理、衛星科技與永續發展 | 人工智慧入門與省思、資訊隱私與法律知能、智慧綠台灣、現代軍事學概論 |

兩種表示法的探索請求皆 200；B 方法 metadata 回傳實際模型、維度與目錄，沒有內部向量。
卡片顯示共同標籤，班次仍有詳情與加入按鈕。本次沒有點加入課表或產生課表，排課驗證屬既有功能。

缺檔情境：將本機 `index.json` 暫時更名後再切到語意相似，API 回 `200`、
`text-embeddings-unavailable`、兩個空清單；畫面提供「改用共同用詞」，可成功切回。
之後已復原產物，再次切到 B 正常呈現計算機概論結果。
最後一段驗收（2026-10-14 18:39:32 起）console 新增 error／warning：0。

截圖在 `tmp/course-text-stage4/`：兩組各有 `tfidf`／`embedding` 全頁圖、
`missing-artifact.png` 與 `final-embedding-preview.png`；已查看最後畫面，切換列與課程卡沒有文字溢出。

### 環境與資料操作邊界

- 此工具環境沒有可呼叫的 `preview_start`；使用 `.claude/launch.json` 同樣的 npm 前後端腳本，
  Vite 5173 加上程序環境 `VITE_API_PROXY_TARGET=http://localhost:27151`、`VITE_API_BASE=/api`。
  初次重用的預覽程序在 A/B 途中停止，出現連線失敗；本次重新啟動的預覽已完成上述驗收。
- 登入後新瀏覽器沒有引導標記。先從實際 `/api/privacy/consents` 回應確認 `requiresAction=false`、
  Persona 的三種同意均已授予目前 v3，再暫時設定此 Persona 的前端 onboarded/setupDone 標記。
  沒有提交同意或 Profile；驗收後已登出，兩個標記恢復原先的 `null`。
- **整個既有 app 不是純唯讀。** `GET /api/privacy/personalization` 過期時會刷新
  `Learned_Preference_Weights`。本次查得 Persona 9001 的 v2 快取 `computed_at=2026-10-14T10:25:17.795Z`，
  `usable_event_count=0`，與登入驗收時段一致。向量產生腳本本身只有 SELECT；不能把整段瀏覽器流程
  寫成「任何 DB 列都沒有寫入」。沒有新增向量表、改同意、改 Profile 或寫入學習互動事件。

## 4. 範圍與剩餘工作

這次完成的是課程文字向量本機原型及探索 A/B 分支。結果能變化不代表內容更合適；尤其微積分案例仍會
推出財務／會計主題，來源標籤和多班次合併文件需要再人工核對。A、B 的輸入也不同：A 只用簡介，
B 用課名＋標籤＋簡介，所以差異不能全部歸因於 embedding 模型本身。沒有 MAE、NDCG 或真人效果結果。

3.7 的系外候選池保留名額改用 `s_vec` 尚未完成；本次沒有修改 scheduler 或排課 context。
階段 5 歷史修課回饋視窗、階段 6 向量 shadow 排課與階段 7～8 CF 仍未開始。
CF、神經網路偏好訓練與真人研究均沒有因本次原型而完成。

roadmap 進度總覽已核對整張狀態與相依表。本次探索原型不解除 #6 真實跨使用者資料、#32 比較與 #36/#38
效果研究的阻塞，其他列未因本次工程變更新增或解除相依。

未 commit、未 push；本機向量與驗收截圖不進版控。前後端預覽留在 27151／5173。
