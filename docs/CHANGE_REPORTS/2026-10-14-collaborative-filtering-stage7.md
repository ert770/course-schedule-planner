# 協同過濾與 User Embedding：階段 7 協同過濾同意、課程共現表與 s_cf shadow

- 日期：2026-10-14
- 對應構想：[協同過濾與 User Embedding 的搭建方式](./2026-10-14-cf-user-embedding-design.md) 4.1～4.6、5.1～5.3、第 6 節、第 7 節階段 7
- 性質：**使用者看得到的變更**：隱私政策升版、隱私中心新增一項可選同意；**共用 MySQL 新增兩張表**。
  協同過濾分數本身只有 shadow，不改變任何排序。

---

## 1. 結論

1. **新同意 `collaborative_learning`**（「協助推薦課程給其他同學」，可選、預設不同意，文字採構想 4.5 的版本）。
   - 以 `personalization_learning` 為前提：未勾個人化學習時伺服器一律記為不同意；隱私中心該項停用。
   - 「貢獻」才需要這項同意；「接收」協同過濾分數只需要 `personalization_learning`。
2. **隱私政策升版 `2026-10-09.v3` → `2026-10-14.v4`**（使用者決定）。現有程式以版本號判定同意是否有效，
   因此**所有人（含 D1249697 與 Persona）下次登入都會被導到隱私中心重新確認**；確認前個人化學習停用。
3. **課程共現表**：共用 MySQL 新增 `Course_Neighbor_Builds`、`Course_Neighbors`（migration 009，使用者決定建表，已執行）。
   伺服器每 24 小時整張重建；有人撤回 `collaborative_learning` 時約 5 秒後提前重建。
4. **s_cf 以 shadow 接入排課**：`CF_INTEREST_MODE` 預設 `shadow`。與 `s_vec` 用同一套 shadow 但分開記錄，
   以 0 計入、不改變排序；日誌另記啟用門檻是否達到。`active` 設定會拒絕啟動。
5. **目前狀態**：同意 `collaborative_learning` 的真人 **0 位**（新同意剛上線、且政策升版後所有舊同意失效），
   共現表為空，s_cf shadow 記為 `empty_table`／`not_built`。**程式已就緒，結論要等真實樣本**；
   構想 4.6 的門檻（真人 ≥ 15、每人有效互動 ≥ 3、共現 ≥ 3）達到後才進入階段 8。

---

## 2. 計算方式（`server/src/skills/itemItemCf.js`）

| 項目 | 做法 |
| --- | --- |
| 使用者課程訊號 | 已通過的選修、通識、系外選修 +0.5；互動事件沿用標籤興趣的事件權重（收藏、高分評價、自願加選、內容退選、歷史修課回饋…），同一門課相加後截到 −1～1。事件快照已排除必修；探索問卷是對標籤的回饋，不列入；回答「不喜歡」的修過課不再給 +0.5 |
| 「選了」 | 訊號 ≥ 0.5（單純瀏覽不算） |
| 相似度 | `co / sqrt(nA × nB) × co / (co + 5)`；co < 3 的配對不保留；每門課保留前 20 門 |
| s_cf | `Σ sim(c, j) × w(j) / max(1, Σ sim(c, j))`；分母至少 1，相近課很弱時分數跟著小，不會被放大成 ±1；沒有重疊為 `null` |
| 啟用門檻 | 只計真人（最後一次同意來源是隱私中心）；Persona／demo 另計，不得計入 |

**已知限制**：互動事件需要標籤快照，沒有 rag_tag 的課的互動不會進入互動表（歷史修課不受影響）。

---

## 3. 做了什麼

### 3.1 後端

| 檔案 | 異動 |
| --- | --- |
| `server/src/data/privacyPolicy.js` | 新用途、`requires`、共現最少人數 3；政策升版 v4 |
| `server/src/services/privacyService.js` | 未同意個人化學習時協同過濾記為不同意；`listCollaborativeContributors()`（只回傳 subject 與是否模擬） |
| `server/src/routes/privacy.js` | 撤回 `collaborative_learning` 時提前重建共現表 |
| `server/src/skills/itemItemCf.js`（新增） | 第 2 節的計算與門檻判定 |
| `server/src/services/courseNeighborService.js`（新增） | 收集貢獻者訊號、建表、整張換新、讀取快取 10 分鐘、每日排程與撤回重建 |
| `server/migrations/009_course-neighbors.*.sql`、`server/scripts/courseNeighborsMigration.js`（新增） | 建表；預設 dry-run，需 `--apply --confirm-shared-mysql` |
| `server/scripts/buildCourseNeighbors.js`（新增） | 手動重建；預設 dry-run；`--include-simulated` 只能 dry-run |
| `server/src/services/scheduleService.js` | `loadCfInterestContext()`，與標籤興趣、s_vec 三者並行讀取；日誌彙總 |
| `server/src/skills/scheduler.js` | shadow 改為可同時記錄多個模型（s_vec、s_cf 各自一份統計） |
| `server/src/skills/interestAlphas.js`、`vectorInterestShadow.js` | `CF_INTEREST_MODE`；shadow context 支援 CF 來源與門檻狀態 |
| `server/src/app.js` | 啟動時開始每日重建（`CF_INTEREST_MODE=off` 時不啟動；表不存在時自動略過） |
| `server/package.json` | `migrate:course-neighbors`、`cf:build-neighbors` |

### 3.2 前端

`client/src/pages/PrivacyPage.jsx`：新增「協助推薦課程給其他同學（可選）」；未勾個人化學習時停用並取消勾選；
取消個人化學習的確認訊息加註協同過濾一併取消。`client/src/App.css`：停用樣式。

### 3.3 文件

`docs/API_SPEC.md`（新用途、政策升版、撤回重建）、`docs/DATA_SCHEMA.md`（新用途、兩張新表）、
`docs/SCHEDULING_LOGIC.md`（s_cf shadow）、`.env.example`（`CF_INTEREST_MODE`）、構想文件狀態、roadmap #6。

---

## 4. 測試與驗證

| 編號 | 內容 |
| --- | --- |
| CC-1～CC-3 | 政策內容與版本；未同意個人化學習時協同過濾記為不同意；貢獻者需兩項都同意、撤回個人化學習一併退出、Persona 來源標為模擬 |
| CF-1～CF-5 | 使用者訊號（非必修、未通過、喜歡／不喜歡）；共現門檻與收縮公式；s_cf 加權與不放大；門檻只計真人且每人 3 筆；模式只接受 off／shadow |
| CN-1、CN-2 | 正式表只用真人、模擬只能 dry-run、寫入時禁止模擬；重建後讀得到最新表、輸出不含 subject 或學號 |
| CS-1～CS-3 | s_cf context 與各種不可用原因；s_vec 與 s_cf 分開記錄；shadow 不改變課表 |

- 測試檔一開始清除 `DB_*` 環境變數，共現表測試一律走記憶體，不會寫入共用資料庫。
- `server/src` 全部 `node --check` 通過；前端 `npm run lint`、`npm run build` 通過。
- `npm test` 1,576 項：連續 4 次 1,575 通過、1 略過、0 失敗；**另有 1 次 2 項失敗**（未保存輸出，無法指出是哪兩項；
  與階段 5 審查時遇到的不穩定相同，連跑皆無法重現）。
- **Migration**：dry-run 確認兩張表都不存在後執行，再次 dry-run 確認已存在。
- **共現表 dry-run（真實資料，不寫入）**：貢獻者 0、配對 0、門檻未達到——符合目前狀態。
- **瀏覽器（D1249697）**：
  - 進入首頁被導到 `/privacy`，顯示「政策版本：2026-10-14.v4」，原有選擇預先勾好，新項目未勾。
  - A/B（只在畫面上切換，**沒有按儲存**）：個人化學習勾選時新項目可勾；取消個人化學習時新項目停用且取消勾選；
    最後恢復原狀。
  - 頁面上的 API 皆 200；console 唯一的 502 是稍早後端重啟時的舊紀錄。

---

## 5. 需要你決定或操作

1. **重新確認隱私設定**：政策升版後你的帳號需要在隱私中心按一次儲存（我沒有替你做）。
   要不要勾「協助推薦課程給其他同學」由你決定。
2. **Persona（9001～9010）與 demo 帳號的同意**：升版後它們的同意都失效。重跑 `personaConsentSeed.js`／
   `demoPersonasSeed.js`（`--apply --confirm-shared-mysql`）可以用 v4 重新寫入，但會寫共用資料庫，需要你同意。
   這兩個 seed 目前都不會替 Persona 勾 `collaborative_learning`；Persona 就算勾了也不會進正式共現表。
3. 開發伺服器下次重啟時，每日排程會寫入第一筆（空的）共現表建立紀錄。

## 6. 是否 commit 與 push

已 commit 並推到 `origin backend`（PR #31）。
