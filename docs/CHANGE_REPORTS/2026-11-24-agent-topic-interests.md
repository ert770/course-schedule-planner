# Agent 讀取並修改課程主題偏好（ADR-037，第二批）

日期：2026-11-24

## 背景

使用者希望 AI Agent 能存取、修改整條排課路徑上的課程主題偏好，再依他的要求調整排課。這些偏好包括：

- s_tag：主題問答勾選，加上互動事件。
- s_vec：標籤向量。
- s_cf：全體學生的選課共現。

先前的狀況（ADR-032）：

- Agent 只能把主題當單次關鍵字。
- 使用者說「以後想多排區塊鏈」時，Agent 只能叫他去設定頁。重跑時舊版還誤稱「課程主題問答沒有區塊鏈選項」。
- 問「為什麼推薦這門課」時，Agent 回答「沒有推薦理由，無法判斷」。

使用者決定（2026-11-24）：

- 「有興趣」直接加進主題勾選。
- 「不想再排」從勾選移除，並用既有機制記一筆「沒興趣」，不新增排除欄位。
- 太常見的主題（Python 等）仍只能單次使用。
- s_cf 只讀。
- 「沒興趣」事件只用單元測試與不寫資料庫的重跑驗證。

## 修改檔案

| 檔案 | 內容 |
| --- | --- |
| `server/src/services/topicInterestService.js`（新增） | 主題比對（`findTopicTags`）、找可保存的方向（`locateTagCategory`）、加入（`addTopics`）、移除（`removeTopics`）、記錄沒興趣（`recordNotInterested`）、讀取與分數拆解（`describeTopicInterests`）、主流程（`updateTopicInterests`） |
| `server/src/services/agentService.js` | 新工具 `get_topic_interests`、`update_topic_interests` 的派送；主題寫入成功時回應帶 `preferencesUpdated` |
| `server/src/services/agentToolRegistry.js` | 登記兩個新工具，共 11 個 |
| `server/src/services/promptService.js` | 兩個工具的 schema；prompt 規則：長期主題用 `update_topic_interests`、「這次想排」仍用 `interests`、問推薦原因時呼叫 `get_topic_interests` |
| `server/src/services/explanationFaithfulness.js` | 把「主題興趣／命中…主題／相近主題」視為轉述推薦原因 |
| 測試 | 新增 `topicInterestService.test.js`（TI1～TI3）；`agentTools.test.js` AG22；`explanationFaithfulness.test.js` F31、F32；`prompt.test.js` P20；`agentToolRegistry.test.js` 改為 11 個工具；黃金題組新增 `topic-interest-saved`、`topic-not-interested` |
| 文件 | `DECISIONS.md`（ADR-037）、`PROMPT_DESIGN.md`、`API_SPEC.md`、roadmap #43 註記 |

前端沒有改。首頁收到 `preferencesUpdated` 已會重抓 profile；設定頁開啟時會讀到新的主題。

## 實作中發現並修正的問題

- **英文比對太寬**：「AI」用包含比對時會命中 Sustainability、Blockchain。改成英文整字比對、中文包含比對。
- **太常見的字擋掉相近主題**：「AI」完全相符的是太常見的「人工智慧」，會擋掉相近、可保存的「生成式AI」。現在兩者都列出。
- **移除時誤刪方向**（瀏覽器實測抓到）：移除會把原本只選方向、沒勾主題的項目一起刪掉，D1249697 的方向從 12 個變成 9 個。
  - 已用測試前的備份還原，確認與原本完全相同。
  - 修正後只刪「因為這次移除而變空」的方向，並補了測試。
- **忠實度檢查擋下正確回答**：問「為什麼推薦」時，Agent 依分數拆解回答，卻被判成缺少推薦原因（`MISSING_RECOMMENDATION_REASON`），換成了安全回答。
  - 拆解結果現在帶出命中的主題。
  - 忠實度檢查也接受以主題興趣轉述推薦原因。

## 影響範圍

- 只影響 AI Agent。排課引擎、s_tag／s_vec／s_cf 的計算方式都沒改。
- ADR-032「長期主題只能從問答設定」不再成立。自由文字的 `interests`／`preferredKeywords` 欄位維持已移除。
- 「沒興趣」事件刪不掉，影響大約 4 個月減半，掛的那門課會被探索頁視為不推薦。

## 測試與驗證

- `npm test`、前端 lint 與 build、`node --check`：見 commit 回報。
- 黃金題組（實際呼叫模型）20 題全過。
- **Agent 新舊對照**（舊版 `d2ba4a7` 放在暫時 worktree，兩版同時重跑、各 3 次；寫入用替身、讀取用 D1249697 真實資料）：
  - 「我對區塊鏈有興趣，以後多排一點」：
    - 舊版 3 次都說問答沒有這個選項、無法保存。
    - 新版 3 次都呼叫 `update_topic_interests`，加入區塊鏈。
  - 「我不想再排生成式AI的課了」：
    - 舊版 3 次都叫使用者自己去設定頁取消。
    - 新版 3 次都移除並記錄沒興趣。
  - 「為什麼推薦程式設計與問題解決」：
    - 舊版說沒有推薦理由。
    - 新版 3 次都引用命中主題（軟體開發 1、資訊科技 0.94、演算法 0.071）、s_vec 0.886，並說明 s_cf 沒有資料。
- **s_tag 只算不寫**（D1249697 真實勾選，只看先驗）：
  - 加入區塊鏈後，「區塊鏈實務與應用」從 0 變成 0.17。
  - 移除生成式AI後，帶該主題的課下降（0.33 變成 0.17 或 0，0.2 變成 0）。
  - 這次沒有跑整份排課的新舊對照。
- **瀏覽器**（`localhost:5173`，D1249697）：
  - 說「以後想多排區塊鏈的課」：資料庫勾選從 12 個方向、15 個主題，變成 13 個方向、16 個主題。設定頁「課程興趣」顯示區塊鏈；「排課條件」顯示「已確認主題：16 個」。
  - 說「把區塊鏈拿掉，只是取消勾選，不用記沒興趣」：修正後勾選與測試前完全相同。互動事件數維持 579 筆，其中 not_interested 7 筆，沒有新增。
  - 問「為什麼推薦智慧生活科技」：回答命中「機器學習」，s_tag 0.2、s_vec 0.207，s_cf 沒有資料。
  - console 沒有新的錯誤。

## Commit 與 push

commit 並 push 至 `origin backend`。
