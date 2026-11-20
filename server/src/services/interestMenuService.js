// 設定頁「想接觸的課程主題」選單的資料來源：重建某位學生的排課候選池、分成三組、算出選單。
//
// 分組**直接用排課器的畢業分類桶**（`getGraduationBucket()`）：本系選修、通識、系外三個桶，正是
// S_tag 實際作用的桶（`scheduler.js` 的標籤分數只套用在這三個桶）。不另寫一份分類邏輯，選單的範圍
// 才不會與排課漂移。必修與「其他」桶（應用外語、體育、學院綜合班、學分學程）不在選單裡：勾了也
// 不會影響排課。

import { ACTIVE_TERM } from '../data/activeTerm.js';
import { getEligibilityRule, getStudentColleges } from '../data/classKindCatalog.js';
import {
  POOL_CACHE_MAX_ENTRIES,
  POOL_CACHE_TTL_MS,
  STEM_COLLEGES,
  STEM_EXTRA_UNITS,
} from '../data/interestMenuConfig.js';
import { buildInterestTopicGroups } from '../data/interestTopicGroups.js';
import { searchCoursesForSchedule } from '../skills/courseQuery.js';
import { buildStudentScope, parseClassName } from '../skills/courseScope.js';
import { GRADUATION_BUCKET, getGraduationBucket } from '../skills/scheduler.js';
import { createTtlCache } from '../utils/ttlCache.js';

/**
 * 這門課的開課單位是不是理工類（資電、工程與科學、建設三個學院，加上設定檔明列的單位）。
 * 系所班用系所全名查學院；非系所班（學院綜合班等）用班級名稱查。
 */
export function isStemOpeningUnit(course) {
  const parsed = parseClassName(course?.department);
  if (parsed.isDepartmentClass) {
    const department = parsed.department;
    if (STEM_EXTRA_UNITS.includes(department)) return true;
    return getStudentColleges(department).some(college => STEM_COLLEGES.includes(college));
  }
  const className = parsed.className || String(course?.department ?? '').trim();
  if (STEM_EXTRA_UNITS.includes(className)) return true;
  const college = getEligibilityRule(className)?.college;
  return Boolean(college && STEM_COLLEGES.includes(college));
}

/**
 * 依畢業分類桶把候選池分成三組；必修與「其他」桶不列入。系外組排除理工類開課單位。
 */
export function classifyCoursesForInterestMenu(courses = [], scope = null) {
  const grouped = { department: [], generalEducation: [], outside: [] };
  const counts = { required: 0, other: 0, stemExcluded: 0 };
  if (!scope?.resolved) return { grouped, counts };

  for (const course of Array.isArray(courses) ? courses : []) {
    const bucket = getGraduationBucket(course, scope);
    if (bucket === GRADUATION_BUCKET.ELECTIVE) grouped.department.push(course);
    else if (bucket === GRADUATION_BUCKET.GENERAL) grouped.generalEducation.push(course);
    else if (bucket === GRADUATION_BUCKET.EXTERNAL) {
      if (isStemOpeningUnit(course)) counts.stemExcluded += 1;
      else grouped.outside.push(course);
    } else if (bucket === GRADUATION_BUCKET.REQUIRED) counts.required += 1;
    else counts.other += 1;
  }
  return { grouped, counts };
}

// 候選池快取：重建一次約 2 秒（盤點實測 1.9～2.0 秒），選單與保存驗證共用。
// 每個「系所＋年級＋班別＋學期」各一份，失敗不快取（見 createTtlCache）。
const poolCaches = new Map();

export function resetInterestMenuCacheForTests() {
  poolCaches.clear();
}

function poolKey(filters) {
  return [
    filters.department, filters.gradeLevel, filters.className,
    ACTIVE_TERM.academicYear, ACTIVE_TERM.semester,
  ].join('|');
}

/**
 * @param filters `{ department, gradeLevel, className }`
 * @param deps 測試用注入：`{ searchCourses, now, cacheStore }`
 * @returns `{ scope, courses, ready }`；缺系所、年級或班別時 `ready` 為 false、courses 為空，不去猜。
 */
export async function loadInterestMenuPool(filters, deps = {}) {
  const search = deps.searchCourses ?? searchCoursesForSchedule;
  const now = deps.now ?? Date.now;
  const store = deps.cacheStore ?? poolCaches;
  const key = poolKey(filters);

  if (!store.has(key)) {
    // 簡單的上限：滿了就丟掉最早建立的那份，避免鍵空間（系所×年級×班別）無限成長。
    if (store.size >= POOL_CACHE_MAX_ENTRIES) store.delete(store.keys().next().value);
    store.set(key, createTtlCache(async () => {
      // 與排課用同一個 `buildStudentScope()`（`scheduleService.prepareGenerationInputs()`），
      // 選單的候選池與分桶才會跟排課一致。盤點對照：換成 `buildCourseQueryScope()` 時四個桶的課數
      // 完全相同，只漏掉 3 門本班必修（班別尾碼比對不到）。
      const className = String(filters.className ?? '').trim();
      const scope = buildStudentScope({
        department: filters.department,
        gradeLevel: filters.gradeLevel,
        className: className || null,
      });
      // 班別沒選好時不猜測候選課程：沒有班別，學生範圍就不完整。
      const ready = Boolean(scope.resolved && className);
      const courses = ready ? await search(filters, scope) : [];
      return { scope, courses, ready };
    }, POOL_CACHE_TTL_MS, now));
  }
  return store.get(key)();
}

/**
 * 選單：三組選項，加上追問與保存驗證要用的分組後課程。
 */
export async function getInterestTopicGroups(filters, deps = {}) {
  const { scope, courses, ready } = await loadInterestMenuPool(filters, deps);
  const { grouped, counts } = classifyCoursesForInterestMenu(courses, scope);
  return {
    scope,
    courses,
    grouped,
    topicGroups: buildInterestTopicGroups(grouped),
    scopeReady: ready,
    candidateCourseCount: courses.length,
    groupCourseCounts: {
      department: grouped.department.length,
      generalEducation: grouped.generalEducation.length,
      outside: grouped.outside.length,
      ...counts,
    },
  };
}

export default {
  isStemOpeningUnit,
  classifyCoursesForInterestMenu,
  loadInterestMenuPool,
  getInterestTopicGroups,
  resetInterestMenuCacheForTests,
};
