# 探索頁「從一門課出發」改用課名、說明、主題三種相近程度（ADR-035）

日期：2026-11-24

## 背景

ADR-033 之後大部分起點推不出課。D1249697 的 53 門已修課中：18 門有共同主題但分數未達 0.40、6 門沒有共同主題標籤、15 門因為本學期課程表沒有這門課（沒有說明與標籤）而無法當起點。體育、國防課本來就不是探索候選，從體育課出發一定沒有結果。另外起點選單會列出實習課、每次重新進入都要重選、預設起點是「成績最高的本系課」，班次那一行也看不出是什麼。

使用者決定（2026-11-24）：

1. 用 OpenAI 分別算課名、課程說明、課程主題的相近程度，三者加總排序，並事先算好。
2. 門檻從 0.30 開始試算逐步提高 → 依試算與抽樣決定 **0.55**。
3. 體育、國防、班級活動這類不計入畢業學分的課不進探索，直接排除。
4. 實習課不列；選單記住上次選的起點；改為依課名排序（A～Z），拿掉「系統先以成績最高的本系課…」。
5. 班次那一行要看得懂。

## 修改檔案

| 檔案 | 內容 |
| --- | --- |
| `server/src/skills/courseExplorationVectors.js`（新增） | 建立三欄文件（主題只放主題類標籤；課程表沒有的已修課只有課名）、向量編碼、產物索引、三欄平均分數 |
| `server/scripts/courseExplorationEmbeddings.js`（新增） | 離線產生向量（text-embedding-3-large、512 維），預設 dry-run，`--apply` 才呼叫 OpenAI，文字雜湊快取 |
| `server/src/services/courseExplorationEmbeddingService.js`（新增） | 讀取產物，檔案沒變就沿用記憶體索引 |
| `server/src/services/explorationService.js` | 「從一門課出發」改用三種相近程度、門檻 0.55；排除不計畢業與實習課；起點依課名排序、預設第一門；兩種模式的候選都排除不計畢業的課 |
| `client/src/pages/ExplorePage.jsx`、`client/src/App.css` | 記住上次的探索方式與起點（per user、只存瀏覽器）；拿掉系統代選說明；卡片顯示課名／說明／主題的相近程度；班次區加「本學期可選的班次」與「班級／老師／時間」；說明文字 |
| `server/test/explorationService.test.js` | 改用注入的三欄向量；新增排除、排序、只有課名的起點、三欄平均與門檻等案例 |
| `server/test/courseExplorationVectors.test.js`（新增） | EV1～EV5 |
| `docs/DECISIONS.md`（ADR-035）、`API_SPEC.md`、`SCHEDULING_LOGIC.md`、`DATA_SCHEMA.md`、`TEST_PLAN.md` | 規則、API、產物格式、測試說明 |

向量產物 `server/simulation-runs/course-exploration-embeddings/`（約 17MB）為 git-ignored，不進版控；新環境要先執行 `node server/scripts/courseExplorationEmbeddings.js --apply`。

## 影響範圍

- 只影響探索頁；不改變自動排課、不寫互動事件。
- 「依你的修課與興趣」的排序不變，只多排除不計入畢業學分的候選。
- 舊的文字向量產物（`course-text-embeddings`）不再被探索頁使用。

## 試算與驗證

- **OpenAI**：2,028 個課號（課程表 2,004、只在修課紀錄 24）、5,757 段文字，實際 620,957 token（約 0.08 美元）。
- **門檻試算**（11 個帳號、263 門起點課，同一份資料）：

  | 門檻 | 門次 | 推不出課的起點 |
  | --- | --- | --- |
  | 0.30 | 2,094 | 0 |
  | 0.40 | 1,751 | 0 |
  | 0.50 | 995 | 22 |
  | **0.55** | **484** | **90** |
  | 0.60 | 210 | 159 |

  抽樣：0.50 以下大多不相干（微積分→投資學）；0.55～0.60 大致合理但仍有牽強配對；0.60 以上多數合理。上一版（ADR-033）為 311 門次、多數起點沒有結果。
- 正式服務重跑 11 個帳號：結果與試算相同（484 門次、90 門起點沒有結果）。
- `npm test`：1958 項，1944 通過、0 失敗、14 略過（13 個需要 Playwright、1 個既有略過）；前端 lint、build 通過；`node --check` 全部通過。
- **瀏覽器（D1249697）**：
  - 改前：53 門已修課中 15 門不能當起點，有結果的只有 14 門；選單有體育、班級活動、實習課；預設「Web程式設計」並顯示系統代選說明。
  - 改後：47 門可選、依名稱排序，預設「Python程式設計」；體育、國防、班級活動、實習課不在選單；推出 3 門並顯示課名／說明／主題百分比；選「離散數學」（本學期沒開，只比課名）推出 1 門；切到「依你的修課與興趣」再切回、回首頁再進來，都還是「從一門課出發／離散數學」；班次顯示「本學期可選的班次」「班級／老師／時間」。
  - 探索 API 全部 200。console 中的 404 是首頁的 `/api/controlled-browser/config`（MyFCU 本機模式未開，PR #37 起即有，與本次無關）。

## 尚未處理

- 34% 的起點仍推不出課；只有課名的起點配對較弱（例：離散數學→數學與金融企業實務 56%）。
- 舊的 `course-text-embeddings` 產物與服務不再被探索頁使用，未刪除。

## Commit 與 push

已 commit 並 push 至 `feature/explore-three-similarity`，開 PR 合入 main。`docs/CHANGE_REPORTS/README.md` 只提交本報告的索引一行。
