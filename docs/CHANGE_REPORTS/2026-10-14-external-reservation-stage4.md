# 階段 4：系外保留候選改用 s_vec

- 日期：2026-10-14（Asia/Taipei）。
- 計畫：`2026-10-14-cf-user-embedding-design.md` 3.7、第 7 節階段 4。
- 基準：`backend`，`f115f2a`。文字向量探索原型已於本回合先 commit／push 至 `origin backend`；本報告的接續改動尚未提交。
- 授權範圍：系外保留候選使用本人標籤向量；未開發 CF 或向量混合計分。

## 1. 修改檔案

| 檔案 | 改動 |
| --- | --- |
| `server/src/services/externalInterestReservationService.js`（新增） | 完整課程目錄建立歷史向量，依既有同意與本人訊號算候選 `s_vec`；失敗不阻擋排課 |
| `server/src/services/scheduleService.js` | REST／Chat 共用入口建立 server context，傳給 scheduler；反事實重排共用政策 |
| `server/src/skills/scheduler.js` | 可用系外候選取正 `s_vec` 前五個穩定課號，每系一門；保留名額與優先挑課，沿用硬條件與一般候選回退；放寬階梯也傳遞 context |
| `server/src/skills/planComparison.js` | 反事實基準與取消偏好後使用相同 runtime policy，避免換了模型造成假對照 |
| `server/test/externalInterestReservation.test.js`（新增） | 9 個案例：讀完整目錄、同意／失敗、A/B、負分／null、去重分散、衝堂、回退、不能偽造與反事實 |
| `.env.example` | `EXTERNAL_INTEREST_RESERVATION_MODE=vector`；`keyword` 供舊政策 A/B，未改真實 `.env` |
| `docs/API_SPEC.md`、`docs/DATA_SCHEMA.md`、`docs/SCHEDULING_LOGIC.md` | request context、公開摘要、政策與原計分的界線 |
| 設計計畫、roadmap、報告索引與本報告 | 更新進度、證據與限制；核對總覽全表狀態／相依 |

工作樹原有的 14 標籤降權／審核腳本與報告、未追蹤 Word／PDF／Excel 等均保留；本次未修改它們。
瀏覽器使用當下工作樹的降權資料（388 個），不把它誤記成此提交新產生的成果。

## 2. 實際規則

1. 僅在畢業配額啟用且系外學分仍有缺口時，服務載入完整課程目錄。歷史課不需要在本學期開課，
   才能在目錄中找到其向量；穩定課號沿用 `catalogCourseCode`。
2. 沿用 `loadUserTagVectorContext()` 的本人同意、歷史修課與互動規則，不使用其他人的資料。
   正負相似與本次候選課號的 P95 縮放沿用 `scoreCoursesForUser()`，不是新的 CF 分數。
3. scheduler 已做分類、資格、認列、已修、關注與無時間等排除後，從尚未使用的系外候選中取正分。
   正 `s_vec` 降冪；平手先穩定課號、班次 ID，課號去重且每系一門，最多 5 門。
4. 有正向保留清單且系外有缺口，就讓通識／系外兩個名額中至少一個為系外；總數上限仍為兩門。
   系外階段先依 `s_vec` 嘗試清單內各班次，分數相同沿用既有候選分與 ID；都不可排時退回其他系外課。
5. 沒同意、沒有正向訊號或讀取失敗不額外保留，依原畢業目標分配。0、null、負分不代表正向，
   也不因它們而刪除一般系外候選。指定課與必修仍先排；衝堂、封鎖時段、共修、資格與學分上限照原規則檢查。
6. runtime context 只由伺服器建立；HTTP body 即使帶同名分數也無效。未建立向量資料表，runtime 不呼叫 embedding API。
   `keyword` 是程序環境的舊政策 A/B 開關，預設為 `vector`。

回應 `graduationPlanning.externalInterestReservation` 揭露來源、上限與優先課號／分數；
`externalReservedForInterest` 是額外保留，`selected` 才是實際入選。
沒有把 `s_vec` 加到 `candidateScore`、`scoreBreakdown` 或方案 `preferenceScore`。
本次作用在 greedy 初始方案的名額和候選優先；MILP 替代方案仍以既有目標與類別門數產生，
可以選不同系外課，不保證每個替代方案都是前五門。第 6 階段向量融合尚未開始。

## 3. 測試

- 相關測試：`node --test server/test/externalInterestReservation.test.js server/test/graduationPlanning.test.js server/test/scheduleService.test.js server/test/planComparison.test.js`，60/60。
  開發中曾修正兩個新測試的 fixture／斷言：rank helper 需輸入已分類課程；反事實摘要沒有 `courses` 欄位，改檢查實際加退課差異。
- `CI=true npm test`：1,521 passed、0 failed、1 skipped。依既有 CI 決定不呼叫 golden set 模型。
- 本機 `npm test`：1,537 passed、0 failed、1 skipped；golden set 13/13，pass@3 100%、pass@1 62%。
  初次執行被自動審核拒絕，因未核實外傳 payload／目的地；唯讀確認固定合成題庫、`EMPTY_PREFS={}`、
  公開工具 schema 與官方 OpenAI API 後重試獲准。沒有把 Persona／DB 歷史送入這份 golden set。
- skipped 為隔離 MySQL 寫入整合，沒有指定隔離 DB；未改連共用 DB 跑寫入型整合。
- 前端 `npm run lint`／`npm run build` 通過；111 個 `server/src/**/*.js` 語法通過，註解更新後再檢查 scheduler。
- 日誌在已忽略的 `tmp/external-reservation-focused.log`、`...-full.log`、`...-full-local.log`。

## 4. Chrome → 真實 HTTP API → MySQL A/B

在首頁 `http://localhost:5173/` 點「套用偏好排課」，代理到後端 27151，使用現有 MySQL 課程、Profile、歷史與本人事件。
沒有 mock。固定同一 Persona、學期、偏好和資料，只重啟後端切換 `keyword`／`vector` 政策；不改 Profile 或同意。

| Persona／主推方案 | A：keyword | B：vector |
| --- | --- | --- |
| 9001 | 24 學分，通識 1、系外 0；有保留但系外 unavailable | 24 學分，通識 1、系外 0；有正向清單但同樣未能入選，課程集合相同 |
| 9006 | 19 學分；必修 3、本系選修 2、通識 2、系外 0；通識含「衛星科技與永續發展」 | 20 學分；必修 3、本系選修 2、通識 1、系外 1；以「數值分析與微分方程解析」（HY2015）取代該通識 |

9006 兩組皆有 3 個方案，來源摘要分別確認 `keyword`／`s_vec`，不是只看課表推測政策。
B 清單：COOP2029、HY2015（均為 1）、LAND2057（約 0.8222）、ARCH2333（約 0.5133）、MGT2031（約 0.4894）。
兩組必修與本系選修相同；通識／系外總共 2 門。重啟一般後端後再排一次，來源仍為 `s_vec`、
20 學分、系外 1 門；實際切換輕鬆、集中並回到綜合方案均正常。獨立 validator 使用 MySQL 的本人偏好，
確認兩組全部 6 個方案 `valid=true`、violations=[]。console 新增 error／warning 為 0。
這是政策能影響入選與硬條件未破壞的工程證據，不證明數值分析一定比另一門課符合本人興趣。

截圖：`tmp/external-reservation-stage4/persona9006-keyword.png`／`persona9006-vector.png`，
局部視窗能看見 19／20 學分及替換課程；已查看圖片。首次 full-page 截圖逾時，改存實際 viewport。
完整 API 投影在同目錄 `browser-ab.json`，本機保留、不提交。

### 環境與資料操作

- 沒有 `preview_start` 工具，使用 `.claude/launch.json` 對應 npm 開發程序。發現舊預覽仍占用埠，
  第一份請求本來就跑 vector，故未當成 A；確認 PID 與本專案 `src/app.js` 後重啟，真正 A/B 回應皆核對來源。
- Persona 9008 登入後發現同意版本過期，未提交同意，改測 v3 同意有效的 9006。
  唯讀核對 9001／9006 有效，其餘 8 個 Persona 的 service 同意仍為 v2 待重新確認；本次未更新它們。
- 9001／9006 原前端 onboarded/setupDone 標記為 null；在確認既有同意有效後暫設引導標記進首頁，
  不提交隱私或個人設定。驗收後登出並恢復 null。
- 排課流程會照原設計寫入推薦曝光與重新排課事件，也可能刷新過期學習快取；不能把整段說成 DB 全唯讀。
  向量服務本身只讀，沒有新增 DB 向量表，也沒有修改歷史資料、收藏、選課或已存課表。
- 最後後端恢復一般 `npm run dev:server`，預設 vector；前端仍為 5173、代理 27151。

## 5. 進度與限制

本次約定的階段 4 系外保留候選已接入；探索文字向量原型仍為本機產物，沒有部署型保存表。
歷史回饋視窗（階段 5）、向量 shadow／融合計分（階段 6）、CF 同意與離線／試行（階段 7～8）仍未開始。
roadmap 進度總覽的全部狀態與相依已核對，本次沒有解除 #6 真實跨使用者資料、#32 比較、#36/#38 效果研究的外部阻塞。
Persona 仍是模擬案例，不當作真人或 CF 成效證據。

此接續改動未 commit、未 push；先前文字向量探索提交為 `f115f2a`，已推至 `origin backend`。
