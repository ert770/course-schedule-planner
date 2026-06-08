// 記憶體模組 — 短期記憶（對話歷史）+ 長期記憶（使用者偏好）
import { getAll, insert, upsertByField, query, clearCollection } from '../db/database.js';

// ===== 短期記憶: 對話歷史 =====

export function getChatHistory(userId, limit = 20) {
  const all = getAll('chat_history').filter(m => m.userId === userId);
  return all.slice(-limit);
}

export function addChatMessage(userId, role, content) {
  return insert('chat_history', {
    userId,
    role,
    content,
    createdAt: new Date().toISOString()
  });
}

export function clearChatHistory(userId) {
  const all = getAll('chat_history');
  const filtered = all.filter(m => m.userId !== userId);
  clearCollection('chat_history');
  filtered.forEach(m => insert('chat_history', m));
}

// ===== 長期記憶: 使用者偏好 =====

export function getUserPreferences(userId = 'default') {
  const prefs = getAll('user_preferences').find(p => p.userId === userId);
  if (!prefs) {
    return {
      userId,
      displayName: '同學',
      completedCredits: 0,
      targetCreditsMin: 15,
      targetCreditsMax: 22,
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

export function updateUserPreferences(userId = 'default', updates) {
  return upsertByField('user_preferences', 'userId', userId, {
    userId,
    ...updates,
    updatedAt: new Date().toISOString()
  });
}

// ===== 已儲存課表 =====

export function getSavedSchedules(userId = 'default') {
  return getAll('saved_schedules').filter(s => s.userId === userId);
}

export function saveSchedule(userId = 'default', name, scheduleData, totalCredits) {
  return insert('saved_schedules', {
    userId,
    name,
    scheduleData,
    totalCredits,
    createdAt: new Date().toISOString()
  });
}

export default {
  getChatHistory, addChatMessage, clearChatHistory,
  getUserPreferences, updateUserPreferences,
  getSavedSchedules, saveSchedule
};
