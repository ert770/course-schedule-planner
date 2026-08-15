import { getAll, getById } from '../db/database.js';
import { summarizeReviews } from './reviewStats.js';
import { classSuffixCovers, parseClassName } from './courseScope.js';
import {
  annotateCourseCategory,
  refineOutsideElectiveScopeReason,
  CATEGORY_CORE_ELECTIVE,
  CATEGORY_ELECTIVE,
  CATEGORY_GENERAL_EDUCATION,
  CATEGORY_OUTSIDE_ELECTIVE,
  CATEGORY_REQUIRED,
} from './courseCategory.js';
import { evaluateOutsideElective } from './outsideElective.js';
import { getAbbreviations } from '../data/departmentMapping.js';
import { normalizeDepartment } from '../utils/text.js';

export const COURSE_SEARCH_CATEGORIES = new Set([
  CATEGORY_REQUIRED,
  CATEGORY_CORE_ELECTIVE,
  CATEGORY_ELECTIVE,
  CATEGORY_OUTSIDE_ELECTIVE,
  CATEGORY_GENERAL_EDUCATION,
]);

function courseSearchError(message, code, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function textIncludes(value, keyword) {
  return String(value || '').toLowerCase().includes(keyword);
}

function applyCommonFilters(courseList, filters = {}, { filterCategory = true } = {}) {
  let courses = courseList;

  if (filters.keyword) {
    const keyword = String(filters.keyword).toLowerCase();
    courses = courses.filter(course =>
      textIncludes(course.name, keyword)
      || textIncludes(course.code, keyword)
      || textIncludes(course.courseId, keyword)
      || textIncludes(course.instructor, keyword)
      || textIncludes(course.department, keyword)
      || textIncludes(course.description, keyword)
      || textIncludes(course.selectionCode, keyword)
    );
  }

  if (filterCategory && filters.category) {
    courses = courses.filter(course => course.category === filters.category);
  }

  if (filters.dayOfWeek) {
    courses = courses.filter(course => course.dayOfWeek === Number(filters.dayOfWeek));
  }

  if (filters.credits) {
    courses = courses.filter(course => Number(course.credits) === Number(filters.credits));
  }

  if (filters.instructor) {
    courses = courses.filter(course => String(course.instructor || '').includes(filters.instructor));
  }

  if (filters.maxStartPeriod) {
    courses = courses.filter(course => Number(course.startPeriod) >= Number(filters.maxStartPeriod));
  }

  if (filters.excludeIds && filters.excludeIds.length > 0) {
    const excluded = new Set(filters.excludeIds.map(String));
    courses = courses.filter(course => !excluded.has(String(course.id)));
  }

  if (filters.code) {
    const codeSearch = String(filters.code).toLowerCase();
    courses = courses.filter(course => String(course.code || '').toLowerCase() === codeSearch);
  }

  if (filters.period) {
    const period = Number(filters.period);
    courses = courses.filter(course =>
      Number(course.startPeriod) <= period && period <= Number(course.endPeriod)
    );
  }

  if (filters.language && filters.language !== 'All' && filters.language !== '全部') {
    courses = courses.filter(course => course.language === filters.language);
  }

  return courses;
}

function isInStudentClass(course, scope) {
  const parsed = parseClassName(course.department);
  return parsed.isDepartmentClass
    && parsed.department === scope.department
    && parsed.degree === scope.degree
    && parsed.grade === scope.grade
    && classSuffixCovers(parsed.classSuffix, scope.classSuffix);
}

function validateCategorizedSearch(filters, scope) {
  if (!scope?.resolved || !scope.classSuffix) {
    throw courseSearchError(
      '缺少班級資料，請先匯入學生班級再搜尋課程。',
      'CLASS_NAME_REQUIRED'
    );
  }

  if (filters.category && !COURSE_SEARCH_CATEGORIES.has(filters.category)) {
    throw courseSearchError('不支援的課程分類。', 'INVALID_COURSE_CATEGORY');
  }
}

function categorizeCourses(courseList, scope) {
  return courseList.map(rawCourse => {
    const course = annotateCourseCategory(rawCourse, scope);
    if (course.category !== CATEGORY_OUTSIDE_ELECTIVE) return course;

    const outsideElective = evaluateOutsideElective(course, scope);
    const refinedScopeReason = refineOutsideElectiveScopeReason(outsideElective);

    return {
      ...course,
      outsideElective,
      ...(refinedScopeReason ? { scopeReason: refinedScopeReason } : {}),
    };
  });
}

export function filterCategorizedCourses(
  courseList = [],
  filters = {},
  scope,
  { includeGeneralEducation = false } = {}
) {
  validateCategorizedSearch(filters, scope);

  let courses = categorizeCourses(courseList, scope);
  // Roadmap #20：candidate 只能是 active term 的 sections，這是結構性過濾
  // （與下面的班級範圍過濾同一層級），不是可豁免的判斷——「明確指定仍保留」
  // 的例外只在排課階段（scheduler.js 的 prepareCandidates）適用，因為只有
  // 那裡才知道哪些課是使用者明確指定的。單純搜尋沒有這個概念，一律過濾掉。
  courses = courses.filter(course => course.term.isActiveTerm);
  if (filters.category === CATEGORY_OUTSIDE_ELECTIVE) {
    courses = courses.filter(course => {
      if (course.category !== CATEGORY_OUTSIDE_ELECTIVE) return false;
      const parsed = parseClassName(course.department);
      return parsed.isDepartmentClass && parsed.degree === scope.degree;
    });
  } else if (filters.category === CATEGORY_GENERAL_EDUCATION) {
    courses = courses.filter(course => course.category === CATEGORY_GENERAL_EDUCATION);
  } else {
    courses = courses.filter(course => (
      isInStudentClass(course, scope)
      || (includeGeneralEducation && course.category === CATEGORY_GENERAL_EDUCATION)
    ));
    if (filters.category) {
      courses = courses.filter(course => course.category === filters.category);
    }
  }

  return applyCommonFilters(courses, filters, { filterCategory: false });
}

// 保留純函式供既有測試與內部低階用途使用；REST、排課與 Agent 應使用下方
// 三個具名入口，避免不同呼叫端的班級規則互相滲透。
export function filterCourses(courseList = [], filters = {}) {
  let courses = courseList;

  if (filters.department && filters.grade && filters.className) {
    const department = normalizeDepartment(filters.department);
    const grade = Number(filters.grade);
    const className = String(filters.className || '').trim();
    courses = courses.filter(course => {
      const parsed = parseClassName(course.department);
      return parsed.isDepartmentClass
        && parsed.department === department
        && parsed.grade === grade
        && classSuffixCovers(parsed.classSuffix, className);
    });
  } else if (filters.department) {
    courses = courses.filter(course => String(course.department || '').includes(filters.department));
  }

  return applyCommonFilters(courses, filters);
}

async function runCategorizedSearch(filters, scope, options) {
  return filterCategorizedCourses(await getAll('courses'), filters, scope, options);
}

export async function searchCoursesForStudent(filters, scope) {
  return runCategorizedSearch(filters, scope);
}

export async function searchCoursesForSchedule(filters, scope) {
  return runCategorizedSearch(filters, scope, { includeGeneralEducation: true });
}

export async function searchCoursesForAgent(filters, scope) {
  return runCategorizedSearch(filters, scope);
}

export async function getCourseDetail(courseId) {
  const course = await getById('courses', courseId);
  if (!course) return null;

  const reviews = (await getAll('reviews')).filter(review => String(review.courseId) === String(course.id));

  // 一列評價可能代表多則評論，統計必須以 reviewCount 加權，
  // 否則 /api/courses/:id 與 /api/reviews/:courseId 對同一門課會回報不同數字。
  return {
    ...course,
    reviews,
    stats: summarizeReviews(reviews),
  };
}

export async function getDepartments() {
  const courses = await getAll('courses');
  return [...new Set(courses.map(course => course.department).filter(Boolean))];
}

export async function getInstructors() {
  const courses = await getAll('courses');
  return [...new Set(courses.map(course => course.instructor).filter(Boolean))];
}

// 某個系所某個年級實際存在的班別（例如 `資訊三甲`、`資訊三乙`、`資訊三合`）。
//
// 供前端讓學生選班別使用。班別清單從課程資料現場推導，而不是寫死在前端——
// 系所簡稱與班級命名的對照只有 `server/src/data/departmentMapping.js` 一份，
// 複製到前端就會有兩份各自漂移。
export async function getClassNames(department, grade) {
  const normalized = normalizeDepartment(department);
  const abbreviations = normalized ? getAbbreviations(normalized) : [];
  if (abbreviations.length === 0) return [];

  const gradeValue = Number(grade);
  const courses = await getAll('courses');
  const names = new Set();

  for (const course of courses) {
    const parsed = parseClassName(course.department);
    if (!parsed.isDepartmentClass) continue;
    if (!abbreviations.includes(parsed.abbreviation)) continue;
    if (parsed.degree !== 'bachelor') continue;
    if (Number.isFinite(gradeValue) && gradeValue > 0 && parsed.grade !== gradeValue) continue;

    names.add(parsed.className);
  }

  return [...names].sort();
}

export default {
  searchCoursesForStudent,
  searchCoursesForSchedule,
  searchCoursesForAgent,
  filterCategorizedCourses,
  filterCourses,
  getCourseDetail,
  getDepartments,
  getInstructors,
  getClassNames,
};
