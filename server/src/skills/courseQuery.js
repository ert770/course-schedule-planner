import { getAll, getById } from '../db/database.js';

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

export async function getCourseDetail(courseId) {
  const course = await getById('courses', courseId);
  if (!course) return null;

  const reviews = (await getAll('reviews')).filter(review => String(review.courseId) === String(course.id));
  const avgDifficulty = reviews.length > 0
    ? reviews.reduce((sum, review) => sum + Number(review.difficultyRating || 0), 0) / reviews.length
    : null;
  const avgRecommend = reviews.length > 0
    ? reviews.reduce((sum, review) => sum + Number(review.recommendScore || 0), 0) / reviews.length
    : null;

  return {
    ...course,
    reviews,
    stats: {
      reviewCount: reviews.length,
      avgDifficulty: avgDifficulty ? Math.round(avgDifficulty * 10) / 10 : null,
      avgRecommend: avgRecommend ? Math.round(avgRecommend * 10) / 10 : null,
      positiveCount: reviews.filter(review => review.sentiment === 'positive').length,
      negativeCount: reviews.filter(review => review.sentiment === 'negative').length,
      neutralCount: reviews.filter(review => review.sentiment === 'neutral').length,
    },
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
