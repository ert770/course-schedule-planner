// `POST /api/profile` 的輸入驗證。
//
// **為什麼抽成純函式**：這些規則原本寫在路由 handler 裡，要驗證它們就得起 HTTP server。
// 而在 Windows 上，起了 `app.js` 的測試檔即使斷言全過，程序仍會因為殘留的
// `TCPServerWrap`／`TCPSocketWrap` 不結束，並在退出時觸發 libuv 的
// `UV_HANDLE_CLOSING` assertion（`authRoutes`／`privacyRoutes`／`scheduleRoutes` 都有
// 這個既有問題）。為了一組輸入驗證規則再增加一個永久失敗的檔案並不划算——規則本身是
// 純資料判斷，抽出來就能用一般單元測試釘住；路由確實有接上這些規則，則以真實帳號的
// 瀏覽器實測作為證據（見 2026-09-20 的任務 3A 變更報告）。
import { isDepartmentInput } from '../utils/text.js';

const ARRAY_FIELDS = Object.freeze([
  'enrolledPrograms', 'mustTakeCourses', 'avoidInstructors', 'interests', 'preferredKeywords',
]);

/**
 * @param updates `POST /api/profile` 去掉 `userId` 之後的 body。
 * @returns `null` 代表通過；否則回傳要直接送給呼叫端的錯誤訊息字串。
 */
export function validateProfileUpdate(updates = {}) {
  // 型別錯誤的 department 必須在邊界擋下，不能靠正規化「救回來」。物件、陣列、數字
  // 經字串轉換後會變成看起來正常的值寫進資料庫，之後所有系所比對都會失敗且無從察覺。
  if (updates.department !== undefined && !isDepartmentInput(updates.department)) {
    return 'department 必須是非空字串';
  }

  for (const field of ARRAY_FIELDS) {
    if (updates[field] !== undefined && !Array.isArray(updates[field])) {
      return `${field} 必須是陣列`;
    }
  }

  if (
    updates.preferredTrack !== undefined
    && updates.preferredTrack !== null
    && typeof updates.preferredTrack !== 'string'
  ) {
    return 'preferredTrack 必須是字串或 null';
  }

  // roadmap #10 任務 3A：學習開關只接受布林值。字串 'false' 之類的東西若被型別轉換
  // 「救回來」，使用者會以為自己關掉了、系統卻還在用學到的權重。
  if (updates.useLearnedPreference !== undefined
    && typeof updates.useLearnedPreference !== 'boolean') {
    return 'useLearnedPreference 必須是布林值';
  }

  if (updates.remainingSemesters !== undefined
    && updates.remainingSemesters !== null
    && (!Number.isInteger(updates.remainingSemesters)
      || updates.remainingSemesters < 1
      || updates.remainingSemesters > 8)) {
    return 'remainingSemesters 必須是 1～8 的整數或 null';
  }

  // `preferences_json` 由專屬欄位（`interests`／`preferredTrack`／`preferredKeywords`／
  // `useLearnedPreference`）各自更新，**公開 API 不接受整包覆寫**。
  //
  // 原因是具體的：頂層 `useLearnedPreference` 有布林檢查，但先前整包 `preferencesJson`
  // 照收，送 `{ values: { useLearnedPreference: "false" } }` 就能把不合法的字串存進去，
  // 讀取時再靜默退回 `true`——型別檢查等於白做，而且與文件寫的「字串回 400」不符。
  // 整包覆寫也會順手洗掉 `values` 裡的其他鍵，那不是任何一個呼叫端真正想要的。
  if (updates.preferencesJson !== undefined) {
    return 'preferencesJson 不可直接更新，請使用 interests／preferredTrack／'
      + 'preferredKeywords／useLearnedPreference／remainingSemesters 等專屬欄位';
  }

  return null;
}

export default { validateProfileUpdate };
