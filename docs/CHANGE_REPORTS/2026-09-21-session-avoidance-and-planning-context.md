# 移除課程後的「本次避開清單」＋ Chat Agent 取得規劃狀態

日期：2026-09-21
分支：`backend`

## 1. 問題

使用者在課表上移除一門課、按「重新排課」，同一門課常常又被排回來，畫面上沒有任何解釋。

成因不是 bug，是設計缺口。移除課程原本只做兩件事：

1. 從畫面陣列拿掉（`ScheduleContext.jsx` 的 `removeCourse()`）；
2. 已同意個人化時送一筆 `course_withdrawn`。

第二件走的是**長期**偏好學習：`preferenceLearning.js` 的 `WITHDRAW_REASON_RULES` 把
`time`／`workload`／`content` 轉成 `compact`／`easy`／`interest` 三軸的投票，而現行 v2 要
累積 50 筆可用事件才會正式套用權重。所以一次移除既不會封鎖那門課，也達不到門檻——
下一次排課的候選池與限制條件與上一次**完全相同**，排回來是必然結果。

第二個問題：`POST /api/chat` 原本只送 `{ message }`，Agent 看不到畫面上的課表與剛移除了
什麼。使用者說「我已經移除不喜歡的課了，幫我重排」時，Agent 只能反問它其實問得到的資料。

## 2. 做法

把「立即重排」與「長期學習」分成兩條**互不取代**的路徑。

| 路徑 | 需要什麼 | 作用 |
| --- | --- | --- |
| 本次避開清單（`constraints.sessionAvoidances`） | section id 在 `Courses` 裡查得到 | 下一次重排立即生效 |
| `course_withdrawn` 互動事件 | 個人化同意 | 長期偏好權重，**規則完全不變** |

### 2.1 一條貫穿全案的分界線

> **避開條件是「使用者本次的排課限制」，不是訓練資料。**

這一條決定了整個實作的形狀，因為 `recordInteractionEvents()` 在寫入**任何**事件之前先擋
個人化同意，`recommendation_exposed` 也走那個函式——**未同意個人化的使用者根本沒有任何
曝光紀錄**。把「requestId 對得上曝光」當成採用規劃狀態的前提，功能對他們會完全失效，
而他們正好是移除課程時**不會被問原因**的那一群（`DashboardPage.jsx`：「不同意的人不該
被問」），最需要 Agent 幫忙補原因。

因此後端分成三條獨立的軌道，任何一條失敗都不影響另一條：

| 軌道 | 需要什麼 | 失敗時 |
| --- | --- | --- |
| 本次排課限制 | section id 查得到 | 丟掉查不到的那一筆，其餘照常生效 |
| 曝光佐證（選用，只影響措辭） | 曝光存在且該班次在 `displayedSet` | 仍當成使用者要求避開的課，但**不宣稱**它是系統推薦過的 |
| 寫入學習事件 | consent ＋ 曝光證明 | 不寫，不影響避開 |

### 2.2 避開範圍由退課原因推導

**保守優先**：只有明確指向「這門課本身」或「這位教師」的原因才放大範圍。

| `reason` | 範圍 | 下一次重排 |
| --- | --- | --- |
| `content`、`workload` | `catalog_course` | 排除整個課號的所有班次 |
| `instructor` | `instructor` | 排除該教師的班次，其他教師的同課程仍可排 |
| `time`、`full`、`eligibility` | `section` | 只排除該班次（這三個原因對內容偏好是中性的） |
| `other`、未填 | `section` | 沒有可據以放大的資訊 |

範圍由**伺服器**依 `reason` 推導，呼叫端送 `scope` 一律忽略；課號與教師也由伺服器從
`Courses` 重查。課號或教師解析不出來時範圍退回 `section`，而不是整筆放棄——使用者按了
移除，最起碼那個班次不該再出現。

### 2.3 `explicitCourseIds` **不是**必排硬限制

這是實作中最容易寫錯、也最容易讓問題原地復活的一點。

`collectExplicitCourseIds()` 把 `explicitCourseIds`、`selectedCourseIds`、`mustTakeCourseIds`、
`mustTakeCourses` 合併成同一個 `explicitIds` 集合，用途只有一個：讓這些課**繞過資格、
學期與系外選修過濾**，不要被靜默剔除。它**不代表「一定要排進課表」**。

而 `SchedulePage` 每次排課都把目前課表當 `courseIds` 重送，`scheduleService` 再把
`courseIds` 併進 `explicitCourseIds`。若避開清單讓位給 `explicitIds`，使用者在那一頁移除
課程後重排，那門課會原封不動被保留——正是這次要修的症狀。

因此新增一個更窄的 `collectProtectedCourseIds()`，只含「不得靜默移除」的三類：

| 類別 | 命中避開時 |
| --- | --- |
| 本學期正式必修（`isRequiredForStudent()`） | 保留並警告／澄清 |
| 重補修（`getFailedRequiredCourseCodes()`） | 同上 |
| `mustTakeCourseIds`、`selectedCourseIds` | 同上 |
| **`explicitCourseIds`／`courseIds`** | **避開清單優先，可以排除** |

### 2.4 必修衝突的兩條路徑處理方式不同（如實記錄）

| 路徑 | 行為 |
| --- | --- |
| Chat | `requirementPreflight.js` 新增第 (14) 項，排課前產生澄清問題 |
| REST | `scheduler.js` 保留課程並發警告；該筆避開回報 `protected-conflict` |

REST 路徑沒有 preflight（該檔第 (13) 項的註解已說明這道防線只涵蓋 chat）。兩者不一致是
事實，不假裝一致。共同保證是：**不靜默違反任何一方**。

連帶修正：`agentService` 的 `lookupCourses()` 原本只載入 `mustTake`／`selected`／`watching`，
避開的班次查不到課程，新檢查會永遠不觸發。現在一併載入。

### 2.5 回報必須誠實：`appliedSessionAvoidances`

每一筆帶 `{ sectionId, reason, scope, pendingReason, status, message }`：

| `status` | 意義 |
| --- | --- |
| `applied` | 真的避開了 |
| `protected-conflict` | 那門課是必修／指定必排，**仍在課表中**，`message` 說明衝突 |
| `not-found` | 這次的候選課程裡找不到對應的課 |

只有 `applied` 才可以在畫面上說「已避開」。`protected-conflict` 顯示成已避開，畫面就會
跟旁邊的課表自相矛盾。

### 2.6 `pendingReason` 的完整迴路

只把「原因未知」送給 Agent 不夠——Agent 就算聽懂「作業太多」，前端 `sessionStorage` 裡
仍是舊的 `section` 範圍，之後按一般「重新排課」時其他班次照樣會出現。整條迴路是：

1. 前端把 `pendingReason: true` 的項目送進 `planningContext`；
2. prompt 規則：有待補項目時先問原因再排課（使用者明說不用才略過）；
3. Agent 把答覆放進 `run_csp_scheduler` 的 `removalReasonResolutions`；
4. 伺服器依 `reason` 重算範圍，回傳 `appliedSessionAvoidances`；
5. 前端寫回 `sessionStorage`，之後的一般重排沿用新範圍。

`pendingReason` **不能從 `reason` 推導**：「還沒問到」與「問過了、他不想講」都是
`reason === null`，照 `reason` 推會讓 Agent 每一輪重問同一個問題。因此這個旗標由呼叫端
決定並一路帶到回報。

### 2.7 職責分界：後端核實不了的地方要講明

`removalReasonResolutions` 的 `outcome`（`resolved`／`declined`）是**模型依使用者的自然
語言判斷**的。使用者到底有沒有說「不想講」，後端收到的只是一組 section ID，**驗證不了**。
這是已知限制，寫進 `AI_AGENT_SPEC.md` 與 `PROMPT_DESIGN.md`，不寫成保證。

後端只驗證它驗證得了的三件事：該 section 確實在待補清單裡、`reason` 在值域內、
`scope` 由後端推導（工具 schema 根本不開 `scope` 欄位，模型沒有機會把「這個時段不方便」
放大成排除整門課）。不合規的項目丟棄、維持待補，不讓整次排課失敗。

### 2.8 `planningContext` 的來源驗證與三態狀態

- **純 shape 與來源驗證分開放**：`data/planningContextSchema.js`（純函式）與
  `services/planningContextService.js`（查 `Courses` 與曝光）。
- **課名、課號、教師一律由後端重查**，呼叫端送的同名欄位丟棄——那些字串會直接進
  system prompt，由 client 提供等於讓它決定「避開的到底是哪門課」，也能把任意文字塞進 prompt。
- **不合法不得讓整次對話失敗**。它住在 `sessionStorage`，會因部署升版、舊分頁、資料損壞
  變成舊格式；回 400 的話使用者的每一則訊息都會失敗，直到他自己想到要清 storage。

| `planningContextStatus` | 意義 | 前端行為 |
| --- | --- | --- |
| `accepted` | 正常採用 | 照常 |
| `rejected-invalid` | 格式不合法 | **清除**避開清單 |
| `temporarily-unavailable` | 後端暫時查不動 | **保留**避開清單，之後可重試 |

布林分不出後兩者，前端會在資料庫暫時失敗時清掉**仍然有效**的避開清單。

### 2.9 `planningContext` 與 `latestExposure` 的優先順序

`resolveLatestRecommendation()` 只認 `surface === 'chat'` 的曝光，但使用者現在看的很可能是
Dashboard 或 Schedule 剛排出來的課表。兩份都說成「目前課表」，模型會分不出哪一份是現在
的，`record_schedule_feedback` 也可能用到錯的 `requestId`。因此有規劃狀態時，舊的那一次
改標成「較早的一次聊天推薦（**不是**使用者目前看到的課表）」。**學習事件的驗證不變**。

## 3. 順手修掉的兩個既有缺口

### 3.1 `course_withdrawn` 會被寫成兩筆

同一次移除經過兩條路徑：使用者在畫面上按移除（`POST /api/interactions`，前端用**隨機**
UUID），以及他接著在 Chat 講同一件事（`record_schedule_feedback`，用**確定性** UUID）。
`canonicalIdempotencyPayload()` 把 `actionId` 算進 key，兩邊永遠撞不到同一個鍵。

修法與 `plan_chosen` 同一個模式：`actionId` 由伺服器依 `(requestId, sectionId)` 推導，
抽成共用的 `courseWithdrawalActionId()`，兩個 service 都呼叫它，不各自複製種子字串。

**光是統一 `actionId` 還不夠**（這是審查抓到的）：`comparableEvent()` 原本也比 `source`
與 `versionSnapshot`，而兩條路徑的 `source` 本來就不同——前端的 `courseSource()` 依課程
回 `required`／`system_recommendation`／`explicit_selection`，Agent 固定寫
`system_recommendation`。移除一門正式必修時即使 `actionId` 與原因都一樣也會被判成
`conflict`，那不是衝突，是同一件事的兩種記法。因此 `course_withdrawn` 另有專屬比較，
只看 `requestId + sectionId + feedbackReason`；**改了原因才是 `conflict`**。

### 3.2 忠實度閘門讓 Agent 問不出它被要求要問的問題

實測發現：Agent 被要求「追問使用者為什麼移除『軟體框架設計』」，但一提到課名就被
`#37` 的忠實度閘門判成幻覺，只能回一句沒有資料的安全答案。

原因是證據帳本只累積**工具結果**，伺服器主動補進 prompt 的課程事實不在裡面。閘門的本意
是「沒有依據就不要講」，不是「沒呼叫工具就不要講」——規劃狀態的課名、課號與教師是伺服器
自己從 `Courses` 解析出來的，可信度不低於一次工具呼叫。

因此新增 `recordContextCourseEvidence()`，**只寫 `courses`／`courseIndex`，不碰
`tools`／`operations`**：這不是一次工具呼叫，不該出現在「這回合做了哪些操作」的歷史裡，
也不該影響 `buildSafeFaithfulnessFallback()` 對「最近一次未完成操作」的判斷。

## 4. 與計畫的一處偏離

計畫寫的是三個平坦陣列（`excludedSectionIds`、`excludedCatalogCourseCodes`、
`sessionAvoidInstructors`）。實作改成**一個結構化欄位** `sessionAvoidances`
（`[{ sectionId, reason }]`），理由是計畫自己要求的「每一筆要帶 `status`」與「範圍由後端
依 `reason` 推導」在三個平坦陣列上做不到——它們丟掉了「哪一筆對應哪個原因」的關聯，
也會讓課號與教師必須由 client 提供（與「不信任 client 字串」矛盾）。

單一結構化欄位讓範圍推導、課號解析與逐筆回報都只有一個地方說了算。

## 5. 修改的檔案

**後端**
- 新增 `data/planningContextSchema.js`（純 shape ＋ 範圍推導）、
  `services/planningContextService.js`（來源驗證）。
- `services/constraintService.js`：新增 `sessionAvoidances`（`pickRequestList`，不從 prefs 回填）。
- `skills/scheduler.js`：`buildSessionAvoidanceRules()`／`matchSessionAvoidance()`／
  `collectProtectedCourseIds()`／`protectedAvoidanceReason()`／`reportSessionAvoidances()`；
  `prepareCandidates()` 內的排除與保留；四個回傳路徑帶上 `appliedSessionAvoidances`。
- `services/scheduleService.js`：`resolveSessionAvoidances()`（可注入 loader）。
- `services/requirementPreflight.js`：第 (14) 項避開與必修衝突。
- `routes/chat.js`、`services/agentService.js`、`services/promptService.js`：規劃狀態、
  `removalReasonResolutions`、伺服器強制合併、優先順序、行為規則。
- `data/interactionEventSchema.js`、`services/interactionEventService.js`、
  `services/scheduleFeedbackService.js`：`course_withdrawn` 的 actionId 與專屬冪等比較。
- `services/explanationFaithfulness.js`：`recordContextCourseEvidence()`。

**前端**
- `contexts/ScheduleContext.jsx`：`sessionAvoidances` 狀態、`sessionStorage`（含 try/catch
  與帳號切換清除）、`removeCourse()` 的三件獨立動作、`applyResolvedAvoidances()`、
  `buildAvoidanceConstraints()`、`buildPlanningContext()`。
- 新增 `components/Schedule/SessionAvoidanceBar.jsx` ＋ `App.css` 樣式。
- `pages/DashboardPage.jsx`、`pages/SchedulePage.jsx`、`components/Chat/ChatPanel.jsx`、
  `services/api.js`。

## 6. 驗證

### 6.1 自動化測試

全套 **1279 項全部通過，0 失敗**。

**一個量測方法上的更正**：過程中我先用 120～420 秒的 timeout 跑 `npm test`，看到
`interactionEvents.test.js` 回報檔案層級失敗，一度以為那是既有缺陷。實際上不是——該檔
起 `app.js`，跑完斷言後**要很久才結束**；讓它跑完（約 49 分鐘）之後整套是 0 失敗。
先前看到的「失敗」是我自己的 timeout 造成的，不是測試或程式的問題。

因此日常驗證分兩段跑比較實用：70 個不起 `app.js` 的測試檔 **1213/1213 通過（19 秒）**；
5 個起 `app.js` 的檔案另外跑，67 項斷言全部通過。兩者相加與單一指令的結果一致。

新增：`sessionAvoidance.test.js`（12）、`planningContextSchema.test.js`（12）、
`planningContextService.test.js`（9）、`removalReasonResolutions.test.js`（8）、
`requirementPreflight.test.js` RP14（4）、`constraints.test.js`（2）、
`explanationFaithfulness.test.js` F25（4）。

`interactionEvents.test.js` 的 IL-3b 依新契約改寫並補三項（IL-3c～e），其中 IL-3d 專門釘住
「UI 寫 `source: required`、Agent 寫 `system_recommendation` 仍判 `duplicate`」這個具體漏洞。

`node --check` 掃過 `server/src` 全部 90 個檔案；`npm run build`、`npm run lint` 通過。
動到 `scheduler.js`，`docs/TEST_PLAN.md` 的 S1–S10 隨 `scheduler.test.js` 執行（226 項通過）。

### 6.2 瀏覽器 A/B（真實帳號 D1249697）

**A/B 對照**（同一個帳號、同一組偏好，只差避開清單）：

| 項目 | A：無避開 | B：有避開 |
| --- | --- | --- |
| `content` 移除 `安全程式設計`（1296） | **在課表中** | 不在課表；診斷 `USER_REMOVED_THIS_SESSION`；`status: applied`、`scope: catalog_course` |
| `instructor` 移除 `行動應用程式開發`（1295） | — | 排除 5 個班次，全部是陳錫民：1295、1304、1305、1309、1310 |
| `time` 移除同一門（1295） | — | **只**排除 1295，其他陳錫民的課仍是合法候選 |

**必修衝突**：同時送 `sessionAvoidances: [1295]` 與 `mustTakeCourseIds: [1295]` →
`status: "protected-conflict"`、該課**仍在課表中**、warnings 出現
「你要求本次避開的課程中有 1 門仍保留在課表裡（行動應用程式開發（同時被你指定為一定要
修的課））」。

**Chat（只問缺的那一項）**：
- 「我已經移除我不喜歡的課了，幫我重排」→ Agent **沒有索取移除清單或目前課表**，直接
  重排，新課表不含被避開的課。
- 待補原因的項目 → Agent 只問：「請確認你移除『軟體框架設計』（sectionId 1299）的原因。」
  **沒有**問課名或課表。
- 回答「因為作業太多」→ `sessionStorage` 由
  `{reason: null, scope: "section", pendingReason: true}` 變成
  `{reason: "workload", scope: "catalog_course", pendingReason: false, status: "applied"}`。
  這證明整條迴路閉合，而不只是那一次生效。

**三態**：壞掉的 `planningContext` → HTTP **200** ＋ `rejected-invalid`；
空白 `message` → 400；正常 → 200 ＋ `accepted`。

**持久化**：重新整理後避開列與 `sessionStorage` 都還在；按「清除本次避開」後兩者皆清空。

**console**：全新分頁載入後無任何錯誤。

### 6.3 誠實記錄的三件事

1. **`catalog_course` 範圍在真實帳號上沒有完整證據。** 這位學生的候選池裡
   `IECS3074` 只有一個班次，所以瀏覽器只證明了「該班次被排除」。「同課號的其他班次也被
   排除」由單元測試 SA1 證明。`instructor` 範圍則在真實資料上完整驗證了（5 個班次）。
2. **清除避開後不斷言該課一定再次出現。** 清除只保證它重新成為合法候選，最佳化器是否
   再次選中取決於整體目標函式。瀏覽器驗證的是診斷消失。
3. **Chat 最終回覆的文字品質受既有的忠實度閘門限制。** 修好證據登記之後，Agent 能正確
   指名課程並提問；但在某些回合，它的敘述仍會被 `#37` 的閘門換成保守的「目前可確認的
   課程資料如下：…」清單。那是既有機制的取捨，不是這次的接線問題——功能面（是否重排、
   是否避開、範圍是否回寫）在同一批實測裡全部正確。

## 7. 沒有做的事

- **第二段（「其他」原因的自然語言分析）不在本輪範圍。** 開工前要先解決一個資料問題：
  `Interaction_Events` 只有 `feedbackReason`（enum），**沒有地方保存 `weak`／`strong`**。
  屆時二選一，不得含糊：只保存 canonical reason 並由程式推導強度（則不可宣稱保存了不同
  強度），或正式擴充版本化的事件欄位。
- 不新增 MySQL 欄位：本次避開是工作階段狀態，長期資料仍用既有的 `Interaction_Events` 與
  `Learned_Preference_Weights`。
- 不改變 Choice Perceptron（任務 3A）的任何行為，也不推進 3B 的 go/no-go。

## 8. 驗收在真實帳號留下的資料

瀏覽器驗收用的是真實 demo 帳號 D1249697（已同意個人化），因此以下是**真的寫進去**的：

- **一筆 `course_withdrawn`**：我用 UI 移除「安全程式設計」（sectionId 1296）並選了
  「課程內容不感興趣」，那筆事件照現行規則寫入，`source: explicit_selection`、
  `feedbackReason: content`，會被 `WITHDRAW_REASON_RULES` 當成 interest 軸的一票。
  這是為了驗證功能而產生的資料，不是使用者真正的表態。
- **數筆 `recommendation_exposed`／`schedule_regenerated`**：按「套用偏好排課」一次，
  以及 A/B 對照用的 6 次 `POST /api/schedule/generate`。
- **幾則聊天記錄**（加密保存）：「我已經移除我不喜歡的課了，幫我重排」等 4 則。

**沒有**改到的東西：同意狀態、`User_Profiles`（含 `preferences_json`、偏好標籤、興趣）、
任何刪除操作。`sessionStorage` 的避開清單已在驗收後清空。

上一輪（任務 3A）用 `PRIVACY_STORE=memory` 隔離驗收事件；這一輪**沒有**那樣做，因為要驗證的
正是「避開條件在真實同意狀態下與長期學習並行」這件事，用記憶體 store 會把要測的東西關掉。
代價就是上面那一筆 withdrawn 事件。要移除它的話說一聲，可以依 `(requestId, sectionId)` 精準刪掉。
