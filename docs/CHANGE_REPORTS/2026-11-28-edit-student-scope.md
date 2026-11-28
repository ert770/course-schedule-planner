# 設定頁可修改系所、年級、班級

修改日期：2026-11-28。

## 問題

一位資工系使用者註冊時把系所選成「資訊電機學院」、班級「資電四乙」。畢業學分表的鍵是
「資訊電機學院學士班」，查不到時畢業學分頁顯示「此系所不存在」、總學分「/ —」、沒有缺口卡片。
設定頁的基本資料只能看不能改，`POST /api/profile` 雖可寫入這三個欄位，但只檢查系所是非空字串，
任意文字或系所與班級對不上都會被存下。

本次範圍只處理「資工學生填錯可以改回來」。「資訊電機學院」對不到「資訊電機學院學士班」的名稱問題、
換系後舊興趣標籤的清理、延畢／英語專班／合班選不到的問題都不在本次範圍。

## 修改檔案

| 檔案 | 改動 |
| --- | --- |
| `server/src/data/studentScopeValidation.js`（新增） | `validateStudentScope`：系所、年級、班級三者對得上的規則（自註冊抽出）。`validateStudentScopeChange`：只有送的值與已保存的不同時才檢查。 |
| `server/src/services/accountService.js` | 註冊改呼叫 `validateStudentScope`，規則與錯誤訊息不變。 |
| `server/src/routes/profile.js` | `POST /api/profile` 帶系所、年級或班級時，以 `validateStudentScopeChange` 檢查，不通過回 `400`。 |
| `server/test/studentScopeValidation.test.js`（新增） | 對得上才通過、學院改成資工可保存、只改系所未改班級被擋、沒改不檢查、註冊沿用同規則。 |
| `client/src/components/Profile/StudentScopeEditor.jsx`（新增） | 系所、年級、班級下拉選單；選項取自 `/api/auth/register-options`，班級組法與註冊頁相同。 |
| `client/src/pages/SetupPage.jsx` | 「確認基本資料」加「修改基本資料」。只有改過才送這三個欄位（以前每次保存都送，包含頁面預設值）；改了系所或班級時，保存後提示回首頁按「套用偏好排課」。 |
| `docs/API_SPEC.md` | `POST /api/profile` 的基本資料檢查規則與錯誤訊息。 |

資料欄位未改動，`DATA_SCHEMA.md` 不需更新。

## 影響範圍

- 設定頁保存偏好：未修改基本資料時，不再送 `department`、`gradeLevel`、`className`。過去 Profile 沒有年級的帳號
  保存時會被寫入頁面預設的 1 年級，現在不會。
- `POST /api/profile`：系所、年級、班級有變動時須互相對得上。AI 助手經 `memoryService` 寫入，不受影響。
- 註冊：行為不變。
- 未修改排課邏輯，未推進 roadmap 任務。

## 測試與驗證

- `server/src` 全部 `node --check` 通過；`CI=true npm test`（server）2,066 項中 2,034 項通過、0 失敗、32 跳過。
- 前端 `npm run build`、`npm run lint` 通過。
- 瀏覽器（`npm run dev:myfcu`，示範帳號 D1249697）：
  - API A/B：後端重啟前，送 `資訊工程學系／4／資電三乙` 被接受（200）；重啟後同一請求回 `400`「班級與系所或年級不符」，
    不存在的系所回 `400`「請選擇有效系所」，資料未變。送與已保存相同的值（班級「資訊四合」，不符新規則）回 200。
  - 設定頁：「修改基本資料」展開三個下拉選單；選「資訊電機學院」時班級列出資電四甲～丁，改「資訊工程學系」可選資訊四乙；
    套用後顯示「資訊工程學系 · 4 年級 · 資訊四乙」與「保存偏好後才會生效」。
  - 保存請求以頁面攔截檢查（未送到伺服器）：修改過時送出 `department`、`gradeLevel: 4`、`className: 資訊四乙`，
    並顯示「基本資料已更新…請回首頁按『套用偏好排課』」；未修改時不帶這三個欄位、不顯示提示、直接回首頁。
  - console 只有上述刻意送出的兩筆 400。
- **驗證過程中誤寫一次共用資料**：後端尚未重啟時送出的 API A/B 請求被舊程式接受，示範帳號 D1249697 的班級被寫成
  「資電三乙」，已立即改回原值「資訊四合」並確認系所、年級、班級與原本相同。
- 使用者本人以該帳號在設定頁改為「資訊工程學系／4 年級／資訊四乙」；資料庫確認已寫入，且畢業學分表查得到該系所。

## Commit 與 Push

與畢業學分頁深色主題修正一起 commit，push 至 `origin backend`。
