import { getAll, getById } from '../db/database.js';
import { summarizeReviews } from './reviewStats.js';

function textIncludes(value, keyword) {
  return String(value || '').toLowerCase().includes(keyword);
}

export async function searchCourses(filters = {}) {
  let courses = await getAll('courses');

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

  if (filters.department) {
    courses = courses.filter(course => String(course.department || '').includes(filters.department));
  }

  if (filters.category) {
    courses = courses.filter(course => course.category === filters.category || course.type === filters.category);
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

  // 🌟 修改核心：將原本分開的 dayOfWeek 與 period 判斷刪除，
  // 統一收斂至此，並改為掃描 timeBlocks 陣列，完美支援「多時段課程」
  if (filters.dayOfWeek || filters.period) {
    const targetDay = filters.dayOfWeek ? Number(filters.dayOfWeek) : null;
    const targetPeriod = filters.period ? Number(filters.period) : null;

    courses = courses.filter(course => {
      // 確保課程有完整時段資料
      const blocks = course.timeBlocks || [];
      if (blocks.length === 0) return false;

      // 掃描所有時段，只要有任何一個時段區塊符合條件，即保留該課程
      return blocks.some(block => {
        const matchDay = targetDay ? Number(block.dayOfWeek) === targetDay : true;
        const matchPeriod = targetPeriod 
          ? (Number(block.startPeriod) <= targetPeriod && targetPeriod <= Number(block.endPeriod)) 
          : true;
        
        return matchDay && matchPeriod;
      });
    });
  }

  if (filters.language && filters.language !== 'All' && filters.language !== '全部') {
    courses = courses.filter(course => course.language === filters.language);
  }

  return courses;
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

export default { searchCourses, getCourseDetail, getDepartments, getInstructors };
