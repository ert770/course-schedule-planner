import { getAll, getById } from '../db/database.js';
import { summarizeReviews } from './reviewStats.js';
import { classSuffixCovers, parseClassName } from './courseScope.js';
import { getAbbreviations } from '../data/departmentMapping.js';
import { normalizeDepartment } from '../utils/text.js';

function textIncludes(value, keyword) {
  return String(value || '').toLowerCase().includes(keyword);
}

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
    // 內部服務的舊呼叫可能只帶 department；REST 搜尋 route 已在邊界強制要求
    // 完整班級範圍。這裡保留既有字串比對，避免改動排課與 Agent 內部行為。
    courses = courses.filter(course => String(course.department || '').includes(filters.department));
  }

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

  if (filters.category) {
    courses = courses.filter(course => course.category === filters.category || course.type === filters.category);
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

export async function searchCourses(filters = {}) {
  return filterCourses(await getAll('courses'), filters);
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

export default { searchCourses, filterCourses, getCourseDetail, getDepartments, getInstructors, getClassNames };
