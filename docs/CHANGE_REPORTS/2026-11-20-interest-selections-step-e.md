# 課程主題選擇改版 Step E：設定頁三組選單與追問對話框

## 1. 修改日期

2026-11-20

## 2. 背景

接續 [Step A](./2026-11-20-interest-selections-step-a.md)～[Step D](./2026-11-20-interest-selections-step-d.md)。這一步把後端做好的
三組選單、追問與保存驗證接到設定頁：**使用者看得到的畫面第一次改變。**

## 3. 修改檔案清單

- `client/src/pages/SetupPage.jsx`
- `client/src/components/Profile/InterestFollowupDialog.jsx`（新增，仿 `HistoryFeedbackModal.jsx`，放在同一個資料夾）
- `client/src/utils/interestSelections.js`（新增，`followupKey`；元件檔不能同時匯出其他函式，否則 `react-refresh/only-export-components` 失敗）
- `client/src/services/api.js`、`client/src/App.css`
- `server/src/routes/courses.js`、`server/src/data/interestPreferences.js`、`server/test/interestPreferences.test.js`（移除舊的 `topics`）
- `docs/API_SPEC.md`
- `docs/CHANGE_REPORTS/2026-11-20-interest-selections-step-e.md`（本報告）、`docs/CHANGE_REPORTS/README.md`

## 4. 主要改動內容

### 4.1 設定頁「想接觸的課程主題」

- 改成**三組**：本系、通識、系外（不含理工類學院）。選項是這位學生候選課程的類別，滑鼠移上去顯示課程數、可選主題數與代表課程。
- 勾選結果存成 `topicSelections`：`[{ group, categoryId, level, mode, tagIds }]`，以 `(group, categoryId)` 為鍵——通識與系外都有
  「語言」時各自一筆，取消其中一組不影響另一組。
- **`direct` 選項**（目前只有「資訊安全與隱私」）：勾選後直接展開候選池裡實際命中的標籤，附課程數與代表課程，供學生確認，不要的可以取消。
- **已保存的選擇還原**：重新開啟設定頁時，選項是選中狀態；已保存過的追問類別顯示「已選 N 個具體主題」與「調整」。
  不在目前選單內的舊選擇（候選池更新）只顯示「另有 N 個先前保存的主題選擇…」並可整批移除，**不顯示原始 ID**。
- 舊的興趣關鍵字（`interests`／`preferredKeywords` 的名稱）改以「已設定的興趣關鍵字（點一下可移除）」顯示，不再混在主題選單裡。
- 「目前沒有特定方向，先平均探索」現在也會清掉課程主題選擇。

### 4.2 保存流程拆成兩段

- `handleSubmit`：有**新勾**的 `followup` 類別（不在已保存的選擇內）就先開追問對話框，沒有就直接保存。已保存過的類別不會每次都重問。
  缺班別時不追問，只記類別。
- `persist`：原本的保存邏輯，payload 多帶 `interestSelections`。保存回應若是 `unverified` 或有警告，先跳出說明（「其他設定都已保存…」）
  再按「繼續」離開，不會默默吞掉。

### 4.3 追問對話框 `InterestFollowupDialog`

- **自己處理 loading**，不使用頁面的 `generating`（那會把整頁換成 spinner，對話框會一起消失）。
- 每個類別一題（GPT 或固定問句，使用者看不出差別）；每個選項附「會加分給 N 門課，例如：…」（方案 A）；以前選過、仍然有效的標籤預設勾好；
  可以全部不選。
- `mode="save"`：「確定並保存」與「略過，直接保存」（略過時新類別只記類別、已確認的答案保留）；`mode="edit"`：從「調整」打開，「確定」只更新畫面。
- 追問載入失敗時顯示錯誤，**仍可「略過，直接保存」**，不擋住保存。一次超過 6 個類別時分批呼叫。

### 4.4 移除舊的 `topics`

`GET /api/courses/interest-options` 不再回 `topics` 與 `topicCourseCount`（只有設定頁一個呼叫端，已改讀 `topicGroups`）；`buildInterestOptions()`、
`INTEREST_TOPIC_LIMIT` 與對應的 2 個測試一併移除。

## 5. 影響範圍

- **使用者看得到的畫面改變**：設定頁的課程主題選單、保存時的追問對話框。
- API：`GET /api/courses/interest-options` 移除 `topics`、`topicCourseCount`（破壞性變更，前端已同步改）。
- 沒有排課器修改，不需要 S1-S10。
- 未推進 roadmap 任務的狀態（#43 延伸改版，尚未完成）。

## 6. 測試與驗證結果

- `client`：`npm run build` 通過；`npm run lint` 沒有錯誤（修掉一個真問題：元件檔匯出非元件函式）。
- 後端完整測試：1,709 個，1,708 通過、0 失敗、1 略過（比上一步少 2 個，是移除的舊函式測試）；`server/src/**/*.js` 全部 `node --check` 通過。
- **瀏覽器實測**（demo 帳號 D1249697，資工四合；前端 5173＋後端 27151，真實資料庫，真的 OpenAI 呼叫）：
  1. **選單**：設定頁展開後有三組，各 8 個選項（本系：資訊與計算：資訊科技、軟體開發、資訊安全 等／資訊科技／藝術、設計與媒體：系統設計、數位系統設計、數位媒體 等／程式、系統與資料／管理／資訊安全與隱私／具名軟體／控制、通訊與訊號；系外有語言、文學與溝通），三條修課路徑與舊的興趣關鍵字都在。
  2. **direct**：勾「資訊安全與隱私」，顯示展開的兩個標籤（資訊安全 5 門、數據保護 1 門，附代表課程）且預設勾好。
  3. **追問**：勾系外「語言、文學與溝通」後按保存，**對話框立刻開啟並顯示 loading，約 4.3 秒後出現選項**，背景頁面沒有被整頁 spinner 取代。
     題目是 GPT 寫的「你想接觸哪些語言、文學或溝通主題？」，12 個選項各附課程數與代表課程，另提示「這個類別另有 10 個主題未列出」。
  4. **保存與後端訊號**：選「外語學習」「語言學」後確定。送出的 `interestSelections` 兩筆；`GET /api/profile` 保存了兩筆；
     `GET /api/privacy/tag-interests` 的 `tagPriors` 出現資訊安全、數據保護、語言學、外語學習，p₀ = 1；`categoryInterests` 是兩個類別本身（沒有展開）。
     沒有行為證據的三個標籤分數是 1，「資訊安全」這個帳號本來就有行為證據，分數是 0.718（印證 p₀ = 1 不等於分數 1）。
  5. **還原**：重新開啟設定頁，兩個類別是選中狀態、direct 面板兩個標籤勾好、顯示「語言、文學與溝通已選 2 個具體主題」；沒有再次追問。
  6. **調整**：按「調整」開啟編輯模式對話框，0.44 秒載入（題目已快取），以前選的兩個預設勾好，按鈕是「確定」、沒有「略過」。
  7. **失敗路徑**：新勾「商業與管理」，並讓追問 API 回 500（在頁面注入）→ 對話框顯示錯誤、「確定」隱藏、**「略過，直接保存」可用**；按略過後已確認的兩筆答案（各 2 個標籤）保留，新類別存成 0 個標籤，伺服器同步，頁面離開設定頁。
  8. **console**：只有最開始後端尚未啟動時的 4 筆 502，沒有新的前端錯誤。
  9. **還原**：測試前存了偏好快照，測完用 API 還原 demo 帳號，所有欄位與快照一致（`interestSelections` 回到空陣列）。
- 測試過程的兩個**腳本誤差**（不是程式問題）：一、程式化連續點擊太快，React 還沒重新渲染，「保存」用到舊狀態而直接保存、沒有追問，真人點擊不會這樣；
  二、操作前頁面上「目前沒有特定方向，先平均探索」被按過一次（系統提示有一次使用者點擊），按鈕本來就會清空興趣關鍵字與修課路徑，所以第一次保存送出的 `interests` 為空。
- **沒有做**：A/B 對照單課分數與排課結果、`INTEREST_FOLLOWUP_MODE=fixed`、拿掉 `OPENAI_API_KEY`、手機寬度版面、`unverified` 提示對話框的畫面——留到 Step G。

## 7. 已知問題與待決

- 追問選項偶爾會出現附帶標籤（例如這位學生的「外語」「中文系」是實習課帶的標籤），已附代表課程讓學生判斷，方案 D 只能排後面、無法完全擋掉。
- 通識組仍會列出「資訊與計算」「工程與製造」（使用者決定先不過濾）。
- GPT 第一次約 4～5 秒；之後同一個類別走快取（約 0.4 秒）。

## 8. 是否 commit 與 push

是，推到 `origin backend`。`docs/API_SPEC.md`、`docs/CHANGE_REPORTS/README.md` 原本就有別人尚未提交的修改，這次只提交屬於本次的區塊。
