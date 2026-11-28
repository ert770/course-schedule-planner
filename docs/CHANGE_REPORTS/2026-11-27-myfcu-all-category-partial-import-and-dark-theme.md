# MyFCU 部分匯入擴及六個分類、欄位格式與擷取診斷；深色主題對比修正

修改日期：2026-11-27。基於 `origin/backend` 的 `723aa89`。

## 一、MyFCU 匯入

### 問題

使用者以真實 MyFCU 帳號同步時，畫面只顯示「擷取失敗」，後端沒有任何輸出。加上診斷後確認：
前五個分類正常，`#/courseSelPno` 有 4 列學期無法辨識（`semester_unrecognized`）。該分類含多門
「校際課程_學士_國外」等交換課。`836d764` 的部分匯入只開放 `#/courseKind1`、`#/courseKind23`，
因此整批仍被擋下。

### 修改檔案

| 檔案 | 改動 |
| --- | --- |
| `server/src/myfcu/console-poc.js` | 表格與必要表頭讀得到、只有個別列無法辨識時，六個分類一律標為 `rowReviewOnly`（原只限兩類），無法辨識的列進待核對、其餘照常匯入。占位列排除規則維持只套用在原兩類。學期另接受「暑修」「暑修班」「第一／第二學期」「第1／第2學期」「一／二」；學年與學分只剝除「學年度／學年」「學分」單位並接受「3.0」。無法辨識的學期文字（最多 10 字）記在列診斷。 |
| `server/src/services/historySnapshot.js` | `canSnapshotHistory` 不再只允許兩類的待核對列。表格未載入、表頭缺漏仍不建立快照。 |
| `server/src/services/localMyFcuPreview.js` | 新增 `captureFailureSummary`。擷取失敗時以 `[MyFCU 擷取] 失敗：` 輸出狀態、原因、最後四個階段、各分類狀態、無法辨識欄位代碼與筆數、無法辨識的學期文字；例外只輸出錯誤類型與第一行訊息（網址遮蔽）。不輸出課名、成績或修課內容。 |
| `server/scripts/observeMyFcuCompatibility.mjs` | 分類報告新增 `rowReviewOnly`、`unresolvedReasons`、`unrecognizedSemesters`。 |
| `server/test/historySnapshot.test.js` | 原本斷言「其他分類的無法辨識列須擋下快照」，依新規則改為可建立快照。 |
| `server/test/myfcuFieldFormats.test.js`（新增） | 單位與別名解析、非明確單位仍判無法辨識並記錄學期文字、成績「通過」收為待確認紀錄。 |
| `server/test/myfcuCaptureFailureLog.test.js`（新增） | 診斷摘要只含代碼與筆數，不含課名或成績。 |
| `docs/API_SPEC.md` | 部分匯入範圍、欄位寫法與診斷輸出。 |

寫入端 `courseHistoryAutoImport.js` 的欄位檢查（學期限 1～3、課號限大寫英數）未修改；被列為待核對的列不會進入寫入。

## 二、深色主題

### 問題

深色主題下課程詳細資訊彈窗為白底白字：標題、先修條件、課程說明、推薦理由都看不見。
多個元件的背景寫死成淺色，文字卻沿用主題的 `--text-primary`（深色時為 `#f8fafc`）。

### 修改檔案

| 檔案 | 改動 |
| --- | --- |
| `client/src/index.css` | 新增 `[data-theme='dark']` 覆寫：捲軸軌道、次要按鈕、輸入框、彈窗、關閉鈕、課號標籤、課程說明、推薦理由、信心標籤、取捨文字。 |
| `client/src/App.css` | 深色下畢業進度條底色。 |
| `CourseDetailModal.jsx`、`GraduationPage.jsx`、`SearchPage.jsx`、`PrivacyPage.jsx`、`SetupPage.jsx` | 主題背景上的內嵌寫死顏色改用主題變數；淺色主題下數值相同或極接近。 |

成對指定背景與文字色的提示框、`RemoveReasonDialog` 整個淺色對話框維持不動。

## 影響範圍

- MyFCU：只影響 Windows 本機 SessionImport 的擷取與快照判定。預檢、本人確認與寫入流程不變。
- 深色主題：只改顏色。
- 未修改排課邏輯（`scheduler.js`），未推進 roadmap 任務，roadmap 進度表不需更新。

## 測試與驗證

- `server/src` 全部 JavaScript 與擷取腳本 `node --check` 通過。
- `CI=true npm test`（server）：2,061 項中 2,029 項通過、0 項失敗、32 項跳過。
  不加 `CI` 時 `agentGoldenSet` 會因讀不到 `server/.env` 的 `OPENAI_API_KEY` 失敗（本機金鑰放在根目錄 `.env`），屬環境設定，與本次無關。
- `npm --prefix server run exploration:index:check` 通過（2,038 門課）。
- 前端 `npm run build`、`npm run lint` 通過。
- 瀏覽器（`npm run dev:myfcu`）：
  - MyFCU 實機 A/B（使用者本人以真實帳號操作）：`836d764` 版本 log 為 `#/courseSelPno` `CATEGORY_INCOMPLETE`、`semester_unrecognized: 4`、`rowReviewOnly:false`，無法匯入；本次修改後同一帳號匯入成功。
  - 深色主題 A/B：以示範帳號 D1249697 登入，搜尋通識課並開啟「世界經濟論壇」課程詳細資訊。套用本次規則時標題、先修條件、課程說明清楚可讀；在同一畫面移除本次規則後重現白底白字，與使用者截圖一致。淺色主題外觀不變。
  - console 只有登入前的 401。
- 未以登入帳號實際查看畢業、搜尋結果以外頁面的深色畫面。

## Commit 與 Push

commit 並 push 至 `origin backend`。
