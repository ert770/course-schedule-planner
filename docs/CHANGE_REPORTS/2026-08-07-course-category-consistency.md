# #12A 課程分類與搜尋一致性變更報告

## 修改日期

2026-08-07

## 目前進度

- #12A：✅ 已完成。必修、核心選修、一般選修、系外選修已統一使用先分類後篩選的資料流。
- #12B：⬜ 未開始。通識正式分類表、領域與適用學年度規則仍待資料來源確認。
- #12 整體：🟡 部分完成；在 #12B 完成前不宣告整項結案。

## 目標與範圍

MySQL `Courses.type` 只有「必修／選修」，原本搜尋 API 直接比對原始值，排課才另外
解析核心選修與系外選修，造成同一門課在搜尋與排課顯示不同分類。本次先完成可由
正式資料支持的四類：必修、核心選修、一般選修、系外選修。通識規則尚未建立，明確
標示為未支援，不推測、不回傳假資料。

## 修改檔案

- `server/src/skills/courseScope.js`
- `server/src/skills/courseCategory.js`
- `server/src/skills/courseQuery.js`
- `server/src/skills/scheduler.js`
- `server/src/routes/courses.js`
- `server/src/routes/schedule.js`
- `server/src/services/agentService.js`
- `server/src/services/promptService.js`
- `client/src/pages/SearchPage.jsx`
- `client/src/pages/SchedulePage.jsx`
- `client/src/pages/SetupPage.jsx`
- `client/src/components/CourseCard/CourseCard.jsx`
- `server/test/courseQuery.test.js`
- `server/test/courseScope.test.js`
- `docs/API_SPEC.md`
- `docs/SCHEDULING_LOGIC.md`
- `docs/PROMPT_DESIGN.md`
- `docs/CHANGE_REPORTS/2026-08-07-course-category-consistency.md`

## 後端資料流

1. `GET /api/profile` 從完整班級（目前為 `資訊三乙`）產生
   `courseSearchScope={department, grade, className}`。
2. `GET /api/courses` 驗證 `department`、`grade`、`className`，再由
   `buildCourseQueryScope()` 建立分類所需的學生 scope。
3. 從 MySQL 取得原始課程後，先以 `annotateCourseCategory()` 逐門解析分類，保留
   `sourceCategory` 與 `classificationSource`。
4. 未指定 category，或搜尋必修／核心選修／一般選修時，維持 F7，只保留本人班級
   與同年級合班。只有明確搜尋系外選修時才擴展到其他系所，且排除不同學制。
5. 分類及班級範圍完成後，再套用 keyword、教師、學分、日期、節次等一般條件。
6. 回傳 `scope`、`appliedFilters`、解析後課程及總筆數。

## 三個搜尋入口

- `searchCoursesForStudent()`：供課程 REST API 使用，API 邊界強制 F7 班級資料。
- `searchCoursesForSchedule()`：由 schedule route 依 `userId` 讀取 profile 後建立 scope；
  前端不必重複傳班級，缺少班級不退回全校候選。
- `searchCoursesForAgent()`：由 Agent 使用者 profile 建立 scope，Agent 不猜測班級。

三個入口都使用同一個 `annotateCourseCategory()`，沒有複製分類規則。

## 分類輸出

| 類別 | 依據 | `sourceCategory` | `classificationSource` |
| --- | --- | --- | --- |
| 必修 | MySQL 原始必修＋學生班級範圍 | 必修 | mysql |
| 核心選修 | 資工核心選修15門清單 | 選修 | cs_curriculum |
| 一般選修 | 資工選修53門清單扣除核心選修 | 選修 | cs_curriculum |
| 系外選修 | 其他同學制系所班級的選修 | 選修 | outside_department |

系外選修另回傳 `outsideElective`：可否認列、不可認列原因、警告及是否需系辦確認。

## API 與錯誤

- 缺少班級範圍：HTTP 400、`CLASS_NAME_REQUIRED`。
- `category=通識`：HTTP 422、`GENERAL_EDUCATION_CATEGORY_UNAVAILABLE`。
- 不支援的 category：HTTP 400、`INVALID_COURSE_CATEGORY`。
- 未指定 category 不執行廣泛搜尋；只回本人班級與合班。

## 自動測試

- `npm test`：238 tests、48 suites，全數通過。
- `client npm run lint`：通過。
- `client npm run build`：通過。
- `server/src/**/*.js` 語法檢查：通過。

新增測試涵蓋：先分類後篩選、四類解析、F7 無分類範圍、系外分類才擴展、不同學制
排除、通識422，以及缺少班級不得退回廣泛搜尋。

## 實際 MySQL 與瀏覽器全量驗收

驗收使用 D1249697（資訊三乙），不是抽樣；瀏覽器逐筆讀取所有結果卡片。

| 分類 | API 筆數 | 瀏覽器卡片 | 錯誤 badge | 錯誤班級／學制 | 遺漏或重疊 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 未指定 | 16 | 16 | 0 | 0 | 0 |
| 必修 | 3 | 3 | 0 | 0 | 0 |
| 核心選修 | 4 | 4 | 0 | 0 | 0 |
| 一般選修 | 9 | 9 | 0 | 0 | 0 |
| 系外選修 | 619 | 619 | 0 | 0 | 0 |

- 本班三類聯集為16筆，與未指定分類的16筆完全相同。
- 必修／核心選修／一般選修／系外選修四個 ID 集合交集均為0。
- 3筆必修全部為資訊三乙；4筆核心與9筆一般選修全部為資訊三合。
- 619筆系外選修全部為其他系所的學士班選修，沒有資工三乙／三合，也沒有碩、博、
  碩專課程。
- 系外選修中587筆顯示「須向系辦確認」，32筆逐卡顯示不可認列原因；缺少狀態0筆。
- 通識選項與條件搜尋 checkbox 均停用並顯示分類資料尚未建立；API 回傳422。
- 排課頁以核心選修搜尋得到4筆，與課程搜尋頁及 API 完全相同。
- `POST /api/schedule/generate` 只傳 `userId` 與核心選修 filters、未傳 className，後端
  從 profile 取得資訊三乙並成功產生2門、6學分、全為核心選修的方案。
- `searchCoursesForAgent()` 以同一 profile 查核心選修得到4筆，全部為資訊三合。
- 缺少 className 的課程 API 仍回傳原 F7 的 HTTP 400 指定錯誤。
- 瀏覽器 console：0 error、0 warning。

## 影響範圍與保留項目

- 搜尋、排課與 Agent 現在使用相同分類結果。
- Setup 的已修選修清單同時接受核心選修與一般選修。
- 通識分類、通識領域與正式通識課程表不在本次實作範圍；#12 尚需後續 #12B 才能
  完整結案。
- 未修改 MySQL schema 或正式資料。

## Commit 與 Push

- Commit：依使用者指示，與本次進度追蹤文件一併提交。
- Push：依使用者指示推送至 `origin main`。
