# 修復 K5／P0-4：已通過的課號放進指定清單時不再讓整份請求失敗

## 修改日期

2026-09-18

## 為什麼做這件事

K5／P0-4：使用者（或 Agent）把一門**已經修過並通過**的課放進指定清單
（`mustTakeCourseIds`／`selectedCourseIds`）時，整份排課請求會失敗。

修正前的實際行為（`evidence/p0-4-repro-2026-09-18.mjs` 可重現）：

```
success: false
solver.status: "infeasible"
message: "指定課程 ID:101 不在候選課程資料中"
schedule: []            ← 另一門完全沒問題的課也沒排出來
unmetRequirements: [{ REQUIRED_COURSE_COVERAGE, "尚未排入必要課程：計算機演算法" }]
clarification: 「請確認哪些具體課程或班次一定要排入」
```

三個問題：

1. **訊息與事實相反。** 那門課就在候選課程資料裡，只是已經修過被 `ALREADY_TAKEN_PASSED` 擋下。
2. **整份請求陪葬。** 一個排不進去的指定課程讓其他排得出來的課全部拿不到。
3. **澄清問題問錯方向。** 系統問「哪些課一定要排入」，但真正的原因是「你已經修過了」。

成因是已修排除與必排涵蓋率兩條規則各自正確、合起來互斥：`buildPlan()` 依課號把已通過
的課濾出 `eligible`，於是 `requiredIds` 裡那個 id 永遠無法被滿足，
`REQUIRED_COURSE_COVERAGE` 掛著不放，狀態變成 `infeasible`。

## 規格決定

本人於 2026-09-18 選擇 **「略過並明講」**（另外兩個被否決的選項：回傳 clarification 等使用者
回答；視為重修意圖照排）。

否決理由：

- **clarification**：前端完全沒有讀 `clarification`（已用 grep 確認 `client/src` 零次引用），
  網頁使用者看不到任何變化，只有 Agent 路徑有用。
- **視為重修照排**：`ALREADY_TAKEN_PASSED` 沒有 `overridableBy`，要繞過得一路改限制結構、
  獨立驗證器與修復路徑，範圍遠大於這次要解決的問題。

## 修改檔案清單

- `server/src/skills/scheduler.js`：新增 `partitionRequiredIds()`、`alreadyTakenRequiredWarning()`；
  `buildPlan()` 與 `buildRepairCandidateContext()` 改用；三處驗證器呼叫改為傳入排除清單
- `server/src/skills/scheduleValidator.js`：`checkRequiredCoverage()` 接受排除清單並自行複核
- `server/test/scheduler.test.js`：新增 H9、H9b、H10、H11 四個測試
- `docs/application-portfolio/07_測試與評估/evidence/p0-4-repro-2026-09-18.mjs`：重現腳本
- 本報告與 `docs/CHANGE_REPORTS/README.md` 索引
- 資料包同步：`01_目前已完成/07_已知限制.md`（K5 刪除、K27 擴充）、
  `05_推甄前預計完成/00_Roadmap.md`、`01_P0必要工作.md`（P0-4 刪除、P0-13 擴充）、
  `04_排課演算法/08_失敗診斷與修復.md`、`07_測試與評估/01_Unit_Test.md`、`04_Scheduler_Test.md`、
  `08_個人貢獻證明/05_問題排查案例.md`

## 主要改動

### 1. 指定清單在進入排課前先分割

新增 `partitionRequiredIds(prepared, constraints)`，把 `selectedCourseIds` ＋
`mustTakeCourseIds`／`mustTakeCourses` 合併後，拿掉課號出現在已通過清單裡的 id，
並回傳被拿掉的那些課程物件。`buildPlan()` 與 `buildRepairCandidateContext()` 都改用它
——兩邊原本各自重算一次 `requiredIds`，只改一邊會讓修復路徑繼續為了一門永遠排不進去的課
反覆搜尋。

警告只在 `buildPlan()` 發一次：

- 一門：`計算機演算法（課號 IECS3002）你已經修過並通過，已從指定課程清單移除，其餘指定課程照常排入。`
- 多門：`你指定的課程中有 N 門已經修過並通過，已從指定課程清單移除：…。其餘指定課程照常排入。`

順帶消失的是舊的 `指定課程 ID:x 不在候選課程資料中`——那句話只在 id 真的不在資料裡時才會再出現
（`Z5` 測的就是那個情境，行為不變）。

### 2. 獨立驗證器同步，但不直接相信呼叫端

`checkRequiredCoverage()` 原本只看 id 有沒有出現在課表裡，會把這個 id 判成涵蓋率缺漏，
於是 `baselineCheck.valid === false` → 觸發修復 → 最後仍回報失敗。這是修正過程中卡住的地方：
只改 `scheduler.js` 時 `solver.status` 已經變成 `solved`，但最外層的自我檢查仍把結果降級成草稿。

改法是讓驗證器接受 `options.excludedCourses`，並且**要跳過一個 id 必須同時滿足兩個條件**：

- (a) 呼叫端在排除清單裡對它標了 `ALREADY_TAKEN_PASSED`
- (b) 這門課的課號**確實**出現在 `courseHistory` 的已通過清單裡

只看 (a) 等於讓被驗證的一方自己決定驗證結果，那會讓這個「獨立驗證器」失去意義。H9b 就是
在測這件事：同樣的排除宣稱，修課紀錄裡沒有那門課時**不得**放行。

沒有傳 `excludedCourses` 的呼叫端（例如外部打 `POST /api/schedule/validate`）行為完全不變。

## 測試與驗證

### 自動化測試

新增 4 個測試（`server/test/scheduler.test.js`）：

| 測試 | 內容 |
| -- | -- |
| H9 | 已通過課號放進 `mustTakeCourseIds`：`solver.status` 不是 `infeasible`、`success:true`、另一門課照常排入、warnings 含「已經修過並通過」與課號、**不含**「不在候選課程資料中」、`unmetRequirements` 不含該 id、`clarification.required === false` |
| H9b | 驗證器只在課程真的已通過時才放行；修課紀錄裡沒有該課時仍回報 `REQUIRED_COURSE_COVERAGE`；沒傳排除清單時行為不變 |
| H10 | 指定清單**全部**都是已通過課號時仍排出課表，且多門合併成一句「有 N 門」 |
| H11 | 尚未通過的必修放進 `mustTakeCourseIds` 不受影響，仍然必排、不發已修警告 |

全套後端：**1,063 測試、1,060 通過、3 失敗**（修改前是 1,059／1,056／3）。3 個失敗是
`authRoutes`、`privacyRoutes`、`scheduleRoutes` 在 Windows 上的 libuv handle 關閉問題（K22），
與本次無關，數量與檔案都沒有變化。

### 真實資料實測（共用 MySQL，U1 帳號）

以 U1（`資訊三乙`，53 筆修課紀錄全部通過）在瀏覽器登入後，用該 session 送出
`POST /api/schedule/generate`，`constraints.mustTakeCourseIds = [1282]`
（1282 ＝ 計算機結構學／資訊三乙，課號 IECS3003，U1 已修過並通過）：

```
httpStatus: 200      success: true      solver.status: "solved"      isDraft: false
courseCount: 8       totalCredits: 23
warnings 含：計算機結構學（課號 IECS3003）你已經修過並通過，已從指定課程清單移除，其餘指定課程照常排入。
warnings 不含：不在候選課程資料中
schedule 不含 1282；excludedCourses 中 1282 帶 ALREADY_TAKEN_PASSED
unmetRequirements: []        clarification.required: false
```

8 門 23 學分與**不指定任何課程**時的結果相同，代表指定一門已修課不再影響其他課程的排課結果。

### Agent 路徑：修好了一半，另一半是既有問題

同一個帳號在聊天送出「我一定要修『計算機結構學』這門課，請幫我排一份課表」，後端正確回應
（`success:true`、7 門 20 學分、`data.warnings` 含上述那句），但**模型的回覆沒有引用它**：

> 「計算機結構學」未列入這份課表；…現有資料沒有提供它未被排入的原因，也沒有修課紀錄或通過資訊，
> 因此無法確認是否因已修畢、課表限制或其他因素而未排入。

查證後確認這不是本次改動造成的，而是 K27 的同一個根因擴大版：**排除原因的清單沒有排序就直接截斷。**
實測 U1 的 219 筆排除中，6 筆 `ALREADY_TAKEN_PASSED` 落在第 **211–216** 位，而
`agentService.js:172` 的 `EXCLUDED_SAMPLE_SIZE = 15` 只送前 15 筆給模型（全部是
`ELIGIBILITY_UNKNOWN`），前端 `ScheduleNotice.jsx:17` 的 `MAX_EXCLUDED_SHOWN = 5` 同理。
警告本身有送進模型的 tool result 信封（`buildToolResultEnvelope()` 帶 `warnings`），
但模型這次沒有採用它。

這項已併入 **K27／P0-13** 並把修法擴大到兩處（前端與 `agentService`）。
**這是單次觀察**：第二次嘗試被排課前矛盾檢查（`避開蔡國裕`）攔下、沒有進到排課，因此
「模型是否穩定地忽略這個 warning」尚未確認，需要在 P0-13 一併多跑幾次。

## 影響範圍

- **行為改變**：已通過的課號出現在指定清單時，從「整份請求 infeasible」變成「降級為不必排＋
  警告＋其餘照常排出」。`selectedCourseIds` 與 `mustTakeCourseIds` 一視同仁——兩者都會匯入
  `requiredIds`，失敗模式完全相同，只修一邊會留下同一個 bug 的另一半。
- **不受影響**：指定 id 真的不在資料裡（仍是 `data-insufficient`，Z5）；未通過的必修重修
  （H11）；沒有傳排除清單的驗證器呼叫端；已修排除本身的判定邏輯完全沒動。
- **共用資料庫**：只讀，沒有寫入任何 profile。U1 的排課請求會依既有機制觸發一次學習權重重算
  （P0-3 的行為），那是正常使用就會發生的事。Agent 對話會寫入 `Chat_Messages`，屬於正常使用。
- **推甄宣稱**：SC18 從「沒有測試、記憶體重現會 infeasible」變成 `已完成`；案例 1 的殘留問題
  (e) 少一項。

## 是否 commit 與 push

**否。** 依先前建立的慣例，只做到「修改＋驗證＋報告」，commit 與 push 交由本人決定。
