import {
  getAll, insert, upsertByField, clearCollection, getUserCourseHistory,
} from '../db/database.js';
import { normalizeProfile } from '../data/profileSchema.js';
import { queryRows } from '../db/mysql.js';

// 沒有 profile 時的骨架。
//
// **不含任何偏好旗標。** 偏好一律由 `preference_tags` 推導，缺席即代表未勾選；
// 在這裡補 `noMorningClasses: false` 之類的合成值，會在與其他來源合併時
// 把使用者真正存的 true 蓋掉——那正是偏好靜默消失的成因。
//
// 同理**不含任何修課歷史的派生欄位**（`completedCourseCodes`、`completedCredits`
// 之類）。修課歷史只有 `courseHistory` 一個代表，課號與學分一律由
// `data/courseHistory.js` 的函式當場算。
function emptyProfile(identity) {
  return {
    userId: String(identity.canonicalId),
    studentId: identity.studentId ?? null,
    displayName: identity.displayName || '使用者',
    courseHistory: [],
    targetCreditsMin: 12,
    targetCreditsMax: 25,
    blockedPeriods: [],
    preferredCategories: [],
    preferenceTags: [],
    selectedTags: [],
    mustTakeCourses: [],
    avoidInstructors: [],
    preferencesJson: {},
  };
}

// 歷史修課存在 MySQL `User_Course_History`，與偏好一樣由 profile 層組合。
//
// **只回傳 `courseHistory` 本身，不派生任何欄位。** 先前這裡另外回傳
// `completedCourseCodes` 與 `completedCredits`，那是把同一份資料從檔案搬到
// 記憶體再存一次；需要課號或學分的呼叫端改為自行呼叫
// `data/courseHistory.js` 的 `getPassedCourseCodes()` / `getEarnedCredits()` /
// `getTotalEarnedCredits()`。
async function readCourseHistory(identity) {
  return { courseHistory: await getUserCourseHistory(identity) };
}

// Profile 的欄位擁有權契約。
//
// **源頭是 MySQL**，兩個 JSON 檔是解析後的物件資料，都要使用；但同一個欄位
// 只能有一個擁有者，否則就是先前那種「MySQL 說避開早八、JSON 說不避」的狀態。
//
// | 欄位 | 擁有者 | 理由 |
// | --- | --- | --- |
// | `department`、`gradeLevel` | `User_Profiles` | 有對應欄位，排課直接讀 |
// | 偏好標籤與其推導出的旗標 | `User_Profiles.preference_tags` | 有對應欄位；標籤是儲存格式 |
// | `blockedPeriods`（第 1～14 節） | `User_Profiles.avoid_time` | 有對應欄位 |
// | `targetCreditsMax` | `User_Profiles.max_credits` | 有對應欄位 |
// | `studentId`、`name`、`className` | `users.json` | `User_Profiles` 沒有這些欄位 |
// | `courseHistory` | `User_Course_History` | 11 欄完整歷史修課契約；只從 MySQL 讀取 |
//
// **修課歷史只有 `courseHistory` 一個代表。** `completedCourseCodes`、
// `completedCourseNames`、`completedCourseIds`、`completedCredits`、`earnedCredits`
// 五個欄位都是它算得出來的東西，已於 2026-08-11 從 `users.json` 移除；
// 課號與學分請呼叫 `data/courseHistory.js` 的派生函式，不要在 profile 上
// 重新長出同名欄位。
//
// **`User_Profiles` 是 profile 的唯一儲存體。** 曾經有第三個位置
// `server/data/user_preferences.json`，用來接住「MySQL 沒有這個人」的情況。
// 該檔已於 2026-08-11 刪除，理由是同一個欄位存兩份必然漂移——實測就出現過
// MySQL 說「避開早八」而 JSON 說「不避」，而且沒有任何東西能判斷誰對。
//
// 因此 `getAll('user_preferences')` 現在只會回傳 `User_Profiles` 的內容
// （集合名稱維持不變，是這個 store 的邏輯名稱）。寫不進 MySQL 時
// `upsertByField()` 會拋錯，不再有靜默落到本機檔案的後路。
export async function getUserPreferences(identity) {
  const prefs = (await getAll('user_preferences'))
    .find(profile => String(profile.userId) === String(identity.canonicalId));

  const history = await readCourseHistory(identity);

  return normalizeProfile({
    ...emptyProfile(identity),
    ...(prefs || {}),
    // 歷史修課的真相來源是 User_Course_History，偏好列不得覆蓋它。
    ...history,
  });
}

// 寫入走 canonical ID（學號），由 `db/database.js` 在 MySQL 邊界換成
// `User_Profiles.user_id`。先前對非數字 userId 直接 return null 再靜默落到
// 本機 JSON，前端送學號時每一次寫入都被跳過而毫無跡象；現在寫不進去會拋錯。
export async function updateUserPreferences(identity, updates) {
  const canonicalId = String(identity.canonicalId);

  await upsertByField('user_preferences', 'userId', canonicalId, {
    userId: canonicalId,
    ...updates,
    updatedAt: new Date().toISOString(),
  });
  return getUserPreferences(identity);
}

export async function getSavedSchedules(userId) {
  return (await getAll('saved_schedules'))
    .filter(schedule => String(schedule.userId) === String(userId));
}

export async function saveSchedule(userId, name, scheduleData, totalCredits) {
  return insert('saved_schedules', {
    userId,
    name,
    scheduleData,
    totalCredits,
    createdAt: new Date().toISOString(),
  });
}

async function replaceJsonCollection(collection, rows) {
  await clearCollection(collection);
  for (const row of rows) await insert(collection, row);
}

// 這是「刪除整個服務帳號與資料」，不是只清偏好。需要 privacy route 的短效
// 單次 token 與固定確認詞才可呼叫。先刪 shared MySQL profile，再刪本機課表與
// 登入列；每一步都是 idempotent，若中途失敗可由受控清理程序重試。
export async function deleteUserServiceData(identity) {
  if (!identity.numericId) throw new Error('缺少 User_Profiles numeric ID，無法執行完整刪除');

  const profileResult = await queryRows('DELETE FROM `User_Profiles` WHERE `user_id` = ?', [identity.numericId]);
  const savedSchedules = await getAll('saved_schedules');
  const remainingSchedules = savedSchedules.filter(row => String(row.userId) !== String(identity.canonicalId));
  await replaceJsonCollection('saved_schedules', remainingSchedules);

  const users = await getAll('users');
  const remainingUsers = users.filter(row => (
    String(row.studentId) !== String(identity.studentId)
    && String(row.id) !== String(identity.numericId)
  ));
  await replaceJsonCollection('users', remainingUsers);

  return {
    profileRowsDeleted: Number(profileResult.affectedRows || 0),
    savedSchedulesDeleted: savedSchedules.length - remainingSchedules.length,
    accountRowsDeleted: users.length - remainingUsers.length,
  };
}

export default {
  getUserPreferences,
  updateUserPreferences,
  getSavedSchedules,
  saveSchedule,
  deleteUserServiceData,
};
