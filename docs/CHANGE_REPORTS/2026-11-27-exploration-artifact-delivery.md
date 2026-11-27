# 隨專案交付課程探索向量索引

修改日期為 2026-11-27。

## 修改檔案與影響範圍

| 檔案 | 變更 |
| --- | --- |
| `.gitignore` | 在 `server/simulation-runs/` 只放行課程探索索引。 |
| `server/simulation-runs/course-exploration-embeddings/index.json` | 交付預先算好的探索索引，涵蓋 2,004 門班次目錄課程及 34 門只有歷史修課紀錄的課程。後者只有課名向量。 |
| `server/scripts/courseExplorationEmbeddings.js`、`server/package.json` | 更新指令說明，加入唯讀盤點、索引重建和驗證指令，從專案根目錄呼叫時在 `server/` 執行。 |
| `server/scripts/checkCourseExplorationArtifact.js`、`.github/workflows/ci.yml` | 透過實際索引載入器及探索服務驗證補齊的 10 門課都有課名向量，並以隔離資料驗證已修課可用於比較。CI 在乾淨 checkout 執行這項檢查。 |
| `README.md`、`.env.example` | 新增乾淨環境啟動、索引更新及路徑覆寫說明。 |
| `docs/API_SPEC.md`、`docs/DATA_SCHEMA.md` | 同步現行索引交付方式與資料規格。2026-11-24 的探索變更報告保留當時的交付狀態。 |
| 本報告 | 記錄課程來源、版本交付和驗證結果。 |

索引缺少的 10 個課號為 `ACTV1051`、`ADV1196`、`COMC1118`、`ENGL3125`、`GEH1125`、`GEK1028`、`IND3411`、`LAND3032`、`MIS0855`、`MIS3505`。逐課核對到歷年課綱的同課號，修課來源對每個課號各只有一種課名。原有 24 門歷史課亦在歷年課綱查到同課號。向量 API 只處理這次新增的 10 筆課名文字，實際用量 116 tokens。課程索引包含課號、來源類別、課名及向量，沒有帳號、成績或個別修課明細。共用 MySQL 未寫入。

## 驗證

- 從 GitHub 乾淨 clone `backend`，加入本次交付檔後，在沒有本機 `.env`、CA 或向量快取的環境執行 `npm ci` 安裝前後端依賴及通過索引檢查。
- 缺索引時檢查指令按預期以非零狀態結束。索引存在時，隔離的修課 `MIS0855` 可選取並比對到 `IBUS2001`。
- 使用 Chrome、Vite 和呼叫實際探索服務的隔離 HTTP 介面做 A/B。A 模擬缺檔，探索選單停用 `DATA SCIENCE` 並顯示比較資料尚未準備好。B 使用交付索引，可選 `DATA SCIENCE` 並看到「資料科學商管應用」卡片，課名相似度為 0.5573。兩組均無瀏覽器 console 錯誤。
- 前端 lint、build、156 個後端 JavaScript 檔案的語法檢查通過。CI 模式完整後端測試 2,042 項通過、14 項跳過、0 項失敗。

## 版本控制

本批提交與推送目標為 `origin/backend`。索引是唯一提交的 `simulation-runs` 產物，向量快取、實驗結果與本機設定留在本機。
