# 2026-09-03 Roadmap #27：多方案比較 UI 與 counterfactual explanation

## 1. 修改日期

2026-09-03

## 2. 為什麼做這件事

`#10`（方案之間真的是不同課程集合）與 `#26`（每門課帶證據導向理由）都已完成，
`#27` 的兩個前置全部滿足。

**後端算了 5 個方案，前端只顯示第 1 個，另外 4 個直接丟掉。** `client/src` 全部檔案
裡只有一個地方碰到 `plans`（`interactionLog.js` 的 `buildRecommendation()`），而且只取
`plans[0]` 的 `planId` 拿去寫互動事件。使用者因此看不到三件事：還有別的選擇（系統
排了「涼課與高分優先」等方案，畫面上不存在）、這些方案差在哪（唯一透露差異的地方是
混在警告清單裡的一句話）、改變偏好會發生什麼（完全沒有）。

另外一個小問題：接受推薦時送出的方案排名寫死是第 1 名——今天只看得到第 1 個方案
所以剛好沒錯，一旦能切換方案這個數字就會開始說謊。

## 3. 規劃時先量測，避免高估這件事的內容量

照 `#10`、`#26` 的作法，先用 demo 帳號（`D1249697`，真實 MySQL）實測：

**方案數是 2 個，不是驗收標準要求的 3 個**，而且這 2 個方案在課數、學分、上課天數、
早八、偏好符合度、評價涵蓋率上**全部相同**，只差 2 門課。

**counterfactual 更空**：把使用者開著的 5 個偏好逐一關掉重排，**五項全部 0 門變動**。
原因跟 `#10`、`#26` 同一個——候選池 227 門裡有 211 門卡在 `#13C`（等系辦書面規則），
真正能競爭的只有 16 門，候選用完就停，偏好沒有發揮空間。

用合法方式放大候選池模擬 `#13C` 已解之後，同一份程式碼立刻有內容：3 個方案、指標真的
不同（天數 3/3/4、評價率 0.30/0.73/0.33），關掉「集中排課」換 4 門、關掉「上機實作
考試」換 4 門。**結論：機制照做，空的地方明講空，`#13C` 一解就有內容。**

## 4. 主要改動內容

### 4.1 後端：比較指標算在後端，不在前端重算

`computePlanMetrics()`（`scheduler.js`）補上前端要的「上課天數、早八課數、空堂節數」
三項，`usedDays` 沿用 `getCompactness()` 判斷「用了幾天」的 `getUsedDays()`；早八／
午休／晚課的節次界線抽成常數（`MORNING_LAST_PERIOD`／`LUNCH_PERIOD`／
`EVENING_FIRST_PERIOD`），與 `getViolatedTimePreferences()` 共用同一份定義——兩處
各自寫 `startPeriod<=1` 遲早會分岔，而比較表正是最容易讓人相信數字的地方。

### 4.2 後端：方案塌縮改成結構化 + 句子兩個出口

`buildPlanDiversity()` 先算出結構化的 `planDiversity`
（`requestedVariants`／`distinctPlans`／`collapsed`／`competablePoolSize`），
`describePlanCollapse()` 再從這份結構產生原本就有的中文句子——一份資料，不是
前端另外 parse 字串。

### 4.3 後端：counterfactual 用獨立端點

實測候選池放大後一次完整排課 289ms、五次 counterfactual 重排 1019ms；塞進
`/api/schedule/generate` 會讓每次排課變 4 倍時間，多數使用者不會展開這個面板。
新增 `POST /api/schedule/counterfactual`，`planComparison.js` 的
`buildCounterfactuals()` 對使用者目前開著的每項偏好，關掉它、用同一個
`generateSchedule()` 重跑、跟基準比對——不自己判斷「這門課應該被換掉」。狀態用
三態（`changed`／`unchanged`／`not-applicable`），與 `#26` 的
`alternativesRejected.status` 同一個原則：空陣列會讓「算過沒差異」與「沒算」
長得一樣。

`prepareGenerationInputs()` 從 `generateForUser()` 抽出，`counterfactualForUser()`
共用同一份候選池組裝邏輯——這個檔案開頭就警告過「兩條路徑各自組一次會靜默漂移」，
不能自己再犯一次。

### 4.4 前端：兩頁都接，順手收斂 SchedulePage 漏讀的欄位

`SchedulePage.jsx` 原本不對等——`DashboardPage` 有 `buildScheduleNotice()` 完整渲染
`warnings`／`excludedCourses`／`unscheduledCourses`，`SchedulePage` 只就地寫了
`{ level, text, details }`，**`excludedCourses` 與 `unscheduledCourses` 完全沒讀**。
既然兩頁都要接方案切換，先把這段收斂成共用的 `ScheduleNotice.jsx`（含
`utils/scheduleNotice.js` 的純函式），否則是第三個漂移點（第一個是 `#26` 的
`CourseDetailModal`）。

新增 `PlanSwitcher.jsx`（方案切換列）與 `PlanComparison.jsx`（比較表 + counterfactual
面板）。比較表刻意不排出六欄一樣的數字——先算出「哪些項目真的有差」，沒差的收成一句話，
把版面讓給真正的差異。

`ScheduleContext` 新增 `plans`／`selectedPlanId`／`activePlan`／`planDiversity`／
`selectPlan()`；`selectPlan()` 不是重新排課，是把畫面換成同一次結果裡的另一個方案，
watched／explicit／時間未定課程不會遺失——它們本來就是每個 plan 各自帶著的欄位，
切換時自然跟著換過去。`acceptRecommendation()` 的 `planRank` 從寫死的 `1` 改成選中
方案在 `plans` 裡的實際索引。

### 4.5 一個實作中發現的真實 bug：接受非主推方案被拒絕

瀏覽器實測時，切到方案切換列的第二個方案再按「符合」，被 `assertProvenance()`
拒絕寫入——因為 `recommendation_exposed` 事件當時只記了主推方案的 `planId`，
使用者切到別的方案再接受，`planId` 對不上就被判定成偽造來源。

修法：`exposureContext` 新增 `displayedPlanIds`（這次曝光顯示過的每一個方案），
`displayedSet` 也從「只有主推方案的課」改成「全部方案課程的聯集」——否則退掉只存在於
非主推方案的課，同樣會被誤判成沒顯示過。舊曝光事件沒有這個欄位時退回只認主推
`planId`，維持相容。

## 5. 影響範圍

- `POST /api/schedule/generate`：每個 `plans[]` 元素新增 `planMetrics`；成功／失敗
  回應頂層新增 `planDiversity`。**既有欄位語意不變**。
- 新增 `POST /api/schedule/counterfactual`。
- `Interaction_Events.exposure_json` 新增 `displayedPlanIds`；`recommendation_accepted`
  的來源驗證規則改變（見 4.5）。
- 前端 `SchedulePage.jsx`／`DashboardPage.jsx` 都新增方案切換與比較 UI；
  `SchedulePage.jsx` 額外修正原本完全沒讀的排除原因顯示。
- **排課決策本身沒有改變**（PM6／CF4 直接釘住這件事）。

## 6. 測試與驗證結果

### 自動化

- `npm test`：**844 pass / 0 fail**（改動前 818，新增 26 項：PM1-PM6 共 12 項、
  CF1-CF4 共 11 項、`buildExposureDraft` 4 項、IL-17e/f/g 3 項——部分測試同時涵蓋
  多個編號）。
- 既有 S1-S17、N1-N15、X1-X16、Z1-Z7、P10、R1-R10、IL 系列全數通過，零回歸。
- `node --check`、client `npm run build`／`npm run lint` 皆通過。

### 瀏覽器實機（demo 帳號 `D1249697`，Dashboard 與 SchedulePage 兩頁都驗）

上一輪（`#26`）截圖多次逾時，改用 DOM 文字擷取交差；這次不接受那個替代方案。
六張截圖清單，兩頁各一組：

1. **方案切換列**：2 個方案、標示主推、各自課數與學分。
2. **切換後的課表**：確認課程真的換了（行動應用程式開發、人工智慧自然語言導論
   ⇄ 電腦視覺與擴增實境、系統安全）。
3. **切換後的課程詳情**：`#26` 的推薦理由跟著換成該方案的（含「它勝過：」的
   真實對照課程與分數差）。
4. **比較檢視**：明講「課數、學分、上課天數、早八課、偏好符合度、評價涵蓋率在各方案
   間相同；真正有差異的項目如下」，只列出真的有差異的「空堂節數」一項——**過程中
   意外發現空堂節數其實有差（0 vs 11），規劃階段沒測到這項，證明比較邏輯是真的在算，
   不是寫死「都一樣」**。
5. **counterfactual 面板**：5 項開著的偏好全部顯示「取消這項偏好，課表不會改變」
   並附上「可競爭的課程只有 16 門」的原因；8 項沒開的偏好顯示「你目前沒有開啟這項
   偏好」。都不留白。
6. **方案數不足的說明**：沿用既有的合併警告文字，明講「目前提供 2 種方案」與
   「可競爭的課程僅 16 門」。

`read_console_messages` 全程無新增錯誤。

### 過程中發現並修的兩個問題（如實記錄）

1. **版面擠壓**：`.schedule-area` 是 `overflow:hidden`、`.schedule-wrapper`（課表格）
   是 `flex:1`。加了 `PlanSwitcher`／`PlanComparison` 之後，文字量把 `.schedule-wrapper`
   的可用高度擠到只剩 26px——課表格實質上消失，且沒有任何捲軸能碰到它。第一次截圖
   就發現了畫面不對，不是等使用者回報。修法是把確認列／提示／方案切換／方案比較
   一起包進 `.schedule-top-stack`（`max-height: 42vh; overflow-y: auto`），課表格
   永遠保有合理空間。
2. **接受非主推方案被拒絕**：見 4.5，這是先驗證再宣稱完成的具體案例——不是靠 code
   review 發現，是瀏覽器裡真的切換方案、真的按下「符合」、看到 `/api/interactions`
   回傳 `"status":"rejected"` 才發現的。修完後在同一個瀏覽器 session 重新驗證，
   確認回傳變成 `"status":"append"`，並補了 IL-17e/f/g 三項回歸測試（含「非顯示過的
   方案仍要被拒絕」的反例，不能為了修好而放寬驗證）。

## 7. 明確不做

- **不做「保留部分課程再重排」的互動**——那需要把使用者鎖定的課當成新的硬限制重排，
  是一條獨立的排課路徑；本次只做「接受方案」與「要求重新規劃」（對應既有事件），
  這一項留在 roadmap `#27` 條目下標記未完成。
- **不新增互動事件類型、不動 `#29` 的 schema 版本**——`displayedPlanIds` 是
  `exposureContext` 內的相容性欄位擴充，不是結構性改動。
- **不改排課決策本身**：比較與 counterfactual 只解釋既有結果（PM6／CF4 釘住）。
- **不為了讓比較表好看而製造差異**——空堂節數之外五項在 demo 帳號現況下真的相同。
- **不修 `scheduleFeedbackService.js`（Agent `record_schedule_feedback` 工具）的
  對應假設**——那條路徑是 Agent 在對話中詢問「這份課表符合嗎」，語意上綁定的是
  Agent 自己那個回合推薦的方案，不是使用者事後透過 UI 切換的方案，是不同的設計
  邊界，超出本次瀏覽器驗證到的範圍，留待需要時另外處理。
- 不處理 `#13C`（外部阻塞，等系辦書面規則）。
