# 探索頁排除全校共同必修

日期：2026-11-24

## 背景

「從一門課出發」的起點選單仍列出中文、英文等全校共同必修（D1249697 有 8 門）。這些課每位學生都要修，拿來當探索起點或推薦結果沒有意義。

使用者決定（2026-11-24）：共同必修從探索清單移除。

## 共同必修的辨識

沿用通識畢業認列（roadmap #23）「基礎必修」的課程身分辨識，不另寫一套：

- 課名前綴：中文思辨與表達、大學基礎英文、大學精進英文（英文各級別課號不同，所以用課名）。
- 核心必修課號：`GEG2000` 現代公民與社會實踐、`GEK2000` 科學與人文的對話。

## 修改檔案

| 檔案 | 內容 |
| --- | --- |
| `server/src/data/generalEducationRecognition.js` | 新增 `isCommonRequiredCourse({ courseCode, courseName })`，只看課程身分 |
| `server/src/services/explorationService.js` | `isExcludedFromExploration` 加上共同必修（起點選單）；`buildCandidates` 排除共同必修（兩種模式的候選） |
| `client/src/pages/ExplorePage.jsx` | 說明文字補上「中文與英文等全校共同必修」不列入 |
| `server/test/explorationService.test.js` | 新增 XS1f；XS1c、XS2c 原本用「中文思辨與表達(一)」當「沒有向量的課」，改用「中國文學史(二)」 |
| `docs/API_SPEC.md`、`docs/SCHEDULING_LOGIC.md` | 排除規則 |

## 影響範圍

- 只影響探索頁；不改自動排課、畢業計算與通識認列。
- D1249697 實測：起點 47 門 → 39 門（少 4 門英文、2 門中文、2 門核心必修），預設起點仍是「Python程式設計」。所有起點推出的結果改前 70 門次、改後 54 門次，改前結果裡本來就沒有共同必修（學生已修過），候選端的排除是防護。

## 測試與驗證

- 探索服務測試 32 項全過；XS1f 在改動前失敗、改動後通過。
- 全部 `npm test`、前端 lint、build、後端 `node --check` 結果見 commit 回報。
- 瀏覽器（D1249697，本機預覽，後端從 `server` 目錄啟動以讀到 `server/.env`）：「從一門課出發」選單 39 門、沒有共同必修、預設 Python程式設計；說明文字顯示新句子。同時在頁面內把一門起點的回應改成不可用，選單顯示「邏輯設計（尚未建立比較資料）」，補驗了同一 PR 前一個 commit 的標記文字。console 只有登入前的 401 與既有的 404。

## Commit 與 push

併入 `fix/explore-label-wording`（PR #40）。`docs/CHANGE_REPORTS/README.md` 只提交本報告的索引一行。
