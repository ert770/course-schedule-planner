# 2026-10-10 rag-tag-interest MySQL 整合測試準備

## 修改日期

2026-10-10

## 修改檔案

- `server/test/tagInterestMysqlIntegration.test.js`：新增 opt-in MySQL 整合測試，覆蓋同意、標籤興趣事件寫入、冪等、profile 重算及合成 subject 清理。
- `docs/CHANGE_REPORTS/2026-10-10-rag-tag-interest-mysql-integration.md`：記錄本次測試準備與限制。

## 主要改動與影響範圍

- 整合測試只有在 `TAG_INTEREST_MYSQL_TEST=1`，且 `DB_NAME` 與 `TAG_INTEREST_TEST_DB_NAME` 完全相同、資料庫名稱含獨立 `test` 字樣時才執行；否則拒絕或跳過，不會觸碰目前的 `defaultdb`。
- 測試建立隨機合成 subject，透過服務層寫入，不使用真實學生身分；結束時依該 subject ID 清除事件、興趣快取、同意及 subject 資料。
- 未修改正式 API、前後端功能、資料表 schema 或 migration。

## 測試與驗證

- 目前配置的 MySQL 資料庫名稱為 `defaultdb`，不是隔離測試資料庫；本次沒有執行任何 MySQL 寫入。
- `node --check test/tagInterestMysqlIntegration.test.js`：通過。
- rag-tag 興趣純模型／服務及 MySQL 整合測試入口：9 項通過、1 項整合測試依安全設定跳過；沒有測試失敗。
- `node --test test/interactionEvents.test.js`：53/53 通過；測試使用記憶體 store，未連接 MySQL。
- `CI=true npm test`：1,445 項通過、1 項隔離 MySQL 整合測試跳過，0 項失敗。CI 依專案設定不執行需呼叫真實模型 API 的 13 題及 1 題重跑一致性。
- 安全閘門檢查：即使設定 MySQL 測試 opt-in，`defaultdb` 仍會在建立連線前被拒絕。
- 真正的 MySQL 持久化流程尚未驗證；需設定獨立測試資料庫後執行 `TAG_INTEREST_MYSQL_TEST=1`，並令 `DB_NAME` 與 `TAG_INTEREST_TEST_DB_NAME` 完全相同。

## Commit 與 Push

- 依使用者授權，將本次兩個檔案提交並推送至 `origin backend`；commit SHA 以 Git 紀錄為準。
