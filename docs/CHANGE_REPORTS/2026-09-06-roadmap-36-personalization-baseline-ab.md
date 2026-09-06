# Roadmap #36：personalization baseline 與 preference sensitivity A/B

## 修改日期

2026-09-06

## 修改檔案

- `server/src/skills/scheduler.js`
- `server/src/skills/personalizationMetrics.js`
- `server/src/skills/personalizationExperiment.js`
- `server/test/fixtures/personalizationCases.json`
- `server/test/fixtures.js`
- `server/test/personalizationMetrics.test.js`
- `server/test/personalizationBaseline.test.js`
- `server/scripts/personalizationBenchmark.js`
- `server/package.json`
- `docs/TEST_PLAN.md`
- `docs/SCHEDULING_LOGIC.md`
- `docs/DECISIONS.md`
- `docs/CHANGE_REPORTS/README.md`
- `docs/CHANGE_REPORTS/2026-08-01-personalization-roadmap.md`

## 主要改動

本輪建立離線、可重播的 B0/B1/P 實驗：B0 移除個人化輸入，B1 只保留表單偏好，P
使用正式 learned weights。所有條件共用固定課程池、評價、term、seed、timeout 與 hard
constraints；每個輸出方案都由既有 validator 複查。

新增量測純函式，重用 scheduler 的 preference profile 與 evaluation 公式，輸出 utility、
review coverage、方案多樣性、課程集合 Jaccard、Kendall tau、rank shifts、credits、used days、
morning courses 與 safety 結果。另提供 interest、compact、easy、avoid-time、review-priority
五條單變量 sensitivity sweep，以及 JSON／Markdown benchmark command。

## 影響範圍

這是 server 端離線量測與文件／測試變更，不新增 API route、不修改 production 排課決策，
也不寫入 MySQL。既有 `buildPreferenceProfile()` 與 `evaluatePreference()` 只新增 export，
運算行為不變。

## 測試與驗證

- `node --test server/test/personalizationMetrics.test.js server/test/personalizationBaseline.test.js`：12/12 通過。
- `npm run bench:personalization --prefix server`：3 個 persona B1→P safety rows 通過，B1 相對 B0 的固定 fixture utility delta 為 `+0.182`，五軸 sweep 均通過全方案 safety；方向檢查將 `compact`（`-0.098666`）與 `avoid-time`（`0`）標為 observe，沒有把未達預期的結果宣稱為成功。
- `npm test --prefix server`：955/955 通過。
- `npm run lint --prefix client`：通過。
- `npm run build --prefix client`：通過。
- `node --check`：`server/src/**/*.js` 與 `server/scripts/*.js` 全數通過。
- 前端 build／瀏覽器驗收：本輪沒有使用者可見畫面或 API 行為變更，不適用；此前端 persona 資料流已由前一輪報告驗證。
- 已核對 roadmap 進度總覽整張表；#36 維持「部分完成」，因 synthetic fixture 不能替代真實去識別互動樣本，且正向改善並非所有 persona／軸都成立。

## Commit 與 push

未 commit，未 push。
