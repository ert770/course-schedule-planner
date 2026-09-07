# 2026-09-07 Roadmap #41（第一段）：tool retry 的 terminal 語意

## 修改日期

2026-09-07

## 背景

對 #37（roadmap #37：commit `4c311c3`／`bc6a48a`）交付的 commit 範圍跑 Codex
adversarial review（`-base f7446d8`），判定 **needs-attention，不建議 ship**。
24 個既有 targeted tests 全過，但直接對抗式重現在 `explanationFaithfulness.js`
本身抓到三個缺陷，詳見 `docs/CHANGE_REPORTS/2026-08-01-personalization-roadmap.md`
的 `## #41` 段落。三個缺陷拆成兩段修補；本報告只涵蓋第一段：**同一操作重試成功
後仍被判定失敗**。第二段（同名不同班次消歧、捏造課程 closed-world 偵測、
evidenceRole）另立報告。

規劃過程含一輪紅隊檢驗，推翻了初版設計「只用 toolName 當 operationKey」的
決定（會遮蔽 `record_schedule_feedback` 對不同課程的部分失敗），改為工具名稱
＋參數雜湊。完整方案見 `C:\Users\yamat\.claude\plans\review-ship-delegated-quasar.md`。

## 修改檔案清單

- `server/src/utils/hash.js`（新增）
- `server/src/services/scheduleFeedbackService.js`
- `server/src/services/explanationFaithfulness.js`
- `server/src/services/agentService.js`
- `server/test/explanationFaithfulness.test.js`
- `docs/PROMPT_DESIGN.md`
- `docs/AI_AGENT_SPEC.md`
- `docs/TEST_PLAN.md`
- `docs/CHANGE_REPORTS/2026-08-01-personalization-roadmap.md`
- `docs/CHANGE_REPORTS/README.md`

## 主要改動內容

### 問題

`ledger.tools`（`explanationFaithfulness.js`）是 append-only 陣列，沒有「這是同
一個邏輯操作的第幾次嘗試」的概念。同一回合內先失敗後成功時，過期的失敗紀錄仍在：

- `auditToolOutcomes` 仍要求揭露「未完成」，即使該操作最終已成功。
- 誠實描述成功的句子（例如「第一次失敗，重試後已成功記錄回饋」）反而被判定
  `TOOL_FAILURE_PRESENTED_AS_SUCCESS`，因為它逐筆掃過整段歷史裡的失敗紀錄。
- `buildSafeFaithfulnessFallback` 用 `[...tools].reverse().find(...)` 找「最近
  一次失敗」，但這是掃整段歷史，不是掃「最近一次仍未完成的操作」——已重試成功
  的操作會一直卡在「這次操作尚未完成，請確認資料後再試」。

### 解法

**operationKey = `${toolName}:${sha256Hex(args).slice(0,16)}`**，在
`agentService.js` 呼叫端計算：只雜湊參數、不記錄參數內容本身，符合既有的
「工具參數已解析（內容不記錄）」政策；解析失敗時退回原始字串雜湊，讓不同的
錯誤輸入仍分屬不同操作。**必須含 args**——若只用 `toolName`，`record_schedule_feedback`
對 A 課失敗、對 B 課成功會被合併成一筆終態成功，A 課的失敗被靜默吃掉，這正是
`agentService.js` 既有註解點名要防的事。

`recordToolEvidence` 新增 `operationKey` 參數（未帶時退回 `toolName`，等同
呼叫端未升級前的舊行為，向後相容）。`ledger.tools` 完全不動、繼續是 append-only
的完整歷史；新增派生的 `ledger.operations`：依 operationKey 分組，用
Map 的 delete → re-set 讓「最後一次被摸到」的操作排在最後，每組取**最後一次
嘗試**（terminal attempt）算出 `terminalStatus`／`terminalError`／
`terminalErrorCode`／`terminalSolverStatus`／`terminalIncomplete`——並把既有
「`run_csp_scheduler` 且 solver 未 `solved`」也算未完成的規則一併帶到終態層，
避免只留三態字串就讓這條規則無聲消失。

`auditToolOutcomes` 與 `buildSafeFaithfulnessFallback` 改讀 `operations` 的
終態，不再看整段歷史。副作用（正是要的）：terminal 成功後不再強制揭露、也
不再誤判宣稱成功，`enforceFaithfulReply` 傳給修正模型的 ledger 投影也一併
加上 `operations`。

`scheduleFeedbackService.js` 的 `deterministicActionId` 原本自己
`crypto.createHash('sha256')...`，改用新抽出的 `sha256Hex()`，避免兩處各寫
一份同模式的雜湊邏輯。

### 新增測試（`server/test/explanationFaithfulness.test.js`，接續既有 F15）

- **F16** 同一操作重試成功後，終態為成功，不得再因為中途失敗要求揭露。
- **F17** 同工具不同操作各自獨立終態，其中一個失敗不能被另一個的成功蓋過——
  對應 Codex 原始重現案例，也是紅隊推翻「只用 toolName 當 key」的直接證據。
- **F18** 排課終態成功但 `solver.status !== 'solved'` 仍視為未完成，確認既有
  規則沒有隨改動流失。

## 影響範圍

- `explanationFaithfulness.js` 的公開介面新增 `ledger.operations`，`recordToolEvidence`
  新增可選參數，兩者皆向後相容（未帶 `operationKey` 時行為與改動前一致）。
- `agentService.js` 是唯一的生產呼叫端，已同步更新；client 端未改動。
- 課程指涉、同名 section 消歧與捏造偵測（Codex 找到的另外兩個缺陷）**不在本次
  範圍**，仍是 #41 第二段，見 roadmap 文件對應段落。

## 測試與驗證結果

- `node --check`：`hash.js`／`scheduleFeedbackService.js`／`explanationFaithfulness.js`／
  `agentService.js`／測試檔全部通過。
- `node --test server/test/explanationFaithfulness.test.js`：22/22（含新增 F16-F18）。
- `node --test server/test/explanationFaithfulness.test.js server/test/agentTools.test.js server/test/prompt.test.js`：118/118。
- `cd server && npm test`：979/979（改動前 976，全數維持通過，新增 3 個）。
- `cd client && npm run build && npm run lint`：通過（client 未改動，仍照 `npm run verify` 規則跑一次）。
- 額外用一支腳本直接呼叫 `sha256Hex()` 與 `recordToolEvidence()`，驗證
  `agentService.js` 呼叫端算 operationKey 的方式（相同參數、不同鍵序 → 相同
  雜湊；不同參數 → 不同雜湊；同 key 兩次紀錄收斂成一個終態為成功的操作；不同
  key 的兩筆紀錄維持兩個獨立操作）與 `explanationFaithfulness.js` 的分組邏輯
  對得上——這一段沒有工具能在瀏覽器裡穩定重現（見下段說明），用腳本補上。
- **瀏覽器 A/B**（`preview_start` server:3001＋client:5173，demo 帳號 `D1249697`，
  真實共用 MySQL）：
  - **A 組**：登入後在 Setup 頁完成真實排課（8 門課、23 學分），於 Chat 追問
    第一門課的課名／教師／學分／推薦原因。模型正確回報課名教師學分，且在本回合
    沒有保留該課程 `recommendationReason` 證據時誠實說「不能臆測」，不編造
    推薦理由——證明不濫發違規、正常路徑不受影響。
  - **B 組**：要求模型在同一回合內「先用一個明顯錯誤的 sectionId 呼叫
    `record_schedule_feedback`（真的會失敗），再用課表中真實 sectionId 記錄
    （真的會成功），並如實回報兩次結果」。伺服器 log 證實第一次呼叫確實回報
    `班次 ... 不在該次推薦實際顯示的課表中`、第二次呼叫確實成功且記錄了互動
    事件；最終回答誠實揭露失敗（安全回答版本），沒有被第二次的成功蓋過去，
    也沒有把失敗說成成功。這是「不同操作各自獨立終態」在真實工具呼叫下的
    直接證明。
  - 兩次額外請求也確認模型在缺乏可驗證 `requestId`／`sectionId`／`planId` 時
    拒絕自行編造，不會為了配合測試指令而捏造識別碼。
  - console 檢查：整段瀏覽器操作只出現帳號切換與 demo persona `D1249196`
    （缺班級資料，非本次改動範圍）造成的既有錯誤，沒有因本次改動新增的
    console 錯誤。
  - **殘留限制（誠實記錄）**：「同一操作、完全相同參數，第一次失敗、第二次
    成功」這個最貼近 Codex 原始重現的場景，在真實聊天路徑中難以穩定重現——
    `record_schedule_feedback` 的驗證邏輯是決定性的，同參數、同曝光狀態下
    重送必得到相同結果，不會自然出現「重試就成功」。該場景以 F16 的直接呼叫
    與上述雜湊腳本共同證明，而非瀏覽器即時重現。

## Commit 與 push

未 commit，未 push（依標準流程，完成並驗證後先回報，commit／push 需使用者明確指示）。
