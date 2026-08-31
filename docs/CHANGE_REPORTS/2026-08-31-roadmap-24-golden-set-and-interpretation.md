# 2026-08-31 Roadmap #24 第二輪：結構性矛盾完整化、理解回講與 golden set

## 1. 修改日期

2026-08-31（接續同日的
[Roadmap #24 第一輪](./2026-08-31-roadmap-24-requirement-gate.md)）

## 2. 為什麼做這件事

第一輪交付時，我把 `#24` 的三件事寫成「不宣稱完成」。使用者逐條反駁，**三條都對**：

1. 我說 golden set 做不到，理由是「模型可能被 `OPENAI_MODEL` 換掉」。使用者指出
   模型固定是 `gpt-5.6-luna`——這個理由不成立。真正的限制只是 `npm test` 不能打
   真的 API，那是執行方式的問題，不是做不到。
2. 我把「結構性矛盾」與「語意矛盾」混在一起講成「無法窮舉」。前者其實**可以窮舉、
   可以宣告完整**，我含糊了。
3. 我說無法讓模型解析變確定。使用者提議用 prompt 框住輸出格式——那正是 `#24` 標題
   「建立**結構化需求模型**」本身，原文還明列要有 intent、hard/soft constraints、
   missing fields、conflicts。我第一輪判斷「tool 參數已經夠了」太快。

## 3. 修改檔案清單

| 檔案 | 改動 |
| --- | --- |
| `server/src/services/requirementPreflight.js` | 從 2 項檢查擴充到 12 項；新增時段可用性計算、理解回講一致性與缺漏檢查 |
| `server/src/services/promptService.js` | `run_csp_scheduler` 新增必填的 `interpretation`；system prompt 新增回講章節 |
| `server/src/services/agentService.js` | 把 `interpretation` 從排課條件中拆出、隨結果回傳；課程查詢範圍擴大到 `selectedCourseIds` |
| `server/src/services/goldenSetAssertions.js` | **新增**。golden set 的斷言邏輯，純函式 |
| `server/test/agentGoldenSet.test.js` | **新增**。會實際呼叫模型的 golden set |
| `server/test/fixtures/agentGoldenSet.json` | **新增**。8 題中文題庫 |
| `server/test/goldenSetAssertions.test.js` | **新增**。斷言邏輯的純函式測試（GA1-GA5） |
| `server/test/requirementPreflight.test.js` | 新增 RP5-RP13，每項矛盾各一正例一反例 |
| `server/test/requirementGate.test.js` | 新增 AG13（回講不進排課引擎、會回傳、矛盾時擋下） |
| `server/test/prompt.test.js` | 新增 P6（回講的 schema 與 prompt 契約） |
| `docs/PROMPT_DESIGN.md` | 完整矛盾清單與回講說明 |

## 4. 主要改動內容

### 4.1 結構性矛盾偵測——可以窮舉，因此宣告完整

`checkPreflightContradictions()` 從 2 項擴充到 12 項。完整清單見
`docs/PROMPT_DESIGN.md`，其中先前**完全沒有任何檢查**的包括：`minCredits > maxCredits`
（已查證 `constraintService.js` 只是把兩個值直通，排課引擎也沒有互相比對，
「最少 20 但最多 15」會一路排到底）、兩門指定必修彼此衝堂、指定必修的學分總和
超過上限、指定必修不在本學期、已選課程撞封鎖時段、時段偏好把可用節次清空。

時段判定沿用 `scheduler.js` 既有規則（早八 = 第 1 節、午休 = 第 5 節、晚間 =
第 12 節以後），不另立一套。

**界線寫清楚**：結構性矛盾（數字、時段、集合互相打架）宣告完整；語意矛盾
（「想輕鬆一點但也想學很多」）取決於語言理解而非數字比對，無法窮舉，不宣稱。
第一輪把兩者混成一句「無法窮舉」是含糊的說法。

### 4.2 結構化理解回講——#24 的本體

`run_csp_scheduler` 新增**必填**參數 `interpretation`（`nonNegotiable`、
`flexible`、`creditGoal`、`notMentioned`、`sourcePhrases`）。三個清單一律填
**代號**而非自由文字，中文由伺服器生成——理由與量測數據見第 7 節。

伺服器做四件事：**檢查回講與實際參數是否自相矛盾**、**擋下缺漏的回講**
（schema 的巢狀 `required` 在非 strict 模式下不被 API 強制，實測模型會送
`interpretation: {}` 過來）、**隨結果回傳給前端顯示**、**不寫 log 也不持久化**
（`sourcePhrases` 含使用者原話，#33 明訂 log 只記 metadata 不記內容）。

### 4.3 Golden set 進入 `npm test`

使用者決定無條件放進 `npm test`。我先前反對的四個理由裡**有一個是錯的**：我說這會
推翻「既有測試刻意 delete `OPENAI_API_KEY`」的設計。實測確認 `node --test` 每個檔案
跑在**獨立行程**，其他檔案刪掉的環境變數不影響新的評估檔——該反對意見不成立，已收回。

針對其餘三個理由的設計：所有題目**並行**送出；**第一次答對就不再打**，最多重試
3 次；每次呼叫設 90 秒逾時；缺 key 時明確失敗並說明「這是環境未設定，不是程式壞掉」。

斷言的是**語意性質而非逐字相同**——即使 model id 固定，推理模型的輸出本來就不保證
每次一樣（而且不吃 `temperature`）。要求逐字重現只會做出一個間歇性失敗的測試，
那比沒有測試更糟。

## 5. 測試與驗證結果

### 自動化

- `npm test`：**672 pass / 0 fail**（第一輪後 615，新增 57 項），**約 10～23 秒**。
- **我先前的估計錯了**：我預估加入 golden set 後 `npm test` 會從 9 秒變成 1～2 分鐘。
  實際是 8.3 秒——並行加上第一次就答對，比預期快得多。
- `client`：`npm run build` 成功、`npm run lint` 無輸出。

### Golden set 實際通過率

**8/8（100%）**，另加一題「同句重跑逐位元相同」（見第 7 節）。

**第一次執行是 5/8，三題失敗——查證後是我的題目寫錯，不是模型答錯。**
失敗的三題原文是「我絕對不要早八，無論如何都不行。」這類**陳述句**，不是排課請求；
模型回覆「了解：這次排課絕對不安排早八……如果你希望之後每次都避開，請再說一次」，
沒有呼叫工具其實完全正確。另一題「你資料弄錯了，我是資訊工程學系的。」模型主動
追問年級與班別再提出變更，比我預期的行為更謹慎。

題目已改成明確的請求（並在題庫的 `why` 欄位記下這個經過），這不是「改題目直到變綠」
——原本的題目測的根本不是我想測的東西。

### 瀏覽器實機（真實 MySQL、真實 OpenAI 呼叫）

**1. 學分區間矛盾**：送「幫我排課，最少要 20 學分，但最多只能 15 學分。」
Agent 回「你的學分條件互相矛盾……請確認你要的是哪一種」，並列出兩個選項。
**值得記錄的是**：模型自己就擋下了，連 `run_csp_scheduler` 都沒呼叫，
所以伺服器端的 preflight 這一次沒有被觸發——結果是好的，但不能當成 preflight 的證據。

**2. 理解回講**：送「幫我排課表。我絕對不要早八，這點無論如何都不能讓步；
午休倒是可以彈性一點。」實際回傳：

**改成代號之後**重測（送「我絕對不要早八，這點不能讓步；集中排課的話有就好。」），
模型輸出的代號與伺服器生成的中文：

```json
{
  "codes": {
    "nonNegotiable": ["NO_MORNING_CLASSES"],
    "flexible": ["PREFER_COMPACT"],
    "creditGoal": { "min": null, "max": null },
    "notMentioned": ["NO_EVENING_CLASSES", "LUNCH_BREAK_FREE", … 共 17 項],
    "sourcePhrases": { "NO_MORNING_CLASSES": "絕對不要早八",
                       "PREFER_COMPACT": "集中排課的話有就好" }
  },
  "chinese": {
    "nonNegotiable": ["不排早八"],
    "flexible": ["集中排課"],
    "creditGoal": "未指定（將沿用你已儲存的偏好）"
  }
}
```

強度分類正確、`creditGoal` 沒有把偏好摘要的預設值抄進來、`sourcePhrases` 正確
對回使用者原話，而 `notMentioned` 完整列出它沒有資訊的 17 個項目。

**3. 伺服器端 preflight 真正被觸發**：送「我這學期一定要修『資訊安全管理』，
但我週五第 11 節到第 13 節要打工不能上課。」——模型無法自行判斷該課的時段，
照樣把兩個條件都送進來，伺服器 log 出現：

```text
INFO [Preflight] 排課前偵測到矛盾或資料不足，改為澄清
```

接著回覆「那就以打工時段為主，資訊安全管理可以不要排」，Agent 依新條件排出
20 學分 7 門課的課表。**完整迴圈成立**：擋下 → 追問 → 使用者選擇 → 照新條件排課。

**4. 回歸檢查**：第一輪的確認閘門仍正常——「以後都把我的學分上限設成 21」→
確認前資料庫 `max_credits` 為 `null`、五個偏好標籤完整；回覆「確認」後
`max_credits` 變成 `21`、標籤仍是五個。驗完已將 demo 帳號還原。

## 6. 驗收標準對照（更新）

| # | `#24` 驗收標準 | 結果 |
| --- | --- | --- |
| 1 | 自然語言 golden set 可正確轉成結構化需求 | **完成**。8 題進 `npm test` 每次執行，實測 8/8 |
| 2 | 資料不足與矛盾案例會先澄清 | **結構性矛盾完整**（12 項，清單即定義）；**語意矛盾明確不宣稱** |
| 3 | 更正 department／grade／className 後 scope 使用新值 | 第一輪已完成 |
| 4 | 同一句需求重跑能得到相同結構化結果 | **完成**（對無歧義的需求）。見下方第 7 節 |

## 7. 追加：把回講改成代號，讓同句重跑真的逐位元相同

使用者追問「同句重跑逐字相同，不能用 prompt 達到嗎？」——我先前直接寫成做不到，
但沒有量測過就下結論。實測之後發現**可以，而且我原本的判斷太快**。

### 先量測，再下判斷

同一句話跑三次，比對結果：

| 項目 | 三次是否一致 |
| --- | --- |
| 選的工具 | ✅ |
| 語意核心（`noMorningClasses`、`allowRelaxation`、`nonNegotiablePreferenceIds`） | ✅ |
| `minCredits`／`maxCredits` | ❌ 有時從偏好摘要抄、有時不抄 |
| `flexible`（自由文字） | ❌ 「可以彈性安排」／「彈性安排」／「彈性調整」 |
| `creditGoal`（自由文字） | ❌ 「12～25 學分」／「12～25 學分（依目前設定）」 |

**模型對語意的判斷三次完全相同，變異全部來自「同一個意思有很多種寫法」。**
那不是模型不穩定，是輸出空間太大。

順帶一提，`temperature` 也實測過了：Responses API 同樣回
`400 Unsupported parameter: 'temperature' is not supported with this model`——
先前那句話是從 chat completions 的錯誤推論的，這次才真的驗證。

### 改法：把輸出空間縮到每個意思只有一種寫法

- `nonNegotiable`／`flexible`／`notMentioned`：自由文字 → **代號 enum**
  （19 個項目的固定詞彙表 `INTERPRETATION_TOPICS`）。
- `creditGoal`：字串 → `{ min, max }` 整數，使用者沒明講就都填 `null`。
- prompt 新增一條：使用者沒明講學分時**不要把偏好摘要的預設值抄進參數**。
- 中文說明改由伺服器的 `describeInterpretation()` 依代號生成——模型輸出穩定，
  使用者看到的仍是人話，兩邊都拿到。

### 結果

新增測試「同一句話重跑三次得到逐位元相同的結構化結果」，**連續四輪執行全部通過**
（12 次呼叫）。

### 過程中發現的兩件事，都寫進程式碼註解

**1. 測試句本身不能有歧義。** 最早用的題目是「我絕對不要早八，午休可以彈性」，
四輪裡有一輪不一致——「午休可以彈性」本來就能解讀成「要保留午休但可放寬」或
「午休不用保留」，模型在兩者間搖擺是合理的。**同句重跑的一致性只對明確的需求成立，
這是句子的性質，不是系統的缺陷。** 題目已換成無歧義的版本，並在測試裡註明原委。

**2. schema 的巢狀 `required` 沒有被強制。** 實測模型會送 `interpretation: {}`
過來——OpenAI 的 function calling 在非 strict 模式下不深入檢查 `required`。
沒有回講就等於沒有這一層保護，因此新增第 12 種矛盾檢查由伺服器自己擋
（只對 chat 路徑要求，REST 與測試等其他呼叫端不受影響）。

### 誠實的界線

給使用者看的**中文回覆文字**仍然不可能逐字相同，也不需要——驗收標準講的是
「結構化需求」。而「無歧義的需求」這個前提必須講明白：句子本身有歧義時，
不同的解讀都是合理的，那時候要做的是澄清而不是硬求一致。

## 8. 已知限制

- Golden set 每次 `npm test` 都會消耗 API 額度：8 題加上 determinism 測試的 3 次
  重跑，順利時共 11 次呼叫、整套約 10～23 秒。成本目前可接受；若之後題庫變大或
  開始間歇性變紅，會照實回報並重新討論執行方式。
- 語意矛盾偵測不在範圍內，且明確不宣稱。

## 9. 後續修正：GitHub CI（2026-08-31 追加）

**本次交付把 CI 弄紅了，當下沒有發現。** 本地 `npm test` 全綠，但 GitHub Actions 沒有
`server/.env`、也沒有 `OPENAI_API_KEY` secret，`before()` 的斷言因此觸發，10 題 GS
全數失敗。從這批 commit 推上去之後每一次 push 都是紅的（`33353771901`、`33390120924`），
最後一次綠燈是 `60c3379`。

**這是「無條件進 `npm test`」這個決定沒有考慮到的環境。** 當初的理由是「缺 key 就該
講清楚而不是靜默跳過」，那個判斷對**本機**完全正確；但 public repo 的 CI **結構上
不可能有 key**，除非把老師給的 API key 放進 repository secret。在那之前 CI 固定紅燈，
而一直紅著的 CI 會變成背景雜訊，真正的失敗反而沒人看見——那比這幾題沒在 CI 跑更危險。

修法是把兩種環境分開，**原本的意圖兩邊都保住**：

| 環境 | 行為 |
| --- | --- |
| 本機、無 key | **維持硬失敗**，訊息不變（「這是環境未設定，不是程式壞掉」） |
| CI、無 secret | 跳過 GS，並印出明顯說明（跳過幾題、怎麼開啟）。其餘 703 項照跑 |
| CI、已設 secret | 自動實跑，**不需要改任何程式**（workflow 已把 secret 傳進去） |

判定用 `process.env.CI`（GitHub Actions 固定會設 `CI=true`）。「不設開關」要擋的是
**開發者可以自己關掉**，這裡不是開關，是環境能力偵測——本機沒有任何方式能跳過。

三種情境都實測過；`npm test` 在模擬 CI 的條件下（`CI=true`、無 `.env`、無 key）
**703 pass / 0 fail**，本機仍為 **713 pass / 0 fail**。

**是否要在 CI 真的跑 golden set 是使用者的決定**，因為那要把老師的 API key 放進
一個 public repo 的 secret，並且每次 push 都消耗額度。目前預設不放；要放的話只需在
GitHub 加 secret，程式與 workflow 都不用再動。

## 9. 是否 commit 與 push

見本次 commit 紀錄。工作區另有一條 course-history v1 的工作線，未一併提交。
