# Roadmap #7：個人化連續評分與動態方案策略變更報告

## 修改日期

2026-09-05

## 問題

原本系統先用五種固定取向各排一份課表，再從結果中選出較符合使用者偏好的一份。這會讓
偏好主要影響「最後選哪一份」，卻不一定影響每一門課是否入選；沒有表達涼課偏好的人也會
收到涼課方案，固定名稱很容易被誤解成使用者真的偏好該方向。

另一個問題是同一套偏好資訊散在方案權重、方案比較與文件中。方案重複時，畫面還會直接把
原因說成候選課太少，但重複結果本身只能證明不同取捨得到同一組課，無法單獨證明原因。

## 新的解法

系統現在先建立這位使用者自己的偏好權重，再用同一份權重挑課及比較方案。使用者想修涼課，
涼度會直接影響入選課程；使用者想挑戰難課，同一個涼度訊號會反方向計分。歷史互動只會加強
已明確表達的方向，不會自行替使用者新增偏好。

方案改為依當次偏好動態產生：先提供綜合方案，再為已表達的偏好提供加重比較方案，最後提供
較多學分方案。沒有表態的取向不會憑空出現，方案總數維持有限。每份結果也會保留當時實際用過
的權重與版本，讓推薦理由、回饋學習和日後重播都能核對。

## 修改檔案

### 後端評分與排課

- `server/src/skills/scoringPolicy.js`（新增）：定義 `personalized-scoring-v1`、三軸權重範圍、
  特徵正規化與分數元件。
- `server/src/skills/planStrategies.js`（新增）：依非零偏好軸建立可重現、最多五個的搜尋策略。
- `server/src/skills/scheduler.js`：移除固定 `PLAN_VARIANTS`／`VARIANT_WEIGHTS`，讓單門課排序
  消費版本化 policy；保留必修絕對優先；方案輸出增加 `generationPolicy`／`stopWhen`；
  `planDiversity` 增加結構化原因。
- `server/src/data/constraintSchema.js`：8 個內容偏好新增 `flag`，讓 scorer 直接讀取正式 soft
  constraint 的 `weight`，不再另存一份常數。
- `server/src/skills/recommendationReason.js`：理由版本升為 `2026-09-05.v2`，新增實際
  `scoringPolicy` 快照。

### 曝光、學習與 Agent

- `server/src/services/scheduleService.js`：推薦曝光保存每個顯示方案的 `planPolicies`。
- `server/src/data/interactionEventSchema.js`：正規化及驗證 policy 版本、權重範圍、係數、停止
  條件和方案對應；舊事件缺少欄位時維持相容。
- `server/src/services/interactionEventService.js`：模型版本改為 `personalized-scoring-v1`，
  回放來源時核對方案策略；非曝光事件不能自行帶入 exposure context。
- `server/src/skills/preferenceLearning.js`：新版混合策略的接受事件不再依方案 ID 捏造單一軸
  投票，舊固定方案事件維持原有語意。
- `server/src/services/promptService.js`：告知 Agent 偏好會影響實際選課，並要求依 policy 和
  指標說明動態方案，不從 ID 猜測偏好。

### 前端

- `client/src/components/Schedule/PlanSwitcher.jsx`：方案合併說明改讀結構化原因，不再把重複
  結果直接宣稱為候選池不足。

### 測試

- 新增 `server/test/scoringPolicy.test.js`、`server/test/planStrategies.test.js`。
- 修改 `server/test/scheduler.test.js`、`server/test/recommendationReason.test.js`、
  `server/test/scheduleService.test.js`、`server/test/interactionEventSchema.test.js`、
  `server/test/interactionEvents.test.js`、`server/test/preferenceLearning.test.js`。

### 文件

- 修改 `docs/SCHEDULING_LOGIC.md`、`docs/API_SPEC.md`、`docs/DATA_SCHEMA.md`、
  `docs/PROMPT_DESIGN.md`、`docs/TEST_PLAN.md`。
- 修改 `docs/CHANGE_REPORTS/2026-08-01-personalization-roadmap.md`：#7 改為完成；核對整張
  進度表後，#36 改為前置相依全數解除，#32 不再卡 #7，Gate 3 改為通過。
- 新增本變更報告。

## 主要工程細節

- 原始使用者權重為 `{ interest, compact, easy }`；非零軸基準絕對值為 1，可用 learned boost
  加強至 2。`easy` 可為負值，表示挑戰難課。
- 興趣以關鍵字命中率正規化；涼度以 0～100 分移到以 0 為中性的有限尺度；集中度以新課程
  是否沿用既有上課日計算有限增量。三軸再乘上固定 preference scale，避免不同原始量尺互相
  壓過。
- 替代策略最多把單一軸加重 1.5 倍，原始使用者 policy 仍是方案主推排序的共同評分基準，
  避免策略拿自己的加重權重替自己評分。
- 方案 ID 改為 `personalized`、`personalized_<axis>`、`personalized_credits`；實際權重保存在
  `generationPolicy`，ID 只做策略識別。
- `Interaction_Events` 的 JSON envelope 新增 `planPolicies`，未修改資料表欄位與事件 schema
  版本，因此不需要 migration。歷史事件正規化為空陣列並保留既有回放路徑。

## 影響範圍

- 影響 Dashboard、Schedule 與 Chat 共用的排課結果：偏好會直接改變可競爭課程的排名與入選。
- 影響方案 ID、方案數、推薦理由版本、排課模型版本與曝光 JSON 的附加欄位。
- 不改變 API endpoint、AI tool call 參數、MySQL table schema、硬性限制、必修／重補修優先、
  學分上下限或資格規則。

## 測試與驗證結果

- `cd client && npm run lint`：通過。
- `cd client && npm run build`：通過，Vite 轉換 1,776 個模組。
- `server/src/**/*.js` 全檔 `node --check`：通過。
- `npm test`：933/933 通過，包含自然語言 golden set 8/8。
- `git diff --check`：通過。
- 瀏覽器實機 A/B（本機 client 5173、server 3001，demo 帳號 Dashboard）：
  - 涼課優先：8 門、23 學分、偏好符合度 72%，包含「系統安全」「電腦視覺與擴增實境」。
  - 挑戰難課：8 門、23 學分、偏好符合度 28%，改為「人工智慧自然語言導論」「嵌入式系統」。
  - 兩組輸入使用相同帳號、候選課與評價資料；實際入選課程不同，證明偏好已進入單門課排序。
  - 兩個難度標籤在驗收後都已還原為原始未勾選狀態。
  - 瀏覽器 console：0 error、0 warning。

瀏覽器產生課表時依既有產品行為寫入推薦曝光事件；沒有接受方案、儲存課表或保留測試偏好。

## Commit 與 Push

- Commit：是，本次程式、測試、文件與本報告一併提交。
- Push：是，推送至 `origin/backend`；commit SHA 以 Git history 與執行後回報為準。
