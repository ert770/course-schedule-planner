# 11 已知限制與風險

> 本文件記錄調查中發現的問題。**所有「建議方向」皆為分析建議，不代表團隊已決定的開發方向。**
> 本次調查**未修改任何功能程式碼**。
> 最後更新：2026-09-10

## 問題總表

| # | 問題 | 類型 | 觸發條件 | 影響 | 嚴重度 | 證據位置 | 現有保護 | 建議方向（分析建議） | 狀態 |
| ---: | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | **密碼以明碼存放於 `users.json`，登入直接字串比對** | 安全 | 任何登入 | 檔案外洩即等於帳號外洩 | **高** | `routes/auth.js:21`、`server/data/users.json` | 回應會剝除 password；`.env`/JSON 不進正式環境 | 導入雜湊（bcrypt/argon2）並改為雜湊比對 | 未處理 |
| 2 | **`noEveningClasses` 可執行但無法儲存** | 前後端不一致 | 使用者透過 Agent 設定不排晚課 | 設定後重新整理即失效，使用者以為有存 | **中** | `preferenceTags.js:53-72`（15 標籤無此項）、`database.js:820-870`（無寫入路徑）、`scheduler.js:291`（引擎有執行） | 排課當次仍生效 | 補一個 `#不排晚課` 標籤，或在 UI 移除此選項 | 未處理 |
| 3 | ~~`/profile` 舊表單送出已淘汰的欄位~~ | 技術債 | ~~使用者進入 `/profile` 頁~~ | 第二輪調查（2026-09-09）發現 `/profile` 從未被 `App.jsx` 註冊路由，瀏覽器實測導覽過去會落進 catch-all 導回首頁——`ProfileForm.jsx`／`ProfilePage.jsx` 是零路由死碼，不是「過期但可用」。同時發現 `Navbar.jsx`／`HomePage.jsx` 也是零 import 死碼 | — | `components/Profile/ProfileForm.jsx`（已刪除）、`App.jsx` 路由表（無 `/profile`） | 四支檔案已刪除；改在四個實際頁面的使用者選單新增「個人資料設定」導向 `/setup`，已用 demo 帳號實測寫入 `User_Profiles.class_name` 成功 | 已於 2026-09-09 移除死碼並補上編輯入口 | **已處理** |
| 4 | **已存課表仍沒有可用的 MySQL 資料表** | Schema 與程式不一致 | 儲存課表 | 換裝置／多人共用資料庫時看不到自己存的課表；正式部署後檔案可能不持久 | **中** | `memoryService.js:108-120`；migration 007 已寫但未執行 | DDL 有 dry-run 與 shared-DB 確認閘門 | 協調後執行 migration，再接應用層讀寫 | migration 已備妥，尚未執行 |
| 5 | **`watchlist`／`skillTree`／`overallScore`／`overallScoreMax` 只存在 `users.json`** | Schema 與程式不一致 | 收藏課程、看首頁技能樹 | 同上；且與 `User_Profiles` 分離造成資料兩處 | **中** | `routes/auth.js:54-71`、`routes/graduation.js:381-384`；migration 007 | migration 已預留四個欄位但未執行、未搬資料 | 先協調 schema，再設計資料遷移 | migration 已備妥，尚未執行 |
| 6 | ~~`className` 同時存在兩處~~ | Schema 與程式不一致 | ~~讀取 Profile~~ | 直接連線共用 MySQL 核對後，確認 `User_Profiles.class_name` 欄位已存在且現有值與 `users.json` 完全一致，已移除 `users.json` 後備路徑（`readClassNameOverrides()`／`applyClassNameOverride()`／`writeClassNameOverride()`／`pickClassNameTarget()` 等六個函式），`User_Profiles.class_name` 現在是唯一儲存體 | 低 | `database.js`（後備機制已刪除）、`server/data/users.json`（已移除 `className` 欄位） | — | — | 已於 2026-09-09 處理，**已處理** |
| 7 | **`mustTakeCourses`／`avoidInstructors`／`preferencesJson` 尚未持久化** | 技術債 | Profile 重載 | 三者仍從 MySQL 映射為空值；但 `avoidInstructors` 已可由 REST/Agent 單次請求使用並由 scheduler/validator 執行 | 低 | `database.js`、`memoryService.js` 仍給空值；`constraintService.js` 已合併 request | `AVOID_INSTRUCTOR` 有正式 schema、排除邏輯、必修豁免與測試 | migration 007 執行後再接 Profile 讀寫 | 部分處理 |
| 8 | **先修條件無法執行** | 資料品質 | 任何排課 | 可能推薦學生尚未具備先修資格的課 | **中** | `Courses.prerequisites` 3,086/3,086 全 NULL；`constraintSchema.js:341-365` 標 `enforced:false` | validator 明確回報 `unchecked: ['PREREQUISITE']`，不假裝檢查過 | 等外部資料（roadmap `#8`） | 規劃中 |
| 9 | **B～F 類課程資格未確認** | 資料品質 | 課程搜尋／排課候選 | 170 門課保守排除，候選池被縮小到 16 門可競爭課程，方案多樣性受限 | **中** | roadmap `#13C`；瀏覽器實測訊息「已保守排除 170 門資格待確認的 B～F 類課程」 | 保守排除 + 明確告知使用者 | 等系辦正式規則 | 規劃中 |
| 10 | **課程缺 `has_midterm`／`has_group_project`／`language` 等欄位** | 資料品質 | 使用 3 個內容偏好 | 只能用 `description` 關鍵字硬猜；實測「無期中考」「全英授課」命中率 0/16，等於無效 | **中** | roadmap `#4`；`scheduler.js:505-509` 註解記錄實測命中數 | 訊號強度檢查會警告使用者「這項偏好幾乎不起作用」 | 需與共用資料庫的其他組員協調 `ALTER TABLE` | 規劃中 |
| 11 | **涼度證據覆蓋率低** | 個人化效果 | 勾「涼課優先」 | 多數課走 proxy 推估，涼度分數趨近常數，區分力弱 | **中** | `scheduler.js:495-497` 註解：demo 帳號 10 門競爭課只有 1 門有評價 | `easinessSource` 三態標記；proxy 不得宣稱「涼」；覆蓋率 <50% 發警告 | 擴充評價爬取範圍 | 部分處理 |
| 12 | **個人化效果尚未在真實使用者上證明** | 個人化效果 | — | 目前所有效果數字來自 synthetic fixture | **中** | roadmap `#36` 維持 🟡；`docs/CHANGE_REPORTS/2026-09-08-roadmap-36-sensitivity-sweep-fix.md` | 每份報告都明寫「這證明不了什麼」 | 等 `#38` 真實學生使用者測試 | 規劃中 |
| 13 | **Golden set 測試會間歇性失敗** | 測試缺口 | 執行 `npm test` | CI 或本機偶發紅燈，非程式回歸 | **中** | `agentGoldenSet.test.js` 的 `no-invented-constraints` case；本專案歷史上多次發生，重跑即過 | 已知並記錄；重跑確認流程 | 評估標記為 flaky 或移出 `npm test` | 未處理 |
| 14 | **前端與 E2E 測試完全沒有** | 測試缺口 | 前端改動 | 前端回歸只能靠人工瀏覽器驗收 | **中** | `client/src` 下 0 個測試檔 | `commit-push` 流程強制人工瀏覽器 A/B 驗收 | 導入 Vitest + Playwright | 未處理 |
| 15 | **`GEMINI_API_KEY` 與 `@google/genai` 仍在但未使用** | 技術債 | — | 依賴膨脹、誤導讀者 | 低 | `server/package.json` 依賴、`process.env.GEMINI_API_KEY` | — | 移除依賴 | 未使用 |
| 16 | **`server/src/db/schema.sql` 是遺留 SQLite 檔** | 文件與程式不一致 | 新人閱讀 | 誤以為那是真實 schema（欄位名稱完全不同） | 低 | `schema.sql` vs `database.js:20` `MYSQL_COLLECTIONS` | roadmap `#4` 已記錄此事 | 刪除或加註「已廢棄」 | 未處理 |
| 17 | **`User_Profiles.name` 來源不明** | 待確認 | 執行 `seed:demo-personas` | 若欄位不存在，seed script 會失敗 | 低 | `demoPersonasSeed.js:90` 查 `name`，但無 migration 建立，`database.js` 也不讀 | — | 確認共用資料庫是否真有此欄位 | **待確認** |
| 18 | **`program_type`／`enrolled_programs`／`college` 有欄位無程式** | 前後端不一致 | — | 組員已建欄位，本專案零引用 | 低 | `docs/DATA_SCHEMA.md:296-298`；`server/src` 全域 grep 0 命中 | — | roadmap `#13D` 接線時使用 | 規劃中 |
| 19 | **`DATA_SCHEMA.md` 欄位表非窮舉** | 文件與程式不一致 | 查閱文件 | 部分實際欄位（`Interaction_Events.request_id`／`action_id`、`Privacy_Subject_State.created_at`／`updated_at`、`Privacy_Data_Requests.created_at`）未列出 | 低 | 對照 migration 002／003 | 文件標題寫「主要欄位」 | 補齊或明確標示為摘要 | 未處理 |
| 20 | **前端硬寫 `maxCredits: 25`／`minCredits: 12`** | 前後端不一致 | 首頁自動排課 | 使用者設定的 `targetCreditsMax` 在這條路徑上被忽略 | **中** | `DashboardPage.jsx:114-115, 498` | 後端仍會套用已存偏好？**待確認** | 改為讀 Profile 值或不送這兩個欄位 | **待確認** |
| 21 | **`recorded` 回傳型別不一致** | 命名不一致 | 送互動事件 | 已同意時是數字，未同意時是 `false` | 低 | `routes/interactions.js` | 前端兩種都處理 | 統一型別 | 未處理 |
| 22 | **`Courses` 與 `Course_Sections` collation 不一致** | 資料品質 | 每次查課程 | 必須用 `BINARY` 比較，否則拋 `ER_CANT_AGGREGATE_2COLLATIONS` | 低 | `database.js:729-733` | 已用 `BINARY` 繞過並加註解 | 統一 collation（需與組員協調） | 已繞過 |
| 23 | ~~`shouldAttemptRepair()` 觸發條件未逐行確認~~ | 待確認 | ~~repair 流程~~ | 第二輪審查已逐行讀完：`solverMode==='greedy'` 時完全不 repair；主方案不存在／不合法時一定 repair；合法時只在未達 `minCredits` 才 repair。已寫入 `06-personalized-scheduling.md` | 低 | `scheduler.js:2124-2128` | — | — | **已確認**（2026-09-09） |
| 24 | **`selectedBecause` 第 8 個取值未確認** | 待確認 | 推薦理由 | 文件列了 7 個 | 低 | `explanationFaithfulness.js:68-73, 603` | — | 讀 `recommendationReason.js` 完整枚舉 | **待確認** |
| 25 | **Chat 歷史送進模型的筆數上限未確認** | 待確認 | 長對話 | 可能有 context window 風險 | 低 | `agentService.js:574` `handleChat()` | `MAX_STEPS_CEILING=20` 限制 tool loop | 補讀該函式 | **待確認** |
| 26 | **Prompt injection 專門測試未確認** | 安全 | 惡意輸入 | 未知覆蓋程度 | **中** | roadmap `#37` 有瀏覽器實測（假教師／假評價／秘密值皆被攔），但自動化測試覆蓋**待確認** | 忠實度稽核 + tool allowlist | 補自動化 injection 測試 | **待確認** |
| 27 | **無 `Secure` cookie／HTTPS** | 安全 | 正式部署後 | 尚未部署故暫無實際風險 | 低（現況） | roadmap `#39` | 目前只在本機執行 | 部署時一併處理 | 規劃中 |
| 28 | **`SESSION_SECRET` 未設定時用暫時密鑰** | 安全 | 本機開發未設 `.env` | 重啟後所有登入失效；若誤用於正式環境則 session 不可預期 | 低（現況） | 啟動 log 實測警告 | 有明確警告 | 正式環境強制檢查 | 部分處理 |

## 依嚴重度排序的優先關注項

**高**：#1 密碼明碼。

**中**：#2 `noEveningClasses` 無法儲存、#4 已存課表無 DB 表、
#5 `users.json` 專屬欄位、#8 先修資料、#9 B～F 類資格、#10 課程評量欄位、
#11 涼度覆蓋率、#12 個人化效果未證明、#13 golden set flaky、#14 無前端測試、
#20 前端硬寫學分、#26 injection 測試覆蓋。

（#3 舊 Profile 表單、#6 `className` 雙處儲存、#23 `shouldAttemptRepair()` 待確認
三項已於 2026-09-09 處理完畢，不再列入待關注清單。）

## 建議優先人工確認的五個問題（分析建議）

1. **`User_Profiles.name` 到底存不存在？**（#17）——影響 `seed:demo-personas` 能否執行。
2. **`DashboardPage` 硬寫的 `maxCredits: 25` 會不會蓋掉使用者設定的學分上限？**（#20）
   ——這是使用者看得到的行為，值得實測一次。
3. **`noEveningClasses` 是要補標籤還是要從 UI 移除？**（#2）——目前是「設了沒用」的狀態。
4. **已存課表要不要進資料庫？**（#4）——正式部署後 JSON 檔可能不持久。
5. **密碼要不要先改成雜湊？**（#1）——即使是專題，示範系統仍可能被審查此點。

## 本次調查的邊界

- 原始盤點階段只新增文件；2026-09-10 後續工作已新增 `avoidInstructors` 單次排課邏輯，
  並備妥但未執行 migration 007。
- 未逐行讀完的檔案（結論以「待確認」標記）：`scheduler.js` 的
  `prepareCandidates()`／`finalizePlan()`／`runRepair()` 內部細節、
  `agentService.js` 的 `handleChat()` 完整流程、`privacyService.js` 全文。
- 三個原本要平行執行的深度調查子任務因 API 用量限制中斷，
  改由直接讀檔補齊；因此部分細節（如加密演算法、保存天數常數）標為待確認。
