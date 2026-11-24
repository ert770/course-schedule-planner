# 拿掉首頁「本學期課程主題」區塊、補回 AGENTS.md 的 om 一節

日期：2026-11-24

## 背景

- 首頁左側的「🌳 本學期課程主題」是早期技能樹的殘留：寫死 5 個關鍵字（安全、程式、資料庫、人工智慧、微積分），數目前課表有幾門課的課名或說明含這些字。與課程主題問答、主題標籤都無關，使用者看不懂用途。使用者決定（2026-11-24）：拿掉。
- `AGENTS.md` 的「跨 Agent 共用記憶（om）」一節（63 行）原本是未提交的修改，切換分支時從工作區消失。使用者決定（2026-11-24）：照原文補回。

## 修改檔案

| 檔案 | 內容 |
| --- | --- |
| `client/src/pages/DashboardPage.jsx` | 移除「本學期課程主題」區塊、「查看課程主題」按鈕與視窗 |
| `client/src/components/Profile/SkillTreeModal.jsx` | 刪除（沒有其他地方使用） |
| `AGENTS.md` | 補回「跨 Agent 共用記憶（om）」一節 |

## 影響範圍

- 只影響首頁左側欄；偏好區、排課、聊天不變。
- 畢業進度 API 回傳的 `skillTree` 欄位與 `App.css` 中早已沒有使用的 `skill-tree` 樣式未動。

## 測試與驗證

- 前端 `npm run lint`、`npm run build` 通過。
- 瀏覽器（D1249697，本機 `localhost:5173`）A/B：還原舊版時首頁有「本學期課程主題」與「查看課程主題」；改後兩者都沒有，「保存變更」與聊天輸入框仍在。API 皆正常，只有既有的 `/api/controlled-browser/config` 404。

## Commit 與 push

commit 並 push 至 `origin backend`。
