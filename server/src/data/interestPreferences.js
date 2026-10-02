import { CS_TRACKS } from './csCurriculum.js';

export const INTEREST_TOPIC_LIMIT = 16;

function normalizeString(value) {
  return String(value ?? '').trim();
}

export function normalizeInterestList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(normalizeString).filter(Boolean))];
}

// 匯出供 personalizationPreferences.js 共用——preferences_json 的 canonical shape
// 只該有一份定義，兩個模組各自維護一份遲早會不一致。
export function normalizePreferencesJson(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { schemaVersion: 1, values: {} };
  }

  return {
    ...value,
    schemaVersion: Number.isInteger(Number(value.schemaVersion))
      ? Number(value.schemaVersion)
      : 1,
    values: value.values && typeof value.values === 'object' && !Array.isArray(value.values)
      ? { ...value.values }
      : {},
  };
}

// 興趣偏好使用既有 preferences_json 保存，不另增一組 MySQL 欄位。這個 helper
// 同時接受 profile 頂層欄位與 JSON 內的正式儲存值，讓單次排課參數與長期偏好
// 可以共用同一組 canonical shape。
export function readInterestPreferences(source = {}) {
  const preferencesJson = normalizePreferencesJson(source.preferencesJson);
  const values = preferencesJson.values;

  return {
    preferredTrack: normalizeString(source.preferredTrack ?? values.preferredTrack) || null,
    interests: normalizeInterestList(source.interests ?? values.interests),
    preferredKeywords: normalizeInterestList(
      source.preferredKeywords ?? values.preferredKeywords
    ),
  };
}

export function mergeInterestPreferences(preferencesJson, updates = {}) {
  const next = normalizePreferencesJson(preferencesJson);
  const values = { ...next.values };

  if (Object.hasOwn(updates, 'preferredTrack')) {
    values.preferredTrack = normalizeString(updates.preferredTrack) || null;
  }
  if (Object.hasOwn(updates, 'interests')) {
    values.interests = normalizeInterestList(updates.interests);
  }
  if (Object.hasOwn(updates, 'preferredKeywords')) {
    values.preferredKeywords = normalizeInterestList(updates.preferredKeywords);
  }

  return { ...next, values };
}

// rag_tag 是每個開課 section 的主題標籤。相同課程若有多個 section，只計一次，
// 避免開班較多的科目把興趣選項排名灌高。
export function buildInterestOptions(courses = [], { topicLimit = INTEREST_TOPIC_LIMIT } = {}) {
  const counts = new Map();
  const seenCourseTopics = new Set();

  for (const course of courses) {
    const courseKey = normalizeString(course.courseId || course.code || course.id);
    for (const topic of normalizeInterestList(course.ragTag)) {
      const uniqueKey = `${courseKey}\u0000${topic}`;
      if (seenCourseTopics.has(uniqueKey)) continue;
      seenCourseTopics.add(uniqueKey);
      counts.set(topic, (counts.get(topic) || 0) + 1);
    }
  }

  const topics = [...counts.entries()]
    .map(([name, courseCount]) => ({ name, courseCount }))
    .sort((left, right) => (
      right.courseCount - left.courseCount
      || left.name.localeCompare(right.name, 'zh-Hant')
    ))
    .slice(0, Math.max(0, Number(topicLimit) || 0));

  return {
    tracks: [...CS_TRACKS],
    topics,
  };
}

export default {
  INTEREST_TOPIC_LIMIT,
  normalizeInterestList,
  readInterestPreferences,
  mergeInterestPreferences,
  buildInterestOptions,
};
