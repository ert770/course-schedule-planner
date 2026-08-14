# 個人歷年修課成績資料匯入

## 修改日期

2026-08-06

## 修改檔案

- `server/data/users.json`
- `docs/DATA_SCHEMA.md`
- `docs/CHANGE_REPORTS/2026-08-06-personal-course-history-import.md`

## 主要改動

- 將 `歷年修課成績資料.md` 的 53 門課匯入 demo 使用者 `D1249697`。
- 保存 112-1 至 114-2 的學年度、學期、課程編碼、科目、百分制成績、等第、學分、修習別及通識類別。
- 新增 `completedCourseCodes` 與完整 `courseHistory`。
- `completedCourseNames` 改為實際 53 門歷史課程。
- 清除原本指向模擬 section 的 `completedCourseIds`，避免把歷史課程誤連到當期 section。
- 實際修習學分為 121；體育 2 學分與國防科技 1 學分不計入畢業學分，因此 `completedCredits` 更新為 118。
- 畢業分類彙總更新為：本系必修 61、本系選修 22、通識 24、系外選修 11。

## 影響範圍

- demo 使用者 `D1249697` 的歷史修課與畢業進度資料。
- 畢業頁總進度及分類缺口。
- 未修改正式 MySQL、登入資訊、watchlist、skillTree 或排課程式邏輯。

## 測試與驗證

- JSON 解析：通過。
- 原始 Markdown 與 `courseHistory` 逐欄比較：53 筆、0 筆差異。
- 課程編碼：53 筆，無重複。
- 學分加總：修習 121；不計畢業 3；計入畢業 118。
- 分類加總：本系必修 61、本系選修 22、通識 24、系外選修 11，合計 118。
- `npm test`：225 項全部通過。
- 實際 API：`GET /api/graduation/D1249697` 回傳 `totalEarned=118`，分類學分及缺口正確。
- 瀏覽器 A/B：匯入前顯示 107/128，匯入後顯示 118/128；匯入後缺口為本系必修 2、本系選修 6、通識 4、系外選修 0，console 無 error 或 warning。

## Commit 與 Push

- Commit：依使用者指示，隨本次 F13、個人修課資料與 F7 變更一併提交。
- Push：依使用者指示推送至 `origin main`。
