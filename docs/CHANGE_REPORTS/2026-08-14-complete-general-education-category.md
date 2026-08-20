# #12B 通識課程分類與學年度規則變更報告

## 修改日期

2026-08-14

## 修改檔案

- 後端規則與查詢：
  - `server/src/data/generalEducationCatalog.js`
  - `server/src/skills/courseCategory.js`
  - `server/src/skills/courseQuery.js`
  - `server/src/services/promptService.js`
- 前端：
  - `client/src/pages/SearchPage.jsx`
  - `client/src/pages/SchedulePage.jsx`
  - `client/src/components/CourseCard/CourseCard.jsx`
- 測試：
  - `server/test/generalEducationCatalog.test.js`
  - `server/test/courseQuery.test.js`
  - `server/test/database-contract.test.js`
- 規格與進度文件：
  - `docs/API_SPEC.md`
  - `docs/DATA_SCHEMA.md`
  - `docs/SCHEDULING_LOGIC.md`
  - `docs/PROMPT_DESIGN.md`
  - `docs/COURSE_SELECTION_RULES.md`
  - `docs/TEST_PLAN.md`
  - `docs/專題進度報告.md`
  - `docs/DB_AUDIT_REPORT_2026-08-05.md`
  - `docs/CHANGE_REPORTS/2026-08-01-personalization-roadmap.md`

## 主要改動

1. 建立版本化通識開課分類規則：
   - 111 學年度以前：人文、社會、自然、統合。
   - 112～114 學年度：全球氣候變遷與永續發展、人文藝術與社會經典教育、世界格局與歷史地理視野、科技知識原理與趨勢浪潮。
   - 115 學年度起：通識選修不再分領域，畢業需修滿 12 學分。
2. 114-2 當期分類以 MySQL 的正式領域開課單位為依據，不再用 `GE*` 課號前綴猜測。
3. 納入官方 114-2 跨院認抵表中的 `IINE2832`、`IINE2833`、`HSS1007`；三門課均映射到「世界格局與歷史地理視野」。
4. `category=通識` 已可在課程搜尋、排課選課面板與 Agent 工具中使用；排課候選預設也會納入通識課。
5. 課程 API 新增 `generalEducationDomain`、`generalEducationRuleVersion`、`generalEducationRecognitionType`、`classificationReference`，保留分類規則與來源追溯資訊。
6. Roadmap 的 #12B 標為完成；完整歷史畢業認列比較移入 #23「版本化畢業規則引擎」。

## 官方資料來源

- [111 學年度以前通識選修舊制](https://genedu.fcu.edu.tw/%E9%80%9A%E8%AD%98%E9%81%B8%E4%BF%AE-112%E5%AD%B8%E5%B9%B4%E5%BA%A6%E5%89%8D-%E8%88%8A%E5%88%B6/)
- [112 學年度起通識選修課程改革說明](https://genedu.fcu.edu.tw/news/112%E5%AD%B8%E5%B9%B4%E5%BA%A6%E8%B5%B7%E3%80%90%E9%80%9A%E8%AD%98%E9%81%B8%E4%BF%AE%E8%AA%B2%E7%A8%8B%E6%94%B9%E9%9D%A9%E8%AA%AA%E6%98%8E%E3%80%91/)
- [112 學年度起適用課程地圖](https://genedu.fcu.edu.tw/%E8%AA%B2%E7%A8%8B%E5%9C%B0%E5%9C%96_112%E5%AD%B8%E5%B9%B4%E5%BA%A6%E8%B5%B7%E9%81%A9%E7%94%A8/)
- [115 學年度通識選修課程變革](https://genedu.fcu.edu.tw/news/115%E5%AD%B8%E5%B9%B4%E5%BA%A6%E9%80%9A%E8%AD%98%E9%81%B8%E4%BF%AE%E8%AA%B2%E7%A8%8B%E8%AE%8A%E9%9D%A9/)
- [各院申請認抵通識選修一覽表](https://genedu.fcu.edu.tw/news/%E3%80%90%E9%81%B8%E4%BF%AE%E8%AA%B2%E7%A8%8B%E3%80%91-%E5%90%84%E9%99%A2%E7%94%B3%E8%AB%8B%E8%AA%8D%E6%8A%B5%E9%80%9A%E8%AD%98%E9%81%B8%E4%BF%AE%E4%B8%80%E8%A6%BD%E8%A1%A8/)

## 影響範圍與邊界

- 目前 114-2 MySQL 資料共有 167 個不重複通識正式課號、208 個直接四領域班次；再加上 3 個跨院認抵班次，通識搜尋共回傳 211 筆。
- #12B 完成的是「當期課程分類與開課學年度規則」，可供搜尋、排課與 Agent 使用。
- 112-1～114-1 的官方歷史認抵資料多數沒有穩定課號，而且目前 MySQL 只有 114-2 sections；因此沒有用課名猜測舊課號。
- 依學生入學年度進行逐門歷史畢業認列、6／4 學分認抵上限、核心必修過渡、系所排除與人工待確認狀態，已完整列入 roadmap #23。
- 未修改 shared MySQL schema，也未修改正式 `server/data/users.json`；該檔原有未提交差異保持不動。

## 測試與驗證結果

- 針對性測試：`node --test test/generalEducationCatalog.test.js test/courseQuery.test.js test/database-contract.test.js`，30／30 通過。
- 完整測試：`npm test`，311／311 通過，0 fail、0 skipped。
- 前端：`npm run lint`、`npm run build` 均通過。
- 後端：38 個 `server/src/**/*.js` 檔案逐一執行 `node --check`，全部通過。
- 瀏覽器隔離驗收使用 `server/test/fixtures/browser-without-failed` 與 `BROWSER01`：
  - A 組選擇「核心選修」得到 4 筆，結果均為核心選修。
  - B 組選擇「通識」得到 211 筆；跨院認抵課「世界經濟論壇－曾經滄海」正確顯示「世界格局與歷史地理視野」。
  - 直接領域課「智慧綠台灣」正確顯示「全球氣候變遷與永續發展」。
  - 排課頁的「通識」篩選同樣得到 211 筆，CourseCard 顯示領域。
  - Browser console 無 error 或 warning。

## Commit / Push

- 本次變更提交後將推送至 `origin backend`。
