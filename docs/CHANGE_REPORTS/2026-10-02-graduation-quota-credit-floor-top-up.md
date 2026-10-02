# 畢業配額排完後補到最低學分；benchmark 載入器對齊線上路徑

日期：2026-10-02
分支：`backend`

## 1. 問題

demo 帳號 D1249697 實際登入後只排出 **5 學分、1 個方案**，低於 profile 的最低 12 學分。

調查結果：這不是意外的 bug，而是 `7f90c7a`（依畢業缺口分配本學期課程）的設計結果與最低學分
互相衝突。

- 這個帳號已取得 118／128 學分，缺口是本系選修 6、通識 4、必修 2、系外 0。
- 三年級下學期推算剩 3 個學期，缺口平均分攤後本學期目標只有選修 2 學分、通識 1.33 學分。
- 規則是「達到當學期目標就停」，所以排 1 門選修（3）加 1 門通識（2）就停了。原報告明寫
  「不用多餘本系選修補滿最低學分」。
- 替代方案被要求與綜合方案的學分與類別門數相同；只有 2 門課時幾乎沒有可換的空間，興趣與集中
  兩條主軸都無解，所以只剩 1 個方案。

同一份真實輸入、只差有沒有帶入 `graduationPlanning`：

| | 方案數 | 學分 |
| --- | ---: | ---: |
| 不帶（benchmark 當時的路徑） | 3 | 25 |
| 帶入（線上實際路徑） | 1 | 5 |

第二個問題由此而來：**benchmark 量的不是線上實際行為。** `planDiversityAcceptanceReport.js` 與
`highsSpike.js` 各自呼叫 `buildScheduleConstraints()`，漏掉了線上 `scheduleService` 會帶的
`graduationPlanning`。

## 2. 決定

使用者決定：**補到最低學分**，並修 benchmark 載入器。

## 3. 修改內容

### `server/src/skills/scheduler.js`

配額決定「先排什麼」，`minCredits` 仍是下限。必修 → 本系選修配額 → 廣度課排完後，若總學分仍
低於 `minCredits`，進入補足階段，一次補一門、**達到下限就停**（不會填到 `maxCredits`）：

1. 優先從畢業缺口還沒補完的類別挑（`gaps` 減去本方案已排入的學分仍大於 0），這些課修了仍然
   計入畢業學分。正式必修不在這裡補。
2. 都沒有時才退回任何還排得進去的課。
3. 類別內依原本的分數排序，本系優先照舊；此階段不受「本系選修最多 3 門」限制。

補的課記在 `graduationPlanning.creditFloorTopUp`（`courses`、`credits`、`sectionIds`），並加一則
warning。配額本身已達下限時完全不進入這個階段。

**沒有改的**：配額階段的順序與門數上限、`maxCredits` 硬上限、通用 repair 在配額啟用時不介入、
替代方案與 S₀ 類別門數相等的限制。

### `server/scripts/lib/demoCaseLoader.js` 與兩支腳本

新增 `buildCaseConstraints()`，與線上 `prepareGenerationInputs()` 一樣帶入
`graduationPlanning`；`planDiversityAcceptanceReport.js` 與 `highsSpike.js` 改用它。之後線上多帶
一項 trusted context 時只需要改這一處。

## 4. 這推翻了 `7f90c7a` 的哪一部分

`7f90c7a` 的報告寫「類別候選不足時保留缺口並警告，不用多餘本系選修補滿最低學分」，並有一條測試
斷言停在 6 學分。本次把那條測試改為補到 9 學分（通識缺口的 warning 仍在）。該次修改要解決的
問題——「25 學分全是本系選修、擠掉通識」——沒有回來：配額階段照舊先排，補足只補到下限。

## 5. 修改檔案

- `server/src/skills/scheduler.js`
- `server/scripts/lib/demoCaseLoader.js`、`server/scripts/planDiversityAcceptanceReport.js`、
  `server/scripts/highsSpike.js`
- `server/test/graduationPlanning.test.js`（改 1 條、新增 3 條）
- `server/test/reports/plan-diversity-acceptance-latest.json`（重跑 benchmark 的產物）
- `docs/SCHEDULING_LOGIC.md`、`docs/API_SPEC.md`、`docs/TEST_PLAN.md`（S19、S19b～d）
- `docs/CHANGE_REPORTS/README.md`、`2026-08-01-personalization-roadmap.md`

未修改資料表欄位；API 回應新增 `graduationPlanning.creditFloorTopUp`，已寫入 `API_SPEC.md`。
未修改 tool call 格式。前端未修改（新的 warning 走既有的提示區）。

## 6. 測試與驗證

- `graduationPlanning.test.js`：8／8。
- 不啟動 `app.js` 的測試檔全部：**1278／1278**（含 `scheduler.test.js` 的 S1–S10）。
- 啟動 `app.js` 的 4 個測試檔：本次未重跑（`interactionEvents.test.js` 在 Windows 上結束極慢）；
  上一次全過是在本次修改之前，**不能當成本次的證據**。
- `node --check` 掃過 `server/src/**/*.js` 與 `server/scripts/**/*.js`。
- 前端未修改，未重跑 build／lint。

### 真實資料（唯讀，與線上相同的限制組法）

| 帳號 | 最低學分 | 修改前 | 修改後 | 補課 |
| --- | ---: | --- | --- | --- |
| D1249697 | 12 | 1 個方案、5 學分 | **2 個方案、13 學分** | 3 門／8 學分 |
| D1249196 | 9 | 3 個方案、12 學分 | 相同 | 無 |
| demo id 2 | 9 | 1 個方案、12 學分 | 相同 | 無 |
| demo id 3 | 9 | 2 個方案、12 學分 | 相同 | 無 |

只有配額低於下限的帳號受影響，其餘三個完全不變。D1249697 的 13 學分是 3 門本系選修（9）加
2 門通識（4）。

### 瀏覽器（使用者本人登入 D1249697）

首頁按「套用偏好排課」：

| | 修改前（同日稍早實測） | 修改後 |
| --- | --- | --- |
| 標頭 | 2 門課、5 學分 | 5 門課、13 學分 |
| 方案 | 只有「個人化綜合方案」 | 「個人化綜合方案」（主推）＋「集中排課方案」 |
| 提示 | 「目前方案僅 5 學分，低於最低目標 12 學分」 | 「本學期畢業缺口只需要部分學分；為達最低 12 學分，另補 3 門課…」 |

console 沒有錯誤。輕鬆與興趣兩條主軸仍未產出方案（資料訊號與門檻問題，與本次無關）。

### Benchmark：載入器修正後的數字才是線上實況

`npm run bench:plan-diversity -- --markdown`（K=3）：

| case | 舊載入器 | 新載入器 |
| --- | :---: | :---: |
| persona-compact | PASS | **FAIL**（只剩 1 個方案） |
| no-preference-control | PASS | PASS |
| persona-challenge | FAIL | **PASS** |
| persona-easy | PASS | PASS |
| fixed-courses-control | PASS | **FAIL**（只剩 1 個方案） |
| 合計 | 4／5 | **3／5** |

**通過數從 4／5 變成 3／5，主因是載入器，不是補足規則**：三位 persona（以及沿用 persona 1 的
no-preference-control）最低學分都是 9，配額本身已排到 12 學分，上面的唯讀實測確認補課為 0。
fixed-courses-control 的最低學分是 12，**我沒有單獨確認它有沒有進入補足階段**，所以它由 PASS 變
FAIL 的原因（載入器或補足規則）尚未分清。先前文件與 roadmap 寫的「4／5」是在漏掉
`graduationPlanning` 的路徑上量的，不代表線上。roadmap #10 的敘述已據此更正。

## 7. 順帶發現、未處理

1. **三個 demo persona 的畢業缺口被高估。** 修課紀錄幾乎全被歸在「未分類」（例如 D1249196：必修 0、
   選修 0、未分類 105），系統因此以為必修缺 63、選修缺 28。D1249697 沒有這個問題。這會影響配額
   與補足時「哪些類別還有缺口」的判斷。
2. **D1249697 必修還缺 2 學分，但沒有排入任何必修。** 未查是本學期沒開還是沒被選到。
3. benchmark 現在有兩個 case 只剩 1 個方案（persona-compact、fixed-courses-control），原因未查。

## 7b. 追加（同日）：距離畢業不到最低學分時，只排到最低學分

使用者補充的規則：**「畢業門檻總學分 − 已取得總學分」低於最低學分時，本學期就套用最低學分。**

實作在 `scheduler.js`：`totalGap = totalRequired − totalEarned`；`totalGap < minCredits` 時
`creditFloorOnly = true`，排課一達到 `minCredits` 就停，不再照類別配額往上排。判斷用總學分而不是
類別缺口，因為類別缺口在修課紀錄沒分類時會被高估（見下），總學分則是可靠的。等於或高於下限時
不套用；沒有總學分資料時也不套用。結果記在各方案的 `graduationPlanning.totalGap`／
`creditFloorOnly`。新增 3 條測試（S19e～g），`graduationPlanning.test.js` 11／11，
不啟動 app 的測試檔 1281／1281。

真實資料（唯讀）：

| 帳號 | 已取得 | 距離畢業 | 最低學分 | 套用？ | 追加前 | 追加後 |
| --- | ---: | ---: | ---: | :---: | --- | --- |
| D1249697 | 118 | 10 | 12 | 是 | 13 學分、2 個方案 | 相同 |
| D1249196 | 126 | 2 | 9 | 是 | 12 學分、3 個方案 | **10 學分、2 個方案** |
| demo id 2 | 116 | 12 | 9 | 否（12 ≥ 9） | 12 學分 | 相同 |
| demo id 3 | 119 | 9 | 9 | 否（9 不小於 9） | 12 學分 | 相同 |

D1249196 是 10 而不是 9：課程是 2～3 學分一門，10 是第一次達到或超過 9 的值。
這次沒有用 D1249196 做瀏覽器驗收（需要使用者本人登入該帳號）。

Benchmark 再降為 **2／5**：persona-easy（即 D1249196）由 3 個方案變成 1 個而 FAIL。課變少之後
替代方案可換的空間變小，這是這條規則的直接代價。

### 修課紀錄為什麼是「未分類」

三位 demo persona 的修課紀錄是用 `courseHistoryMarkdown.js` 從 Markdown 成績表匯入的。那份
成績表只有章節標題（基礎／通識／資工核心／系內／一般…），**沒有逐門的修別欄**，匯入程式刻意
不猜：

- `graduationCategory()` 只把「通識」章節標成 `general`、「商管／外語／跨院／一般」標成
  `external`、不計畢業學分的標成 `nonGraduation`；**其餘一律 `unspecified`**，包含資工核心、
  系內課，以及基礎／共同必修（例如「中文思辨與表達(一)」在 D1249697 是 `general`，在 persona
  是 `unspecified`）。
- `requirementType()` 對「資工核心／系內」回傳「未確認」（每人 33～35 筆），程式註解寫明
  「混有必修與選修，附件沒有修別欄，不能用章節名稱猜」。

所以畢業缺口計算看到的是必修 0、選修 0、未分類約 100 學分，於是以為必修缺 63、選修缺 28。
D1249697 的紀錄來自另一個來源，每一門都有分類，沒有這個問題。這是資料來源的缺口，不是計算
寫錯；要修就得替這些課補上正式的逐門認列（用課號對照必選修科目表），本次沒有做。

## 7c. 追加（同日）：用課號對照必選修科目表，回填修課紀錄的分類

使用者同意後改寫共用 MySQL。

### 分類規則（`server/src/data/courseHistoryClassification.js`）

只用課號與官方科目表判定，對不上就維持未分類：

1. **通識基礎必修** → `general`／必修：核心必修課號（`GEG2000`、`GEK2000`）或中文／英文課名前綴，
   沿用 `generalEducationRecognition.js` 既有的身分判定。
2. **系必修** → `required`／必修：課名在 `csCurriculum.js` 的必修清單上，且課號是 `IECS`，或是
   列舉的 7 個外系開課必修課號（`IEE1005`、`IEE1006`、`IEE1007`、`IEE1010`、`IEE1011`、
   `MATH1005`、`MATH1006`）。只比課名會把他系同名課誤判成本系必修，所以外系開課的用課號列舉；
   這 7 個課號在 D1249697 逐門帶分類的紀錄裡都記為系必修，兩個來源一致。
3. **系選修** → `elective`／選修：`csCurriculum.js` 的核心選修／選修清單（要求 `IECS` 課號）。

`courseHistoryMarkdown.js` 匯入時也套用同一個函式，之後重跑 demo seed 不會把分類洗回未分類。
已由章節判定為通識／系外／不計入的列不覆寫。

### 回填（`server/scripts/courseHistoryCategoryBackfill.js`）

預設 dry-run；套用需 `--apply --confirm-shared-mysql`。只更新 `graduation_category =
'unspecified'` 的列，套用前把原始列備份到 `server/backups/course-history/`（已被 `.gitignore`
排除，不進版控），整批在一個 transaction 內，筆數不符就 rollback。

結果：未分類 128 筆中 **127 筆已分類**（通識基礎必修 24、系必修 75、系選修 28），已寫入 MySQL。
D1249697 的 53 筆完全沒動。

| 帳號 | 回填前（已通過學分） | 回填後 |
| --- | --- | --- |
| demo id 2 | 未分類 96、通識 10、系外 10 | 必修 61、選修 19、通識 26、系外 10 |
| demo id 3 | 未分類 103、通識 10、系外 6 | 必修 61、選修 25、通識 26、系外 6、未分類 1 |
| D1249196 | 未分類 105、通識 12、系外 9 | 必修 61、選修 28、通識 28、系外 9 |

維持未分類的 1 筆是 demo id 3 的「體育(二)」`ATHL1004`（1 學分）：它不在必選修科目表上，
所以沒有動。同一人其他體育課是「不計入畢業」，這一筆在原始成績表的畢業學分欄不是 0，
是否為原始資料的筆誤沒有查證。

### 回填後的排課（唯讀實測）

| 帳號 | 缺口（必修／選修／通識／系外） | 距離畢業 | 最低 | 結果 |
| --- | --- | ---: | ---: | --- |
| D1249697 | 2／6／4／0 | 10 | 12 | 13 學分、2 個方案（不變） |
| D1249196 | 2／0／0／0 | 2 | 9 | 11 學分、2 個方案（補 4 門） |
| demo id 2 | 2／9／2／0 | 12 | 9 | 10 學分、1 個方案 |
| demo id 3 | 2／3／2／3 | 9 | 9 | 10 學分、1 個方案（補 2 門） |

缺口現在是真實的數字（先前是必修缺 63、選修缺 28）。四個帳號必修都還缺 2 學分，對應科目表上
63 學分必修中尚未修的那一門；本學期都沒有排入必修，原因仍未查。

Benchmark 最終為 **1／5**（只有 persona-easy 通過）。這才是線上實況：四年級下學期的學生本來就
只需要修少量課，方案之間可換的空間很小。先前的 4／5、3／5、2／5 分別量在「漏掉畢業缺口分配」
與「缺口被高估」的資料上。

測試：新增 `courseHistoryClassification.test.js`（13 項）。不啟動 `app.js` 的測試檔
**1293／1293**。瀏覽器以 D1249697 再按一次「套用偏好排課」：5 門課、13 學分、2 個方案，
console 無錯誤（這個帳號的資料與結果都沒有變）。其餘三個帳號沒有做瀏覽器驗收——id 2、3 無法
登入，D1249196 需要使用者本人登入。

## 8. 是否 commit 與 push

2026-10-02 依使用者指示 commit 並 push 至 `origin backend`。roadmap 與 `README.md` 只提交本次
自己的修改，其他 session 尚未提交的內容原樣留在工作區。
