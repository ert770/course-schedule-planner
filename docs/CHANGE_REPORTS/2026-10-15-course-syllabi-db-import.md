# 歷年教學大綱：讀取組員匯入的 `Course_Syllabi` 與文字向量 v2 接線

- 日期：2026-10-15（2026-10-16 修訂）
- 狀態：大綱資料以**組員匯入的 `Course_Syllabi`** 為準；本專案只保留讀取與文字向量 v2 接線
- 修訂原因：本報告初版（10-15）記錄的是本專案自寫的 migration 010 與匯入工具，當時因 MySQL DNS 錯誤沒有寫入。
  之後組員依《112-114學年度教學大綱資料匯入規格》完成建表與匯入（10-15 23:06），表結構與本專案的 migration 010 不同。
  依使用者決定（10-16），以組員的資料為準，本專案的建表與匯入工具不再使用、不提交。

## 1. 結論

1. **資料已在 MySQL**：`Course_Syllabi` 共 16,490 列（113-1 4,537、113-2 4,414、114-1 3,979、114-2 3,560），
   98 列缺課號、2,099 列沒有主題正文。112 學年度尚未匯入。
2. **本專案的讀取接線可以直接讀組員的表**：讀取只用到 `course_code`、`academic_year`、`semester`、`syllabus_text`、`source_key`，
   組員的表都有。唯讀盤點：當學期 2,004 門課中 **1,996 門**拿得到大綱文字（來自 6,627 列最新學期大綱）。
3. **使用者看不到變化**：文字向量 v2 尚未產生，探索仍用現有 v1 產物。v2 只在本機向量產物標記為 v2 時才會讀大綱。
4. **113-1 多出的 129 列已查明（10-16）**：不是重複資料。組員從 `113-1教學大綱.zip` 匯入，zip 內正好 4,537 份 JSON；
   本專案先前盤點用的是本機解壓的資料夾，只有 4,408 份，缺的 129 份全是 zip 依檔名排序最後的檔案
   （「體育(一)」44 份、各類「體育－…」、「高等…」、「Ｘ光繞射結晶學」等），是解壓不完整。見第 6 節。

## 2. 修改檔案

| 檔案 | 異動 |
| --- | --- |
| `server/src/db/database.js` | 新增讀取「每個課號最新且有內容的學期大綱」的查詢，60 秒快取；不讀 `syllabus_content` |
| `server/src/skills/courseTextVector.js` | 保留 `course-text-vector-v1`；新增選配 `course-text-vector-v2`（課名、標籤、簡介＋大綱文字） |
| `server/src/services/courseTextEmbeddingService.js` | 只有本機產物標記 v2 時，runtime 才讀 `Course_Syllabi` |
| `server/scripts/courseTextEmbeddingStage4.js` | 新增 `--include-syllabi`，盤點或產生 v2 向量 |
| `server/test/courseTextVector.test.js` | v1／v2 文件組成與相容性測試 |
| `docs/DATA_SCHEMA.md` | `Course_Syllabi` 改為描述資料庫實際的表結構與筆數；移除匯入工具說明 |
| `docs/CHANGE_REPORTS/README.md` | 索引標題更新 |

**沒有提交、已移出專案的**：`server/migrations/010_course-syllabi.up.sql`／`.down.sql`、
`server/scripts/importCourseSyllabi.js`、`server/test/courseSyllabusImport.test.js`。
它們與組員的表定義不同（多 `id`、`created_at`、`updated_at`；內容欄位 NOT NULL；欄位長度不同），
執行會與現有表衝突。暫時保存在工作階段的暫存區，供查 113-1 差異時重跑來源盤點，不會再對資料庫執行。

## 3. 表結構比較

| 項目 | 組員的表（實際） | 本專案 migration 010（不使用） |
| --- | --- | --- |
| 主鍵 | `source_key` | 自增 `id`，`source_key` 為唯一鍵 |
| `course_code` | `VARCHAR(45)`，可 NULL | `VARCHAR(32)`，可 NULL |
| `selection_code` | `VARCHAR(4)` | `VARCHAR(16)` |
| `syllabus_content`、`syllabus_text` | 可 NULL | NOT NULL |
| `source_file` | `TEXT` | `VARCHAR(512)` |
| 時間欄位 | 無 | `created_at`、`updated_at` |
| 白名單內容鍵 | `description`、`subTitleDesc`、`targets`、`weeklyScds`、`readings`、`textBooks`、`gradeRules`、`gradeRuleDescribe`、`iSoftwares`、`assistSoftwares`、`courseBankC` | 相同用途 |

白名單內容與本專案的設計一致；缺課號 98 列、沒有正文約 2,100 列，也與本專案的盤點相符。

## 4. 驗證

- 唯讀查詢 `information_schema` 與 `Course_Syllabi`：表結構、各學期筆數、缺課號與無正文列數（第 1、3 節）。
- `node scripts/courseTextEmbeddingStage4.js --include-syllabi`（唯讀盤點，**未呼叫 API**）：
  1,996／2,004 門有大綱文字，1,050 門超過 1,800 字上限會被截斷，估計 token 上限約 527 萬。
- `node scripts/courseTextEmbeddingStage4.js`（v1）：盤點不變。
- `server/src` 全部 `node --check` 通過；`npm test` 1,607 項，1,606 通過、1 略過、0 失敗。
- 未做瀏覽器驗收：v2 向量尚未產生，探索與排課行為不變。

## 5. 之後要決定的

- **是否產生 v2 向量**：會把約 2,000 門課的大綱文字送到 OpenAI embedding API，估計上限約 527 萬 tokens；
  另外 v2 與 v1 寫到同一個本機產物路徑，產生後會取代 v1，需要先做探索的 A/B 再決定。
- **1,800 字上限**：過半課程的大綱文字會被截斷，v2 實作前可考慮只取簡介、教學目標與每週主題。
- **112 學年度**：來源尚未取得。

## 6. 113-1 多出 129 列的調查（2026-10-16）

| 檢查 | 結果 |
| --- | --- |
| 資料庫 113-1 有無重複 | 4,537 列對應 4,537 個不同來源檔，課號＋選課代碼也沒有重複 |
| `113-1教學大綱.zip` 內的 JSON | 4,537 份，選課代碼 4,537 個 |
| 本機解壓資料夾 `113-1教學大綱` | 4,408 份 |
| 只在 zip 的選課代碼 | **129 個**，正好等於差額 |
| 這 129 份是什麼 | 依檔名排序在最後的檔案：體育(一) 44、體育－羽球 9、體育－桌球 5 等各類體育課，高等會計學(一)與實習各 4，以及 30 多門「高等…」研究所課程與「Ｘ光繞射結晶學」 |
| 檔名不同但選課代碼相同的 20 份 | 同一批檔案；差異來自比對時少數 Big5 字元解碼失敗，不是內容不同 |

結論：組員的匯入完整且正確；本機資料夾是解壓不完整。之後若要從本機來源重做盤點，應直接讀 zip。
