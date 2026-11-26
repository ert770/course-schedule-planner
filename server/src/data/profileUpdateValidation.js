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
import { INTEREST_SELECTION_GROUPS, REMOVED_INTEREST_FIELDS } from './interestPreferences.js';
import { normalizeScheduleOptions } from './scheduleOptions.js';

// 三組選單、每組每次最多 8 個類別，另留餘裕給之後調整；超過一定是異常請求。
const MAX_INTEREST_SELECTIONS = 48;

const ARRAY_FIELDS = Object.freeze([
  'enrolledPrograms', 'mustTakeCourses', 'avoidInstructors',
]);

/**
 * @param updates `POST /api/profile` 去掉 `userId` 之後的 body。
 * @returns `null` 代表通過；否則回傳要直接送給呼叫端的錯誤訊息字串。
 */
export function validateProfileUpdate(updates = {}) {
  if (updates.initialSetupStage !== undefined && !['schedule', 'completed'].includes(updates.initialSetupStage)) {
    return 'initialSetupStage 必須是 schedule 或 completed';
  }
  if (updates.scheduleOptions !== undefined) {
    const options = updates.scheduleOptions;
    if (!options || typeof options !== 'object' || Array.isArray(options)
      || Object.keys(normalizeScheduleOptions(options)).length !== Object.keys(options).length) {
      return 'scheduleOptions 包含無效的排課條件';
    }
  }
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

  // 設定頁課程主題的選擇結果。形狀在邊界就擋下：每一筆必須是物件、組別必須在已知清單內、
  // tagIds 必須是字串陣列。是否存在於標籤目錄、標籤是否屬於所選組別，則由路由在保存前
  // 對照候選池驗證（`interestSelections.js`），不是這裡能判斷的。
  if (updates.interestSelections !== undefined) {
    if (!Array.isArray(updates.interestSelections)) return 'interestSelections 必須是陣列';
    for (const item of updates.interestSelections) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return 'interestSelections 的每一筆必須是物件';
      }
      if (!INTEREST_SELECTION_GROUPS.includes(item.group)) {
        return `interestSelections.group 必須是 ${INTEREST_SELECTION_GROUPS.join('、')} 之一`;
      }
      if (typeof item.categoryId !== 'string' || !item.categoryId.trim()) {
        return 'interestSelections.categoryId 必須是非空字串';
      }
      if (item.tagIds !== undefined
        && (!Array.isArray(item.tagIds) || item.tagIds.some(id => typeof id !== 'string'))) {
        return 'interestSelections.tagIds 必須是字串陣列';
      }
    }
    if (updates.interestSelections.length > MAX_INTEREST_SELECTIONS) {
      return `interestSelections 最多 ${MAX_INTEREST_SELECTIONS} 筆`;
    }
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

  // 這三個欄位會原樣寫進 `User_Profiles` 的整數欄位。先前沒有檢查，送 `gradeLevel: "abc"`
  // 會讓 MySQL 拒絕寫入、回 500，錯誤訊息還帶出資料表欄位名稱（2026-11-08 黑箱測試發現）。
  // 字串 '2' 同樣擋下：前端一律送數字，型別轉換「救回來」只會讓不合法的呼叫端看似成功。
  for (const field of ['gradeLevel', 'targetCreditsMax', 'schemaVersion']) {
    const value = updates[field];
    if (value !== undefined && value !== null && (!Number.isInteger(value) || value < 1)) {
      return `${field} 必須是正整數或 null`;
    }
  }

  // `preferences_json` 由專屬欄位（`preferredTrack`／`interestSelections`／
  // `useLearnedPreference`）各自更新，**公開 API 不接受整包覆寫**。
  //
  // 原因是具體的：頂層 `useLearnedPreference` 有布林檢查，但先前整包 `preferencesJson`
  // 照收，送 `{ values: { useLearnedPreference: "false" } }` 就能把不合法的字串存進去，
  // 讀取時再靜默退回 `true`——型別檢查等於白做，而且與文件寫的「字串回 400」不符。
  // 整包覆寫也會順手洗掉 `values` 裡的其他鍵，那不是任何一個呼叫端真正想要的。
  if (updates.preferencesJson !== undefined) {
    return 'preferencesJson 不可直接更新，請使用 preferredTrack／'
      + 'interestSelections／useLearnedPreference／remainingSemesters 等專屬欄位';
  }
  // 舊的文字興趣欄位已移除（ADR-032）：長期興趣改由課程主題問答（interestSelections）設定。
  const removed = REMOVED_INTEREST_FIELDS.find(field => updates[field] !== undefined);
  if (removed) {
    return `${removed} 已停用，請改用設定頁的課程主題問答（interestSelections）`;
  }

  return null;
}

export default { validateProfileUpdate };
