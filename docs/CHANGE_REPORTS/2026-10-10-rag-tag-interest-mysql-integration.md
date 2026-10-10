# 2026-10-10 rag-tag-interest-v1 MySQL 整合與探索頁瀏覽器驗收

## 修改日期

2026-10-10

## 修改檔案

- server/test/tagInterestMysqlIntegration.test.js：修正新增事件回傳值斷言，服務回傳的是新增筆數 1，不是布林 true。
- docs/CHANGE_REPORTS/2026-10-10-rag-tag-interest-mysql-integration.md：更新實際 MySQL 整合及瀏覽器驗收結果。
- docs/CHANGE_REPORTS/2026-08-01-personalization-roadmap.md：更新 #43 階段驗收證據，重新核對進度總表的狀態與相依欄。

## 主要改動與影響範圍

- 沒有修改正式服務、API、資料表 schema 或前端功能程式。
- 在獨立的 rag_tag_interest_test 建立測試 schema，套用 privacy、interaction event、learned preference 與 tag-interest migrations（002、003、006、008）。測試資料庫保留供重跑；每次測試使用隨機合成 subject，結束時清除其互動事件、興趣快取、同意、稽核與 subject 狀態。
- 沒有修改 defaultdb 的業務資料，也沒有在其中新增測試使用者或課程。
- 前端瀏覽器驗收使用本機 mock API 與三張合成課程卡，不連接 MySQL。mock 另提供首頁所需的空課表 API，避免測試登入暫經首頁時產生無關錯誤。

## 測試與驗證

- 隔離 MySQL 整合：DB_NAME=rag_tag_interest_test、TAG_INTEREST_TEST_DB_NAME=rag_tag_interest_test、TAG_INTEREST_MYSQL_TEST=1 node --test test/tagInterestMysqlIntegration.test.js，1/1 通過。涵蓋同意、事件寫入與冪等、資料庫事件列、匯出標籤快照、profile 重算與快取、個人化重設及合成 subject 清理。測後唯讀查核 8 張測試表，事件、profile、同意、稽核、subject 等列數皆為 0。
- 完整後端測試：CI=true npm test，1,445 通過、1 項 opt-in MySQL 測試跳過、0 失敗；MySQL 情境另以隔離資料庫明確啟用並通過。依 CI 設定，需呼叫真實模型 API 的 golden set 未執行。
- 瀏覽器同意開啟對照：登入後首頁載入無 console error；進入 /interest-exploration，按「有興趣」後由第 1 張前進到第 2 張，mock 收到一筆 interest_exploration_feedback；再按第 2 張「略過這張」後正常前進至第 3 張，事件數仍為一筆。
- 瀏覽器未同意對照：畫面顯示未同意提示；按「有興趣」仍由第 1 張前進到第 2 張，mock 事件數維持 0。
- 首次瀏覽器測試的 mock 未涵蓋首頁排課 API，曾產生測試環境 console error；補上 mock 路由後，重新跑完 consent-on／off 情境，首頁與探索頁均為 0 個瀏覽器 console error，沒有 React 錯誤畫面。
- git diff --check：通過。
- 此瀏覽器測試使用 mock API；MySQL 服務層整合測試另行通過。尚未以真實課程／使用者資料跑完整「瀏覽器 → HTTP API → MySQL」端到端流程，因隔離資料庫未建立課程與個人 profile 測試資料。

## Commit 與 Push

- 未 commit、未 push。
