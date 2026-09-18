# 2026-09-18 興趣導向排課設定

## 修改日期

2026-09-18

## 修改檔案

### 前端

- `client/src/pages/SetupPage.jsx`
- `client/src/services/api.js`
- `client/src/App.css`

### 後端

- `server/src/data/interestPreferences.js`（新增）
- `server/src/data/profileSchema.js`
- `server/src/db/database.js`
- `server/src/routes/courses.js`
- `server/src/routes/profile.js`
- `server/src/services/memoryService.js`
- `server/src/services/promptService.js`

### 測試

- `server/test/interestPreferences.test.js`（新增）
- `server/test/databaseProfileContract.test.js`
- `server/test/profileSchema.test.js`
- `server/test/prompt.test.js`

### 文件

- `docs/API_SPEC.md`
- `docs/DATA_SCHEMA.md`
- `docs/PROMPT_DESIGN.md`
- `docs/SCHEDULING_LOGIC.md`
- `docs/CHANGE_REPORTS/2026-08-01-personalization-roadmap.md`
- `docs/CHANGE_REPORTS/2026-09-18-interest-guided-scheduling.md`（本檔）

## 主要改動

1. 設定頁新增「感興趣的課程方向」：資訊工程學系可單選三條正式修課路徑，並可複選
   目前候選課程 `rag_tag` 統計出的主題或輸入自訂關鍵字；也能選擇沒有特定方向。
2. 新增 `GET /api/courses/interest-options`。完整班級存在時，以排課候選池為基礎，
   再收斂到本系選修或已有正式 track 的課程產生主題，避免通識的「語言學習／文化研究」
   淹沒資訊安全、軟體開發等專業方向。這項收斂不改變真正的排課候選池。
3. `preferredTrack`、`interests`、`preferredKeywords` 保存到既有
   `User_Profiles.preferences_json.values`。沒有新增 MySQL 欄位或 migration；合併時保留
   JSON 內其他個人化資料。
4. Profile 正規化後把三個興趣欄位展開到頂層，因此既有 `constraintService.js` 與
   `scheduler.js` 可直接使用。必修、重補修及硬限制完全不變，興趣只影響軟性分數、
   主推方案與推薦理由。
5. Agent 在使用者要求個人化推薦、但 Profile 與本輪都沒有興趣時，先用一個簡短問題詢問
   方向；一般排課或使用者表示沒有方向時不阻擋排課。長期保存仍走既有兩段式確認。
6. 瀏覽器驗收時發現 `emptyProfile()` 的空興趣陣列會遮蔽 `preferences_json` 已存值，已移除
   該重複預設來源。修正後路徑與複選主題都能保存並於重載後選中。

## 影響範圍

- 使用者可在 Setup 畫面直接表達內容方向，不必只靠自然語言或後續互動學習。
- Profile API 增加三個興趣欄位；既有呼叫端未提供時行為不變。
- 課程方向選項來自正式課程路徑及 MySQL `Course_Sections.rag_tag`，不新增模擬課程資料。
- Roadmap #10 維持「部分完成」：這次補齊真實興趣輸入口，但多方案數量仍需另以現版資料
  重新量測，未把本次功能誤記為整項完成。進度總覽整張表的狀態與相依欄已核對，沒有其他
  任務因本次改動而需要改狀態或相依。

## 測試與驗證

- 新增／相關契約測試：83 pass / 0 fail。
- 後端完整測試（排除既有不會結束程序的 `interactionEvents.test.js`）：
  1070 pass / 0 fail，包含會實際呼叫模型的 golden set 13/13 通過。
- `interactionEvents.test.js` 單獨執行：畫面列出的 39 項斷言全部通過，但測試程序在結束後
  仍不退出，30 秒後人工終止；這是本專案既有 open-handle 問題，本次沒有修改該模組。
- 根目錄 `npm test` 曾完整跑到同一個既有 hang；第一次模型 golden set 的
  `no-invented-constraints` 發生一次非決定性 schema 輸出失敗，隨後由 server 工作目錄單獨
  重跑以及排除 hang 檔的完整套件重跑皆為 13/13 通過。
- 前端 `npm run lint`：通過。
- 前端 `npm run build`：通過。
- `server/src/**/*.js` 語法檢查：通過。
- 實際瀏覽器 A/B（Chrome，D1249697）：
  - A：清除方向後，Profile 回傳 `preferredTrack: null`、`interests: []`。
  - B：選擇「網路與安全類」及動態主題「資訊安全」後，Profile 回傳相同選擇；重新載入
    Setup 後兩個按鈕維持選中。
  - 畫面取得 3 條正式路徑、16 個專業主題；本次 scope 為資訊三乙，完整排課候選 362 門，
    用來產生主題的本系／正式 track 課程 36 門。
  - 瀏覽器 console 無新增錯誤。
  - 驗收結束後已把測試帳號的興趣與班別還原為原值。

## Commit / Push

- 本報告與本次興趣導向排課功能一併 commit。
- 推送目標為 `origin backend`。
