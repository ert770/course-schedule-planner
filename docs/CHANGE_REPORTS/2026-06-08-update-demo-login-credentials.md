# 2026-06-08 變更報告：更新 Demo 登入帳密

## 修改日期

2026-06-08

## 修改檔案清單

- `server/data/users.json`
- `docs/CHANGE_REPORTS/2026-06-08-update-demo-login-credentials.md`

## 主要改動內容

1. 更新 demo 使用者登入帳號。
   - 原學號：`D1249196`
   - 新學號：`D1249697`

2. 更新 demo 使用者登入密碼。
   - 原密碼：`fcu12345`
   - 新密碼：`123`

## 影響範圍

- 影響前端登入頁可使用的 demo 帳密。
- 影響後端 `POST /api/auth/login` 驗證資料。
- 未修改前端、後端 API 邏輯、排課邏輯或 AI Agent 程式碼。

## 測試與驗證結果

已使用後端登入 API 驗證：

```text
POST /api/auth/login
```

request body：

```json
{
  "studentId": "D1249697",
  "password": "123"
}
```

實際結果：

```json
{
  "success": true
}
```

HTTP status：

```text
200
```

## Commit 與 Push

驗證通過後，將依照專案 Git 規範 commit 並 push 到：

```text
origin main
```
