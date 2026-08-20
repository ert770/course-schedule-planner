# 2026-08-19 內容偏好從硬過濾改成軟懲罰（Roadmap #3）

## 修改日期

2026-08-19

## 修改檔案清單

**新增**：

- `docs/CHANGE_REPORTS/2026-08-19-content-preference-soft-scoring.md`（本檔）

**修改**：

- `server/src/skills/scheduler.js`
- `server/test/scheduler.test.js`
- `docs/SCHEDULING_LOGIC.md`
- `docs/API_SPEC.md`
- `docs/PROMPT_DESIGN.md`
- `server/src/services/promptService.js`
- `docs/DECISIONS.md`（新增 ADR-009～011）
- `docs/TEST_PLAN.md`
- `docs/CHANGE_REPORTS/2026-08-01-personalization-roadmap.md`（#3 狀態更新、#21 開始前必須具備回填）

## 主要改動內容

### 問題

`server/src/skills/scheduler.js` 的 `hardConstraintReason()` 把 8 個「內容偏好」旗標（`noMidterm`／
`noGroupReport`／`discussion`／`weightDaily`／`practicalExam`／`finalReport`／`englishTaught`／
`learnMore`）當成硬性排除條件，判定依據全部是對 `course.description`（161 字平均、100% 有內容的
自由文字）做關鍵字比對。真實資料庫命中率兩極化：

| 旗標 | 排除模式 | 命中率（本次重測） | 後果 |
| --- | --- | ---: | --- |
| `noMidterm` | 命中即排除 | 0.1% | 幾乎從未真正排除任何課，是靜默假承諾 |
| `weightDaily` | 未命中即排除 | 1.7% | 候選集幾乎全滅 |
| `learnMore` | 未命中即排除 | 97.6% | 幾乎不篩選任何課，使用者卻以為有效 |
| 其餘 5 個 | — | 5.5%～48.9% | 尚可，但仍是不可靠的關鍵字猜測 |

呼叫端行為：`hardConstraintReason()` 回傳非 null 時，該課直接排除；若是必修或使用者明確指定的
課程，還會讓整個方案 `success` 變 `false`。這對候選集規模與排課成功率造成直接影響，且完全沒有
任何測試釘住這 8 個旗標的行為。

### 設計

1. **共用設定表取代 8 個 if 分支**：`CONTENT_PREFERENCE_RULES`（`flag`／`mode`／`label`／
   `keywords`／可選 `extra`），`mode: 'avoid'` 命中扣分、`mode: 'prefer'` 命中加分，`englishTaught`
   額外保留 `extra: course => course.language === 'English'` 判定路徑（與原本
   `hardConstraintReason()` 的判定完全一致，不擴大既有比對範圍）。
2. **`hardConstraintReason()` 移除這 8 個 branch**，只剩 4 個真正硬性的時段類檢查
   （`noMorningClasses`／`noEveningClasses`／`blockedPeriods`／`lunchBreakFree`）——它們是結構化
   事實判定，不是關鍵字猜測，沒有「命中率」失效模式，維持硬性排除。
3. **`scoreCourse()` 不分 variant 一律套用** `getContentPreferenceScore()`，比照 `category
   priority`／`credits` 的基礎分寫法——這 8 個旗標原本就是候選篩選層級，不是特定 variant 的行為。
   單一命中 ±40 分（與 `INTEREST_KEYWORD_SCORE` 同量級），小於一個類別優先度級距（120）。
4. **未命中一律中性 0 分，avoid／prefer 兩種 mode 皆然**：關鍵字沒出現在描述裡代表「描述沒提到」，
   不代表「這門課真的沒有這個特徵」，與 #4 對缺席評價「不當成 0 分」是同一個誠實原則的延伸（見
   `docs/DECISIONS.md` ADR-010）。完全沒有設定任何內容偏好時，這個函式對每門課都回傳 0，排序與
   改動前逐項一致。
5. **訊號可靠度警告**：`prepareCandidates()` 對候選池（5 個方案共用同一批）計算每個已啟用旗標的
   關鍵字命中率，<5% 或 >95% 時發出警告。門檻用真實命中率表驗證過：正好命中 `noMidterm`、
   `weightDaily`、`learnMore` 這三個 roadmap 背景段落自己分類為「仍近乎全滅／仍形同無效」的旗標，
   其餘 5 個不觸發，與既有「已可運作」判斷一致（見 ADR-011）。警告算在候選池層級（非個別方案），
   透過既有的 `[...new Set(...)]` 警告聯集機制自然去重，不會因 5 個方案各發一條而重複。
6. **`docs/SCHEDULING_LOGIC.md` 順手修正既有文件錯誤**：`noMorningClasses`／`noEveningClasses`／
   `lunchBreakFree` 先前被誤列在「軟性偏好」（與程式碼行為不符，程式碼裡它們一直是硬性的），這次
   一併移到「硬性限制」，只改文件敘述，不改這 3 項的程式行為。

### 明確不在本次範圍

- Roadmap #21 的正式 `hard`／`soft` constraint schema（`weight`／`relaxable`／`source`／
  `confidence` 欄位、獨立 validator、逐級放寬機制、結構化 conflict set）——#21 依賴 #3（其
  「開始前必須具備」原本就寫「所有現有偏好已分類成 hard constraint 或 soft preference」），本次
  只是把 8 個內容偏好從硬性排除改成軟性加分，不是 #21 要的正式分層，#21 仍是分開的任務。
- 4 個時段類硬性檢查——程式行為不變，只修正文件分類。
- `has_midterm`／`grading_scheme`／`language` 等課程欄位——維持 #4 已定案的「需要對共用 MySQL 做
  `ALTER TABLE`，屬 D 類 rollout」決定，這次不動。
- 不改前端、不改 `preferenceTags.js` 的標籤對照表——旗標名稱不變，只改後端怎麼解讀；前端既有的
  8 個 checkbox（`#無期中考`等）不需任何改動即可套用新行為。

## 影響範圍

- `POST /api/schedule/generate` 與 `/api/chat` 的 `run_csp_scheduler`：這 8 個旗標的行為由「硬性
  排除」改為「軟性加分」——**這是刻意的行為變更**。候選集不再因這些旗標歸零，`excludedCourses`
  不再因這 8 個旗標出現排除原因，必修／明確指定課程不再因這 8 個旗標被誤判失敗。`warnings` 新增
  訊號可靠度警告的可能。
- 排課邏輯：`scoreCourse()`／`hardConstraintReason()`／`prepareCandidates()` 改動；
  `prepareCandidates()` 簽章新增第 5 個參數 `constraints`（已確認未匯出、僅一處呼叫，安全）。
- 前端：無需任何改動，既有 8 個 checkbox 直接套用新行為。
- 效能：候選池命中率計算為 O(候選數 × 已啟用旗標數) 的一次性掃描，量級與既有的
  `unknownEligibilityNames` 等候選層彙整相同，可忽略。

## 測試與驗證結果

### 自動化測試

- `npm test`：**428 tests / 97 suites 全數通過**（基準 413 tests / 96 suites，新增 15 個測試
  N1–N15，0 個失敗、0 個 skip）。
- N1–N15 涵蓋：命中即排除類（N1）與未命中即排除類（N2）不再讓候選集歸零或消失；全部 8 個旗標
  同時開啟時未命中的課不再被排除（N3）；必修／明確指定課程不再被誤判失敗（N4）；命中課程分數
  確實較低／較高、影響同時段衝突的排序結果（N5、N6）；內容偏好加總不蓋過類別優先度（N7，
  通識課命中 2 項偏好 +80 分，仍不敵核心選修的 240 分類別優先度差距）；4 個真正硬性檢查中先前
  完全無測試的 `noEveningClasses`／`lunchBreakFree` 趁重構補上回歸測試（N8、N9）；訊號可靠度
  警告在命中率過低（N10）、過高（N11）時觸發，正常範圍不觸發（N12），多方案聯集後不重複
  （N13）；未設定任何旗標時行為與改動前一致（N14）；`englishTaught` 的 `language` 欄位判定
  路徑獨立驗證（N15）。
- 既有測試零回歸：已 grep 確認**沒有任何既有測試斷言這 8 個旗標的行為**，全數 413 個既有測試
  維持通過。

### S1–S10（`docs/TEST_PLAN.md` 與 `.claude/skills/commit-push/SKILL.md` 強制要求）

逐項執行，全數通過。

### 真實資料驗證（node 層，連正式 MySQL）

- 對資工三學生的 227 門候選課，實測 `weightDaily` 關鍵字命中率 1.3%（3/227）。模擬舊版「未命中
  即排除」行為：候選集會被壓縮到僅剩 3 門，幾乎必然無法滿足必修課排入條件。新版軟性加分後，
  `weightDaily: true` 排課仍正常成功，8 門課、24 學分，與不設定此偏好時完全相同。
- `noMidterm: true` 正確觸發「候選課程中僅 0/13 門（0%）符合...訊號極弱」警告；`learnMore: true`
  正確觸發「候選課程中有 13/13 門（100%）符合...無法有效區分課程」警告；`noGroupReport: true`
  不觸發任何警告（命中率落在正常範圍）——與門檻設計的預期完全吻合。

### 瀏覽器實機驗收（`AGENTS.md:133-147` 強制，`preview_start` 啟動 server + client）

- 以 demo 帳號 `D1249697` 登入，Dashboard 側欄「我的排課偏好」的 8 個內容偏好 checkbox（先前
  onboarding 精靈已設定的既有 UI，本次未改動）**直接可用於 A/B 測試**，比 #4 當時仰賴繞過
  Chat（因缺 `GEMINI_API_KEY`）改用原始 fetch 呼叫的驗收方式更直接。
- **A/B 對照**：勾選「無期中考」→ 點擊「套用偏好排課」→ 頁面正確顯示新警告文字：「偏好「免期中考」
  目前以課程描述關鍵字判定，候選課程中僅 0/16 門（0%）符合這個判定，訊號極弱，這項偏好對排序
  幾乎不起作用，結果可能不如預期。」課表維持 8 門課、23 學分（候選集未歸零）。取消勾選後重新
  套用，警告文字消失，課表內容不變——完整的開／關對照。
- Console 檢查：僅有既有的 4 個登入前 `/api/auth/me` 401 探測（與本次改動無關的既有行為），未
  增加任何新錯誤；`preview_logs` 確認伺服器端無錯誤日誌。

## 是否 commit 與 push

- 尚未 commit，尚未 push。
- 補充說明：`server/data/chat_history.json`／`server/data/users.json` 在瀏覽器驗收過程中因登入與
  設定精靈互動被 Express 正常寫入——這是瀏覽器驗收（AGENTS.md 強制要求）產生的既有副作用，不是
  本次任務刻意修改測試資料，commit 時將排除這兩個檔案的變動（延續 2026-08-17 變更報告的既有作法）。
