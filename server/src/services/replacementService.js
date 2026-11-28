// 換課候選：Agent 的 `find_replacement_courses` 與首頁課程格的「備選」按鈕共用同一套規則。
//
// 課表上其他課的時段固定，找「不衝堂、可修、沒修過、符合已存偏好」的班次。
// 只用伺服器端的事實（目前課表的 sectionId、課程資料、已存偏好），不依賴前端或模型記得時間。

import { getCachedCourseCatalog } from './courseCatalogCache.js';
import { buildStudentScope } from '../skills/courseScope.js';
import {
  timeConflict, getCourseKey, getTimeBlocks, hardConstraintReason, rankReplacementCandidates,
} from '../skills/scheduler.js';
import { searchCoursesForSchedule, filterCategorizedCourses } from '../skills/courseQuery.js';
import { buildScheduleConstraints } from './constraintService.js';
import { getPassedCourseCodes } from '../data/courseHistory.js';
import { scheduleOptionCourseViolation } from '../data/scheduleOptions.js';
import { getUserPreferences, readScheduleAvoidances } from './memoryService.js';
import {
  prepareGenerationInputs, loadTagInterestContextSafely, loadVectorInterestContext, loadCfInterestContext,
} from './scheduleService.js';
import { resolveTagInterestRankingMode } from '../skills/tagInterestRanking.js';
import { resolveCfInterestMode, resolveVectorInterestMode } from '../skills/interestAlphas.js';

export const ALTERNATIVE_LIMIT = 8;

// 排除原因（給模型解釋「為什麼查不到」用的中文標籤）。
export const REPLACEMENT_EXCLUSION_LABELS = Object.freeze({
  inSchedule: '已在課表上',
  sameCourse: '與課表上的課是同一門課',
  removedThisSession: '這次已移除過',
  passed: '已經修過',
  ineligible: '資格不符',
  noTime: '沒有上課時間',
  timeConflict: '與課表上其他課衝堂',
  preference: '不符合已存的排課偏好（早八、星期一排空、午休、不能上課的時段或避開教師）',
});

// 可修的排前面；同級維持原順序。
const ELIGIBILITY_RANK = { eligible: 0, unknown: 1 };
export function rankByEligibility(courses = []) {
  return courses
    .map((course, index) => ({ course, index }))
    .sort((a, b) => (
      (ELIGIBILITY_RANK[a.course?.eligibility] ?? 2) - (ELIGIBILITY_RANK[b.course?.eligibility] ?? 2)
      || a.index - b.index
    ))
    .map(entry => entry.course);
}

function replacementExclusionReason(course, state) {
  const id = Number(course.sectionId ?? course.id);
  if (state.scheduleIds.has(id)) return 'inSchedule';
  if (state.removedIds.has(id)) return 'removedThisSession';
  if (course.eligibility === 'ineligible') return 'ineligible';
  if (getTimeBlocks(course).length === 0) return 'noTime';
  if (course.catalogCourseCode && state.passed.has(course.catalogCourseCode)) return 'passed';
  if (state.usedKeys.has(getCourseKey(course))) return 'sameCourse';
  if (state.others.some(other => timeConflict(other, course))) return 'timeConflict';
  if (hardConstraintReason(course, state.constraints)) return 'preference';
  return null;
}

export function describeExclusions(excluded) {
  return Object.fromEntries(
    Object.entries(excluded).map(([reason, count]) => [REPLACEMENT_EXCLUSION_LABELS[reason] ?? reason, count])
  );
}

export async function findReplacementCandidates(
  { replaceSectionId, filters = {} }, ctx, { lookupCourses, searchScheduleCourses = searchCoursesForSchedule }
) {
  const current = ctx.planningContext?.currentCourses ?? [];
  const replaceId = Number(replaceSectionId);
  if (!Number.isInteger(replaceId) || !current.some(course => Number(course.sectionId) === replaceId)) {
    return {
      error: `sectionId ${replaceSectionId} 不在使用者目前的課表裡，無法替換。請用「目前規劃狀態」列出的 sectionId。`,
      errorCode: 'REPLACE_TARGET_NOT_IN_SCHEDULE',
    };
  }
  const scheduleIds = current.map(course => Number(course.sectionId));
  const byId = await lookupCourses(scheduleIds);
  const others = scheduleIds.filter(id => id !== replaceId).map(id => byId.get(id)).filter(Boolean);
  const state = {
    scheduleIds: new Set(scheduleIds),
    removedIds: new Set((ctx.planningContext?.removedCourses ?? []).map(course => Number(course.sectionId))),
    passed: new Set(getPassedCourseCodes(ctx.prefs?.courseHistory ?? [])),
    // 被換掉的那門本身可以換成同課另一班；其他課的同課班次不算「換一門課」。
    usedKeys: new Set(others.map(getCourseKey)),
    others,
    constraints: buildScheduleConstraints({}, ctx.prefs ?? {}),
  };

  const pool = await searchScheduleCourses(filters, ctx.studentScope);
  const excluded = {};
  const candidates = [];
  for (const course of pool) {
    const reason = replacementExclusionReason(course, state);
    if (reason) {
      excluded[reason] = (excluded[reason] ?? 0) + 1;
      continue;
    }
    candidates.push(course);
  }
  return { candidates: rankByEligibility(candidates), excluded, poolSize: pool.length, others, constraints: state.constraints };
}

// 按鈕要快：完整課程目錄用 10 分鐘快取（`getAll('courses')` 每次都重查 MySQL，要 1.4～5 秒）。
async function loadCoursesById(ids) {
  const wanted = new Set(ids.map(Number));
  const courses = await getCachedCourseCatalog();
  return new Map(courses.filter(course => wanted.has(Number(course.id))).map(course => [Number(course.id), course]));
}

/**
 * 課程格的「備選」：某一門課可以直接換上的選修、通識、系外課（不列必修），依排課分數由高到低。
 *
 * @param input `{ sectionId, currentIds }`：要換掉的班次，以及畫面上目前課表的全部班次 id。
 */
export async function listAlternatives(identity, { sectionId, currentIds }, deps = {}) {
  const {
    loadPreferences = getUserPreferences,
    prepare = prepareGenerationInputs,
    lookupCourses = loadCoursesById,
    // 與 `searchCoursesForSchedule` 相同的排課候選範圍，只是讀快取的目錄。
    searchPool = async (filters, scope) => filterCategorizedCourses(
      await getCachedCourseCatalog(), filters, scope, { includeGeneralEducation: true, schedulingPool: true }
    ),
    loadTag = loadTagInterestContextSafely,
    loadVector = loadVectorInterestContext,
    loadCf = loadCfInterestContext,
    limit = ALTERNATIVE_LIMIT,
  } = deps;
  const prefs = await loadPreferences(identity);
  const studentScope = buildStudentScope(prefs);
  const avoided = new Set(readScheduleAvoidances(prefs.preferencesJson).map(item => Number(item.sectionId)));
  const ctx = {
    identity,
    prefs,
    studentScope,
    planningContext: { currentCourses: currentIds.map(id => ({ sectionId: Number(id) })), removedCourses: [] },
  };
  const found = await findReplacementCandidates({ replaceSectionId: sectionId }, ctx, {
    lookupCourses, searchScheduleCourses: searchPool,
  });
  if (found.error) {
    throw Object.assign(new Error('這門課已不在目前的課表裡，請重新整理後再試。'), { status: 400 });
  }
  const open = found.candidates.filter(course => (
    // 使用者指定：備選不列必修。
    course.category !== '必修'
    && course.eligibility !== 'unknown'
    && !avoided.has(Number(course.sectionId ?? course.id))
  ));
  if (open.length === 0) return { sectionId: Number(sectionId), alternatives: [] };

  // 排課限制與興趣分數同時載入（資料庫往返多，串著跑會讓使用者等十秒以上）。
  // 分數與排課同一套：基礎分、偏好、主題興趣 s_tag，以及啟用中的 s_vec／s_cf。
  const [prepared, tagInterestContext, vectorInterestContext, cfInterestContext] = await Promise.all([
    // 'keyword' 讓系外保留名額略過 s_vec 計算：下面自己會算一次，不必重複。
    prepare(identity, {}, { prefs, externalInterestReservationMode: 'keyword' }),
    loadTag(identity, open, { mode: resolveTagInterestRankingMode(process.env.TAG_INTEREST_RANKING_MODE), prefs }),
    loadVector(identity, prefs, open, { mode: resolveVectorInterestMode(process.env.VECTOR_INTEREST_MODE) }),
    loadCf(identity, prefs, open, { mode: resolveCfInterestMode(process.env.CF_INTEREST_MODE) }),
  ]);
  const constraints = prepared.mergedConstraints;
  const otherCredits = found.others.reduce((sum, course) => sum + Number(course.credits || 0), 0);
  const eligible = open.filter(course => (
    (constraints.maxCredits == null || otherCredits + Number(course.credits || 0) <= constraints.maxCredits)
    && !(constraints.scheduleOptions
      && scheduleOptionCourseViolation(course, constraints.scheduleOptions, getTimeBlocks(course)))
  ));
  const ranked = rankReplacementCandidates(eligible, {
    schedule: found.others,
    constraints,
    tagInterestContext,
    vectorInterestContext,
    cfInterestContext,
  });

  // 清單只顯示課名，同一門課的多個班次只留分數最高的那一班。
  const seen = new Set();
  const alternatives = [];
  for (const course of ranked) {
    const key = getCourseKey(course);
    if (seen.has(key)) continue;
    seen.add(key);
    alternatives.push({ sectionId: Number(course.sectionId ?? course.id), name: course.name, course });
    if (alternatives.length >= limit) break;
  }
  return { sectionId: Number(sectionId), alternatives };
}
