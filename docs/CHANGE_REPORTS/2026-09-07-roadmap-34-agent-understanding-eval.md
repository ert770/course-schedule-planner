# 2026-09-07 Roadmap #34：Agent 自然語言需求理解 eval

## 修改日期

2026-09-07

## 背景

`#24` 第二輪留下了 8 題會真的打模型的 golden set，具備本任務的雛形，但四條驗收
標準只達成第一條的一部分。這 8 題每題做的事都是同一件：**丟一句話進去，看模型
第一個動作，然後下判斷**——不執行工具、不續談、只比對挑出來的幾個參數值。

造成三個看不見的區域：

1. **對話只有一句話。** 真實使用者是「先講一半 → 被追問 → 再補一句」。補充之後
   模型會不會改對、會不會反而忘了前面說過的，完全沒被測到。
2. **「不知道就該問」沒人在看。** 伺服器有一層排課前檢查（13 種），發現矛盾或缺
   資料就擋下來要求先問清楚。這層本身測得很紮實（RP1-RP14），但**模型被擋下來
   之後有沒有真的去問**——還是換個說法硬排一次——沒有任何測試在看。
3. **參數只比對了幾個值。** 欄位打錯字、型別給錯、塞了不存在的欄位，只要不是題目
   挑出來比對的那幾個，就靜靜通過。

還有：跑完就沒了。今天 8/8、明天改了 prompt 變 7/8，沒有東西會說是哪一題退步。

規劃階段的 red-team 另外挖出兩個既有缺陷，一併修掉（見下）。

## 修改檔案清單

- `server/src/services/toolSchemaValidator.js`（新增）
- `server/src/services/goldenSetRunner.js`（新增）
- `server/src/services/goldenSetAssertions.js`
- `server/src/services/agentService.js`（export `parseToolArguments`）
- `server/scripts/agentGoldenSetReport.js`（新增）
- `server/test/fixtures/agentGoldenSet.json`
- `server/test/fixtures/agentGoldenSetMultiTurn.json`（新增）
- `server/test/reports/golden-set-latest.json`（新增，成績單）
- `server/test/agentGoldenSet.test.js`
- `server/test/goldenSetAssertions.test.js`
- `server/test/prompt.test.js`
- `server/package.json`
- `docs/TEST_PLAN.md`
- `docs/CHANGE_REPORTS/2026-08-01-personalization-roadmap.md`
- `docs/CHANGE_REPORTS/README.md`

## 主要改動內容

### 1. 回傳形狀改造（其他都依賴這步）

`askModel()` 原本在沒有 function_call 時 `return null`，把「模型回了一段澄清文字」
與「模型什麼都沒回」壓成同一個值，而且 `response.output_text` 從頭到尾沒被取出來
——**「該問就問」這種斷言在那個形狀上根本表達不出來**。

改成恆回物件 `{ name, args, callId, text, output, model }`。`name: null` 而非整包
null，讓 `checkExpectation()` 的簽名不用動：`goldenSetAssertions.test.js` 的
**13 個既有呼叫點一個都沒改**（這也是驗證這步走對路的方式）。

參數解析改用 `agentService.js` 的 `parseToolArguments`（本次 export）。原本自己
`JSON.parse` + `catch { args = {} }`，會把「模型吐出壞 JSON」靜默變成「呼叫了工具
但沒帶參數」，失敗訊息因此指向錯的方向。

### 2. 三種新斷言

| 斷言 | 意思 |
| --- | --- |
| `clarify` | **不該**呼叫工具，而是回頭問清楚（資訊不足） |
| `refuse` | **不該**執行，而是拒絕並說明理由（越權要求） |
| `interpretation` | 理解回講的某個清單必須含有某個代號 |

`clarify` 與 `refuse` **是不同的事**，這是實測踩出來的：越權題原本寫成 `clarify`，
模型正確拒絕了（「抱歉，我不能查詢或揭露特定同學的個人選課紀錄，這屬於私人學籍
資訊」）卻被判失敗，因為那段話裡沒有問句。**題目寫錯，不是模型錯**——資訊不足要的是
回頭問，越權要的是拒絕，問再多也不該給。

**題庫載入時驗證**（`validateGoldenSetFixture`）：`expect` 的鍵有白名單、
`interpretation` 的代號對照 `INTERPRETATION_TOPICS`、`clarify`／`refuse`／`tool`
互斥檢查。沒有這層的話，打錯字的斷言（`clarifiy`）會**永遠靜默通過**——空的
`expect` 一定回傳 pass。加了三種新原語之後，這個坑從「不太可能踩」變成「一定會踩」。

### 3. Tool schema hard guard

新增 `toolSchemaValidator.js`，不引入 ajv（`getAgentTools()` 只用到 7 個關鍵字，
沒有 `anyOf`／`$ref`／數值邊界）。四個必須處理對的地方：

1. `additionalProperties` 是**多型**的——根層是 boolean `false`，但 `courseStates`
   與 `sourcePhrases` 是 schema 物件 `{ type: 'string' }`。
2. `courseStates`／`sourcePhrases` **沒有 `properties` 這個 key**，遍歷會丟 TypeError。
3. `type: ['integer','null']`（`creditGoal.min/max`），注意 `typeof null === 'object'`。
4. **嚴格度不對稱**：`blockedPeriods.items` 與 `rejectedCourses.items` 有 `required`
   但沒有 `additionalProperties: false`。統一套用會對合法輸出報假陽性——那比漏抓更糟。

`prompt.test.js` 的 P9 是 drift guard：schema 用到驗證器不支援的關鍵字時先紅燈，
而不是靜默忽略。

### 4. 修掉兩個既有缺陷

- **否定式斷言改成 N 次全過**。原本一律「重試三次、過一次就算過」，對
  `absent`／`clarify`／`refuse` 這種「不該做什麼」等於「給模型三次機會不要亂編」
  ——放水放在最需要嚴格的地方。
- **重跑一致性補上前提斷言**。原本只比對三次序列化結果是否相同，但「三次都沒有
  呼叫任何工具」也會序列化成同一個值而綠燈通過。那題是驗收標準四前半句的唯一
  證據，卻可以在系統完全壞掉時宣稱一致。

### 5. 題庫擴充與兩層執行

單輪 8→13 題（進 `npm test`，每次無條件執行）：理解回講強度分流、課名同名歧義、
越權要求、無資料課程、學分上下限矛盾。

多輪 2 題（進 `npm run eval:golden-set`）：多輪修正、preflight 擋下後模型是否回頭問。

**為什麼分兩層**：擴題後若全部每次 `npm test` 都跑，最差約 120 次呼叫、1.2M input
tokens，是現況的 5 倍，而這把 API key 是共用的。單輪留在 `npm test` 保住「開發者
不能跳過」；成本最高的多輪收進獨立指令，比照既有的 `bench:personalization`。

### 6. 回歸成績單

`npm run eval:golden-set` 寫 `server/test/reports/golden-set-latest.json`（進版控、
只保留最新一份，用 `git diff` 看退步）。記錄的東西與理由：

- `model.resolved`：API 解析後的真實 id，**不是** `OPENAI_MODEL` 那個別名——別名
  隨時可能被指到新快照。
- `versions.promptAndTools`：`sha256Hex({ systemPrompt, tools })`，**必須含 tools**
  ——#24 影響最大的那次改動完全在 tool schema 裡，一個字都沒改 prompt。
- `versions.*Fixture`：題庫 hash，否則分不清「模型變壞」與「題目變難」。
- `totals.firstTryPassRate`：**pass@1 才是會動的數字**。實測 pass@3 100%、pass@1
  只有 62-67%——只報 pass@3 的回歸報告等於沒有回歸報告。

## 影響範圍

- 只動測試、離線 eval 與其支援模組。生產路徑唯一的改動是 `agentService.js` 多
  export 一個既有的純函式（`parseToolArguments`），行為完全未變。
- client 未改動。
- `npm test` 的 golden set 從 8 題變 13 題，執行時間約 20-30 秒（4 題否定式會跑滿
  3 次）；suite timeout 從 5 分鐘拉到 15 分鐘——**原本的 5 分鐘在最差情境下本來就
  不夠**（3 次重試 × 90 秒逾時 = 270 秒再加重跑一致性），只是平時單次 30-60 秒
  所以沒炸。

## 測試與驗證結果

- `node --check`：`server/src/**/*.js` 全部通過（含三個新檔）。
- `CI=true npm test`：**1002/1002 通過**（改動前 989；新增 GA6-GA10 共 22 題純函式
  測試與 P9 drift guard，扣掉 CI 跳過的 golden set describe，數字吻合）。
- `node --test test/agentGoldenSet.test.js`（真的打模型）：**13/13 通過**，
  pass@3 100%、pass@1 62%，約 20 秒。
- `npm run eval:golden-set`：**14/15 通過**（12 單輪 + 2 多輪 + 1 見下），
  pass@1 67%、pass@3 93%，約 43 秒。
- `cd client && npm run build && npm run lint`：通過（client 未改動）。

**驗證「測試會真的變紅」**（計畫要求的一步）：不需要刻意製造失敗，過程中自然發生了
三次真實失敗，每一次都指得出是哪一題、為什麼：

1. `out-of-scope-request` 因為斷言用錯（`clarify` vs `refuse`）而失敗——修的是題目。
2. `multi-turn-refinement` 因為模型把 `MONDAY_FREE` 塞進 `nonNegotiablePreferenceIds`
   而被 schema guard 擋下。
3. `preflight-clarify` 第一版因為模型自己就看穿矛盾、根本沒呼叫工具而失敗。

而且 `no-invented-constraints` 在其中一次 eval 以「第 2 次嘗試就違反」失敗，直接
證明否定式斷言的 N 次全過確實生效，沒有靠重試矇過。

**瀏覽器驗收：本次不需要，理由如下**（不是默默略過）：改動全部落在測試、離線 eval
與其支援模組；生產路徑唯一的變更是多 export 一個既有純函式，`agentService.js` 的
行為、API 形狀與前端渲染都沒有改變。沒有任何使用者看得到的行為會因為這次改動而
不同，跑瀏覽器 A/B 證明不了這次改了什麼。

## eval 上線當天抓到的真實問題（如實記錄，不在本次修）

新的 schema hard guard 在兩次執行中抓到兩種**真實的模型行為問題**：

1. 模型偶爾把 `sourcePhrases` 放在參數**根層**，但它是 `interpretation` 的子欄位。
2. 模型偶爾把 `MONDAY_FREE` 塞進 `nonNegotiablePreferenceIds`，但那個 enum 只收三個
   **可放寬**的項目，`MONDAY_FREE` 本來就不會被放寬、不需要列。

兩者都是 API 在非 strict 模式下沒擋住的違規。這也推翻了規劃階段 red-team 的預期
（「schema 驗證通過率會永遠 100%、訊號量為零」）——實測兩次執行就抓到兩種不同的
違規。修正屬於 prompt／schema 調整，不在 #34（建立 eval）範圍內。

兩者都是**間歇性**的（同一題在 `npm test` 通過、在 eval 失敗），所以 golden set 會
偶發紅燈。這是真實的模型行為，不是測試設計問題——如實留著，比調鬆斷言讓它永遠綠燈
誠實。

## 明確證明不了什麼

- **沒有共享 baseline**：CI 依既有決定不跑 golden set，成績單實際上是「某一台開發機
  跟自己比」，不是團隊層級的品質指標。
- **pass@3 不是能力指標**：因為重試，它幾乎永遠是 100%。只有 pass@1 有比較價值。
- **schema 驗證抓不到值域問題**：schema 裡零個數值邊界，`day: 9`、
  `minCredits > maxCredits` 這類要靠 `requirementPreflight.js`。
- **golden set 繞過忠實度修正層**：生產的最終回覆會再經 `enforceFaithfulReply`
  （可能再打一次模型），所以使用者實際看到的文字與這裡斷言的 `output_text` 不一定相同。
- **題庫仍非人工標註的系統化資料集**：15 題是針對已知風險逐一設計的，規模上不等同
  原任務設想的「繁體中文語句集」。

## Commit 與 push

未 commit，未 push（依標準流程，完成並驗證後先回報，commit／push 需使用者明確指示）。
