# 2026-10-09 rag-tag-interest 探索卡片略過崩潰修正

## 修改日期

2026-10-09

## 修改檔案

- `client/src/pages/InterestExplorationPage.jsx`：將「略過這張」按鈕改為呼叫 `advance()` 的無參數回呼，避免 React 的點擊事件物件被當成提示文字渲染。
- `docs/CHANGE_REPORTS/2026-10-09-rag-tag-interest-exploration-skip-fix.md`：記錄本次修正與驗證結果。

## 主要改動與影響範圍

- 修正探索卡片的「略過這張」操作。略過現在只推進卡片索引；略過最後一張時會完成探索並前往排課。
- 不改變正向／負向回饋、模型分數、API 契約或資料庫欄位。
- 影響範圍為登入後初始興趣探索頁的略過卡片流程。

## 測試與驗證

- 修正前後 Edge 瀏覽器 A/B：相同 Persona 與假 API fixture 下，修正前點擊略過會使 React 畫面崩潰；修正後第一張略過前進到第二張，略過最後一張前往 `/schedule`。
- 瀏覽器 console/runtime error：0。
- 探索回饋事件：略過流程未送出興趣事件；所有 API 呼叫均由瀏覽器端假資料攔截，未寫入共用資料庫。
- 前端 `npm run build`：通過。
- 前端 `npm run lint`：通過。
- 前端服務測試：7/7 通過。
- 後端 `server/src` 104 個 JavaScript 檔案 `node --check`：通過。
- `CI=true npm test`：1,445/1,445 通過。CI 依專案設定略過需呼叫真實模型 API 的 golden set（13 題及 1 題重跑一致性）。

## Commit 與 Push

- 依使用者授權由本次提交並推送；目標為 `origin backend`，commit SHA 以 Git 紀錄為準。
