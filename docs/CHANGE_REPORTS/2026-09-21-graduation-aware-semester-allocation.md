# 依畢業缺口與剩餘學期分配本學期課程

## 修改日期

2026-09-21

## 問題

排課器雖然會從 `User_Course_History` 排除已通過課程並安排不及格必修重補修，卻沒有把
歷史修課算出的畢業分類缺口接進「本學期要選幾門」。`maxCredits` 因而被當成填滿目標，
「本系優先」又會讓本系選修持續勝過通識與系外選修。真實 demo 帳號在本系選修只缺 6
學分、通識缺 4 學分時，仍排出 9 門／25 學分，且大多是本系選修。

## 解法

沿用原有的版本化畢業規則與 `User_Course_History`，將本系選修、通識、系外選修的缺口
分攤到剩餘學期：

```text
本學期目標 = max(0, 畢業要求 - 已取得學分) / 剩餘學期
```

排課順序改為：

1. 當學期正式必修與不及格必修重補修。
2. 1～3 門本系選修；達到當學期選修學分目標後停止。
3. 依通識與系外缺口分配最多 2 門廣度課，結果只會是 1 通識＋1 系外、2 通識或 2 系外。

「本系優先」保留在同一類別內的排序，`maxCredits` 維持硬上限，但不再要求填滿。類別
候選不足時保留缺口並警告，不用多餘本系選修補滿最低學分。

## 修改檔案

### 後端資料與服務

- `server/src/data/graduationPlanning.js`
  - 共用畢業規則、已取得學分、缺口、剩餘學期與當學期目標的計算。
  - Profile 未設定剩餘學期時，依年級與 active term 推算，並把目前學期算進去。
- `server/src/data/semesterPlanningPreferences.js`
  - 定義 `remainingSemesters` 的讀取、正規化與合併；合法值為 1～8 或 `null`。
- `server/src/data/profileSchema.js`、`server/src/data/profileUpdateValidation.js`
  - 將剩餘學期接入 Profile canonical shape 與 API 型別驗證。
- `server/src/services/memoryService.js`
  - 把剩餘學期存進既有 `preferences_json.values`，更新時保留興趣與個人化開關。
- `server/src/routes/graduation.js`
  - 畢業頁與排課改用同一份缺口計算，避免兩套公式漂移。
- `server/src/services/scheduleService.js`、`server/src/services/constraintService.js`
  - 排課前由後端建立 `graduationPlanning`，只經 trusted context 注入；REST 與 Agent 不能覆寫。
- `server/src/services/agentService.js`
  - 將頂層與各方案的 `graduationPlanning` 保留在 Agent 精簡投影中。

### 排課與多方案

- `server/src/skills/scheduler.js`
  - 新增 required／elective／general／external 類別判定與每學期分配狀態。
  - 正式必修、重補修與明確指定課排完後，依本系選修配額與廣度組合挑課。
  - 配額完成即停止，不再填滿 25 學分；候選不足時不讓通用 repair 塞回額外選修。
  - 回應加入缺口、目標、實際門數／學分及缺少候選的類別。
- `server/src/skills/optimization/scheduleMipModel.js`
  - HiGHS 替代方案加入本系選修／通識／系外門數 equality constraints。
- `server/src/skills/optimization/milpPlanChecks.js`
  - 求解後獨立複查三類門數與 S₀ 一致。

### 前端

- `client/src/pages/SetupPage.jsx`
  - 基本資料加入「剩餘學期」選擇；可留空交由年級與 active term 推算。
- `client/src/pages/SchedulePage.jsx`
  - 顯示本學期畢業缺口分配、剩餘學期、各類目標與實際門數／學分。
- `client/src/components/Schedule/PlanSwitcher.jsx`
  - 加入「無法維持選修／通識／系外門數」的方案合併說明。

### 測試與文件

- 新增 `server/test/graduationPlanning.test.js`。
- 更新 `server/test/agentTools.test.js`、`constraints.test.js`、`milpPlanChecks.test.js`、
  `profileSchema.test.js`、`profileUpdateValidation.test.js`。
- 更新 `docs/API_SPEC.md`、`DATA_SCHEMA.md`、`SCHEDULING_LOGIC.md`、`TEST_PLAN.md`、
  `AI_AGENT_SPEC.md`、`PROMPT_DESIGN.md`、roadmap 與變更報告索引。

## 影響範圍與行為邊界

- 有可用歷史修課、畢業規則與剩餘學期的使用者，正式排課會啟用類別配額。
- 歷史修課仍是 `User_Course_History` 唯一來源；`completed_courses` 沒有復活。
- 已通過排除與不及格必修重補修的既有行為保留。
- 無歷史修課、規則不存在或剩餘學期無法判定時，配額停用並回傳 warning。
- 使用者明確指定課程不會被配額靜默刪除；超過配額時揭露警告。
- #23 仍為部分完成：B～F 課程的正式畢業分類、舊年度科目表、官方逐門認列表等外部
  資料仍未取得。已核對 roadmap 整張表的「狀態」與「相依」，沒有其他列需要改動。

## 測試與驗證

- 前端 `npm run lint`：通過。
- 前端 `npm run build`：通過（Vite 8.0.3，1779 modules）。
- 後端 `server/src/**/*.js` 語法檢查：92 個檔案通過。
- 相關測試：84／84 通過；補上 Agent 投影測試後另跑 43／43 通過。
- 後端全套：1292 項中 1289 通過。3 個檔案層級失敗仍是既有 Windows libuv
  `UV_HANDLE_CLOSING` assertion：`authRoutes.test.js`、`privacyRoutes.test.js`、
  `scheduleRoutes.test.js`；失敗數與本輪開始前相同。
- 真實 MySQL 唯讀核對（demo 帳號 `D1249697`）：要求／已取得／缺口為
  required 63／61／2、elective 28／22／6、general 28／24／4、external 9／11／0；
  大四下推算剩餘 1 學期，當期目標為選修 6、通識 4、系外 0。
- 瀏覽器實機 A/B（同帳號、同候選池）：
  - 舊後端：9 門／25 學分，以本系選修為主。
  - 更新後端：4 門／10 學分；畫面顯示本系選修 2 門／6 學分（目標 6.0）、
    通識 2 門、系外 0 門。
  - 觸發畫面為 `/schedule` 的「自動排課」；瀏覽器 console error／warn 為 0。

## Commit 與 push

功能完成並通過驗證後，使用者已另行明確要求將本批變更 commit 並 push 至
`origin backend`；實際 commit SHA 以 Git history 為準。
