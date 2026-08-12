# A6 移除 AI Agent 已修課程參數

## 修改日期

2026-08-12

## 修改檔案

- `server/src/services/promptService.js`
- `server/test/prompt.test.js`
- `docs/PROMPT_DESIGN.md`
- `docs/CHANGE_REPORTS/2026-08-12-a6-remove-completed-course-agent-param.md`

## 主要改動內容

- 從 `run_csp_scheduler` 的模型可用參數移除 `completedCourseIds`。
- 不把 `courseHistory` 加入工具參數；修課歷史由後端已載入的 profile 自動直通排課限制。
- 保留 `retakeCourseIds`，讓使用者仍可在當次對話表達重補修需求。
- 新增 prompt 契約測試，禁止 `completedCourseIds` 與 `courseHistory` 再次出現在 system prompt。
- 同步更新 `docs/PROMPT_DESIGN.md` 的工具參數契約與資料流說明。

## 影響範圍

- AI Agent 不再被誘導猜測或編造使用者已修課號。
- Chat 排課仍透過 `agentService.js` 將同一次對話載入的 `prefs` 傳給 `generateForUser()`；A2 只從 `prefs.courseHistory` 建立限制，因此已修排除仍自動生效。
- `agentService.js` 與 `constraintService.js` 的現有實作已符合 A6，本次不修改。

## 測試與驗證結果

- 修改前：system prompt 的 `run_csp_scheduler` 參數清單含 `completedCourseIds`。
- 修改後直接建構 system prompt：`completedCourseIds` 不存在、`courseHistory` 不存在、`retakeCourseIds` 仍存在。
- `cd server && node --test test/prompt.test.js`：通過，33 項測試全數成功。
- 根目錄 `npm test`：通過，277 項測試全數成功，0 項失敗。
- `server/src/**/*.js` 逐檔執行 `node --check`：全部通過。
- 根目錄 `npm run lint`：通過。
- 根目錄 `npm run build`：通過。
- 獨立後端冷啟動：以測試埠 27153 啟動成功，health check 回傳 `ok`；profile 正常載入 53 筆 `courseHistory` 且不含 `completedCourseIds`。
- 瀏覽器 `/schedule` Chat：實際送出「幫我排課表」，畫面正常顯示後端錯誤提示，沒有白畫面；Browser console 無 error 或 warning。
- 同一請求的獨立後端日誌確認：先成功載入含 53 筆 `courseHistory` 的 profile 並建構 2027 字元 system prompt，之後才在呼叫外部模型時收到 404。錯誤為既有的 `gemini-2.5-pro` 已不再提供給新使用者，與 A6 工具參數修改無關。

## Commit 與 Push

- Commit：否。
- Push：否。
