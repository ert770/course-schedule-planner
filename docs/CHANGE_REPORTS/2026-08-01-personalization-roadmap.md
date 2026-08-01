# 2026-08-01 個人化推薦演算法改造路線圖

## 文件性質

本文件為**持續更新的任務追蹤報告**。每完成一項任務即回來更新該任務區塊的狀態、修改檔案清單、實際改動與驗證結果。

## 建立日期

2026-08-01

## 最後更新

2026-08-01（完成 #1、#11 並套用對抗式審查修正；新增 #10）

## 背景

對現行排課演算法（`server/src/skills/scheduler.js`）做個人化能力檢討後，確認目前系統屬於「參數化的限制求解器」，而非個人化推薦系統。

判定依據：兩位修課歷史、互動行為完全不同的學生，只要表單填寫相同，`buildPlan()` 會回傳完全相同的課表。個人化程度等於使用者自己勾了幾個 checkbox。

> **2026-08-01 修正**：下表是以 `server/data/courses.json` 的 55 筆**示範資料**（description 平均 21 字）實測。接上 MySQL 後已用 3560 筆真實課程（description 平均 161 字、100% 有內容）重測，結論有實質變化——`discussion` 不再全滅、`practicalExam` 與 `finalReport` 已可運作，但 `weightDaily`、`noMidterm`、`learnMore` 與涼課關鍵字仍然失效。完整對照見 [排課演算法與資料庫對齊](./2026-08-01-align-scheduler-with-database.md) 的「關鍵字命中率重測」章節。下表保留作為示範資料下的紀錄。
>
> `#3`（硬過濾改軟懲罰）與 `#4`（結構化評分欄位）仍然成立且必要。

實測 `server/data/courses.json`（55 門課，description 平均 21 字）後發現偏好層在示範資料上大量失效：

| 偏好開關 | 命中課程數 / 55 | 開啟後實際後果 |
| --- | ---: | --- |
| `noMidterm` | 0 | 完全無效，永不排除任何課，卻回報已滿足 |
| `noGroupReport` | 0 | 完全無效，同上 |
| `discussion` | 0 | 候選集歸零，排課直接失敗 |
| `weightDaily` | 0 | 候選集歸零，排課直接失敗 |
| `finalReport` | 1 | 剩 1 門，湊不到最低學分 |
| `englishTaught` | 1 | 剩 1 門，且 `language` 欄位 55 筆全為 undefined |
| `practicalExam` | 3 | 剩 3 門共 8 學分 |
| `learnMore` | 5 | 剩 5 門 |
| 涼課關鍵字（涼/容易/輕鬆/高分/甜） | 0 | 「涼課高分優先」方案加分恆為 0 |

## 進度總覽

| # | 任務 | 狀態 | 相依 |
| ---: | --- | --- | --- |
| 1 | 修掉方案排序的自相矛盾：用偏好符合度決定 `plans[0]` | ✅ 已完成 | 無 |
| 2 | 埋互動 log：記錄推薦清單、最終選擇、加選後退選 | ⬜ 未開始 | 無 |
| 3 | 偏好從硬過濾改成軟懲罰 | ⬜ 未開始 | 無 |
| 4 | 把評分方式結構化：新增課程欄位並從 reviews 聚合難度甜度 | ⬜ 未開始 | 無 |
| 5 | 把 reviews 分數接進 `scoreCourse`，加權方向依使用者而異 | ⬜ 未開始 | #4 |
| 6 | 協同過濾：用選課紀錄矩陣做 item-item / user-user | ⬜ 未開始 | 無 |
| 7 | 以個人化權重向量取代 5 個固定 variant | ⬜ 未開始 | #2, #5 |
| 8 | 先修關係與多學期路徑規劃 | ⬜ 未開始 | 無 |
| 9 | 探索機制：小比例隨機與多樣性重排 | ⬜ 未開始 | #2 |
| 10 | 修復多方案塌縮：5 個 variant 實際只產出 2 種課表 | ⬜ 未開始 | #4 |
| 11 | 修復排課失敗時關注課程從回應中消失（TEST_PLAN S2） | ✅ 已完成 | 無 |

---

## #1 修掉方案排序的自相矛盾

**狀態**：✅ 已完成（2026-08-01）

### 問題

`server/src/skills/scheduler.js` 的方案比較器只看三層：`success` → 是否達最低學分 → 總學分高者勝。三層都與使用者偏好無關。

系統花整套 `getEasyCourseScore`、`getInterestScore`、compact 加權產生 5 份反映不同偏好的課表，卻用總學分裁決主推哪一份。而 `max_credits` 是唯一跳過提前中止條件、一路塞滿到上限的 variant，設計上必定學分最高，因此主推方案幾乎恆為「學分最大化」，其他四種偏好方案只能躺在 `plans[1..4]`。

整條個人化管線的產出，在管線末端被一個與偏好正交的排序規則覆蓋掉。

### 修改檔案清單

- `server/src/skills/scheduler.js`
- `server/src/routes/schedule.js`
- `server/src/services/agentService.js`
- `docs/API_SPEC.md`

### 主要改動內容

- 新增 `buildPreferenceProfile(constraints)`，由使用者實際表達的偏好推出權重（`interest` / `compact` / `easy`）。
- 新增 `evaluatePreference(plan, constraints, profile)`，回傳 0~1 的 `preferenceScore` 與三項 `preferenceBreakdown`。
- **關鍵設計**：所有方案一律用「同一組使用者權重」評分，方案不得用自己的 variant 偏誤自評，否則彼此無從比較。
- 三項正規化指標：
  - `interest`：平均每門課的興趣關鍵字命中率，除以每門課可能的最大命中分。
  - `compact`：`(maxDays - usedDays) / (maxDays - 1)`，使用天數越少越高。
  - `easy`：平均涼課分數除以最大可能涼課分數。
- 比較器改為四層：`success` → 是否達最低學分 → `preferenceScore` → `totalCredits`（tie-break）。
- 抽出 `collectInterestKeywords()`，並將 magic number 改為具名常數（`INTEREST_KEYWORD_SCORE`、`MAX_EASY_COURSE_SCORE`、`WEEK_DAYS`、`PREFERENCE_SCORE_EPSILON`）。
- 回傳結果新增 `preferenceProfile`、`hasExpressedPreference`，各方案新增 `preferenceScore`、`preferenceBreakdown`，訊息文字附上主推理由。
- 使用者未表達任何偏好時，`preferenceScore` 全為 0，自動退回總學分排序（維持既有行為），並發出 warning 說明「主推方案改以總學分決定，個人化程度有限」。
- 補齊參數傳遞：`preferredKeywords`、`interests` 原本**完全沒有**被傳進排課引擎，導致 `interest` variant 的 `getInterestScore` 只看得到 `preferredTrack`，該方案形同半死。本次於 REST 與 AI Agent 兩條路徑一併補上，並新增 `preferEasyCourses`。

### 影響範圍

- `POST /api/schedule/generate`
- `POST /api/chat` 的 `run_csp_scheduler` tool call
- 回應格式為**向後相容的欄位新增**，既有欄位語意不變；但 `plans[0]` 與頂層 `schedule` 的挑選結果會改變，這正是本次修正的目的。

### 測試與驗證結果

以 `server/data/courses.json`（55 門課）實測。

**情境一：大一大二（必修未修畢）**

選修填充空間僅剩 1 學分，variant 差異幾乎無法展現。詳細量測與根因見 #10。

**情境二：大三（12 門必修已修畢，選修填充階段實際執行）**

| 測試 | 結果 |
| --- | --- |
| A. 無偏好 | `preferenceScore` 全 0，退回總學分排序，warning 正確發出 |
| B. 興趣優先（關鍵字 網路/資料） | **`interest` 方案 21 學分（pref 0.214）擊敗 `compact` 方案 22 學分（pref 0.063）** |
| C. 集中排課 | 使用 3 天的方案（pref 0.500）勝過使用 4 天的方案（pref 0.250） |
| D. 涼課優先 | 所有方案 `easy` 皆為 0，`preferenceScore` 全 0，退回學分排序 |

測試 B 即為本任務驗收條件：**偏好符合的方案即使學分較少，仍成為 `plans[0]`**。舊比較器下必定是相反結果。

測試 D 的 0 分是**正確且誠實的行為**，反映背景章節記錄的「涼課關鍵字 0 命中」資料問題。系統會顯示「偏好符合度 0%」，把資料缺口顯性化而非靜默吞掉。該資料問題由 #4 修復。

**其他驗證**

- `node --check` 對 `server/src/**/*.js` 全數通過。
- `npm run install:all`：通過（client 165 packages、server 142 packages）。
- `cd client && npm run build`：通過，1744 modules transformed，產出 `dist/index.html`、CSS 28.02 kB、JS 277.74 kB。
- `cd client && npm run lint`：通過，無錯誤與警告。
- 本次未修改任何前端檔案，前端無程式碼變更；`node_modules/` 已由 `.gitignore` 排除，未進入 git 追蹤。

### 已知限制（留給後續任務）

- `easy` 維度目前恆為 0，需等 #4 補上結構化評分欄位後才有作用。
- 偏好權重仍是 0/1 二元，無法表達「0.7 涼 + 0.3 興趣」，由 #7 處理。
- 權重來源仍為顯式表單，非從行為學習，由 #2 與 #7 處理。
- 5 個 variant 去重後實際只剩 2 種課表，本次驗證過程中量測發現，已另立 #10 追蹤。

### 對抗式審查修正（2026-08-01 追加）

`/codex:adversarial-review` 對 #1 的工作區變更提出兩項 medium 發現，均成立且均為本次引入或未同步，已修正。

**發現一：空陣列蓋掉已儲存偏好**

`constraints.preferredKeywords || prefs.preferredKeywords || []` 中，空陣列在 JavaScript 是 truthy，因此 client 只要送出 `[]` 就會短路，永遠取不到已儲存偏好。

追查後確認影響範圍比審查指出的更大：`client/src/pages/DashboardPage.jsx:60-82` **每次都送出本地建的 `blockedPeriods`**，`mondayFree` 為 false 時即為 `[]`。這使得使用者存在 `User_Profiles.avoid_time` 的封鎖時段被靜默丟棄——這是硬約束，不只是軟偏好，且為線上既有缺陷。

**發現二：AI Agent tool 契約未同步**

`agentService.js` 已接受 `preferredKeywords`、`interests`、`preferEasyCourses`，但 `promptService.js` 呈現給 LLM 的工具說明未列出，模型不知道這些參數存在，`/api/chat` 路徑的個人化實際未生效。違反 `AGENTS.md:115` 與 `docs/PROMPT_DESIGN.md:93` 的維護規則。

**根因與處置**

兩項發現的共同根因是 `routes/schedule.js` 與 `agentService.js` 各有一份近乎重複的 30 行限制條件合併區塊，兩者已經漂移。新增 `server/src/services/constraintService.js`，抽出共用的 `buildScheduleConstraints()`，兩條路徑改為呼叫同一份邏輯。

合併語意明確化：

- 陣列型參數送 `[]` 視同未指定，退回已儲存偏好；要覆蓋必須送非空陣列。
- 布林型 `false` 是有效值會覆蓋；只有 `null` / `undefined` 才退回。
- `selectedCourseIds`、`watchingCourseIds`、`courseStates` 屬本次操作狀態，不從偏好回填。

**連帶修正**：`mondayFree` 原本只在 REST 路徑展開，Agent 路徑完全忽略——但 `docs/PROMPT_DESIGN.md:82` 的 few-shot 範例正是教模型送 `mondayFree`。抽出共用邏輯後兩條路徑一致。

**追加修改檔案**

- `server/src/services/constraintService.js`（新增）
- `server/src/services/promptService.js`
- `server/src/routes/schedule.js`
- `server/src/services/agentService.js`
- `docs/PROMPT_DESIGN.md`
- `docs/API_SPEC.md`
- `docs/TEST_PLAN.md`

**追加驗證**

- 限制合併與 prompt 契約測試：17 項全數通過。
- `docs/TEST_PLAN.md:81` 規定「修改排課邏輯至少執行 S1-S10」，此項在 #1 原始提交時**遺漏未執行**，本次補做：12 項通過、1 項失敗。
- 失敗項 S2 為既有缺陷，非 #1 或本次修正引入，已立案為 #11。
- #1 的驗收情境 B（興趣方案以較少學分勝出）重跑通過，無回歸。
- `node --check` 對 `server/src/**/*.js` 全數通過。
- `npm run build`、`npm run lint`：通過。

### 是否 commit 與 push

- 未 commit。
- 未 push。

---

## #2 埋互動 log

**狀態**：⬜ 未開始

記錄推薦清單、使用者最終選擇、加選後退選。不需演算法工作，但為 #5 #6 #7 #9 的資料前提。

---

## #3 偏好從硬過濾改成軟懲罰

**狀態**：⬜ 未開始

解決反向判定型（候選集歸零）與正向判定型（靜默假承諾）兩種失效模式，並提供 graceful degradation。

---

## #4 把評分方式結構化

**狀態**：⬜ 未開始

新增 `has_midterm` / `has_group_project` / `grading_scheme` 等欄位進 courses 表；從 reviews 聚合難度甜度；修正 `schema.sql` 的 category CHECK 與 `CATEGORY_PRIORITY` 不一致；補上 `language` 欄位。

---

## #5 把 reviews 分數接進 scoreCourse

**狀態**：⬜ 未開始（卡 #4）

評價分數需個人化加權：同一難度數值對不同使用者要有相反符號。

---

## #6 協同過濾

**狀態**：⬜ 未開始

用選課紀錄矩陣做 item-item / user-user 相似度，含冷啟動 population fallback。

---

## #7 以個人化權重向量取代 5 個固定 variant

**狀態**：⬜ 未開始（卡 #2, #5）

將離散 variant 選擇改為連續權重空間，並在 log 累積後由資料學習權重。

---

## #8 先修關係與多學期路徑規劃

**狀態**：⬜ 未開始

從單學期無狀態貪婪升級為序列決策，補上先修欄位、歷史成績與分類別畢業進度。

---

## #9 探索機制

**狀態**：⬜ 未開始（卡 #2）

小比例隨機與多樣性重排，限制在備選區與低風險課程，不得對必修與重補修做隨機化。

---

## #10 修復多方案塌縮

**狀態**：⬜ 未開始（卡 #4）

於 #1 的驗證過程中量測發現。`PLAN_VARIANTS` 宣稱 5 種方案，經 `uniquePlans()` 去重後**永遠只剩 2 種，且與年級無關**。`docs/SCHEDULING_LOGIC.md:131` 要求至少支援五種方案，目前實質未達成。

以 `server/data/courses.json` 實測：

| 已修必修 | 選修填充空間 | 去重後方案數 |
| ---: | ---: | ---: |
| 0 門 | 1 學分 | 2 |
| 4 門 | 1 學分 | 2 |
| 8 門 | 10 學分 | 2 |
| 12 門 | 16 學分 | 2 |

**根因一：必修排不進去，低年級無填充空間**

15 門必修共 45 學分，但**互相衝堂的配對有 11 對**，實際只排得進 7 門 21 學分。低年級在 22 學分上限下只剩 1 學分填充空間，選修貪婪迴圈幾乎無事可做。

另需注意：被擋掉的 8 門必修只寫進 `excludedCourses`，不會進 `plan.failures`——因為只有 `requiredIds` 指定的課程會記錄 failure，`category === '必修'` 的不算。**使用者看不到「你的必修排不進去」這件事。**

須釐清 11 對必修衝堂是 seed 資料不真實，還是系統缺少分班／分組（section）概念。

**根因二：variant 評分函式退化為同一個**

`interest` variant 的 `getInterestScore` 在使用者未提供關鍵字時恆為 0；`easy_score` variant 的 `getEasyCourseScore` 因涼課關鍵字 0 命中而恆為 0。兩者評分函式因此與 `required_first` 完全相同，必然產生同一份課表。`max_credits` 亦常與其他 variant 重合。

**與 #7 的關係**：本任務是過渡修復，長期由連續權重向量取代固定 variant。

---

## #11 修復排課失敗時關注課程從回應中消失

**狀態**：✅ 已完成（2026-08-01）

於補做 `docs/TEST_PLAN.md` S1-S10 時發現。**既有缺陷，非 #1 或對抗式審查修正引入。**

`generateSchedule` 的失敗回傳路徑不含 `watchedCourses`，只有成功路徑有。方案 `success === false` 時，使用者的關注課程從 API 回應中完全消失。

重現：

```text
generateSchedule([課程5, 課程6], { watchingCourseIds: [5, 6], minCredits: 0 })
  → plans[0].watchedCourses 正確含 2 筆
  → 頂層 watchedCourses === undefined
  → success === false，message =「無法產生符合限制的課表。」
```

**根因兩處**

1. `plan.success = plan.schedule.length > 0 && plan.failures.length === 0`——全部課程都是關注狀態時 `schedule` 為空，被判定為失敗。但關注課程本來就不佔時段，這個判定把合法情境當成失敗。
2. 失敗回傳物件缺少 `watchedCourses`。任何失敗情境都會遺失關注課程。

**違反規格**：`docs/SCHEDULING_LOGIC.md:28-34` 規定關注課程會顯示在課表上供學生觀察時間分佈。

### 修改檔案清單

- `server/src/skills/scheduler.js`
- `docs/SCHEDULING_LOGIC.md`
- `docs/API_SPEC.md`
- `docs/TEST_PLAN.md`

### 主要改動內容

- `plan.success` 改為 `failures.length === 0 && (schedule.length > 0 || watchedCourses.length > 0)`。關注課程本來就不佔時段，「只有關注課程」是合法結果而非失敗。
- 新增 `plan.watchOnly` 旗標，並在該情境下加上警告訊息。
- 失敗回傳路徑補上 `watchedCourses`，與成功路徑一致。無候選課程的早期回傳也補上，維持回應形狀一致。
- `watchOnly` 情境給予專屬訊息，不再誤報「無法產生符合限制的課表」。
- 頂層回應新增 `watchOnly` 欄位。
- `docs/SCHEDULING_LOGIC.md` 補上兩條關注課程規則，把此行為固定為規格而非實作細節。

### 影響範圍

- `POST /api/schedule/generate`
- `POST /api/chat` 的 `run_csp_scheduler` tool call
- 回應為向後相容的欄位新增。**行為變更**：候選課程全為關注狀態時，`success` 由 `false` 改為 `true`。

### 測試與驗證結果

| 情境 | 結果 |
| --- | --- |
| 只有關注課程 | `success=true`、`watchOnly=true`、回傳 2 門關注課、訊息正確 |
| 指定必修排不進去 + 有關注課 | `success=false`（正確），`watchedCourses` 仍完整回傳 1 門 |
| 正常課表 + 關注課 | 無回歸，`watchOnly=false`，訊息維持原格式 |

- **S1-S10：13 項全數通過**（修正前為 12 通過 1 失敗）。
- 限制合併與 prompt 契約測試：17 項全數通過。
- #1 驗收情境 B 重跑通過，無回歸。
- `node --check` 對 `server/src/**/*.js` 全數通過。
- `npm run build`、`npm run lint`：通過。

### 已知限制

前端目前**完全沒有關注課程相關程式碼**（`client/src/` 查無 `watchedCourses` / `watching` / `關注`）。`docs/UX_FLOW.md:42` 已將此標註為「未來應支援」，屬既有未實作項目，不在本任務範圍。後端修正確保資料至少不再遺失，前端接上後即可直接使用。

### 是否 commit 與 push

- 已於後續 commit 提交。
