export const COURSE_GRADE_LEVEL_LABELS = Object.freeze({
  0: '全年級可修',
  1: '大一',
  2: '大二',
  3: '大三',
  4: '大四',
  5: '研究所',
});

export function normalizeCourseGradeLevel(value) {
  if (value === null || value === undefined || value === '') return null;
  const gradeLevel = Number(value);
  return Number.isInteger(gradeLevel) && gradeLevel >= 0 && gradeLevel <= 5
    ? gradeLevel
    : null;
}

export function courseGradeLevelLabel(value) {
  const gradeLevel = normalizeCourseGradeLevel(value);
  return gradeLevel === null ? '年級資料未知' : COURSE_GRADE_LEVEL_LABELS[gradeLevel];
}

// 0 是「沒有年級限制」，不是未知；5 同時涵蓋碩士與博士課程。
export function isCourseGradeEligible(course, studentGradeLevel) {
  const courseGradeLevel = normalizeCourseGradeLevel(course?.gradeLevel);
  const normalizedStudentGrade = normalizeCourseGradeLevel(studentGradeLevel);
  if (courseGradeLevel === null || normalizedStudentGrade === null) return null;
  return courseGradeLevel === 0 || courseGradeLevel === normalizedStudentGrade;
}

export default {
  COURSE_GRADE_LEVEL_LABELS,
  normalizeCourseGradeLevel,
  courseGradeLevelLabel,
  isCourseGradeEligible,
};
