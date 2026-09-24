const LABELS = {
  0: '全年級可修',
  1: '大一',
  2: '大二',
  3: '大三',
  4: '大四',
  5: '研究所',
};

export function formatCourseGradeLevel(value) {
  const gradeLevel = Number(value);
  return Number.isInteger(gradeLevel) && LABELS[gradeLevel]
    ? LABELS[gradeLevel]
    : '年級資料未知';
}
