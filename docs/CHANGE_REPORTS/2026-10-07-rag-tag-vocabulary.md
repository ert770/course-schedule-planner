# rag_tag 興趣詞彙整理與候選流程（階段 1）

## 修改日期

2026-10-07

## 範圍

本階段只整理課程主題詞彙並產生人工審查候選，不改變互動學習、排課結果或資料庫。
`interestTagAliases.json` 目前保持空白；下方模型候選尚未獲人工確認，不會生效。

## 課程目錄統計

| 指標 | 結果 |
| --- | ---: |
| 班次數 | 3,560 |
| 不重複課程數（穩定課號） | 2,004 |
| 原始不同標籤數 | 6,846 |
| 正規化後標籤數 | 6,782 |
| 原始標籤中出現在至少 5 門課者 | 610 |
| 正規化碰撞群組 | 51 |
| 原始標籤只出現在一門課（未正規化） | 4,662 |
| 正規化後只出現在一門課 | 4,594 |
| 整理後保留標籤數 | 2,152 |
| 有保留標籤的課程覆蓋率 | 99.5% |
| 每門課平均保留標籤數 | 4.92 |
| 每門課保留標籤數（最少／中位數／最多） | 1／4／37 |
| 資工 IECS 課程覆蓋 | 66/66（100.0%） |
| 每門課權重總和檢查 | 1,993 門；最大誤差 6.66e-16 |

原始標籤的 6,846 個名稱中，610 個在至少 5 門課出現，作為模型提案輸入。先正規化大小寫、空白與連字號後，有 51 組表面寫法自動合併；語意同義詞仍需人工確認。

## 正規化合併清單

| 標準顯示名稱 | 合併的表面寫法 | 課程數 |
| --- | --- | ---: |
| 3D IC | 3D IC、3DIC | 2 |
| 工業4.0 | 工業 4.0、工業4.0 | 6 |
| AIoT | AIoT、AIOT | 3 |
| ANSYS | Ansys、ANSYS | 5 |
| APP CAD | APP CAD、AppCAD、APPCAD | 3 |
| ArcGIS | ArcGIS、ARCGIS | 11 |
| ArcGIS Pro | ArcGIS Pro、ArcGIS PRO | 7 |
| AutoCAD | Auto CAD、Autocad、AutoCAD | 12 |
| Autodesk Revit | Autodesk Revit、AutoDESK REVIT | 4 |
| Canva | Canva、CANVA | 5 |
| ChatGPT | Chat GPT、ChatGPT | 15 |
| Comsol | Comsol、COMSOL | 2 |
| Decision Making | Decision Making、Decision-Making | 2 |
| Dev C++ | Dev C++、DEV C++、Dev-C++、DEV-C++ | 9 |
| E-commerce | E-commerce、E-Commerce | 1 |
| E-views | E-views、Eviews、EViews、EVIEWS | 4 |
| Excel | Excel、EXCEL | 64 |
| Fourier Series | Fourier series、Fourier Series | 3 |
| Gemini | Gemini、GEMINI | 5 |
| Google AI Studio | Google Ai Studio、Google AI Studio | 3 |
| HEC-RAS | HEC-RAS、HECRAS | 3 |
| iLearn | ilearn、iLearn | 7 |
| ilearn2.0 | iLearn 2.0、ilearn2.0、iLearn2.0 | 4 |
| Java | Java、JAVA | 8 |
| LabVIEW | Labview、LabVIEW、LABVIEW | 4 |
| Laplace transform | Laplace transform、Laplace Transform | 2 |
| MATLAB | Matlab、MatLAB、MATLAB | 65 |
| Maxwell's equations | Maxwell's equations、Maxwell's Equations | 2 |
| Multisim | Multi-Sim、Multisim、MultiSim、MultiSIM | 8 |
| MySQL | MySQL、MYSQL | 4 |
| NoSQL | NoSQL、NOSQL | 2 |
| p-n接面 | p-n接面、PN接面 | 2 |
| pn Junction | pn Junction、PN Junction | 2 |
| Power BI | Power BI、PowerBI | 5 |
| PowerPoint | POWER POINT、PowerPoint | 12 |
| Python | Python、PYTHON | 80 |
| Python3 | Python 3、Python3 | 3 |
| QGIS | Qgis、QGIS | 8 |
| RSoft | Rsoft、RSoft | 3 |
| Rstudio | Rstudio、RStudio | 4 |
| scikit-learn | scikit-learn、Scikit-learn | 2 |
| Simulink | Simulink、SIMULINK | 5 |
| Sketchup | Sketchup、SketchUp | 3 |
| Smith Chart | Smith Chart、SMITH CHART | 2 |
| Solidworks | Solidworks、SolidWorks、SOLIDWORKS | 9 |
| Stata | Stata、STATA | 2 |
| VS Code | VS Code、VS CODE、VSCode | 7 |
| Webstorm | Webstorm、WebStorm | 2 |
| Wireshark | wireshark、Wireshark | 4 |
| Word | Word、WORD | 7 |
| Youtube | Youtube、YouTube | 2 |

## 泛用標籤排除摘要

排除規則是出現在超過 2% 的不重複課程，或命中程式內明列的通用標籤清單。以下列出頻率最高的前 30 個；完整納入、排除清單與理由見同目錄的 JSON 詳細報告。

| 標籤 | 課程數 | 課程比例 |
| --- | ---: | ---: |
| 數據分析 | 164 | 8.2% |
| 材料科學 | 96 | 4.8% |
| 環境科學 | 86 | 4.3% |
| 文化研究 | 84 | 4.2% |
| 互動設計 | 83 | 4.1% |
| 風險管理 | 82 | 4.1% |
| Python | 80 | 4.0% |
| 電子工程 | 72 | 3.6% |
| 人工智慧 | 68 | 3.4% |
| 土木工程 | 65 | 3.2% |
| MATLAB | 65 | 3.2% |
| Excel | 64 | 3.2% |
| 企業管理 | 63 | 3.1% |
| 永續發展 | 57 | 2.8% |
| 經濟學 | 56 | 2.8% |
| 機器學習 | 55 | 2.7% |
| 自動化 | 54 | 2.7% |
| 資料分析 | 54 | 2.7% |
| 工程 | 53 | 2.6% |
| 語言學習 | 50 | 2.5% |
| 半導體 | 49 | 2.4% |
| 法律 | 46 | 2.3% |
| 學術寫作 | 46 | 2.3% |
| 可持續發展 | 45 | 2.2% |
| 程式設計 | 45 | 2.2% |
| 物聯網 | 44 | 2.2% |
| 社會科學 | 44 | 2.2% |
| 城市規劃 | 44 | 2.2% |
| 建築設計 | 43 | 2.1% |
| AI | 41 | 2.0% |

全部排除 4,630 個：明列通用 6 個、比例過高 30 個、只出現在一門課 4594 個。

## 語意同義標籤候選

本次未呼叫模型；候選輸入範圍為出現在至少 5 門課的 610 個原始標籤，名稱與門數見詳細 JSON 的 aliasProposal.inputTags 欄位。

自動審查拒絕將 catalog 標籤與出現次數送往設定的 OpenAI 服務，理由是該資料尚未明確核准外傳；審查要求不得改用其他路徑重試。

本次沒有產生候選，因此目前沒有待審查群組；`interestTagAliases.json` 仍維持空白。若之後產生候選，須先人工確認同義關係，尤其不要把上下位概念、工具名稱與領域主題只因相關就合併。


## 權重整理規則

每門課只保留通過詞彙規則的標籤。先按標籤數平分該課的總份量，再乘上 `ln((課程總數 + 1) / (標籤課程數 + 1))` 的稀有度，最後在該課內重新正規化，使保留標籤的權重總和仍為 1。沒有保留標籤的課程不產生標籤權重。

## 主要檔案與驗證

- `server/src/data/interestTagVocabulary.js`：純函式正規化、頻率過濾、合併與每課權重。
- `server/src/data/interestTagAliases.json`：只存人工確認的 alias；目前無已確認映射。
- `server/scripts/interestTagAliasProposal.js`：從唯讀課程目錄產生本報告與 JSON 詳細資料。
- `server/test/interestTagVocabulary.test.js`：正規化、去重、排除與權重總和測試。
- 語法檢查：`server/src` 全部 98 個 JavaScript 檔案與本次新增的 script/test 通過。
- 詞彙測試：`node --test test/interestTagVocabulary.test.js` 5/5 通過；外部呼叫預設封鎖檢查通過。
- 完整後端 `npm test`：1,426 項中 1,424 通過、2 項失敗；失敗為 `agentGoldenSet.test.js` 的 `no-invented-constraints`（模型回傳 schema 未定義的 `sourcePhrases`）及其總通過率斷言，與本階段模組無關。
- 前端 `npm run build` 通過；沒有修改 client 檔案，因此未跑 lint。未改變 UI 或排課結果，未執行瀏覽器 A/B。
- 詳細資料：[2026-10-07-rag-tag-vocabulary-details.json](./2026-10-07-rag-tag-vocabulary-details.json)。

## 變更與提交狀態

- 修改範圍：新增詞彙純函式、空 alias 容器、候選腳本、單元測試、測試計畫、變更報告與 roadmap #43。
- 影響：目前只產生離線詞彙統計與每課標籤權重；未修改學習器、儲存層、隱私頁、API 或 `scheduler.js`，排課結果不變。
- Roadmap：核對 #1–#42 的狀態與相依欄，未改其他列；新增 #43 並記錄同義詞審查的待辦與外部分享阻塞。
- 本次未 commit、未 push；工作樹既有修改與未追蹤資料均保留。

## 本階段結論

階段 1 的正規化程式與資料統計已完成；外部模型候選受阻，正式 alias 檔仍為空。待專案負責人決定是否授權傳送詞彙資料，或提供本機模型，再完成候選審查。
