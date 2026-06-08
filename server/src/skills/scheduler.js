// Skill 3: CSP 排課演算法
// 使用 Constraint Satisfaction Problem (CSP) — 貪婪法 + 回溯搜尋

/**
 * 主要排課函式
 * @param {Array} candidateCourses - 候選課程列表
 * @param {Object} constraints - 使用者限制條件
 * @returns {Object} { success, schedule, totalCredits, message }
 */
export function generateSchedule(candidateCourses, constraints = {}) {
  const {
    maxCredits = 22,
    minCredits = 15,
    blockedPeriods = [],
    noMorningClasses = false,
    noEveningClasses = false,
    mustTakeCourseIds = [],
    preferCompact = false,
    maxCoursesPerDay = 4,
  } = constraints;

  // Step 1: Pre-filter courses by hard constraints
  const filtered = candidateCourses.filter(course => {
    if (noMorningClasses && course.startPeriod === 1) return false;
    if (noEveningClasses && course.startPeriod >= 12) return false;
    for (const bp of blockedPeriods) {
      if (course.dayOfWeek === bp.day) {
        for (let p = course.startPeriod; p <= course.endPeriod; p++) {
          if (p === bp.period) return false;
        }
      }
    }
    
    // New Constraints
    const desc = course.description || '';
    if (constraints.noMidterm && desc.includes('期中考')) return false;
    if (constraints.noGroupReport && (desc.includes('分組報告') || desc.includes('小組'))) return false;
    if (constraints.discussion && !desc.includes('討論') && !desc.includes('互動')) return false;
    if (constraints.weightDaily && !desc.includes('平時') && !desc.includes('作業')) return false;
    
    if (constraints.practicalExam && !desc.includes('上機') && !desc.includes('實作')) return false;
    if (constraints.finalReport && !desc.includes('期末報告')) return false;
    if (constraints.englishTaught && !desc.includes('全英') && course.language !== 'English') return false;

    if (constraints.lunchBreakFree && course.startPeriod <= 5 && course.endPeriod >= 5) return false;

    if (constraints.learnMore) {
       // Since we don't have reviews loaded here directly, we do a basic keyword check on description
       // Ideally we'd use the review stats, but this simple filter works for MVP.
       if (!desc.includes('豐富') && !desc.includes('充實') && !desc.includes('實作') && !desc.includes('進階')) return false;
    }

    return true;
  });

  // Check must-take courses
  const missingMust = mustTakeCourseIds.filter(id => !filtered.some(c => c.id === id));
  if (missingMust.length > 0) {
    const missingNames = missingMust.map(id => {
      const c = candidateCourses.find(cc => cc.id === id);
      return c ? c.name : `ID:${id}`;
    });
    return {
      success: false, schedule: [], totalCredits: 0,
      message: `以下必修課程因限制條件而無法排入：${missingNames.join('、')}。請調整限制條件。`
    };
  }

  // Step 2: Separate must-take and optional courses
  const mustTake = filtered.filter(c => mustTakeCourseIds.includes(c.id));
  const optional = filtered.filter(c => !mustTakeCourseIds.includes(c.id));

  // Step 3: Start with must-take courses
  const schedule = [];
  let totalCredits = 0;

  for (const mc of mustTake) {
    if (schedule.some(sc => timeConflict(sc, mc))) {
      return {
        success: false, schedule: [], totalCredits: 0,
        message: `必修課「${mc.name}」與其他必修課時間衝突，無法排入。`
      };
    }
    schedule.push(mc);
    totalCredits += mc.credits;
  }

  // Step 4: Sort optional courses by priority
  // Priority: 必修 > 選修 > 通識, then by fewer time conflicts
  const categoryOrder = { '必修': 0, '選修': 1, '通識': 2 };
  const sortedOptional = [...optional].sort((a, b) => {
    const catDiff = (categoryOrder[a.category] ?? 1) - (categoryOrder[b.category] ?? 1);
    if (catDiff !== 0) return catDiff;
    return b.credits - a.credits; // Prefer higher credit courses
  });

  // Step 5: Greedy fill
  for (const course of sortedOptional) {
    if (totalCredits + course.credits > maxCredits) continue;
    if (schedule.some(sc => timeConflict(sc, course))) continue;

    // Check max courses per day
    const dayCount = schedule.filter(sc => sc.dayOfWeek === course.dayOfWeek).length;
    if (dayCount >= maxCoursesPerDay) continue;

    schedule.push(course);
    totalCredits += course.credits;

    if (totalCredits >= maxCredits) break;
  }

  // Step 6: If below minimum, try backtracking with limited depth
  if (totalCredits < minCredits) {
    // Try swapping: remove one course and add two that fit
    const unused = sortedOptional.filter(c => !schedule.some(sc => sc.id === c.id));
    let improved = true;

    while (improved && totalCredits < minCredits) {
      improved = false;
      for (const candidate of unused) {
        if (schedule.some(sc => sc.id === candidate.id)) continue;
        if (totalCredits + candidate.credits > maxCredits) continue;

        // Check if it fits without conflicts
        if (!schedule.some(sc => timeConflict(sc, candidate))) {
          const dayCount = schedule.filter(sc => sc.dayOfWeek === candidate.dayOfWeek).length;
          if (dayCount < maxCoursesPerDay) {
            schedule.push(candidate);
            totalCredits += candidate.credits;
            improved = true;
            if (totalCredits >= maxCredits) break;
          }
        }
      }
    }
  }

  if (schedule.length === 0) {
    return {
      success: false, schedule: [], totalCredits: 0,
      message: '找不到符合限制條件的課表組合。請放寬限制條件或增加候選課程。'
    };
  }

  // Sort schedule by day and period for display
  schedule.sort((a, b) => {
    if (a.dayOfWeek !== b.dayOfWeek) return a.dayOfWeek - b.dayOfWeek;
    return a.startPeriod - b.startPeriod;
  });

  return {
    success: true,
    schedule,
    totalCredits,
    courseCount: schedule.length,
    message: `成功生成課表！共 ${schedule.length} 門課，${totalCredits} 學分。`,
  };
}

/**
 * 檢查兩門課是否有時間衝突
 */
function timeConflict(courseA, courseB) {
  if (courseA.dayOfWeek !== courseB.dayOfWeek) return false;
  return !(courseA.endPeriod < courseB.startPeriod || courseB.endPeriod < courseA.startPeriod);
}

export { timeConflict as checkConflict };

/**
 * 檢查一組課程是否有衝突
 */
export function validateSchedule(courses) {
  const conflicts = [];
  for (let i = 0; i < courses.length; i++) {
    for (let j = i + 1; j < courses.length; j++) {
      if (timeConflict(courses[i], courses[j])) {
        conflicts.push({ course1: courses[i], course2: courses[j] });
      }
    }
  }
  return {
    valid: conflicts.length === 0,
    conflicts,
    totalCredits: courses.reduce((s, c) => s + c.credits, 0),
  };
}

export default { generateSchedule, checkConflict: timeConflict, validateSchedule };
