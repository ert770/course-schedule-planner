# rag-tag-interest-v1 階段 6：Persona scheduler off／active 重播

## 修改日期

2026-10-11

## 目的與範圍

依階段 6 設計稿的 Persona 重播步驟，讓既有 10 位 synthetic Persona 各自走過正式 `generateSchedule()`，以完全相同的候選課、偏好、9 學分上下限與 solver seed 比較標籤興趣 `off`／`active`。此階段只新增離線驗收能力、測試及文件；沒有改排課正式邏輯、API、資料庫或前端，也沒有新增真實推薦曝光。

為確認標籤軟分數不會越過硬條件，兩種模式都將合成課程 `ai-foundations` 與 `database-course` 設成同時段，並檢查主推方案沒有同時選入兩門衝堂課。

## 評估結果

| 指標 | `off` | `active` |
| --- | ---: | ---: |
| 硬條件全數通過 | 10/10 | 10/10 |
| 平均選中 Persona 標註相關課數 | 1.7 | 1.8 |
| 平均 precision | 0.566667 | 0.600000 |
| 平均 recall | 0.766667 | 0.816667 |
| 有證據 Persona 的平均方案標籤興趣分（n=9） | 無 | 0.257498 |
| 平均標籤興趣覆蓋率 | 無 | 0.833333 |
| 平均子分類多樣性 | 1.000000 | 1.000000 |

有 5 位 Persona 的選課組合改變：P02、P03、P05、P06、P07；其餘 5 位未變。P08 是只有廣泛 AI 主題、沒有標籤行為訊號的冷啟動案例，`planTagScore=null`、coverage 為 0，`off`／`active` 選課相同。P01 則只有明確主題先驗，因此可有標籤分數，但沒有行為資料。

理由與分數核對：

- `active` 方案列出的命中標籤都屬於該課可跨課配對的標籤，42/42 個理由標籤通過 server-side 忠實度檢查。標籤名稱不新增到 API 回應。
- 30/30 門已選課的 `scoreBreakdown.tagInterest` 與 `1000 × α_course(0.6) × courseTagScore` 一致；無使用者證據的標籤分按 0 計算。
- 兩種模式皆通過排課器成功、衝堂／重複課檢查及 9 學分上下限；衝堂候選組合沒有同時出現在主推方案。

這些 precision／recall 與變動數字只反映固定人工標註的合成情境，**不是推薦準確率、真人偏好證據或線上成效**，也不據此調整 α。真人按時間先後切分的評估依既有決策列入未來上線規劃。

## 修改檔案

- `server/scripts/lib/tagInterestEvaluation.js`：新增對正式 scheduler 的 `off`／`active` 雙模式 Persona 重播、硬條件與理由／score breakdown 檢查，以及彙總指標。
- `server/test/tagInterestEvaluation.test.js`：驗證 10 位 Persona 兩種模式均符合硬條件、標籤分數與理由一致，且能辨認冷啟動及組合變動。
- `docs/PLANS/2026-10-10-rag-tag-interest-v1-stage6-interface-design.md`：將 Persona 重播標為完成，記錄結果，將安全瀏覽器 A/B 列為下一步。
- `docs/CHANGE_REPORTS/2026-08-01-personalization-roadmap.md`：更新 #43 狀態、進度摘要與下一步；逐列核對狀態／相依總表。#43 前置項目均已完成，沒有其他任務以 #43 為依賴，因此其他列狀態與相依維持不變。
- `docs/CHANGE_REPORTS/README.md`：新增本報告索引。

## 驗證

- `node --test test/tagInterestEvaluation.test.js`：10/10 通過。
- `node --test test/tagInterestEvaluation.test.js test/tagInterestRanking.test.js test/scheduler.test.js test/scheduleService.test.js`：247/247 通過。
- `npm run --silent eval:tag-interest`：成功；9/9 合成規則案例通過，並輸出 10 位 Persona 的排課重播結果。
- `node --check`：`server/src` 105 個 JavaScript 檔案全數通過。
- 一般沙盒模式的 `npm run verify`：前端 lint 與 build 通過；測試中的 localhost HTTP server 遭 `connect EACCES 127.0.0.1:<port>` 阻擋，live model golden-set 回報 `Connection error`。之後使用核准的本機測試權限執行 `CI=true npm run verify`：lint、build 及全套測試成功，1,480 通過、0 失敗、1 項隔離 MySQL 測試因未設定專用測試 DB 而略過；live model golden-set 的 13 題及一致性重跑依專案 CI 政策跳過，沒有呼叫模型。
- 本階段只跑離線 Persona 重播，沒有做瀏覽器 A/B。下一步依計畫使用具已知標籤訊號的隔離測試資料跑安全瀏覽器 `off`／`active` 對照，並檢查畫面理由、硬條件及 console；不重跑會寫入真實帳號曝光的對照。

## Commit／Push

本報告建立時尚未 commit／push；完成後依使用者要求執行 `project-commit-push`。
