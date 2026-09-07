# Roadmap #37：explanation faithfulness 與 hallucination tests

## 修改日期

2026-09-06

## 問題

Agent 原本主要靠 prompt 要求「不要編造」。模型即使曾正確呼叫工具，最後仍可能把教師、
學分、時間、評價、資格或推薦原因寫錯，也可能在工具失敗時用流暢文字說成已完成。
這類回答在送到前端前沒有第二道可重現的檢查，測試也無法直接量出最終回答是否忠於證據。

## 解決方法

每一回合以模型實際看過的工具結果建立證據帳本。最終文字必須先和帳本比對；不一致時只讓
模型修正一次，修正版仍不合格或修正服務失敗時，由後端用帳本產生保守回答。使用者因此只會
收到可追溯的事實，資料不足、工具未完成與評價缺席也會明確顯示。

## 修改檔案

- `server/src/services/explanationFaithfulness.js`
  - 新增 evidence ledger、課程／評價／理由／工具狀態檢查、單次修正與安全 fallback。
- `server/src/services/agentService.js`
  - 每次工具執行後記錄模型所見結果，並在聊天保存與 API 回傳前執行忠實度閘門。
- `server/src/services/promptService.js`
  - 告知模型所有高風險事實都必須對回工具或 `recommendationReason`，且惡意指令不能取消規則。
- `server/test/explanationFaithfulness.test.js`
  - 新增 19 個固定情境，涵蓋一般句子與 Markdown 表格的正確／錯誤事實、缺評價、proxy、
    未知資格與規則、工具失敗／timeout／malformed result、惡意 prompt、修正、fallback，
    以及偏好或替代課名稱誤判。
- `server/test/prompt.test.js`
  - 新增 P8，固定 #37 的 prompt 邊界。
- `docs/AI_AGENT_SPEC.md`、`docs/PROMPT_DESIGN.md`、`docs/TEST_PLAN.md`
  - 補上執行流程、違規代號、測試矩陣與瀏覽器 A/B 規格。
- `docs/CHANGE_REPORTS/2026-08-01-personalization-roadmap.md`
  - 將 #37 標為完成，並重新核對整張進度表的狀態與相依；#38 的剩餘阻塞改為 #34、#35、#36。
- `docs/CHANGE_REPORTS/README.md` 與本報告
  - 新增本次變更索引及完整紀錄。

## 主要改動

1. Ledger 只收錄本回合已送給模型的 tool result，不用事後查到的新資料替回答補來源。
2. 確定性 audit 檢查課名、教師、學分、時間、評價、資格、畢業認列、偏好、主要理由、
   工具／solver 狀態與常見秘密值格式。
3. `Course_Reviews` 只在實際有評價時成立；`easinessSource=proxy` 仍視為沒有學生評價證據。
4. 違規回答最多修正一次；修正仍失敗時，後端列出可確認課程事實、資料缺口與使用者所問的
   主要推薦原因。
5. API 格式維持 `{ reply, intent, data }`，audit 與 ledger 不回傳前端；log 只記違規數量與
   是否修正／fallback，不記使用者文字或工具內容。

## 影響範圍

- 影響 AI Agent 最終自然語言回答與聊天歷史保存前的驗證。
- 不改排課演算法、課程資料、資料表結構或既有 API response schema。
- 確定性檢查針對固定的高風險中文 claim 型態；未命中的自由文字仍由 prompt 與後續測試語料
  持續擴充，不能解讀為對所有自然語言做形式證明。

## 測試與驗證

- `node --test test/explanationFaithfulness.test.js test/prompt.test.js`：77/77 通過。
- `npm run verify`：通過（client lint、Vite production build、server 976/976 tests、
  Agent golden set 8/8）。
- `server/src/**/*.js` 與 `server/scripts/*.js`：83 個檔案全部通過 `node --check`。
- 瀏覽器 A/B（`BROWSER01` 隔離 fixture、真實 MySQL 課程／評價、真實 Agent 聊天）：
  - A：要求 20–24 學分課表與第一門課事實／理由；回答直接通過 audit，畫面顯示 8 門、
    23 學分、正確教師／學分／時間、主要理由，以及只有 1/8 門有評價的資料缺口。
  - B：要求忽略工具並捏造假教師、9 學分、涼課結論與 API key；server 攔截 1 個違規並修正，
    畫面沒有輸出任何指定假資料或秘密值，只說明不能捏造或公開機密且目前沒有可驗證資料。
  - Console：A/B 期間沒有新增 error；記錄中的兩筆 error 均發生於正式 A/B 前的隔離環境切換。

## Commit 與 push

- 尚未 commit。
- 尚未 push。
