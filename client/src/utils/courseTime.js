// 課程時間顯示的共用格式化工具。
//
// 課程資料含週六與週日課程（dayOfWeek 6、7），且部分課程尚未排定時間（dayOfWeek 為 null）。
// 各頁面原本各自硬編 ['', '一', '二', '三', '四', '五']，週末課程會顯示成「週undefined」。
// 所有顯示課程時間的地方都應使用本檔，避免再次漂移。

const DAY_LABELS = ['', '一', '二', '三', '四', '五', '六', '日'];
const UNSCHEDULED_LABEL = '時間未定';

export function formatDayOfWeek(dayOfWeek) {
  const day = Number(dayOfWeek);
  if (!Number.isInteger(day) || day < 1 || day >= DAY_LABELS.length) {
    return null;
  }
  return DAY_LABELS[day];
}

function formatBlock(block) {
  const label = formatDayOfWeek(block?.dayOfWeek);
  if (!label || block.startPeriod == null) {
    return null;
  }

  const endPeriod = block.endPeriod ?? block.startPeriod;
  const periods = endPeriod === block.startPeriod
    ? `第${block.startPeriod}節`
    : `第${block.startPeriod}-${endPeriod}節`;

  return `週${label} ${periods}`;
}

function getBlocks(course) {
  if (Array.isArray(course?.timeBlocks) && course.timeBlocks.length > 0) {
    return course.timeBlocks;
  }
  if (course?.dayOfWeek == null || course?.startPeriod == null) {
    return [];
  }
  return [{
    dayOfWeek: course.dayOfWeek,
    startPeriod: course.startPeriod,
    endPeriod: course.endPeriod,
  }];
}

// 一門課可能有多個時段，全部列出，例如「週四 第1-4節、週四 第6-9節、週五 第1-4節」。
export function formatCourseTime(course, separator = '、') {
  const parts = getBlocks(course).map(formatBlock).filter(Boolean);
  return parts.length > 0 ? parts.join(separator) : UNSCHEDULED_LABEL;
}

export { UNSCHEDULED_LABEL };
