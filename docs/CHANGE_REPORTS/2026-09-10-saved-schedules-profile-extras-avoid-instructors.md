# 2026-09-10 Saved_Schedules／Profile 擴充 migration 與避開教師限制

> **後續狀態（2026-09-11 更新）**：本報告描述的 Migration 007 已於 2026-09-11
> 實際套用至共用 MySQL，`avoidInstructors` 亦已接上 Profile 持久化讀寫，詳見
> [課程年級、Profile 擴充與已存課表接線](./2026-09-11-course-grade-profile-saved-schedules.md)。
> 下文「影響範圍」中「Profile 尚未持久化此欄位；重新請求時必須再次提供，直到
> Migration 007 經團隊同意套用且 Profile 讀寫另案接線」一句僅反映 09-10 當下狀態，
> 該前提已於隔天成立，不再適用。程式碼部分已隨 commit `a9421ab` 提交並推送；
> 下方「Commit 與 Push」欄的「未 commit／未 push」指的是本報告檔案本身，
> 不是它描述的程式碼。

## 修改日期

2026-09-10

## 修改檔案

### Migration（只建立檔案，未套用共用 MySQL）

- `server/migrations/007_saved-schedules-and-profile-extras.up.sql`
- `server/migrations/007_saved-schedules-and-profile-extras.down.sql`
- `server/scripts/savedSchedulesMigration.js`
- `server/package.json`

### 排課與 AI Agent

- `server/src/data/constraintSchema.js`
- `server/src/skills/scheduler.js`
- `server/src/services/constraintService.js`
- `server/src/services/promptService.js`
- `server/src/services/requirementPreflight.js`

### 測試

- `server/test/scheduler.test.js`
- `server/test/prompt.test.js`
- `server/test/requirementPreflight.test.js`

### 規格與盤點文件

- `docs/API_SPEC.md`
- `docs/DATA_SCHEMA.md`
- `docs/PROMPT_DESIGN.md`
- `docs/SCHEDULING_LOGIC.md`
- `docs/project-guide/11-known-limitations.md`
- `docs/欄位盤點與待修正清單.pdf`
- `docs/CHANGE_REPORTS/2026-09-10-saved-schedules-profile-extras-avoid-instructors.md`

## 主要改動

1. 新增 Migration 007，規劃建立 `Saved_Schedules`，並在 `User_Profiles` 增加
   `must_take_courses`、`avoid_instructors`、`preferences_json`、`password_hash`、
   `watchlist`、`skill_tree`、`overall_score`、`overall_score_max`。
2. Migration 腳本預設只做 dry-run；真正 apply 或 rollback 都必須同時提供
   `--apply --confirm-shared-mysql`。本次沒有執行任何 DDL。
3. `password_hash` 只先建立 schema，不搬移 `users.json.password` 明碼，也不在本輪決定
   bcrypt／argon2 或修改登入流程。
4. 新增 `AVOID_INSTRUCTOR` 正式限制。教師名稱只做 trim 與英文大小寫正規化後的完整比對，
   不做模糊搜尋或姓名猜測。實查 `Course_Sections.teacher` 的 1,248 個相異值，沒有偵測到
   多教師分隔格式，因此目前不拆字串。
5. 一般候選課命中避開教師時硬性排除；正式必修沿用舒適偏好豁免並在 warning／
   `recommendationReason.constraintTradeoffs` 揭露；關注課維持不占衝堂、不套用限制。
6. `AVOID_INSTRUCTOR` 可進 opt-in 放寬階梯；放寬時把教師清單清成 `[]`，保留陣列型別；
   若列入 `nonNegotiablePreferenceIds` 則不會放寬。
7. AI 工具 schema、理解代號、前置矛盾檢查與文件同步支援 `avoidInstructors`；prompt 明確要求
   只採使用者說出的完整姓名，不得自行猜測教師。
8. PDF 修正 `users.json` 活躍欄位為 5 個、相關課程資料欄位為 7 個，並記錄 migration
   已寫未執行、`avoidInstructors` 已實作、`program_type` 等欄位延後、
   `targetCreditsMin` 不需 UI 而 `targetCreditsMax` 仍待決定。

## 影響範圍

- REST 與 AI Agent 的單次排課請求現在都可使用 `avoidInstructors`。
- Profile 尚未持久化此欄位；重新請求時必須再次提供，直到 Migration 007 經團隊同意套用且
  Profile 讀寫另案接線。
- 共用 MySQL schema 與既有 JSON 資料均未變更；`server/data/users.json` 完全未碰。
- 未修改 `program_type`、`enrolled_programs`、`college`、`preferencesJson` runtime 讀寫，
  也未搬移 `saved_schedules.json`。

## 測試與驗證結果

- 後端本次相關測試：`267 pass / 0 fail`。
- 後端完整測試（排除專案已知會 hang 的 `interactionEvents.test.js`）：
  `1023 pass / 0 fail`。直接執行根目錄 `npm test` 時確實在該已知檔案卡住，已終止卡住程序；
  卡點前沒有失敗。
- 後端 `server/src/**/*.js` 語法檢查：79 個檔案全數通過。
- 前端 `npm run build`：通過。
- 前端 `npm run lint`：通過。
- `git diff --check`：通過（只有 Git 的 LF→CRLF 提示，無 whitespace error）。
- Migration dry-run：通過；回報 `Saved_Schedules` 與 8 個欄位皆尚未存在，
  `User_Profiles` prerequisite 存在，輸出 `mode: "dry-run"`，沒有執行 DDL。
- 瀏覽器 A/B（demo 帳號、Dashboard AI 對話）：
  - A（未避開教師）：8 門／23 學分，包含「安全程式設計（蔡國裕）」。
  - B（`AVOID_INSTRUCTOR` 設為不可退讓）：7 門／20 學分，蔡國裕授課課程不再出現；
    AI 另能說明安全程式設計因避開該教師而排除。
  - 乾淨驗收頁 console：0 error／0 warning。
- 正式必修豁免、關注課略過、validator constraint id、放寬階梯型別由自動測試覆蓋；
  目前可登入且有完整班級資料的 demo 帳號已修完當學期正式必修，無法在同一真實 profile
  製造必修 A/B，因此未修改共享資料來湊瀏覽器案例。
- PDF：7 頁 A4；已逐頁渲染檢查，沒有缺字方框、裁切或表格破版，文字可由 pdfplumber 擷取。

## Commit 與 Push

- 未 commit。
- 未 push。

本次工作樹原先已有 Claude／使用者的未提交修改；本次只在已確認範圍內疊加修改，未重置、
覆寫或清理其他既有變更。
