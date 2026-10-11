# rag-tag-interest-v1：預設啟用與驗收狀態更新

## 修改日期

2026-10-11

## 修改檔案

- `.env.example`
- `server/src/skills/tagInterestRanking.js`
- `server/test/tagInterestRanking.test.js`
- `docs/PLANS/2026-10-10-rag-tag-interest-v1-stage6-interface-design.md`
- `docs/CHANGE_REPORTS/2026-08-01-personalization-roadmap.md`
- `docs/CHANGE_REPORTS/2026-10-11-rag-tag-interest-stage6-browser-ab.md`
- `docs/CHANGE_REPORTS/2026-10-11-rag-tag-interest-active-default.md`（本報告）

## 主要改動

- 未設定 `TAG_INTEREST_RANKING_MODE` 時，標籤興趣排序預設為 `active`；明確設定 `off` 仍可立刻回復原排序，`shadow` 行為不變。
- 更新 `.env.example` 的預設值與過期註解。profile 仍由伺服器依同意狀態讀取；未同意行為學習者只使用明確主題先驗，profile 無法讀取時沿用原排序。
- 將 Persona UX 記為本專案後續階段正式的代表使用者驗收方式。Persona 情境是產品驗收依據；資料來源仍如實標示為模擬事件，不記成實際真人蒐集。
- 更新階段 6 設計稿、roadmap #43 狀態／相依及瀏覽器 A/B 報告，記錄 10 位 Persona 各跑 `off`／`active` 的 Chrome → HTTP API → MySQL 驗收，以及同帳號先後執行造成的資料污染限制。

## 影響範圍

一般排課請求若未指定模式，現在會使用標籤興趣分調整候選池及可行方案的軟性排序。硬性畢業／先修／班次／衝堂條件不變。設定 `TAG_INTEREST_RANKING_MODE=off` 可回復舊排序。

Persona 瀏覽器驗收的唯讀核對結果：`Learned_Tag_Interests` 10 列、探索回饋 58 筆、`plan_chosen` 10 筆、`recommendation_accepted` 10 筆、`recommendation_exposed` 21 筆、`schedule_regenerated` 21 筆。P08 另外重排一次以確認連線，因此曝光與重排各多一筆。每個帳號先跑 `off` 再跑 `active`，所以前一模式留下的接受事件會被後一模式讀取；這證明資料流與持久化，不當作乾淨的因果 A/B。

## 測試與驗證

- `node --test test/tagInterestRanking.test.js`：15/15 通過，包含未指定模式時預設 `active` 及明確 `off`／`shadow`／`active` 分支。
- `CI=true npm run verify`：前端 lint、build 與後端測試通過；1,480 passed、0 failed、1 skipped。CI 略過需要 live model 的案例。課程資料契約檢查連 `defaultdb` 並執行唯讀查詢；寫入型標籤興趣 MySQL 整合另行隔離。
- 明確指定 `DB_NAME=rag_tag_interest_test`、`TAG_INTEREST_TEST_DB_NAME=rag_tag_interest_test`、`TAG_INTEREST_MYSQL_TEST=1` 後執行 `node --test test/tagInterestMysqlIntegration.test.js`：1/1 通過；使用隨機測試 subject 並清理。
- `npm run eval:tag-interest`（在 `server` 目錄）：9/9 Persona 案例通過。
- `node --check src/skills/tagInterestRanking.js` 與測試檔：通過。
- Chrome 重新載入本機登入頁成功，HTTP 狀態 200；登入頁 console error／warning 為 0。透過本機 HTTP client 對後端 `/api/health` 與前端 `/login` 檢查均回 200。
- 本次重啟後，CUA 直接導覽後端 API 被 Chrome 回報 `ERR_BLOCKED_BY_CLIENT`，未在這一輪重新操作已登入的排課畫面；未設定模式的預設分支由單元測試驗證。先前 10 位 Persona × `off`／`active` 的排課瀏覽器流程已完成，詳見[瀏覽器 A/B 報告](./2026-10-11-rag-tag-interest-stage6-browser-ab.md)。
- 完整 verify 曾先以只有 fixture 的 `rag_tag_interest_test` 執行，資料契約測試因缺完整課程資料而失敗；改以 `defaultdb` 執行唯讀契約查詢後完整驗證通過。寫入型 MySQL 整合全程只使用 `rag_tag_interest_test`。
- `git diff --check`：本次追蹤檔案通過；新報告的尾端空白檢查也通過。

## Commit／Push

未 commit、未 push。
