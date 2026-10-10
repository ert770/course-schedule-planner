# rag-tag-interest-v1 階段 6 第三階段：候選層計分接線

## 修改日期

2026-10-10

## 修改檔案

- `server/src/skills/tagInterestRanking.js`
- `server/src/services/scheduleService.js`
- `server/src/skills/scheduler.js`
- `server/test/tagInterestRanking.test.js`
- `server/test/scheduleService.test.js`
- `server/test/scheduler.test.js`
- `docs/API_SPEC.md`
- `docs/PLANS/2026-10-10-rag-tag-interest-v1-stage6-interface-design.md`
- `docs/CHANGE_REPORTS/2026-08-01-personalization-roadmap.md`
- 本變更報告

## 主要改動

1. `TAG_INTEREST_RANKING_MODE` 支援 `off`、`shadow`、`active`，預設仍為 `off`。
2. `active` 由 server 根據同意狀態載入使用者標籤興趣 profile，對本系選修、通識與系外選修的自由候選套用：

   ```text
   candidateScore = poolBaseScore × (1 + 0.6 × courseTagScore)
                  + 學分分 + 文字偏好命中分 + 舊興趣關鍵字分 + 集中偏好分 + 難易偏好分
   ```

   分數範圍為 `-1～1`。若本次 scheduler 的池內基礎分為 1000，標籤分 `+0.8` 加 480 分，`-0.8` 減 480 分。`null` 或中性 0 不加不扣。profile 不可用時退回原分數。

3. 繼續使用既有畢業配額流程建立本系選修、通識及系外選修的階段候選集合；標籤軸只改軟性候選排序。必修／重補修、使用者指定課及共同必修實習不會取得標籤加減分。排課硬條件仍由原 scheduler 驗證。
4. 保留已確認的 `−2500` 跨年級選修排序規則，僅用於本系選修池。跨池課程類別優先分與非本系扣分不再作為標籤候選排序的一部分。
5. `shadow` 會計算同一候選階段內的假想排序，並記錄彙總分布與順序變動；不改正式課表、不持久化使用者分數或標籤清單。
6. 在既有 `recommendationReason.scoreBreakdown` 回傳 `tagInterest` 加減量，並更新 API 規格；未新增頂層回應欄位或資料表。此階段沒有改前端顯示。
7. 同步更新階段 6 設計稿與 roadmap。方案層 `planTagScore` 與 Persona 重播尚未完成。

## 影響範圍

- `off` 與 `shadow` 的正式候選及方案排序維持舊行為；部署預設仍為 `off`。
- `active` 可改變同一候選池中被選中的課程，因此可行課表仍受原有硬性條件控制，並可能改變可行方案組成。
- 此階段尚未把 `planTagScore` 乘入既有 `preferenceScore`，也尚未把標籤理由顯示為命中標籤名稱。
- 依使用者明確授權，以目前帳號在瀏覽器各執行一次 `off` 與 `active` 排課；兩次各產生一筆 recommendation exposure。兩組都產生 3 個方案，預設方案同為 4 門課／10 學分，競爭候選數同為 353，畫面結果未見差異。這次 A/B 完成了真實頁面操作，但未證明標籤分數在該帳號情境下改變排序；不再以此帳號重跑，後續需用有已知標籤訊號的 Persona 或隔離測試帳號確認效果。
- roadmap 狀態／相依總表已整體核對。#43 的依賴狀態未變，沒有其他任務因本次改動而需改狀態或相依。

## 測試與驗證

- `node --test test/tagInterestRanking.test.js test/scheduleService.test.js test/scheduler.test.js`（`server/`）：230 項通過。
- `npm test`（`server/`）：1,488 通過、0 失敗、1 項因未啟用隔離 MySQL 整合測試而略過。
- `server/src/**/*.js` 語法檢查：通過。
- `client/` `npm run build`：通過。
- `client/` `npm run lint`：通過。
- Chrome `/schedule` 真實頁面 off／active A/B：完成各一次；相同使用者設定下方案數、預設方案課數／學分及候選數相同，沒有觀察到可見排序差異，且產生兩筆 recommendation exposure。此結果不足以驗證有標籤訊號時的效果；未重複觸發。
- 瀏覽器 console：目前可讀的頁面紀錄無 error/warn；排課 A/B 完成後的歷史 console 紀錄不可回溯，故不據此宣稱 A/B 畫面 console 全程零錯誤。

## Commit／Push

本報告隨本次變更提交並推送至 `origin backend`；commit SHA 以 Git 記錄為準。
