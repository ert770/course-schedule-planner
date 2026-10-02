// Roadmap #10：MILP 專用的獨立結果檢查。
// 與 scheduleValidator 並用；這裡檢查模型特有的學分對齊、固定班次與課號規則。

const idOf = course => Number(course?.id ?? course?.sectionId);
const codeOf = course => String(course?.catalogCourseCode ?? `section:${idOf(course)}`);

function blocks(course) {
  if (Array.isArray(course?.timeBlocks) && course.timeBlocks.length > 0) return course.timeBlocks;
  const dayOfWeek = Number(course?.dayOfWeek);
  const startPeriod = Number(course?.startPeriod);
  const endPeriod = Number(course?.endPeriod);
  if (![dayOfWeek, startPeriod, endPeriod].every(Number.isFinite)) return [];
  return [{ dayOfWeek, startPeriod, endPeriod }];
}

export function checkMilpPlan(courses = [], inputs = {}, {
  creditTarget = inputs?.basePlan?.totalCredits,
  hierarchyTargets = null,
} = {}) {
  const selected = Array.isArray(courses) ? courses : [];
  const violations = [];
  const ids = new Set(selected.map(idOf));
  const totalCredits = selected.reduce((sum, course) => sum + (Number(course?.credits) || 0), 0);
  const add = (constraintId, reason, details = {}) => violations.push({ constraintId, reason, ...details });

  if (totalCredits < Number(inputs.minCredits || 0) || totalCredits > Number(inputs.maxCredits ?? Infinity)) {
    add('CREDIT_BOUNDS', `總學分 ${totalCredits} 不在 ${inputs.minCredits}～${inputs.maxCredits} 之間`);
  }
  if (Number.isFinite(creditTarget) && totalCredits < creditTarget) {
    add('CREDIT_PARITY', `總學分 ${totalCredits} 低於 S₀ 的 ${creditTarget} 學分`);
  }

  for (const fixed of [...(inputs.fixedSchedule || []), ...(inputs.fixedUnscheduled || [])]) {
    if (!ids.has(idOf(fixed))) {
      add('FIXED_SECTION_COVERAGE', `固定班次 ${idOf(fixed)} 未排入`, { courseId: idOf(fixed) });
    }
  }

  const byCode = new Map();
  for (const course of selected) {
    const code = codeOf(course);
    if (!byCode.has(code)) byCode.set(code, []);
    byCode.get(code).push(course);
  }
  for (const [code, sameCourse] of byCode) {
    if (sameCourse.length > 1) {
      add('ONE_SECTION_PER_COURSE', `課號 ${code} 同時選了 ${sameCourse.length} 個班次`);
    }
  }

  for (const course of selected) {
    if (course?.corequisiteRole === 'regular') {
      const partners = byCode.get(String(course.corequisiteCode)) || [];
      if (partners.length !== 1) add('COREQUISITE', `${course.name} 缺少唯一的共同必修實習`);
    }
    if (course?.corequisiteRole === 'internship') {
      const regular = selected.filter(item => item?.corequisiteRole === 'regular'
        && String(item.corequisiteCode) === codeOf(course));
      if (regular.length !== 1) add('COREQUISITE', `${course.name} 沒有唯一的共同必修正課`);
    }
  }

  const metadata = new Map();
  for (const entry of [...(inputs.competitive || []), ...(inputs.internships || [])]) {
    metadata.set(idOf(entry.course), entry);
  }
  const explicitIds = new Set((inputs.explicitIds || []).map(Number));
  const bySeries = new Map();
  for (const course of selected) {
    if (explicitIds.has(idOf(course))) continue;
    const seriesKey = metadata.get(idOf(course))?.seriesKey;
    if (!seriesKey) continue;
    if (!bySeries.has(seriesKey)) bySeries.set(seriesKey, []);
    bySeries.get(seriesKey).push(course);
  }
  for (const [seriesKey, seriesCourses] of bySeries) {
    if (seriesCourses.length > 1) add('COURSE_SERIES', `同系列 ${seriesKey} 同時排入多門課`);
  }

  const hierarchyCounts = { 'cross-year': 0, outside: 0 };
  const selectedCompetitiveKeys = new Set();
  for (const entry of inputs.competitive || []) {
    if (!ids.has(idOf(entry.course)) || selectedCompetitiveKeys.has(entry.courseKey)) continue;
    selectedCompetitiveKeys.add(entry.courseKey);
    if ((Number(entry.scoreComponents?.outsideOwnDepartment) || 0) < 0) hierarchyCounts.outside += 1;
    else if ((Number(entry.scoreComponents?.crossYearElective) || 0) < 0) hierarchyCounts['cross-year'] += 1;
  }
  for (const tier of ['cross-year', 'outside']) {
    if (hierarchyTargets && hierarchyCounts[tier] !== (Number(hierarchyTargets[tier]) || 0)) {
      add(
        'HIERARCHY_PARITY',
        `${tier} 課程數 ${hierarchyCounts[tier]} 與 S₀ 的 ${Number(hierarchyTargets[tier]) || 0} 不同`,
        { tier, actual: hierarchyCounts[tier], expected: Number(hierarchyTargets[tier]) || 0 }
      );
    }
  }

  const graduationCategoryCounts = { elective: 0, general: 0, external: 0 };
  const countedGraduationKeys = new Set();
  for (const entry of [...(inputs.competitive || []), ...(inputs.internships || [])]) {
    const bucket = entry.graduationBucket;
    if (!Object.hasOwn(graduationCategoryCounts, bucket) || !ids.has(idOf(entry.course))) continue;
    const key = entry.courseKey || codeOf(entry.course);
    if (countedGraduationKeys.has(key)) continue;
    countedGraduationKeys.add(key);
    graduationCategoryCounts[bucket] += 1;
  }
  if (inputs.graduationPlanning?.enabled) {
    for (const bucket of Object.keys(graduationCategoryCounts)) {
      const expected = Math.max(
        0,
        Number(inputs.graduationPlanning.selected?.[bucket]?.courses || 0)
          - Number(inputs.fixedGraduationBuckets?.[bucket]?.courses || 0)
      );
      if (graduationCategoryCounts[bucket] !== expected) {
        add(
          'GRADUATION_CATEGORY_PARITY',
          `${bucket} 課程數 ${graduationCategoryCounts[bucket]} 與 S₀ 競爭課程的 ${expected} 不同`,
          { bucket, actual: graduationCategoryCounts[bucket], expected }
        );
      }
    }
  }

  if (Number.isFinite(inputs.maxCoursesPerDay)) {
    const dayCounts = new Map();
    for (const course of selected) {
      for (const day of new Set(blocks(course).map(block => block.dayOfWeek))) {
        dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);
      }
    }
    for (const [day, count] of dayCounts) {
      if (count > inputs.maxCoursesPerDay) {
        add('DAILY_COURSE_CAP', `星期 ${day} 有 ${count} 門課，超過上限 ${inputs.maxCoursesPerDay}`);
      }
    }
  }

  return {
    valid: violations.length === 0,
    violations,
    totalCredits,
    hierarchyCounts,
    graduationCategoryCounts,
  };
}

export default { checkMilpPlan };
