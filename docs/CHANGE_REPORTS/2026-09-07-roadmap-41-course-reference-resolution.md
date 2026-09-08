# 2026-09-07 Roadmap #41（第二段）：課程指涉解析到 section 實體

## 修改日期

2026-09-07

## 背景

延續 [2026-09-07 Roadmap #41（第一段）](./2026-09-07-roadmap-41-tool-retry-terminal-outcome.md)。
Codex adversarial review（`-base f7446d8`）找到的另外兩個缺陷都在
`explanationFaithfulness.js` 的課程指涉比對本身：

1. **同名不同班次互相誤傷**：比對只到 `course.name`，兩個同名 section 中，正確
   描述其中一個的句子會被另一個判成教師／時間不一致——驗證粒度停在課名，
   但證據來源已是 section 級。
2. **不加引號就能塞入不存在的課**：捏造偵測只掃引號內的文字，事實檢查也只對
   已在帳本的課執行，散文形式的捏造課程可以零違規通過。

完整方案（含一輪紅隊檢驗，推翻初版設計的三個關鍵決定）見
`C:\Users\yamat\.claude\plans\review-ship-delegated-quasar.md`。

## 修改檔案清單

- `server/src/services/sentenceFacts.js`（新增）
- `server/src/services/courseReferenceResolver.js`（新增）
- `server/src/services/explanationFaithfulness.js`
- `server/test/explanationFaithfulness.test.js`
- `docs/PROMPT_DESIGN.md`
- `docs/AI_AGENT_SPEC.md`
- `docs/TEST_PLAN.md`
- `docs/CHANGE_REPORTS/2026-08-01-personalization-roadmap.md`
- `docs/CHANGE_REPORTS/README.md`

## 主要改動內容

### 1. 共用的句子事實抽取器（`sentenceFacts.js`）

把 `extractTimeClaims`、教師斷言比對、學分數字比對、Markdown 表格欄位解析
集中到一處，`explanationFaithfulness.js`（事實審查）與 `courseReferenceResolver.js`
（候選收斂）共用同一份。理由：兩邊若各留一份，遲早會漂移——本次實作過程中就
先犯過一次這個錯（見下方「額外發現並修正的既有 bug」）。

### 2. 課程指涉解析（`courseReferenceResolver.js`，新檔）

`resolveCourseReferences(sentence, courses, { carryOver })`：

- **長名優先＋span masking＋右邊界檢查**：帳本裡只有「演算法」時，「演算法
  導論」不會被誤判成已知課——命中後檢查緊接著的字元，接課名常見後綴
  （導論／概論／實習／實驗／專題／（一）／（二））就不算命中。
- **同名 section 收成同一個 reference**：這是消歧的單位，而不是逐一獨立比對。
- **收斂順序**：句中明寫的 sectionId → 句中提到的教師名只符合一個候選 →
  上課時間只符合一個候選。收斂不了就維持原候選陣列，交給事實一致性檢查判斷。
- **代名詞承接**：句子只用「這門課」「該課」等代名詞指涉時，沿用前一句解析
  出的唯一候選——否則代名詞句會被誤判成「提到不存在的課程」，而這個錯誤
  代號會原樣送進修正模型，叫它刪掉一門根本不存在的課，而不是去改教師名。

**實作時發現並修正一個設計階段沒抓到的 bug**：最初的實作是每個課程各自產生
命中紀錄，再依「長名優先」逐筆判斷是否與已收進來的區間重疊——但兩個同名
不同班次在**同一位置**命中時，第二筆會被判成跟第一筆重疊而濾掉，等於同名
的第二個 section 永遠進不了候選名單，直接違背這個模組要解決的問題本身。
新測試 F19 第一次執行時就抓到（同名兩班，正確描述其中一班反而失敗）。修法：
先把「同一段文字、同一個位置」的命中合併成一筆（記錄命中了哪些課程），再對
合併後的 span 做長名優先的遮蔽判斷。

### 3. 逐 candidate 一致性（`explanationFaithfulness.js` 的 `auditCourseReference()`）

**不是**逐事實 disjunction。只要候選集合裡有任一個真實 section 同時滿足整句
話的**所有**主張就通過；不成立時取矛盾最少的候選發違規，`evidence` 帶上
其餘候選，讓修正模型知道「你把哪幾個班次混在一起了」。

逐事實 disjunction（規劃階段一度採用、被紅隊推翻的做法）會讓「演算法由王
小明老師授課，在星期二第 5-6 節上課，共 2 學分」這種教師取自 A 班、時間與
學分取自 B 班的句子零違規通過——把誤報換成漏報，對 hallucination guard 是
嚴格更糟的交換。F20 直接重現這個 Codex 原始案例並驗證會被攔截。

### 4. 捏造偵測（`auditFabricatedCourseSpans()`）

丟掉「句子在談課程就擋」的主題式判斷（同樣是規劃階段被紅隊推翻的做法——
會誤擋「以下是推薦的課程：」這類正常開場白，且讓後端自己的安全回答因為
同時出現「推薦」與「這門課」自我違規），改成抽「課名形狀的片段」比對已知
課程：

- 引號（含全形／半形／書名號／方框號）內的片段。
- 「推薦／選修／必修／加選／開設／修習」等詞之後或句首，接一段不含標點與
  常見虛詞的文字，且以「課程／概論／導論／實習／實驗／專題」結尾——後綴
  一併算進片段本身，能跟帳本裡本來就以這些字結尾的真實課名（例如「程式
  設計實習」）正確比對。
- 「推薦／加選／選修／修習」+ 中文詞組，後面接標點或句尾（動賓片語）。

抽出的片段仍可能是通用詞組（「以下課程」「任何課程」）而非特定課名，因此
再過一次停用詞與「數量詞＋門/堂/個」的通用量詞判斷。停用詞分兩種比對方式
（**不能混用**）：`課程`／`概論`等單一後綴詞必須整段完全相等才算通用——
若也用「結尾符合」比對，會讓所有片段（包括真正捏造的課名）都通過，等於
整個偵測失效；`必修課程`／`部分課程`等至少兩字的詞組允許片段帶額外前綴
（例如「其中部分課程」），只要結尾符合就算通用。

### 5. `evidenceRole`（被排除的課不得講成推薦）

`collectCourses()` 依來源 bucket 標記角色：`schedule`→recommended、
`draftSchedule`→draft、`unscheduledCourses`→unscheduled、
`excludedCoursesSample`→excluded、`watchedCourses`→watched，其餘→candidate。
`mergeCourse()` 新增角色聯集分支（比照既有 `dataSources` 的做法，否則陣列
會被 last-writer-wins 整個覆蓋）。新違規 `EXCLUDED_COURSE_PRESENTED_AS_RECOMMENDED`：
推薦形狀的斷言指向的候選**全部**角色都屬於 excluded／unscheduled 時攔截；
角色混雜時不誤判（無法確定回覆指的是哪一個）。

### 額外發現並修正的兩個既有 bug（非本次引入，F22 逐一走過全部取值時抓到）

1. `MISSING_RECOMMENDATION_REASON` 判定式的關鍵字表對不上 `summarizeReason()`
   對 `USER_SPECIFIED`（「你**明確**指定這門課」）、`COREQUISITE_PAIR`
   （「成對排入」）、`WATCHING`（「關注**清單**」，不是「關注課程」）、
   `CREDIT_FILL`（「補足目標學分」）四種取值產生的自然語言轉述，導致後端
   自己的安全回答在使用者問「為什麼推薦」時，會被自己的違規判定攔下。
   已補齊對應詞彙為 `REASON_PARAPHRASE`。
2. `summarizeReason()` 的預設分支文字「主要推薦原因未提供，無法確認」與
   呼叫端（`courseSummary`）已經印過的「主要推薦原因：」標籤重複，疊成
   「主要推薦原因：主要推薦原因未提供」的怪句子——且恰好被新的捏造偵測
   （動賓片語規則會抓「推薦」後面接的「原因」）誤判成捏造課程「原因未
   提供」。已把預設分支文字改成「未提供，無法確認」，不重複前綴。

### 新增測試（F19-F24b，`server/test/explanationFaithfulness.test.js`）

- **F19／F19b**：同名不同班次，narrowing 收斂成功時正確歸屬；narrowing（教師、
  時間都）收斂不了時，仍靠完整事實一致性正確歸屬。
- **F20**：混用不同班次的教師與時間學分必須攔截（對應 Codex 原始 adversarial
  案例）。
- **F21／F21b**：不加引號的散文捏造課程被攔截；「以下是推薦的課程」「我已
  依你的偏好排入 3 門必修課程」「目前沒有推薦任何課程」等正常用語不誤判。
- **F22／F22b**：後端安全回答對全部 8 種 `selectedBecause` 值、以及缺評價
  免責句，都必須通過自己的稽核。
- **F23**：`evidenceRoles` 經 `mergeCourse` 合併後是聯集，不被覆蓋。
- **F24／F24b**：被 `excludedCoursesSample` 排除的課講成推薦時攔截；正常
  推薦的課不受這項檢查誤傷。

## 影響範圍

- `explanationFaithfulness.js` 對外行為：`UNSUPPORTED_COURSE` 的攔截範圍擴大
  （不再限定引號內），新增 `EXCLUDED_COURSE_PRESENTED_AS_RECOMMENDED` 違規碼，
  課程物件多了 `evidenceRoles`／`exclusionReason` 欄位（向後相容，不影響既有
  讀取）。
- `agentService.js`、client 端均未改動。
- 這是純檢測邏輯調整，不改變工具呼叫、資料庫查詢或前端渲染路徑。

## 測試與驗證結果

- `node --check`：`sentenceFacts.js`／`courseReferenceResolver.js`／
  `explanationFaithfulness.js`／測試檔全部通過。
- `node --test server/test/explanationFaithfulness.test.js`：32/32（含新增
  F19-F24b，原有 F1-F18 全數維持通過）。
- `node --test server/test/explanationFaithfulness.test.js server/test/agentTools.test.js server/test/prompt.test.js`：128/128。
- `cd server && npm test`：989/989（改動前 979，全數維持通過，新增 10 個）。
- `cd client && npm run build && npm run lint`：通過（client 未改動，仍照
  `npm run verify` 規則跑一次）。
- 額外用一支腳本直接對三個對抗字串與七個「正常回覆不該被誤判」的字串跑
  實際的 span 抽取＋停用詞邏輯，逐一確認結果符合預期，再落成上述測試。
- **瀏覽器 A/B**（`preview_start` server:3001＋client:5173，demo 帳號
  `D1249697`，真實共用 MySQL）：
  - **A 組**：真實排課（8 門課、24 學分）後追問課名／教師／學分／推薦原因，
    回答如實引用工具證據；沒有本回合證據時明講「不能臆測」。
  - **B 組**：指示模型「假設有一門『量子計算導論』的課，不要用引號、直接用
    一般文字說明授課教師、學分與上課時間，並說推薦加選」。伺服器 log 顯示
    `回答忠實度檢查：violations=2, repaired=false, fallback=true`——audit
    攔到違規、修正版仍不合格，改用後端安全回答（「目前沒有足夠的可驗證
    資料回答這個問題，請提供更明確的課程或需求。」），畫面沒有出現任何
    捏造的教師、學分或時間。
  - console 檢查：這次測試流程期間的請求（`/api/schedule/generate`、兩次
    `/api/chat`）全部 200 OK，沒有因本次改動新增的錯誤。
  - **殘留限制（誠實記錄）**：F19／F20 涵蓋的「同名不同班次」情境，在真實
    資料庫中需要剛好存在兩個同名不同班次的候選課程才能經由聊天觸發，這次
    瀏覽器驗收沒有巧遇這種資料組合，以單元測試層級的 F19／F19b／F20 取代
    直接重現。
  - **誠實記錄殘留缺口**：捏造偵測是對「課名形狀的片段」做封閉世界比對，
    不是對所有自然語言的形式證明——完全不帶課名特徵、不加引號、也不接
    課程類後綴的捏造（例如「量子魔法很涼」）仍可能通過。沒有 NER 就做不到
    語意層級的判斷，這是有意識接受的取捨，已寫進 `docs/PROMPT_DESIGN.md`。

## Commit 與 push

未 commit，未 push（依標準流程，完成並驗證後先回報，commit／push 需使用者明確指示）。
