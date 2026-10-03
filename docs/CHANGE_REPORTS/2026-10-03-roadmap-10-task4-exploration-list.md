# Roadmap #10 任務 4：系外與通識探索清單（Pardos & Jiang 2020）

日期：2026-10-03
分支：`backend`

> **一句話**：新增獨立的「探索」頁。使用者從已修課程挑一門喜歡的課，系統依課程說明的文字
> 相似度列出系外選修與通識，每個系所／通識領域只出一門。**不改變自動排課的結果。**
> 沒有做使用者研究，所以不能宣稱「提升了 serendipity」。

## 1. 為什麼做這個

任務 3B 卡在真實 `plan_chosen` 樣本不足。四任務中剩下可動工的是任務 4。

文獻：Z. A. Pardos, W. Jiang, *Designing for Serendipity in a University Course Recommendation
System*, LAK '20, pp. 350–359。全文 10 頁已讀完。

調查時的實測（唯讀）：

- 課程資料 2004 門不重複課號全部有課程說明（中位數 162 字），bag-of-words 做得起來。
- course2vec 做不了：論文用 16 萬名學生的修課序列，我們只有 4 位使用者。論文使用者研究中
  serendipity 最高的是 BOW (div)（Table 3），上線的 Explore 分頁也用它（§7）。
- **自動排課的候選池裡沒有任何系外選修**（D1249697 的 365 門候選中 0 門），而可修的系外選修
  有 207 門課、35 個系。探索清單是它們目前唯一的出口。

## 2. 做了什麼

### 後端

- **`server/src/skills/courseExploration.js`**（新，純函式）：斷詞、tf-idf 索引、cosine、
  共同字詞、以及論文式 (4) 的挑選 `rankSerendipitous()`。
- **`server/src/services/explorationService.js`**（新）：`exploreForUser()`。
- **`server/src/routes/exploration.js`**（新）：`GET /api/exploration?favoriteCourseCode=`，
  掛在 `app.js`。唯讀，不寫互動事件。

### 前端

- **`client/src/pages/ExplorePage.jsx`**（新）、路由 `/explore`、四個既有頁面的導覽列各加
  「探索」按鈕。
- **`client/src/services/selectionSource.js`**（新）：`addCourse(course, { source })` 只接受
  `exploration` 這一個覆寫值。
- `ScheduleContext.jsx`、`api.js`、`App.jsx`、`App.css`。

### 契約（審查後補齊的五項）

1. **通識的分散單位**：有領域時每領域一門；沒有領域（115 學年度起 `domain` 為 `null`）時整組
   不做單位分散，取最相似的幾門不同課號，回應標 `general.diversification: 'none'`。
2. **起點與候選分開**：起點用課程資料中**任何學期**的說明，本學期沒開也能當起點；候選只取
   當學期。已修課不能當起點的原因只有一種：`no-description`。
3. **認列狀態照實回傳**：系外選修通過機械條件標 `needs-office-confirmation`，文字是
   「符合系外選修條件，仍須向系辦確認是否認列」；系所不在支援清單標 `unchecked`。
   文件與畫面都不寫「可計入畢業學分」。
4. **推薦以課號為單位，加入課表以班次為單位**：每門推薦帶完整的標準班次物件
   （`filterCategorizedCourses()` 的輸出，不刪欄位），每個班次各有「加入課表」。
5. **事件只標 `source: exploration`**：不新增 `surface`，不寫曝光事件。

## 3. 論文 → 實作對照與偏離

| 項目 | 論文 | 本系統 |
| --- | --- | --- |
| 輸入 | 使用者指定一門已修過、喜歡的課（§6.1） | 同 |
| 表示法 | BOW（tf／binary／tf-idf）、course2vec、串接 | 只有 tf-idf BOW |
| 挑選 | 式 (4)：每個 department 取 cosine 最大者，再依 cosine 排序 | 同一式 |
| 斷詞 | 英文：停用詞、lemmatization、stemming | 中文字元 bigram；英數字串整個當 term |
| 停用詞 | 人工停用詞表、去常見套語 | 含中文虛詞的 bigram 不計；df 比例 > 20% 的 term 不計；去掉「課程：○○。」 |
| department | subject | 系外用系所全名；通識用通識領域 |
| 第二組清單 | 同系最相似 5 門 | 通識 5 門 |
| 候選範圍 | 不含研究所課；不限當學期 | 當學期、資格確定、有上課時間、尚未通過 |
| 評估 | 70 人使用者研究 | 沒有 |

偏離的說明：

- **bigram 是近似**：會切出跨詞邊界的碎片（例如「了解人工智慧」裡的「解人」）。相似度排序
  仍然合理，但顯示給使用者的「共同字詞」偶爾會帶碎片（見第 5 節）。
- **候選範圍是本系統的產品決策，不是論文驗證過的做法。** 論文的推薦不限當學期；§8 只在討論中
  把「在有助於完成學位的範圍內探索」列為 future work，沒有實作也沒有評估。我們的依據是
  roadmap #9 的既有約定：探索不得作用於資格不確定的課程。
- **不能宣稱提升了 serendipity**：那是使用者主觀評分。論文自己的數字也顯示分散後
  successfulness 會下降（BOW (div) 2.904，不分散的 Equivalency 3.619）。

### 與核准計畫的出入

1. **共同字詞的做法比計畫複雜**。計畫只寫「列出權重最高的幾個共同 term」。實測直接列 bigram
   會出現「料庫」「工智」「式設」這類碎片，於是改成：從貢獻最大的共同 bigram 出發，在原文中
   往左右延伸成兩份說明都真的出現過的片語，並濾掉出現在超過 12% 課程裡的通用句型
   （「學生掌握」「課程適合」）。只影響顯示，不影響相似度。
2. **多了一份含虛詞的停用字表**（`的了及與和或並…`）。計畫只寫用 df 比例當停用詞；實測只靠
   df 濾不掉「及企」「的能」這類碎片。
3. **事件來源的判定放在新檔 `selectionSource.js`，不是 `interactionLog.js`**。後者會 import
   瀏覽器端的 API 模組，node 無法直接載入來測試。

## 4. 測試與驗證

- `courseExploration.test.js`：20／20。
- `explorationService.test.js`：21／21。
- `interactionEventSchema.test.js` 新增 EXP1：通過。
- 伺服器全部測試（含啟動 `app.js` 的檔案）：**1395／1395**，45 秒。
- 前端 node 測試：7／7（其中 4 項是新的 `selectionSource.test.js`）。
- `node --check` 掃過 `server/src` 與 `server/scripts`；前端 `npm run lint`、`npm run build` 通過。
- 本任務沒有動 `scheduler.js`。

### 真實資料（唯讀）

候選池（D1249697）：系外選修 207 門、35 個系；通識 79 門、3 個領域。四個帳號的已修課中
能當起點的比例：38／53、41／58、39／55、40／55（約七成；其餘在課程資料中查不到說明）。

同一個帳號換起點，清單跟著變（A/B）：

| 起點 | 跨系第 1 名（cosine） | 通識第 1 名（cosine） |
| --- | --- | --- |
| 人工智慧導論 | 通訊系「機器學習」（0.364） | 人工智慧入門與省思（0.322） |
| 資料庫系統 | 應數系「網際網路應用程式設計」（0.116） | 社會學與生活體驗（0.019） |
| Web程式設計 | 土木系「工程資訊管理導論」（0.056） | 從空間看世界（0.068） |
| 系統安全（D1249196） | 環工系「風險評估」（0.159） | 5G應用與人文社會發展（0.077） |
| 邏輯設計實習（demo id 3 的預設起點） | 通訊系「嵌入式系統設計」（0.169） | 數位歷史專題製作（0.066） |

讀法：

- 排序是合理的，但 cosine 的絕對值偏低，多數在 0.02～0.4。數值不宜解讀成「相似幾成」。
- 通識只有 3 個領域有候選（第四個領域的班級限一年級，三年級學生不可修），所以通識最多 3 門。
- 通識的相似度普遍比系外低很多；資料庫系統對通識的最高分只有 0.019，實質上已接近不相關。

耗時（D1249697）：冷請求約 4.0～4.5 秒（其中課程資料查詢佔 1.4～2.7 秒，其餘是建索引）；
10 分鐘快取內的熱請求約 240 毫秒。

### 瀏覽器

已完成，見第 6 節。

## 5. 已知限制

- 「共同字詞」仍會出現碎片，例如「解人工智慧」「據管理」「式設計」。它們確實是兩份說明共有的
  字面片段，但不是完整的詞。畫面上有註明這是字面比對。
- 約三成已修課不能當起點（資料庫只有一個學期的課程說明）。
- 115 學年度通識不分領域的情形，因 `ACTIVE_TERM` 仍是 114，沒有做端到端測試；以 `domain` 為
  `null` 的通識班次在服務層重現，規則本身另有單元測試。
- 冷請求 4 秒偏慢。

## 6. 瀏覽器驗收（2026-10-03，使用者本人登入 D1249697，1400×900）

| 操作 | 結果 |
| --- | --- |
| 進「探索」頁 | 導覽列有「探索」；預設起點「Web程式設計」，並顯示「系統先以你成績最高的本系課…當起點，可自行更換」 |
| 起點選單 | 53 門已修課，其中 15 門不可選，標示「課程資料中沒有這門課的說明」 |
| 跨系探索 | 5 門、5 個不同系所，每門都標「符合系外選修條件，仍須向系辦確認是否認列」 |
| 通識探索 | 3 門、3 個不同領域，說明文字為「每個通識領域只列與起點最相近的一門」 |
| **A/B：起點換成「人工智慧導論」** | 清單整組改變：跨系第一名由土木系「工程資訊管理導論」變成通訊系「機器學習」；通識第一名由「從空間看世界」變成「人工智慧入門與省思」；系統代選的提示消失 |
| 加入衝堂的班次 | 「機器學習」（週二 6–8）被拒：「『互連網路』與『機器學習』衝堂」；「人工智慧與大數據分析」同樣因衝堂被拒。兩次都**沒有**送出事件 |
| 加入不衝堂的班次 | 「人工智慧視覺加速器設計」加入成功，按鈕變「已在課表」 |
| 事件來源 | 送到 `/api/interactions` 的事件為 `course_selected`、`source: "exploration"`、`sectionId: 1453` |
| 多班次課程 | 「網際網路資訊的甄別與運用」列出兩個班次（週五 6–7、8–9）；選第二個加入成功，事件同為 `exploration` |
| 詳情彈窗 | 顯示該班次的教師、地點、時間與課程說明 |
| 回首頁 | 課表由 9 門 25 學分變為 11 門 30 學分，兩門新加的課都在 |

console 的錯誤只有登入前的四個 401，登入後沒有新的錯誤。

沒驗到的一項：多班次課程在已加入一個班次後，再加另一個班次時是被「課表共 32 學分，已超過絕對
上限 30 學分」擋下的，**不是**被「同一門課已有其他班次」擋下——學分上限先觸發，所以重複班次的
拒絕訊息沒有在畫面上看到。那條規則由 `explorationService.test.js` 的 XS5c 驗證。

驗收寫入的真實資料：D1249697 多了兩筆 `course_selected`（`source: exploration`，班次 1453 與
3004）。課表沒有按「儲存課表」，重新載入後回到原本的 9 門 25 學分。

## 7. 順帶發現、未處理

- 自動排課的候選池不含系外選修，所以「系外」配額實際上永遠補不到。另案處理。
- 通識第四個領域（人文藝術與社會經典教育）的班級被判為「限一年級」，高年級學生的通識候選因此
  只有三個領域。這是否符合實際選課規則沒有查證。

## 8. 修改檔案

- 新增：`server/src/skills/courseExploration.js`、`server/src/services/explorationService.js`、
  `server/src/routes/exploration.js`、`client/src/pages/ExplorePage.jsx`、
  `client/src/services/selectionSource.js`
- 新增測試：`server/test/courseExploration.test.js`、`server/test/explorationService.test.js`、
  `client/src/services/selectionSource.test.js`
- 修改：`server/src/app.js`、`server/test/interactionEventSchema.test.js`、
  `client/src/App.jsx`、`client/src/App.css`、`client/src/services/api.js`、
  `client/src/contexts/ScheduleContext.jsx`、四個頁面的導覽列
  （`DashboardPage`、`SchedulePage`、`SearchPage`、`GraduationPage`）
- 文件：`docs/API_SPEC.md`、`docs/DATA_SCHEMA.md`、`docs/SCHEDULING_LOGIC.md`、
  `docs/TEST_PLAN.md`、`docs/CHANGE_REPORTS/README.md`、roadmap

未修改資料表欄位；新增一支 API；未修改 tool call 格式；未修改排課邏輯。

## 9. 是否 commit 與 push

2026-10-03 依使用者指示 commit 並 push 至 origin backend。roadmap 檔只提交本次的三處修改，其他 session 尚未提交的內容原樣留在工作區。
