import { getAll, insert, upsertByField, clearCollection } from '../db/database.js';

export async function getChatHistory(userId, limit = 20) {
  const all = (await getAll('chat_history')).filter(message => String(message.userId) === String(userId));
  return all.slice(-limit);
}

export async function addChatMessage(userId, role, content) {
  return insert('chat_history', {
    userId,
    role,
    content,
    createdAt: new Date().toISOString(),
  });
}

export async function clearChatHistory(userId) {
  const all = await getAll('chat_history');
  const filtered = all.filter(message => String(message.userId) !== String(userId));
  await clearCollection('chat_history');
  for (const message of filtered) {
    await insert('chat_history', message);
  }
}

// 沒有 profile 時的骨架。
//
// **不含任何偏好旗標。** 偏好一律由 `preference_tags` 推導，缺席即代表未勾選；
// 在這裡補 `noMorningClasses: false` 之類的合成值，會在與其他來源合併時
// 把使用者真正存的 true 蓋掉——那正是偏好靜默消失的成因。
function emptyProfile(identity) {
  return {
    userId: String(identity.canonicalId),
    studentId: identity.studentId ?? null,
    displayName: identity.displayName || '使用者',
    completedCredits: 0,
    completedCourseIds: [],
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

// 歷史修課存在 `users.json`（2026-08-06 匯入），偏好存在 `User_Profiles`。
// 排課只讀後者，因此在 profile 層合併——否則排課器永遠看不到修課歷史。
async function readCourseHistory(identity) {
  const users = await getAll('users');
  const user = users.find(item =>
    String(item.studentId) === String(identity.studentId)
    || String(item.id) === String(identity.canonicalId)
  );

  if (!user) return {};

  return {
    completedCourseCodes: user.completedCourseCodes ?? [],
    courseHistory: user.courseHistory ?? [],
    completedCredits: user.completedCredits ?? 0,
  };
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
// | `blockedPeriods`（第 2～14 節） | `User_Profiles.avoid_time` | 有對應欄位（決策 C） |
// | `targetCreditsMax` | `User_Profiles.max_credits` | 有對應欄位 |
// | `studentId`、`name`、`className` | `users.json` | `User_Profiles` 沒有這些欄位 |
// | `courseHistory`、`completedCourseCodes`、`completedCredits`、`earnedCredits` | `users.json` | 同上；2026-08-06 由成績單匯入 |
// | 其餘本機設定 | `user_preferences.json` | 前兩者都沒有欄位時的落腳處 |
//
// 合併順序刻意讓 MySQL 最後蓋上去：`user_preferences.json` 留有 canonical 化之前
// 寫入的舊值，若讓它覆蓋 MySQL，使用者剛存的偏好會被過期值取代。
export async function getUserPreferences(identity) {
  const prefs = (await getAll('user_preferences'))
    .find(profile => String(profile.userId) === String(identity.canonicalId));

  const history = await readCourseHistory(identity);

  return {
    ...emptyProfile(identity),
    ...(prefs || {}),
    // 歷史修課的真相來源是 users.json，偏好列不得覆蓋它。
    ...history,
  };
}

// 寫入走 canonical ID。canonical 是 numeric id，因此 MySQL 的
// `UPDATE User_Profiles WHERE user_id = ?` 會真的命中，而不是像先前那樣
// 對非數字 userId 直接 return null 後靜默落到 JSON。
export async function updateUserPreferences(identity, updates) {
  const canonicalId = String(identity.canonicalId);

  return upsertByField('user_preferences', 'userId', canonicalId, {
    userId: canonicalId,
    ...updates,
    updatedAt: new Date().toISOString(),
  });
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

export default {
  getChatHistory,
  addChatMessage,
  clearChatHistory,
  getUserPreferences,
  updateUserPreferences,
  getSavedSchedules,
  saveSchedule,
};
