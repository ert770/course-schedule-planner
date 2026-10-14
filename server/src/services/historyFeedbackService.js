// 協同過濾與 User Embedding 構想階段 5：歷史修課回饋視窗的資料來源。
// 構想見 docs/CHANGE_REPORTS/2026-10-14-cf-user-embedding-design.md 3.4。
//
// 列出使用者可以回饋的歷史課：最新一次已通過的選修／通識／系外選修（必修不列），
// 且必須有可比對的課程標籤（否則回答對向量沒有作用）與當學期班次（事件快照要從班次讀標籤）。
// 每門課附上目前的回答（未到期事件中最後一次）。唯讀：回答本身由 POST /api/interactions 寫入。

import { ACTIVE_TERM, normalizeSemesterLabel } from '../data/activeTerm.js';
import { getPassedNonRequiredAttempts } from '../data/courseHistory.js';
import { PRIVACY_RETENTION } from '../data/privacyPolicy.js';
import { getCachedCourseCatalog } from './courseCatalogCache.js';
import { getInteractionEventsForExport, hasPersonalizationConsent } from './interactionEventService.js';
import { getUserPreferences } from './memoryService.js';
import { getCourseTagIndex } from './userTagVectorService.js';

const normalizeCode = value => String(value ?? '').trim().toUpperCase();

function termKey(entry) {
  const year = Number(entry?.academicYear) || 0;
  const semester = normalizeSemesterLabel(entry?.semester) === 'second' ? 2 : 1;
  return year * 10 + semester;
}

// 當學期、有上課時間的班次，課號 → 班次 ID（取最小的，結果可重現）。
function currentSectionByCode(courses) {
  const byCode = new Map();
  for (const course of courses) {
    const code = normalizeCode(course.catalogCourseCode);
    const id = Number(course.sectionId ?? course.id);
    if (!code || !Number.isInteger(id)) continue;
    if (Number(course.year) !== Number(ACTIVE_TERM.academicYear)
      || normalizeSemesterLabel(course.semester) !== normalizeSemesterLabel(ACTIVE_TERM.semester)) continue;
    if (!byCode.has(code) || id < byCode.get(code)) byCode.set(code, id);
  }
  return byCode;
}

function latestResponses(events, now) {
  const retentionMs = PRIVACY_RETENTION.interactionEventDays * 86400000;
  const latest = new Map();
  const sorted = [...events]
    .filter(event => event.eventType === 'history_course_feedback')
    .filter(event => {
      const time = Date.parse(event.timestamp ?? '');
      return Number.isFinite(time) && now - time <= retentionMs;
    })
    .sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
  for (const event of sorted) {
    latest.set(normalizeCode(event.course?.catalogCourseCode), {
      response: event.interestFeedback?.response ?? null,
      answeredAt: event.timestamp,
    });
  }
  return latest;
}

/**
 * @param deps 測試用注入：`{ loadProfile, loadCourses, loadConsent, loadEvents, now }`。
 * @returns `{ consented, term, groups: [{ academicYear, semester, courses: [...] }], pendingCount, excluded }`
 */
export async function getHistoryFeedbackCourses(identity, deps = {}) {
  const now = deps.now ? Number(deps.now()) : Date.now();
  const consented = deps.loadConsent ? await deps.loadConsent(identity) : await hasPersonalizationConsent(identity);
  const base = { consented, term: { academicYear: ACTIVE_TERM.academicYear, semester: ACTIVE_TERM.semester } };
  if (!consented) return { ...base, groups: [], pendingCount: 0, excluded: { noTags: 0, notOfferedThisTerm: 0 } };

  const profile = deps.loadProfile ? await deps.loadProfile(identity) : await getUserPreferences(identity);
  const courses = deps.loadCourses ? await deps.loadCourses() : await getCachedCourseCatalog();
  const index = getCourseTagIndex(courses);
  const sections = currentSectionByCode(courses);
  const events = deps.loadEvents ? await deps.loadEvents(identity) : await getInteractionEventsForExport(identity);
  const responses = latestResponses(events, now);

  const excluded = { noTags: 0, notOfferedThisTerm: 0 };
  const groups = new Map();
  for (const entry of getPassedNonRequiredAttempts(profile?.courseHistory ?? [])) {
    const code = normalizeCode(entry.courseCode);
    // 先看本學期有沒有開（沒開的課在課程資料中查不到，也就談不上有沒有標籤），再看標籤。
    const sectionId = sections.get(code);
    if (!sectionId) { excluded.notOfferedThisTerm += 1; continue; }
    if (!(index.vectors.get(code)?.norm > 0)) { excluded.noTags += 1; continue; }
    const key = termKey(entry);
    if (!groups.has(key)) {
      groups.set(key, { academicYear: Number(entry.academicYear) || null, semester: Number(entry.semester) || null, courses: [] });
    }
    groups.get(key).courses.push({
      courseCode: code,
      name: entry.courseName ?? index.courseNames.get(code) ?? code,
      sectionId,
      graduationCategory: entry.graduationCategory,
      response: responses.get(code)?.response ?? null,
      answeredAt: responses.get(code)?.answeredAt ?? null,
    });
  }
  const sortedGroups = [...groups.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([, group]) => ({ ...group, courses: group.courses.sort((a, b) => a.courseCode.localeCompare(b.courseCode)) }));
  const pendingCount = sortedGroups.reduce((sum, group) => sum + group.courses.filter(course => course.response === null).length, 0);
  return { ...base, groups: sortedGroups, pendingCount, excluded };
}

export default { getHistoryFeedbackCourses };
