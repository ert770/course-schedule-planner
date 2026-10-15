# 課程詳情「先修條件」顯示成 [object Object] 的修正

- 日期：2026-10-15
- 來源：[協同過濾階段 8 演練](./2026-10-15-cf-stage8-persona-rehearsal.md)的瀏覽器實測（Persona 9006，「電子商務安全」）
- 性質：使用者看得到的變更（課程詳情視窗）

## 1. 原因

`Courses.prerequisites` 已經不全是 NULL。2026-10-15 實查 3,086 門課：

| 格式 | 門數 | 修正前顯示 |
| --- | --- | --- |
| 空陣列 `[]` | 3,058 | 「無」 |
| 物件 `{ rules: [{ name, course_id }], required_ids, course_code, course_name }` | 28 | **`[object Object]`** |
| NULL | 0 | 「尚未取得官方先修資料」 |

`CourseDetailModal.jsx` 只處理 NULL 與陣列，其他一律 `String()`，物件就變成 `[object Object]`。

## 2. 修改

- 新增 `client/src/utils/coursePrerequisites.js` 的 `formatCoursePrerequisites()`：
  - NULL／undefined →「尚未取得官方先修資料」，不是沒有先修
  - 陣列 → 課名用「、」連接，空陣列 →「無」
  - 物件 → 列出 `rules` 的課名（沒有課名時用課號、重複的只列一次），`rules` 為空 →「無」；
    沒有 `rules` 但有 `required_ids` 時列課號；其他無法辨識的物件 →「尚未取得官方先修資料」
  - 字串原樣顯示
- `CourseDetailModal.jsx` 改用這個函式。全前端只有這一處顯示先修條件。
- 文件：`DATA_SCHEMA.md` 補上實查的三種格式（原本寫「3,086/3,086 皆為 NULL」已過期）；
  `API_SPEC.md` 的 `prerequisites` 欄位說明補上兩種格式。

## 3. 驗證

- 新增 `client/src/utils/coursePrerequisites.test.js`（4 項）；與既有前端測試共 13 項全過。
- `npm run lint`、`npm run build` 通過。
- 瀏覽器 A/B（Persona 9008 的課表，開課程詳情）：

  | 課程 | 修正前 | 修正後 |
  | --- | --- | --- |
  | 資料庫系統 | `[object Object]` | 資料結構、計算機概論實習(一)、計算機概論實習(二) |
  | 機率與統計 | `[object Object]` | 微積分、離散數學 |
  | 電子商務安全（修正前，9006） | `[object Object]` | — |
  | Web程式設計（空陣列） | 無 | 無 |

  修正前的畫面是階段 8 演練時的截圖（9006「電子商務安全」）；修正後重新整理頁面再開詳情，console 沒有新的錯誤。

## 4. 未處理

- 空陣列目前仍顯示「無」（沿用既有行為）。3,058 門都是空陣列，若資料來源其實代表「未整理」而非「沒有先修」，
  需要另外確認資料來源的語意。
- 先修資料尚未用於排課或推薦的資格判斷（roadmap #8）。

## 5. 是否 commit 與 push

已 commit 到 `backend`，尚未 push。
