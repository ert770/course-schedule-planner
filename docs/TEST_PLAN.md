# 測試規劃

## 驗證指令

前端 build：

```bash
cd client
npm run build
```

前端 lint：

```bash
cd client
npm run lint
```

後端語法：

```bash
cd server
node --check src/app.js
```

## 排課邏輯測試

| 編號 | 情境 | 預期結果 |
| --- | --- | --- |
| S1 | 兩門加選課同天同時段 | 判定衝堂 |
| S2 | 兩門關注課同天同時段 | 不判定衝堂 |
| S3 | 必修課與選修衝堂 | 優先保留必修 |
| S4 | 必修不及格且本學期有開課 | 優先排入重補修 |
| S5 | 技術應用類核心選修剛好 12 學分 | 可完成核心選修要求 |
| S6 | 路徑缺 1 或 3 學分 | 可跨類別補足 |
| S7 | 設定不上早八 | 不排入第一節開始課程 |
| S8 | 設定週一空堂 | 週一不排正式加選課 |
| S9 | 學分低於最低門檻 | 回傳警告或補課建議 |
| S10 | 無法滿足所有硬性限制 | 回傳失敗原因 |
| S11 | request 送空陣列偏好，但使用者有已儲存偏好 | 退回已儲存偏好，不得清空 |
| S12 | request 送非空陣列偏好 | 覆蓋已儲存偏好 |
| S13 | 表達興趣偏好且候選充足 | 興趣方案即使學分較少仍為 `plans[0]` |
| S14 | 未表達任何軟性偏好 | `hasExpressedPreference` 為 false 並回傳警告 |
| S15 | Agent 送 `mondayFree` | 展開為週一 1-14 節封鎖並與既有封鎖時段合併 |
| S16 | 候選課程全為關注狀態 | `success` 為 true、`watchOnly` 為 true、回傳關注課程與對應訊息 |
| S17 | 指定必修排不進去且有關注課程 | `success` 為 false，但 `watchedCourses` 仍完整回傳 |
| M1 | 多時段課程與其**第二個以後**的時段重疊 | 判定衝堂 |
| M2 | 多時段課程與任一時段皆不重疊 | 不判定衝堂 |
| M3 | 封鎖時段命中多時段課程的非第一段 | 該課程被排除且理由為封鎖時段 |
| M4 | 多時段課程跨多天 | 單日課程數上限對每一天分別計算 |
| W1 | 週六課程 | 可被排入且顯示於課表 |
| W2 | 週日課程 | 可被排入且顯示於課表 |
| W3 | 課表顯示 | 課表格含週一至週日共七欄 |

## AI Agent 契約測試

| 編號 | 情境 | 預期結果 |
| --- | --- | --- |
| P1 | `buildSystemPrompt` 輸出 | 含 `run_csp_scheduler` 的所有可用參數 |
| P2 | 使用者有已儲存興趣關鍵字 | prompt 的偏好摘要列出這些關鍵字 |
| P3 | `agentService` 新增排課參數 | `promptService.js` 與本文件同步更新 |

## API 測試

| API | 測試項目 |
| --- | --- |
| `/api/health` | 回傳 `status: ok` |
| `/api/auth/login` | 正確登入、錯誤密碼、缺少欄位 |
| `/api/courses` | keyword、department、category、period 查詢 |
| `/api/schedule/generate` | 無 courseIds、指定 courseIds、偏好限制 |
| `/api/schedule/validate` | 有衝堂、無衝堂 |
| `/api/profile` | 讀取與更新偏好 |
| `/api/reviews/easy` | limit 正常運作 |
| `/api/graduation/:studentId` | 學分缺口與推薦 |
| `/api/chat` | 無 message、正常 message、無 API key |

## 前端操作測試

- 登入後導向 onboarding 或 dashboard。
- 初始偏好可儲存。
- 課程搜尋可查詢並顯示結果。
- 儀表板可產生課表。
- 課表格可顯示不同星期與節次。
- 畢業學分頁可顯示缺口。
- AI 聊天輸入後可顯示回覆。

## AI Agent 測試

| 情境 | 預期 |
| --- | --- |
| 問「幫我排不要早八」 | 呼叫排課工具並套用 `noMorningClasses` |
| 問「找涼課」 | 查詢評價或 easy courses |
| 問不存在課程 | 不得編造，需說明查無資料 |
| 問畢業門檻 | 回答 128 學分與分類要求 |
| 資料不足 | 說明限制並要求補充 |

## 每次開發完成驗收

1. 確認相關文件已更新。
2. 執行前端 build。
3. 執行必要的 lint 或語法檢查。
4. 確認 `.env` 與 `node_modules/` 沒有被加入 Git。
5. 若修改排課邏輯，至少執行排課測試案例 S1-S10。

