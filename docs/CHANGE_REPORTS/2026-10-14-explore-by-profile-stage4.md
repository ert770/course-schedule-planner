# 協同過濾與 User Embedding：階段 4 探索功能改用 s_vec

- 日期：2026-10-14
- 對應構想：[協同過濾與 User Embedding 的搭建方式](./2026-10-14-cf-user-embedding-design.md) 3.7、第 7 節階段 4
- 前一步：[標籤向量降權套用與同義詞合併候選](./2026-10-14-tag-downweights-and-synonym-candidates.md)
- 性質：**使用者看得到的變更**（探索頁）。不影響自動排課。

---

## 1. 結論

1. **探索頁新增「依你的修課與興趣」模式，並設為預設。** 以標籤空間使用者向量排序系外選修與通識，
   每張卡片附理由：共同主題，以及和你修過、收藏或看過的哪一門課相近。
2. **瀏覽器 A/B（同一帳號 D1249697）差異明顯**：「從一門課出發」靠課程說明的字面片段，
   推出「電鍍技術與實務」（共同字詞只有「網站」）、「銀行外匯業務」（只有「電子商務」）；
   「依你的修課與興趣」推出「資料處理與分析科學」（機器學習、深度學習、Python）、
   「系統品質建模與挑戰」（系統設計），理由指得出是哪門修過的課。
3. **講課與實習課合併**成一張卡片（課號多 `P`），兩種模式都套用。
4. **興趣探索卡片**：主題相關度相同時改依 `s_vec` 排序（原本依課號）。
5. 需要 `personalization_learning` 同意；未同意時不計算，畫面提示改用「從一門課出發」或前往隱私設定。

---

## 2. 做了什麼

### 2.1 後端

| 檔案 | 異動 |
| --- | --- |
| `server/src/services/userTagVectorService.js`（新增） | `loadUserTagVectorContext()`：檢查同意、讀未到期互動事件、建使用者向量；課程索引依課程陣列快取、標籤相近表只建一次。只在記憶體計算，不寫任何資料表 |
| `server/src/services/explorationService.js` | 新增 `exploreByProfile()`：候選條件與原模式相同，依 `s_vec` 排序、每個系所／通識領域一門，回傳 `score` 與 `reasons`；`emptyReason` 為 `no-personalization-consent` 或 `no-profile-signal`。兩種模式都把講課與實習課合併；原模式回應加上 `mode: "favorite"` |
| `server/src/routes/exploration.js` | `GET /api/exploration?mode=profile` |
| `server/src/services/interestExplorationService.js` | 興趣探索卡片在主題相關度相同時依 `s_vec` 排序；未同意或沒有訊號時維持課號順序 |
| `server/src/skills/userTagVector.js` | 推薦理由中同一個課程標籤只列一次（瀏覽器驗收時發現「系統整合」「資訊處理」重複出現） |

### 2.2 前端

| 檔案 | 異動 |
| --- | --- |
| `client/src/pages/ExplorePage.jsx` | 兩種模式切換（預設「依你的修課與興趣」）、理由顯示、空狀態與「改用從一門課出發」「前往隱私設定」按鈕、兩種模式各自的說明文字 |
| `client/src/services/api.js` | `explorationAPI.get(favoriteCourseCode, mode)` |
| `client/src/App.css` | 模式切換與空狀態按鈕樣式 |

### 2.3 文件

- `docs/API_SPEC.md`：`GET /api/exploration?mode=profile` 的回應格式、`emptyReason`、`reasons`；原模式的 `mode` 欄與講課／實習合併。
- `docs/SCHEDULING_LOGIC.md`：探索一節新增兩種模式對照表；順手註明系外選修已於 2026-10-07 納入排課候選池。

### 2.4 測試

| 編號 | 內容 |
| --- | --- |
| XS9 | 依使用者向量排序、每系一門、無關課不列；講課與實習課合併；理由引用修過的課；回應不含內部向量 |
| XS9b | 未同意不計算（`signals` 為 `null`）；只有必修時回報 `no-profile-signal` |
| XS9c | 「從一門課出發」也合併講課與實習課，並標明 `mode` |
| IE-SVEC | 興趣探索卡片：相關度相同時依 `s_vec` 排序，沒有分數時維持課號順序 |
| UV6（擴充） | 推薦理由中同一課程標籤只列一次 |

---

## 3. 驗證

- `server/src` 全部 `node --check` 通過；`npm test` 1,521 項，1,520 通過、1 略過、0 失敗。
- 前端 `npm run lint`、`npm run build` 通過。
- **瀏覽器驗收**（D1249697，使用者自行登入）：
  - 探索頁預設「依你的修課與興趣」：系外 5 門、通識 3 門，每張卡片都有理由。
  - 修正前理由會重複同一標籤（「系統整合（近似你的『系統設計』）、系統整合（近似你的『系統開發』）」），
    修正後重新載入確認已不重複。
  - 切到「從一門課出發」：起點為系統代選的「Web程式設計」，清單變成字面比對的結果（見第 1 節第 2 點）。
  - 興趣探索頁正常載入 8 張卡片：安全程式設計、軟體框架設計、程式語言、校外專業實習(二)……
  - 相關 API 請求都是 200。console 中的 502／404／401 都是驗收前的問題：一開始代理設定錯誤，以及登入前的請求。
- **未在瀏覽器驗到的路徑**：未同意個人化學習的空狀態。這需要用另一個帳號登入，改由 XS9b 測試涵蓋。

### 3.1 驗收環境的兩個問題（未修改，記錄給之後的驗收）

1. `.claude/launch.json` 把後端設在 27151 埠，但 `client/vite.config.js` 的代理預設是 3001，
   而 `VITE_API_PROXY_TARGET` 沒有設定，所以照 `launch.json` 啟動時，前端登入會出現「Unknown error」。
   這次暫時加一組指向 27151 的前端設定，驗收後已還原 `launch.json`。
2. 前端以瀏覽器 `localStorage` 判斷「設定已完成」。新的瀏覽器面板沒有這個標記，會被導回 `/onboarding`，
   而該頁按鈕會重新寫入同意紀錄。這次只在瀏覽器面板的 `localStorage` 補上標記，沒有寫資料庫。

### 3.2 效能

`/api/interest-exploration/cards` 一次約 2.6～4.1 秒。其中讀全部課程約 3 秒（原本就有）；
新增的向量計算約 1.2 秒（建課程索引 0.2 秒，讀同意與互動事件約 1 秒）。探索頁相同。

---

## 4. 已知限制

- 推薦理由仍會出現同義詞造成的「近似」，例如「人工智慧（近似你的『人工智能』）」。同義詞合併後會消失。
- 「全像原理與應用」靠「資訊處理≈資訊科技」與實習課連起來，屬於泛用標籤的弱連結；你決定保留「資訊科技」，所以維持。
- 「從一門課出發」的起點清單仍包含必修課（原行為，未改）。

---

## 5. 本次異動

見第 2 節。另新增本報告並更新 `docs/CHANGE_REPORTS/README.md`。未修改 roadmap 的任務狀態（#9 探索機制
仍卡 #36；本次是 User Embedding 構想的階段 4）。未 commit。
