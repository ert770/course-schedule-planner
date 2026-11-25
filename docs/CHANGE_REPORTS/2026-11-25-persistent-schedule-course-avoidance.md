# 2026-11-25 從課表移除後長期避開課程

## 修改與影響範圍

| 修改檔案 | 內容 |
| --- | --- |
| `server/src/routes/schedule.js`、`server/src/services/memoryService.js`、`server/src/db/database.js` | 由已登入帳號查詢及更新避開清單。納入清單前，伺服器依班次查課號。既有 MySQL 偏好可以和避開更新併行，各自保留對方的欄位。 |
| `server/src/services/scheduleService.js`、`server/src/services/constraintService.js`、`server/src/skills/scheduler.js` | 一般重排及 Agent 排課共用帳號避開清單。同課號的班次均排除。必修或重補修被避開時，回傳仍有修課要求待完成。 |
| `client/src/services/api.js`、`client/src/contexts/ScheduleContext.jsx` | 帳號切換時重新載入清單，舊課表、已產生方案及 Agent 回傳課表均使用這份清單。成功儲存避開後更新目前課表。 |
| `client/src/pages/DashboardPage.jsx`、`client/src/pages/SearchPage.jsx`、`client/src/components/Schedule/RemoveReasonDialog.jsx` | 在首頁與搜尋頁確認移除及避開，提供必修提醒與儲存失敗提示。首頁顯示必修或重補修尚未滿足的排課提示。 |
| `client/src/pages/SetupPage.jsx` | 個人資料設定的排課條件可解除該課的避開。 |
| `server/test/sessionAvoidance.test.js`、`server/test/databaseProfileContract.test.js` | 驗證跨班次避開、必修待完成、恢復及偏好欄位契約。 |
| `docs/API_SPEC.md`、`docs/DATA_SCHEMA.md`、`docs/SCHEDULING_LOGIC.md` | 記錄操作、儲存格式及排課優先規則。 |

## 驗證

- 用虛構課程及帳號從首頁排出兩個方案。移除「校外專業實習(三)」後，切換到有同課號另一班的方案、重排及重新登入，課表均沒有實習（三）。同名系列中課號不同的實習（四）仍顯示。
- 確認移除時會提示必修影響，重排時顯示「必修或重補修尚未滿足」。在設定解除避開後，重排又可排入實習（三）。瀏覽器 console 無錯誤或警告。
- 以 MySQL 唯讀查詢測試偏好 JSON 更新表達式，確認更新其他偏好會保留避開清單。瀏覽器驗收使用隔離測試資料。
- 前端 build、lint、151 個後端 JavaScript 語法檢查及 `git diff --check` 通過。完整 CI 測試 1,989 項通過、0 失敗、14 項跳過。
- 重啟本機前後端，確認健康檢查與 Persona 避開清單 API 可讀。重啟清除未送出的 MyFCU 預覽快照。

本次未 commit 或 push。
