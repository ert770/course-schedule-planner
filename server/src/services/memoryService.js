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

export async function getUserPreferences(userId = 'default') {
  const prefs = (await getAll('user_preferences'))
    .find(profile => String(profile.userId) === String(userId));

  if (!prefs) {
    return {
      userId,
      displayName: '使用者',
      completedCredits: 0,
      completedCourseIds: [],
      targetCreditsMin: 12,
      targetCreditsMax: 25,
      blockedPeriods: [],
      preferredCategories: [],
      mustTakeCourses: [],
      avoidInstructors: [],
      preferCompact: false,
      noMorningClasses: false,
      noEveningClasses: false,
      preferencesJson: {},
    };
  }

  return prefs;
}

export async function updateUserPreferences(userId = 'default', updates) {
  return upsertByField('user_preferences', 'userId', userId, {
    userId,
    ...updates,
    updatedAt: new Date().toISOString(),
  });
}

export async function getSavedSchedules(userId = 'default') {
  return (await getAll('saved_schedules'))
    .filter(schedule => String(schedule.userId) === String(userId));
}

export async function saveSchedule(userId = 'default', name, scheduleData, totalCredits) {
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
