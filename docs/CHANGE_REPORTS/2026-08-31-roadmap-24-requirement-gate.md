# 2026-08-31 Roadmap #24：永久寫入確認閘門、身分更正與排課前矛盾偵測

## 1. 修改日期

2026-08-31

## 2. 為什麼做這件事

`#24` 的相依（`#18`、`#21`）都已完成。但盤點原文之後發現，它字面上寫的
「同義詞／否定／程度詞正規化」與「結構化需求物件」，在 2026-08-30 遷移到 OpenAI
原生 tool calling 之後**大部分已由 JSON Schema 加模型本身承擔**——再自建一套平行的
正規化管線只會與模型的工作重複。

真正還沒解決的，是**系統自己違反 `#24` 所訂規範**的四個具體缺口，全部經程式碼實證：

1. **`update_preferences` 未經確認就永久寫入。** `agentService.js` 直接呼叫
   `memoryService.updateUserPreferences()`，後者 `upsertByField` 立即寫進 MySQL。
   唯一的保護是 system prompt 裡一句模型可以無視的叮嚀。這直接違反 `#24` 自己的
   條文「使用者確認前不得永久更新偏好」。
2. **模型完全沒有辦法更正系所／年級／班級。** `update_preferences` 的 schema 沒有
   這三個欄位，而 schema 是 `additionalProperties: false`。`#24` 驗收標準第三條
   因此無從滿足。
3. **`ctx.studentScope` 每回合只建一次**，中途有工具改了 profile 也不會重建。
4. **chat 的放寬階梯是結構性死碼。** `allowRelaxation` 在 `constraintService.js`
   → `scheduler.js` → `tryRelaxationLadder()` 完整接通，卻沒有出現在工具 schema
   裡。這才是 roadmap 點名的「絕對不上早八 vs 必要時可早八」至今無從實作的真正原因。

另外 `scheduleService.js` 建完 `studentScope` 後完全沒檢查 `resolved`——系所不明時
會靜默排課，而 `courseScope.js` 自己的註解明講那種情況不得猜測。

**本次不做**：`preferredMaxCoursesPerDay` 軟性偏好。roadmap 原文明講
「只有使用者提出後者需求時才建立獨立欄位與後續開發」，現在做等於超出文件要求。

## 3. 修改檔案清單

### 後端

| 檔案 | 改動 |
| --- | --- |
| `server/src/services/pendingChangeService.js` | **新增**。待確認變更的暫存／確認，含 `turnId` 跨回合規則與供 prompt 取回 token 的 `peekPendingChange()` |
| `server/src/services/requirementPreflight.js` | **新增**。排課前的純函式矛盾偵測 |
| `server/src/services/agentService.js` | 兩個寫入工具改走 `runConfirmedWrite()`；新增 `update_student_profile` 派送與同回合 `ctx.studentScope` 重建；`run_csp_scheduler` 前加 preflight；新增 `mergePreferenceTags()`；每回合產生 `turnId`；待確認變更補進 prompt |
| `server/src/services/promptService.js` | `update_preferences` 加 `confirmationToken`；新增 `update_student_profile` 工具；`SCHEDULER_PARAMETERS` 補 `allowRelaxation` 與 `nonNegotiablePreferenceIds`；system prompt 新增兩段式確認與強度判讀兩節、待確認變更區塊 |
| `server/src/services/constraintService.js` | 透傳 `nonNegotiablePreferenceIds`（純 request，不從 prefs 回填） |
| `server/src/skills/scheduler.js` | `tryRelaxationLadder()` 跳過使用者指名不可放寬的偏好；export `buildClarification` 供形狀相容測試 |

### 測試

`server/test/pendingChangeService.test.js`（新增，PC1-PC5）、
`server/test/requirementPreflight.test.js`（新增，RP1-RP4）、
`server/test/requirementGate.test.js`（新增，AG9-AG12）、
`server/test/agentTools.test.js`（AG5 改測兩段式的「確認之後」）、
`server/test/scheduler.test.js`（X15-X16）、
`server/test/prompt.test.js`（P4-P5，並更新參數與工具清單）。

### 文件

`docs/AI_AGENT_SPEC.md`（順手修掉仍列著已移除的 `final_answer` 的過時工具表）、
`docs/PROMPT_DESIGN.md`、本報告與索引。

## 4. 主要改動內容

### 4.1 兩段式確認：真正的保證是「跨回合」，不是 token

第一次呼叫只暫存並回傳 `proposedChanges` 與 `confirmationToken`，**不寫入任何東西**；
模型必須把內容講給使用者，取得同意後帶 token 再呼叫一次。

實作過程中發現 token 本身**擋不住**真正該擋的事：模型可以在同一回合連續呼叫兩次
工具，使用者在那中間根本沒有機會說話。因此 `consumePendingChange()` 會比對
`turnId`，**拒絕同一回合內自己暫存又自己確認**。這是機制保證，不依賴模型自律。

寫入時採用**當初暫存的內容**，第二次呼叫夾帶的其他欄位一律忽略——否則模型可以
拿一個使用者確認過的 token 偷渡他從沒同意過的變更。同樣的防護思路已存在於
`scheduleFeedbackService`（不信模型自報的 sectionId，只信伺服器的曝光紀錄）。

**瀏覽器驗收時踩到的坑**：第一版模型永遠走不到寫入那一步，因為工具結果不跨回合
保存，下一回合它手上沒有第一回合拿到的 token，於是又重新暫存一次。**與 2026-08-30
`requestId` 完全相同的根因**。修法一致：由伺服器把待確認變更與 token 補進 prompt。

### 4.2 身分更正與同回合 scope 重建

新增 `update_student_profile`（系所／年級／班別），與偏好分開是因為「更正我是誰」
與「以後都這樣排」對使用者是兩件事。寫入路徑直接沿用 `updateUserPreferences()`
——它本來就正確處理這三個欄位，**不需要新增任何 memoryService 函式**。

確認成功後 **寫回 `ctx.studentScope` 而不是區域變數**：`ctx` 在同一次 `handleChat`
迴圈中是同一個物件參考，同回合後續的 `query_course_db` 因此立即改用新範圍。

### 4.3 偏好強度：把死碼接通

`SCHEDULER_PARAMETERS` 補上 `allowRelaxation`（接通既有階梯）與
`nonNegotiablePreferenceIds`（即使允許放寬，這幾項這次也不准動）。
`tryRelaxationLadder()` 只多一行過濾，**完全不動 `constraintSchema.js` 的分類**
——那是「這個限制本質上可不可以放寬」，這裡處理的是「這一次使用者允不允許」。

### 4.4 排課前的矛盾偵測

`checkPreflightContradictions()` 檢查兩件不必真的排一次課就能斷定的事：系所／年級
無法解析、使用者指名必修的課落在他自己的封鎖時段裡。回傳形狀與 `#22` 的
`buildClarification()` 完全一致，模型既有指令可原封不動套用；有一項測試專門釘住
兩者欄位一致。刻意**不重複** `#22` 已覆蓋的 Z5（不存在的課程 id）。

### 4.5 附帶修掉的資料遺失（既有缺陷，瀏覽器驗收才發現）

`update_preferences` 只送幾個旗標時，`database.js` 的 `extractTags()` 找不到明確的
標籤陣列就退回 `flagsToTags(payload)`，用「這次這批旗標」**重建整份
`preference_tags`**。實測 demo 帳號的標籤從 5 個被砍成 2 個，
`#上機實作考試`／`#全英授課`／`#學到許多知識` 三個使用者從沒提過的偏好被靜默刪掉。

這是既有行為（改動前直接寫入時同樣會發生），但 `#24` 的主旨正是「不要在使用者沒
同意的情況下動他的資料」，因此一併修掉：新增 `mergePreferenceTags()` 把現有標籤
換算回旗標、疊上這次真正變更的旗標、再換算成完整清單明確送出。修正**限縮在
`agentService`**，沒有動 `database.js`（該檔目前有另一條 course-history 工作線）。

## 5. 影響範圍

- `/api/chat`：新增一個工具；兩個寫入工具的行為由「立即寫入」改為「兩段式」。
  回應欄位不變。
- 排課引擎：只多一行過濾，且僅在 `nonNegotiablePreferenceIds` 非空時生效。
- 前端、隱私與互動記錄路徑完全沒有改動。
- 沒有資料庫 schema 或遷移變動；待確認變更放行程內記憶體（比照
  `utils/rateLimiter.js` 已寫明的理由）。**代價**：開發時 `node --watch` 重啟會讓
  待確認的變更失效，使用者需重講一次。那是自我修復的失敗，不會造成靜默寫錯。

## 6. 測試與驗證結果

### 自動化

- `npm test`：**615 pass / 0 fail**（改動前 565，新增 50 項）。
- `node --check`：所有改動的後端檔案通過。
- `client`：`npm run build` 成功、`npm run lint` 無輸出。

### 瀏覽器實機（真實 MySQL、真實 OpenAI 呼叫）

**A/B 對照 1：確認閘門（本次核心證據）**

送出「以後幫我把學分上限都設成 18。」

| 時間點 | Agent 回覆 | 資料庫 `max_credits` | `preference_tags` |
| --- | --- | --- | --- |
| 送出後、確認前 | 「目前尚未寫入。請確認是否要套用這項變更？」 | `null` | 5 個 |
| 回覆「對，確認。」後 | 「已完成更新。」 | **18** | **仍是 5 個** |

兩次直接查 MySQL 的對照，證明的是機制而不是模型的說法。標籤數不變同時證明 4.5
的資料遺失也修好了（修正前同樣操作會砍到剩 2 個）。

**A/B 對照 2：身分更正 + 同回合 rescope（驗收標準第三條）**

先把 demo 帳號的系所改成「電機工程學系」，然後在聊天說「我其實是資訊工程學系
三年級」→ Agent 先詢問確認 → 回覆「對，請更正，然後順便幫我查一下系上有哪些
選修課」。**同一回合**回傳的課程是 `資訊三合` 的課（人工智慧導論、程式語言、
嵌入式系統、資訊安全管理…），不是電機系的課——scope 確實在回合中途重建了。

**驗證 3：排課前的資料檢查**

把系所設成對照表認不得的值（`buildStudentScope` 回 `resolved:false`）後要求排課，
Agent 回「你的系所名稱目前對不到系統資料，因此還不能正確判斷下學期必修課」，
伺服器 log 出現 `[Preflight] 排課前偵測到矛盾或資料不足，改為澄清`，排課引擎
完全沒有被呼叫。

**收尾**：demo 帳號的系所、班別、年級、學分與偏好標籤全部還原為原始值並已查證。

### 過程中的一次誤判（如實記錄）

第一次驗證時我看到 `target_credits_max` 沒變，就判定「模型在謊報」。實際上寫入端
與讀取端用的都是 **`max_credits`** 這個欄位（`database.js` 的 `targetCreditsMax`
對應 `max_credits`），`target_credits_max` 在這條路徑上根本沒被使用——是我查錯欄位。
模型當時說的是實話。

## 7. 誠實的驗收標準對照

| # | `#24` 驗收標準 | 結果 |
| --- | --- | --- |
| 1 | 自然語言 golden set 可正確轉成結構化需求 | **不宣稱完成**。NL→結構化參數已由模型 + JSON Schema 承擔；要對模型輸出做 golden set 斷言需要真實模型呼叫，且模型可被 `OPENAI_MODEL` 換掉，`npm test` 無法誠實保證。可測的是 schema 本身與下游的驗證層 |
| 2 | 資料不足與矛盾案例會先澄清 | **部分完成**。未解析 scope 與必修撞封鎖時段會強制澄清；「任何可想像的自然語言矛盾」無法窮舉，不宣稱 |
| 3 | 更正 department／grade／className 後 scope 使用新值 | **完成**（同回合與跨回合皆可，已實機驗證） |
| 4 | 同一句需求重跑得到相同結構化結果 | **不宣稱完成**。無法讓模型自身的解析變確定（此模型不接受 `temperature`）。本次新增的是**解析下游全部確定性**：確認閘門、scope 重建、放寬過濾、preflight 皆為純函式，同輸入必同輸出 |

## 8. 已知限制

- `update_preferences` 的 schema 有 `noEveningClasses`，但 `preferenceTags` 沒有
  對應標籤、`database.js` 也沒有對應欄位，這個偏好實際上寫不進去。既有問題，
  本次未處理（不在 #24 範圍，且修法牽涉 schema 與欄位設計）。
- 待確認變更放記憶體，多行程部署時不通用。目前是單一 process 部署。

## 9. 是否 commit 與 push

見本次 commit 紀錄。工作區另有一條 course-history v1 的工作線（`database.js`、
`memoryService.js`、routes、migration 004），**不屬於本次改動，未一併提交**。
