# rag-tag-interest-v1 階段 6 第四階段：方案層標籤興趣計分

## 修改日期

2026-10-10（方案層後端計分）；2026-10-11（方案比較頁與補充瀏覽器驗收）

## 修改檔案

- `server/src/skills/tagInterestRanking.js`
- `server/src/skills/scheduler.js`
- `server/src/services/scheduleService.js`
- `server/test/tagInterestRanking.test.js`
- `server/test/scheduler.test.js`
- `server/test/scheduleService.test.js`
- `client/src/components/Schedule/PlanComparison.jsx`
- `docs/API_SPEC.md`
- `docs/PLANS/2026-10-10-rag-tag-interest-v1-stage6-interface-design.md`
- `docs/CHANGE_REPORTS/2026-08-01-personalization-roadmap.md`
- 本報告

## 主要改動

- 新增方案層計分純函式：只平均有興趣證據的自由選擇課分數；無證據課仍計入覆蓋率分母，但不當成負向訊號。
- 方案標籤倍率採 `1 + alphaPlan × planTagScore`，預設 `alphaPlan=0.6`；合併分為 `preferenceScore × planTagMultiplier`。正負分使用相同倍率，`null` 分數維持原比較結果。
- 排除個人必修、重補修、使用者固定指定課、關注課與實習共修夥伴；方案硬性成功狀態與最低學分排序仍優先於軟性分數。
- `active` 有可用標籤證據時以合併分排序，原始 `preferenceScore` 不覆寫；主推方案有標籤證據時，摘要訊息改為顯示偏好與標籤興趣合併分。
- 方案比較頁在回應含方案標籤計分欄位時固定顯示「標籤興趣分」與「標籤證據覆蓋率」；分數以帶正負號百分比呈現，無有效證據時明確顯示，覆蓋率以百分比呈現。沒有標籤計分欄位時維持原有摘要，不顯示空白標籤列。
- `shadow` 只記錄方案正／中／負／無證據分布與假想名次變動彙總，不在 API 暴露單一使用者的方案分數。
- 更新 API 規格、階段 6 設計稿及 roadmap。roadmap 進度總覽共 47 列已逐列核對：#43 的前置依賴仍均已完成，沒有其他列以 #43 為前置；本次沒有改動其他列狀態或相依。

## 影響範圍

- 部署預設仍為 `TAG_INTEREST_RANKING_MODE=off`；不會自行啟用正式標籤排序。
- 不新增資料表、migration、互動事件或 `plan-feature-v1` 三軸欄位；不寫入資料庫。
- `counterfactualForUser()` 仍不納入標籤分數。
- #43 仍屬部分完成：程式接線與前端方案指標呈現完成；Persona 重播及具已知標籤訊號的排課演算法 off／active A/B 尚待驗收。真人時間切分評估依既定計畫列入未來上線規劃。

## 測試與驗證

- 定向測試：237 項通過、0 失敗。
- 全後端 `npm test`：1,495 項通過、0 失敗、1 項略過。略過的是需明確設定獨立 MySQL 測試資料庫的持久化整合測試；未連線或修改目前資料庫。
- Golden set：13/13 案例通過，pass@3 為 100%、pass@1 為 62%。
- 後端語法檢查：105 個 `server/src/**/*.js` 檔案通過 `node --check`。
- 前端 `npm run build` 通過；`npm run lint` 通過。
- 前端 `PlanComparison` 瀏覽器 A/B（隔離 Vite `127.0.0.1:5176` + 合成 API）通過：合成 Persona 的「提供排課服務」與「個人化學習」同意均為已勾選，且有兩項顯式偏好及每方案兩門合成課；`off` 保留偏好與排課畫面，只顯示既有方案摘要、不出現標籤列；`active` 顯示 `+80%`、`−80%` 與 `50%`、`100%` 覆蓋率，即使其他方案指標相同也能讀到標籤值。隱私頁唯讀確認兩個同意 checkbox 已勾選，aggregate research 未勾選。瀏覽器主控台 error/warn 為空。這只驗證 UI 對 API 欄位的呈現，不代表以真實 profile 驗證排課器的 off／active 排序效果；完整 Persona 重播及已知標籤訊號的演算法 A/B 仍待驗收。未使用真實使用者 session，也未新增真實推薦曝光。

## Commit 與 Push

- 未 commit。
- 未 push。
