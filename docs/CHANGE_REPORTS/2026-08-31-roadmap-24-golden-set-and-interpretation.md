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
| `server/src/services/requirementPreflight.js` | 從 2 項檢查擴充到 11 項；新增時段可用性計算與理解回講一致性檢查 |
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

`checkPreflightContradictions()` 從 2 項擴充到 11 項。完整清單見
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
`flexible`、`creditGoal`、`notMentioned`、`sourcePhrases`）。因為是 JSON Schema
的 `required`，格式由 API 層保證，不是靠 prompt 自律。

伺服器做三件事：**檢查回講與實際參數是否自相矛盾**（說了「絕對不排早八」就必須
同時設好 `noMorningClasses` 與 `nonNegotiablePreferenceIds`，對不上退回修正）、
**隨結果回傳給前端顯示**、**不寫 log 也不持久化**（`sourcePhrases` 含使用者原話，
#33 明訂 log 只記 metadata 不記內容）。

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

- `npm test`：**670 pass / 0 fail**（第一輪後 615，新增 55 項），**8.3 秒**。
- **我先前的估計錯了**：我預估加入 golden set 後 `npm test` 會從 9 秒變成 1～2 分鐘。
  實際是 8.3 秒——並行加上第一次就答對，比預期快得多。
- `client`：`npm run build` 成功、`npm run lint` 無輸出。

### Golden set 實際通過率

**8/8（100%）**，總耗時約 6 秒。

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

```json
{
  "nonNegotiable": ["絕對不排早八，無論如何不讓步"],
  "flexible": ["午休時段可以彈性一點", "盡量集中排課", "偏好上機實作考試、全英授課與學到較多知識"],
  "creditGoal": "12～25 學分",
  "notMentioned": ["不能上課的其他日期與節次", "一定要修的課程或班次", "已選課程",
                   "是否要排除晚間課", "是否有其他必修或資格限制"],
  "sourcePhrases": { "noMorningClasses": "絕對不要早八，這點無論如何都不能讓步",
                     "lunchBreakFree": "午休倒是可以彈性一點", … }
}
```

強度分類正確（早八在 `nonNegotiable`、午休在 `flexible`），`notMentioned` 列出五項
它沒有資訊的部分而沒有自行假設。排出來的課表也確實沒有早八。

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
| 2 | 資料不足與矛盾案例會先澄清 | **結構性矛盾完整**（11 項，清單即定義）；**語意矛盾明確不宣稱** |
| 3 | 更正 department／grade／className 後 scope 使用新值 | 第一輪已完成 |
| 4 | 同一句需求重跑能得到相同結構化結果，或清楚標記 LLM 不確定性 | **後半句完成**。理解回講讓解析看得見、可被使用者當場糾正、可被 golden set 量測。**前半句仍不宣稱**：無法讓模型自身的解析變成確定性的（此模型不吃 `temperature`），這一點沒有因為本輪而改變 |

## 7. 已知限制

- Golden set 每次 `npm test` 都會消耗 API 額度。目前 8.3 秒、8 次呼叫，成本可接受；
  若之後題庫變大或開始間歇性變紅，會照實回報並重新討論執行方式。
- 語意矛盾偵測不在範圍內，且明確不宣稱。

## 8. 是否 commit 與 push

見本次 commit 紀錄。工作區另有一條 course-history v1 的工作線，未一併提交。
