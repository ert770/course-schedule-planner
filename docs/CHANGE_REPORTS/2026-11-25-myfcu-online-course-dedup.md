# 2026-11-25 MyFCU 課名 (Online) 去重

| 修改檔案 | 內容 |
| --- | --- |
| `server/src/services/courseHistoryAutoImport.js` | 本機 SessionImport 遇到與既有紀錄同課號、同學年、同學期、同已知數字成績，且課名只差結尾 `(Online)` 的紀錄，計入已匯入跳過。 |
| `server/test/sessionHistoryImport.test.js` | 驗證預檢與確認匯入結果一致、正向案例沒有寫入，以及課號、學年、學期、成績或名稱不同的案例不套用例外。 |
| `docs/API_SPEC.md` | 記錄本機 SessionImport 的比對條件。 |

影響範圍為 Windows 本機 MyFCU 快照預檢與確認匯入。例外使用已存的目錄課號或來源課號核對同一次修課。

## 驗證

- 瀏覽器使用虛構 MyFCU 快照及實際匯入比對函式。只有課名後綴不同時顯示新增 0、跳過 1、衝突 0，匯入按鈕可用。只改成績時顯示新增 0、跳過 0、衝突 1，匯入按鈕停用。兩種情境皆無 console 錯誤或警告。
- SessionImport 測試 12 項通過。後端語法檢查、前端 build、lint 與 `git diff --check` 通過。完整 CI 測試 1,988 項通過、0 失敗、14 跳過。
- 測試後重啟本機前後端。健康檢查正常，設定回報本機 SessionImport 啟用，後端僅監聽 `127.0.0.1`。重啟清除舊預覽快照，真人資料需要重新擷取。

本次未執行 commit 或 push，驗收未提交真人修課資料。
