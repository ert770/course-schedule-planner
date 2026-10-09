# 2026-10-09 rag-tag-interest-v1 階段 4：前端初始探索

## 修改範圍

依 docs/PLANS/2026-10-08-rag-tag-interest-v1-plan.md 完成第 4 階段：登入後第一次保存偏好設定，接續到初始課程主題探索；完成或略過後進入排課。

## 修改檔案

- client/src/App.jsx：新增受登入、偏好設定及隱私狀態保護的 /interest-exploration 路由。
- client/src/pages/SetupPage.jsx：第一次保存偏好後依探索狀態導頁；保存失敗時保留設定頁並顯示錯誤；既有使用者可手動重新探索。
- client/src/pages/InterestExplorationPage.jsx、client/src/pages/InterestExplorationPage.css（新增）：探索主畫面、廣泛分類澄清、課程卡片、正負回饋、略過與完成狀態。
- client/src/services/interestExplorationState.js（新增）：按登入者分開保存探索狀態、卡片順序／位置及已處理主分類；不存卡片答案。
- client/src/services/api.js：新增探索候選卡片 API 呼叫。
- server/src/app.js、server/src/routes/interestExploration.js（新增）：掛載登入者專屬探索卡片端點，並要求 service_processing 同意。
- server/src/services/interestExplorationService.js（新增）：依登入者修課範圍、目前學期、資格及標籤學習資格挑出真實課程；排除必修、已通過、資格未知／不符、無時段及無合格標籤課程；去除同課號重複班次，優先已選主題並分散分類。
- server/test/interestExplorationService.test.js（新增）：驗證候選資格、課號去重、相關性／多樣性、廣泛分類追問及登入者範圍／學期。
- docs/API_SPEC.md：補上候選卡片端點、廣泛主分類追問格式及隱私同意行為。
- docs/PLANS/2026-10-08-rag-tag-interest-v1-plan.md：更新階段 4 狀態與實作紀錄。
- docs/CHANGE_REPORTS/2026-08-01-personalization-roadmap.md：更新 #43，並核對整張狀態／相依總表。其他任務的狀態與相依未因 #43 階段 4 改變；沒有其他總表列以 #43 作為前置條件。

## 使用流程

1. 第一次保存初始偏好後進入探索頁；完成或略過後進入排課。已完成／已略過者不會在後續登入被強制重問。
2. 只選廣泛主分類時，先列出目前合格探索課程可用的子分類。使用者選中的子分類存為明確 Profile 主題，不把整個分類樹展開成標籤興趣。
3. 卡片提供「有興趣」、「沒興趣」、「想先了解」及略過；負向回饋必須由使用者指定標籤。
4. 只有同意 personalization_learning 才將探索回饋送到既有互動事件 API；未同意仍能查看、略過及開始排課。
5. 進度按登入者寫在同一瀏覽器的 localStorage，包含狀態、卡片順序／位置及已處理主分類，不保存回饋答案。刷新後可接續；偏好設定頁可手動重新探索。
6. 沒有合格探索卡片時顯示說明並可直接排課。

## 驗證

- client：npm run build 通過。
- client：npm run lint 通過。
- server：node --check 對 server/src 的 104 個 JavaScript 檔案通過。
- 相關測試：node --test test/interestExplorationService.test.js test/tagInterestLearning.test.js test/interactionEventSchema.test.js，33/33 通過。
- 全套測試：CI=true npm test，1,438 項通過、0 失敗。CI 模式依專案設定略過會呼叫真實模型 API 的 golden set；沒有因此呼叫外部模型。
- 隔離 Edge 瀏覽器／本機假 API A/B：第一次偏好保存進入探索、廣泛分類追問、逐卡回饋、刷新續做、略過進入排課；既有使用者保存後不被強制導入探索，並可手動重新開啟。未同意時不送互動事件。
- 隔離 Edge 瀏覽器／本機假 API：同意後的正向回饋送出 interested；負向回饋送出 not_interested 及使用者選取的 canonicalTagId。
- 兩組瀏覽器流程均為 0 個 console error，且只連接本機假 API，沒有寫入共用 DB。

## 範圍與待辦

本階段未修改資料庫 schema，也未套用 migration。migration 008 尚未套用到共用 MySQL，因此本次沒有宣稱已驗證正式資料庫的同意後事件持久化；需完成 migration 後再做真實資料串接驗收。

階段 5「角色扮演與離線評估」及階段 6「排課介接」尚未開始。標籤興趣分數仍未接入正式排課排序。

未 commit、未 push。
