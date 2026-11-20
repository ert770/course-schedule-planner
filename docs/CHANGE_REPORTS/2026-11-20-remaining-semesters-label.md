# 設定頁「剩餘學期數」標籤註明包含當學期

## 1. 修改日期

2026-11-20

## 2. 修改檔案清單

- `client/src/pages/SetupPage.jsx`
- `docs/CHANGE_REPORTS/2026-11-20-remaining-semesters-label.md`（本報告）
- `docs/CHANGE_REPORTS/README.md`（加入本報告連結）

## 3. 主要改動內容

設定頁的「剩餘學期數：」標籤改成「剩餘學期數（包含當學期）：」。

原因：排課的畢業缺口配額以 `剩餘缺口 ÷ 剩餘學期數` 計算本學期目標學分，而剩餘學期數
本來就把目前學期算進去（`server/src/data/graduationPlanning.js` 的 `inferRemainingSemesters()`、
`docs/SCHEDULING_LOGIC.md`「剩餘學期優先讀取 Profile 的 `remainingSemesters`……而且把目前學期算進去」）。
原本的標籤沒有說明這點。使用者若自行選擇，可能把當學期排除在外，例如大三下的使用者選 2 而不是 3，
分母因此偏小，本學期的目標學分就會偏高。

下拉選項的文字（「依年級自動推算」「剩餘 N 學期」）沒有改。

## 4. 影響範圍

- 只改了設定頁上的一段文字。
- 排課邏輯、API、資料欄位都沒有改，所以 `docs/API_SPEC.md` 與 `docs/DATA_SCHEMA.md` 不需要更新。

## 5. 測試與驗證結果

- `client`：`npm run build` 通過，`npm run lint` 沒有錯誤。
- 瀏覽器實測（`/setup`，已登入帳號）：
  - 修改前：用 DOM 讀取標籤文字，得到「剩餘學期數：」。
  - 修改後：同一頁面經 HMR 更新後讀取，得到「剩餘學期數（包含當學期）：」。電腦版寬度下，
    標籤與下拉選單仍排在同一列。
  - console：有 4 筆 401 錯誤，都發生在使用者登入前、未登入狀態下打開 `/setup` 時。
    登入後的 API 請求全部回應 200，沒有因這次修改新增錯誤。
- 手機寬度（375px）下，這個標籤會斷成好幾行。不過同一區塊的「MBTI 人格特質」標籤與
  「設定流程進度」原本就會這樣斷行，是設定頁既有的版面問題，這次沒有處理。
- 沒有改到後端，因此沒有執行後端語法檢查與 `npm test`。

## 6. 是否 commit 與 push

是。本報告與修改在同一個 commit 提交，push 到 `origin backend`。
`docs/CHANGE_REPORTS/README.md` 只提交本次新增的索引；該檔案中其他人尚未提交的索引沒有一起提交。
