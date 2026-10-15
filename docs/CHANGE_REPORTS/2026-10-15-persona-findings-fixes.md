# Persona 實測剩餘 6 項發現的修正

- 日期：2026-10-15
- 來源：[s_vec／s_cf 切 active 與 10 位 Persona 實測](./2026-10-15-active-switch-and-persona-ux-test.md) 第 5 節第 4～9 項
  （第 1～3 項見 [AI 對話推薦品質修正](./2026-10-15-ai-chat-recommendation-quality.md)）
- 性質：**使用者看得到的變更**（探索頁、全校查詢、課程詳情、儲存課表、隱私中心、興趣探索卡）。

> A/B 使用測試 Persona（模擬帳號）的真實資料；只驗證功能，不代表真實使用者的推薦效果。

---

## 1. 修正與 A/B

| # | 發現 | 原因 | 修正 | 瀏覽器 A/B |
| --- | --- | --- | --- | --- |
| 4 | 探索頁推薦剛按「沒興趣」的課 | 探索卡的沒興趣只把**選到的標籤**放進負向向量，課的其他標籤仍讓它排很前面 | 使用者向量記下明確拒絕過的課（沒興趣、因內容退選、不喜歡的修過課），「依你的修課與興趣」直接排除 | 9005：「家計經濟學」原本排第一 → 不再出現 |
| 5 | 全校查詢「科目名稱」也搜尋描述 | 前端把科目名稱與課程描述都送成 `keyword` | 後端 `/api/courses/catalog` 新增 `name`（只比對課名、課號）；前端科目名稱送 `name`、課程描述送 `keyword` | 「Python」：110 筆（含「機器學習」「金融資訊系統」）→ 7 筆，課名都含 Python |
| 6 | 推薦理由寫「它符合你的偏好」又寫「沒有命中任何偏好」 | 選修課預設的選入原因 `PREFERENCE_MATCH` 一律顯示「符合你的偏好」 | 沒命中偏好時改依分數明細：有興趣加分→「它和你的興趣主題相近」並列出「興趣加分：主題興趣 +N、相近主題 +N、同學選課 +N」；都沒有→「同時段的候選中，它的綜合分數最高」；不到 1 分的加分不列 | 9001「玩遊戲，探索生活與經濟」：矛盾的兩句 → 「綜合分數最高／沒有命中排課偏好」；9005 的資安課顯示「主題興趣 +152、相近主題 +200」 |
| 7 | 儲存課表沒有任何提示 | 提示框 `ScheduleNotice` 在 PR #27 刻意隱藏（橘色警告框） | 不推翻該設計，只為儲存在按鈕旁加一則 3 秒後消失的提示 | 9005：按儲存後顯示「課表已儲存。」，3 秒後消失 |
| 8 | 已設偏好標籤、興趣，個人化來源仍顯示「尚未表達偏好」 | 判斷用的 `explicitProfileEmpty` 只看學習權重的基準軸（目前只有「集中排課」會落到軸上） | 後端新增 `hasExplicitPreferences`（偏好標籤、興趣、關鍵字、避開時段、修課路徑），徽章兩者都空才顯示「尚未表達偏好」 | 9010：「尚未表達偏好」→「使用你的顯式設定：互動資料還不夠（6/10 筆）」 |
| 9a | 「語意相似」結果不穩 | 課程描述的樣板句讓文字向量相似度擠在 0.52～0.56；「每系一門」又讓低相關的系所也佔名額 | 改成「文字向量 × 0.7 ＋ 主題標籤相似度 × 0.3」，且**至少要有一個相同的主題標籤**（相近標籤表太寬：「網站設計↔網路設計」） | 「Web程式設計」出發：水處理工程與設計、鋼筋混凝土房屋設計 → 多媒體通訊、數位敘事等有共同標籤的課；「UNIX應用與實務」出發的 5 門都標出共同標籤 Python |
| 9b | 推薦跳級的系列課 | 資料庫沒有先修資料 | 依課名推測系列（與排課器同一規則）：第 n 級（n > 1）只在已通過第 n－1 級時才推薦；只用於興趣探索卡與探索頁，不擋自己搜尋或加選 | 9010 探索卡：西班牙文(四)、法文(二)、韓文(二) → 法文(一)、韓文(一)、印尼語(一) |

---

## 2. 異動檔案

- 後端：`skills/userTagVector.js`（`rejectedCourseCodes`）、`services/explorationService.js`（排除拒絕過的課、語意相似混合分數、系列）、
  `skills/courseExploration.js`（`similarityOf` 多傳候選課）、`skills/courseQuery.js`（`name` 篩選）、`routes/courses.js`、
  `services/preferenceLearningService.js`（`hasExplicitPreferences`）、`services/interestExplorationService.js`（系列）、
  `data/courseSeries.js`（新增）。
- 前端：`components/CourseCard/CourseDetailModal.jsx`、`pages/DashboardPage.jsx`、`pages/SearchPage.jsx`、
  `components/Profile/PreferenceSourceBadge.jsx`、`App.css`。
- 文件：`docs/API_SPEC.md`（`name` 參數、`hasExplicitPreferences`）、本報告、索引。

## 3. 驗證

- 新增 `test/personaFindingsFixes.test.js`（SER-1、SER-2、REJ-1、NAME-1、PERS-1）。
- `server/src` 全部 `node --check` 通過；`npm test` 1,597 項，1,596 通過、1 略過、0 失敗。
- 前端 `npm run lint`、`npm run build` 通過。
- 瀏覽器：見第 1 節 A/B 欄，使用 9001、9005、9010；最後 console 沒有新的錯誤。

## 4. 限制

- 系列判斷依課名推測，課名格式不是「名稱(一)」的系列課抓不到；也不處理跨名稱的先修（例如資料結構→演算法）。
- 語意相似要求共同標籤後，部分起點課的結果變少，甚至沒有結果——寧可少也不列無關的課。
- 拒絕過的課只從探索頁排除；自動排課仍依分數（負向訊號已會降低分數）。

## 5. 是否 commit 與 push

已 commit 並推到 `origin backend`（併入 PR #30）。
