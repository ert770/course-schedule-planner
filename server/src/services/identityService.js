// Canonical user identity。
//
// 專案裡同時存在兩個 ID 空間：
//
// | 空間 | 範例 | 來源 | 性質 |
// | --- | --- | --- | --- |
// | `studentId` | `D1249697` | `users.json`、登入表單 | 學生知道的值，前端唯一會送的值 |
// | numeric `id` | `1` | `users.json.id`、`User_Profiles.user_id` | MySQL 的 NOT NULL 數字主鍵 |
//
// **實測到的後果**：`updateMysqlUserPreference()` 對非數字 userId 直接 `return null`，
// 所以前端送 `studentId` 時 MySQL profile 寫入會被**靜默跳過**，資料改落到
// 當時還存在的 `server/data/user_preferences.json`。同一位學生因此同時存在：
//
//   - `User_Profiles.user_id = 1`（真正被排課讀到的那份）
//   - `user_preferences.json` 的 `userId = "D1249697"`（內容已過期的副本）
//   - `user_preferences.json` 的 `userId = "1"`（空殼）
//
// 那個檔案已於 2026-08-11 刪除，`User_Profiles` 是 profile 的唯一儲存體；
// 寫不進去會拋錯而不是落到別處（見 `services/memoryService.js` 的欄位擁有權契約）。
//
// canonical ID 選 **`studentId`**：學號是這個領域裡「這個人是誰」的答案，
// 使用者、登入表單、畢業查詢用的都是它。`User_Profiles.user_id = 1` 只是
// **某一個儲存體的內部主鍵**，不該外溢成全系統的身分。
//
// 代價是 MySQL 邊界需要一層 `studentId ↔ user_id` 轉換，那層藏在 `db/database.js`：
// 讀取時 `mapUserProfileRow()` 把 `user_id` 換成 studentId，寫入時
// `updateMysqlUserPreference()` 把 studentId 換回 `user_id`。對照來源是
// `users.json` 的同一列，不做任何推測。
//
// 這裡刻意**不做 ID 猜測**：`D1249697` 與 `1` 的對應只能來自 `users.json` 同一列。
// 對不到就回傳 `found: false` 讓呼叫端回 404，不得退回 `default` 使用者。

import { getAll } from '../db/database.js';

function sameId(left, right) {
  return String(left) === String(right);
}

export function isNumericId(value) {
  return /^\d+$/.test(String(value ?? '').trim());
}

// 純函式：給定 users 集合與任一種 ID，解析出 canonical identity。
// 與 I/O 分離才測得到。
export function resolveIdentityFrom(users = [], rawId) {
  const key = String(rawId ?? '').trim();

  if (!key) {
    return { found: false, reason: 'missing' };
  }

  // `default` 曾是預設值，現在明確視為無效身分而非可用帳號。
  if (key === 'default') {
    return { found: false, reason: 'default-user-not-allowed' };
  }

  const user = users.find(item => sameId(item.studentId, key) || sameId(item.id, key));
  if (!user) {
    return { found: false, reason: 'unknown-user' };
  }

  const hasNumericId = user.id !== undefined && isNumericId(user.id);
  const studentId = user.studentId !== undefined ? String(user.studentId) : null;

  return {
    found: true,
    // canonical 是學號。沒有學號的資料列才退回 numeric id——那種列
    // 在 UI 上也無法登入，屬於資料異常而非正常情況。
    canonicalId: studentId ?? String(user.id),
    studentId,
    // `User_Profiles.user_id`。只有 MySQL 邊界會用到，其餘程式一律用 canonicalId。
    numericId: hasNumericId ? String(user.id) : null,
    displayName: user.name ?? null,
    className: user.className ?? null,
    // 沒有 numeric id 代表寫不進 User_Profiles，呼叫端需要知道。
    canWriteMysqlProfile: hasNumericId,
  };
}

// 所有 route 都應在邊界呼叫這一支，之後只傳 canonical identity。
export async function resolveIdentity(rawId) {
  return resolveIdentityFrom(await getAll('users'), rawId);
}

// route 共用的錯誤回應。把「沒帶身分」與「帶了但查無此人」分開，
// 否則前端無法區分要導去登入還是資料有問題。
export function identityErrorResponse(identity) {
  if (identity.reason === 'missing' || identity.reason === 'default-user-not-allowed') {
    return { status: 401, error: '未提供有效的使用者身分，請先登入' };
  }
  return { status: 404, error: '找不到使用者' };
}

export default {
  isNumericId,
  resolveIdentityFrom,
  resolveIdentity,
  identityErrorResponse,
};
