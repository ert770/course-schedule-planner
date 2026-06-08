// Skill 1: 課程資料庫查詢
import { getAll, getById } from '../db/database.js';

/**
 * 查詢所有課程，支援多種篩選條件
 */
export function searchCourses(filters = {}) {
  let courses = getAll('courses');

  if (filters.keyword) {
    const kw = filters.keyword.toLowerCase();
    courses = courses.filter(c =>
      c.name.toLowerCase().includes(kw) ||
      c.code.toLowerCase().includes(kw) ||
      c.instructor.toLowerCase().includes(kw) ||
      c.department.toLowerCase().includes(kw) ||
      (c.description && c.description.toLowerCase().includes(kw))
    );
  }

  if (filters.department) {
    courses = courses.filter(c => c.department.includes(filters.department));
  }

  if (filters.category) {
    courses = courses.filter(c => c.category === filters.category);
  }

  if (filters.dayOfWeek) {
    courses = courses.filter(c => c.dayOfWeek === filters.dayOfWeek);
  }

  if (filters.credits) {
    courses = courses.filter(c => c.credits === filters.credits);
  }

  if (filters.instructor) {
    courses = courses.filter(c => c.instructor.includes(filters.instructor));
  }

  if (filters.maxStartPeriod) {
    courses = courses.filter(c => c.startPeriod >= filters.maxStartPeriod);
  }

  if (filters.excludeIds && filters.excludeIds.length > 0) {
    courses = courses.filter(c => !filters.excludeIds.includes(c.id));
  }

  if (filters.code) {
    const codeSearch = filters.code.toLowerCase();
    courses = courses.filter(c => c.code.toLowerCase() === codeSearch);
  }

  if (filters.period) {
    const p = parseInt(filters.period, 10);
    courses = courses.filter(c => p >= c.startPeriod && p <= c.endPeriod);
  }
  
  if (filters.language && filters.language !== 'All' && filters.language !== '全部') {
    // Assuming language isn't explicitly stored, we do a basic mock check if it was requested.
    // For now we just return all since we don't have language data.
  }

  return courses;
}

/**
 * 取得單一課程詳情（含評價統計）
 */
export function getCourseDetail(courseId) {
  const course = getById('courses', courseId);
  if (!course) return null;

  const reviews = getAll('reviews').filter(r => r.courseId === courseId);
  const avgDifficulty = reviews.length > 0
    ? reviews.reduce((sum, r) => sum + r.difficultyRating, 0) / reviews.length
    : null;
  const avgRecommend = reviews.length > 0
    ? reviews.reduce((sum, r) => sum + r.recommendScore, 0) / reviews.length
    : null;

  return {
    ...course,
    reviews,
    stats: {
      reviewCount: reviews.length,
      avgDifficulty: avgDifficulty ? Math.round(avgDifficulty * 10) / 10 : null,
      avgRecommend: avgRecommend ? Math.round(avgRecommend * 10) / 10 : null,
      positiveCount: reviews.filter(r => r.sentiment === 'positive').length,
      negativeCount: reviews.filter(r => r.sentiment === 'negative').length,
      neutralCount: reviews.filter(r => r.sentiment === 'neutral').length,
    }
  };
}

/**
 * 取得所有科系列表
 */
export function getDepartments() {
  const courses = getAll('courses');
  return [...new Set(courses.map(c => c.department))];
}

/**
 * 取得所有教師列表
 */
export function getInstructors() {
  const courses = getAll('courses');
  return [...new Set(courses.map(c => c.instructor))];
}

export default { searchCourses, getCourseDetail, getDepartments, getInstructors };
