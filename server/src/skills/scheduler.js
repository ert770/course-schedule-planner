// Skill 3: scheduling engine
// Rule-based scheduler that keeps hard constraints verifiable and leaves
// explanation/comparison to the AI Agent.

const DEFAULT_MIN_CREDITS = 15;
const DEFAULT_MAX_CREDITS = 22;
const DEFAULT_MAX_COURSES_PER_DAY = 4;
const WEEK_DAYS = 5;
const INTEREST_KEYWORD_SCORE = 40;
const MAX_EASY_COURSE_SCORE = 100;
const PREFERENCE_SCORE_EPSILON = 0.001;

const CATEGORY_PRIORITY = {
  '必修': 0,
  '核心選修': 1,
  '選修': 2,
  '通識': 3,
  '系外選修': 4,
};

const PLAN_VARIANTS = [
  {
    id: 'required_first',
    title: '必修與重補修優先',
    description: '優先放入必修、重補修與指定加選課程，再補足選修與通識。',
  },
  {
    id: 'compact',
    title: '集中排課',
    description: '偏好把課集中在較少天數，保留完整休息日。',
  },
  {
    id: 'easy_score',
    title: '涼課與高分優先',
    description: '偏好描述中具有高分、涼課、報告或容易通過特徵的課程。',
  },
  {
    id: 'interest',
    title: '興趣與路徑優先',
    description: '偏好符合關鍵字、修課路徑或學生指定類別的課程。',
  },
  {
    id: 'max_credits',
    title: '學分最大化',
    description: '在不衝堂與不超過上限的前提下，盡量補足較多學分。',
  },
];

function toArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function toIdSet(value) {
  return new Set(toArray(value).map(Number).filter(Number.isFinite));
}

function getCategoryPriority(course) {
  return CATEGORY_PRIORITY[course.category] ?? 5;
}

function getCourseStatus(course, constraints) {
  const courseStates = constraints.courseStates || {};
  const explicit = courseStates[course.id] || course.status || course.state;
  if (explicit === 'watching' || explicit === '關注') return 'watching';
  if (explicit === 'selected' || explicit === '加選') return 'selected';

  const watchingIds = toIdSet(constraints.watchingCourseIds);
  if (watchingIds.has(Number(course.id))) return 'watching';

  return 'selected';
}

function isWatching(course, constraints) {
  return getCourseStatus(course, constraints) === 'watching';
}

function textIncludesAny(text, keywords) {
  if (!text) return false;
  return keywords.some(keyword => text.includes(keyword));
}

function hardConstraintReason(course, constraints) {
  if (isWatching(course, constraints)) return null;

  if (constraints.noMorningClasses && course.startPeriod <= 1) {
    return '不符合不上早八限制';
  }

  if (constraints.noEveningClasses && course.startPeriod >= 12) {
    return '不符合不上晚課限制';
  }

  for (const bp of toArray(constraints.blockedPeriods)) {
    if (course.dayOfWeek !== bp.day) continue;
    for (let period = course.startPeriod; period <= course.endPeriod; period += 1) {
      if (period === bp.period) return '位於封鎖時段';
    }
  }

  const desc = course.description || '';
  if (constraints.noMidterm && textIncludesAny(desc, ['期中', '期中考'])) {
    return '不符合免期中考偏好';
  }
  if (constraints.noGroupReport && textIncludesAny(desc, ['分組', '團體報告', '小組'])) {
    return '不符合免分組報告偏好';
  }
  if (constraints.discussion && !textIncludesAny(desc, ['討論', '互動', '參與'])) {
    return '不符合討論課偏好';
  }
  if (constraints.weightDaily && !textIncludesAny(desc, ['平時', '作業', '出席'])) {
    return '不符合重視平時成績偏好';
  }
  if (constraints.practicalExam && !textIncludesAny(desc, ['實作', '實驗', '專題'])) {
    return '不符合實作評量偏好';
  }
  if (constraints.finalReport && !textIncludesAny(desc, ['期末報告', '報告', '專題'])) {
    return '不符合期末報告偏好';
  }
  if (constraints.englishTaught && !(desc.includes('英文') || course.language === 'English')) {
    return '不符合英文授課偏好';
  }
  if (constraints.lunchBreakFree && course.startPeriod <= 5 && course.endPeriod >= 5) {
    return '不符合午休保留偏好';
  }
  if (constraints.learnMore && !textIncludesAny(desc, ['實作', '專題', '深入', '進階', '應用'])) {
    return '不符合學到較多內容偏好';
  }

  return null;
}

function timeConflict(courseA, courseB) {
  if (courseA.dayOfWeek !== courseB.dayOfWeek) return false;
  return !(courseA.endPeriod < courseB.startPeriod || courseB.endPeriod < courseA.startPeriod);
}

function conflictsWithSchedule(course, schedule) {
  return schedule.find(existing => timeConflict(existing, course)) || null;
}

function getEasyCourseScore(course) {
  const desc = course.description || '';
  let score = 0;
  if (textIncludesAny(desc, ['涼', '容易', '輕鬆', '高分', '甜'])) score += 60;
  if (textIncludesAny(desc, ['報告', '期末報告', '免考'])) score += 30;
  if (textIncludesAny(desc, ['實作', '專題'])) score += 10;
  return score;
}

function collectInterestKeywords(constraints) {
  return [
    ...toArray(constraints.preferredKeywords),
    ...toArray(constraints.interests),
    constraints.preferredTrack,
  ].filter(Boolean);
}

function getInterestScore(course, constraints) {
  const keywords = collectInterestKeywords(constraints);

  if (keywords.length === 0) return 0;

  const searchable = [
    course.name,
    course.code,
    course.instructor,
    course.department,
    course.category,
    course.description,
    course.track,
  ].filter(Boolean).join(' ');

  return keywords.reduce((score, keyword) => (
    searchable.includes(keyword) ? score + INTEREST_KEYWORD_SCORE : score
  ), 0);
}

// 方案偏好符合度：所有方案都用「同一組使用者權重」評分，方案不得用自己的
// variant 偏誤自評，否則彼此無從比較。
function buildPreferenceProfile(constraints) {
  return {
    interest: collectInterestKeywords(constraints).length > 0 ? 1 : 0,
    compact: constraints.preferCompact ? 1 : 0,
    easy: (constraints.preferEasyCourses ?? constraints.preferEasy) ? 1 : 0,
  };
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function getInterestCoverage(plan, constraints) {
  const keywords = collectInterestKeywords(constraints);
  if (keywords.length === 0 || plan.schedule.length === 0) return 0;

  const maxPerCourse = keywords.length * INTEREST_KEYWORD_SCORE;
  const average = plan.schedule
    .reduce((sum, course) => sum + getInterestScore(course, constraints), 0) / plan.schedule.length;

  return clamp01(average / maxPerCourse);
}

function getCompactness(plan) {
  const courseCount = plan.schedule.length;
  if (courseCount === 0) return 0;

  const usedDays = new Set(plan.schedule.map(course => course.dayOfWeek)).size;
  const maxDays = Math.min(WEEK_DAYS, courseCount);
  if (maxDays <= 1) return 1;

  return clamp01((maxDays - usedDays) / (maxDays - 1));
}

function getEasiness(plan) {
  if (plan.schedule.length === 0) return 0;

  const average = plan.schedule
    .reduce((sum, course) => sum + getEasyCourseScore(course), 0) / plan.schedule.length;

  return clamp01(average / MAX_EASY_COURSE_SCORE);
}

function evaluatePreference(plan, constraints, profile) {
  const breakdown = {
    interest: getInterestCoverage(plan, constraints),
    compact: getCompactness(plan),
    easy: getEasiness(plan),
  };

  const weightSum = profile.interest + profile.compact + profile.easy;
  const score = weightSum === 0
    ? 0
    : (breakdown.interest * profile.interest
      + breakdown.compact * profile.compact
      + breakdown.easy * profile.easy) / weightSum;

  return { score, breakdown };
}

function scoreCourse(course, schedule, constraints, variant, requiredIds, retakeIds) {
  let score = 1000;
  const id = Number(course.id);

  if (requiredIds.has(id)) score += 10000;
  if (retakeIds.has(id)) score += 9000;

  score -= getCategoryPriority(course) * 120;
  score += (course.credits || 0) * 12;

  if (variant.id === 'compact' || constraints.preferCompact) {
    const usedDays = new Set(schedule.map(c => c.dayOfWeek));
    score += usedDays.has(course.dayOfWeek) ? 120 : -20;
  }

  if (variant.id === 'easy_score') {
    score += getEasyCourseScore(course);
  }

  if (variant.id === 'interest') {
    score += getInterestScore(course, constraints);
  }

  if (variant.id === 'max_credits') {
    score += (course.credits || 0) * 25;
  }

  return score;
}

function addCourseToPlan(plan, course, constraints, reason, options = {}) {
  if (isWatching(course, constraints)) {
    plan.watchedCourses.push({ ...course, scheduleState: 'watching' });
    return true;
  }

  const hardReason = hardConstraintReason(course, constraints);
  if (hardReason) {
    plan.excludedCourses.push({ course, reason: hardReason });
    if (options.required) {
      plan.failures.push(`必要課程「${course.name}」${hardReason}`);
    }
    return false;
  }

  const conflict = conflictsWithSchedule(course, plan.schedule);
  if (conflict) {
    const message = `與「${conflict.name}」衝堂`;
    plan.excludedCourses.push({ course, reason: message });
    if (options.required) {
      plan.failures.push(`必要課程「${course.name}」${message}`);
    }
    return false;
  }

  if (plan.totalCredits + course.credits > plan.maxCredits) {
    const message = `超過學分上限 ${plan.maxCredits}`;
    plan.excludedCourses.push({ course, reason: message });
    if (options.required) {
      plan.failures.push(`必要課程「${course.name}」${message}`);
    }
    return false;
  }

  const dayCount = plan.schedule.filter(c => c.dayOfWeek === course.dayOfWeek).length;
  if (dayCount >= plan.maxCoursesPerDay) {
    plan.excludedCourses.push({ course, reason: `超過每日 ${plan.maxCoursesPerDay} 門課限制` });
    return false;
  }

  plan.schedule.push({ ...course, scheduleState: 'selected', reason });
  plan.totalCredits += course.credits || 0;
  return true;
}

function createEmptyPlan(variant, constraints) {
  return {
    id: variant.id,
    title: variant.title,
    description: variant.description,
    schedule: [],
    watchedCourses: [],
    excludedCourses: [],
    failures: [],
    warnings: [],
    totalCredits: 0,
    minCredits: constraints.minCredits ?? DEFAULT_MIN_CREDITS,
    maxCredits: constraints.maxCredits ?? DEFAULT_MAX_CREDITS,
    maxCoursesPerDay: constraints.maxCoursesPerDay ?? DEFAULT_MAX_COURSES_PER_DAY,
  };
}

function buildPlan(candidateCourses, constraints, variant) {
  const plan = createEmptyPlan(variant, constraints);
  const selectedIds = toIdSet(constraints.selectedCourseIds);
  const mustTakeIds = toIdSet([
    ...toArray(constraints.mustTakeCourseIds),
    ...toArray(constraints.mustTakeCourses),
  ]);
  const retakeIds = toIdSet([
    ...toArray(constraints.retakeCourseIds),
    ...toArray(constraints.failedRequiredCourseIds),
  ]);
  const completedIds = toIdSet(constraints.completedCourseIds);
  const requiredIds = new Set([...selectedIds, ...mustTakeIds, ...retakeIds]);

  for (const course of candidateCourses) {
    if (isWatching(course, constraints)) {
      addCourseToPlan(plan, course, constraints, '關注課程');
    }
  }

  const eligible = candidateCourses.filter(course => (
    !completedIds.has(Number(course.id)) && !isWatching(course, constraints)
  ));
  const requiredCourses = eligible
    .filter(course => requiredIds.has(Number(course.id)) || course.category === '必修')
    .sort((a, b) => {
      const aRequired = requiredIds.has(Number(a.id)) ? 0 : 1;
      const bRequired = requiredIds.has(Number(b.id)) ? 0 : 1;
      if (aRequired !== bRequired) return aRequired - bRequired;
      return getCategoryPriority(a) - getCategoryPriority(b);
    });

  const requiredCourseIdsInData = new Set(requiredCourses.map(course => Number(course.id)));
  for (const requiredId of requiredIds) {
    if (!requiredCourseIdsInData.has(requiredId)) {
      plan.warnings.push(`指定或重補修課程 ID:${requiredId} 不在候選課程資料中`);
    }
  }

  for (const course of requiredCourses) {
    addCourseToPlan(plan, course, constraints, course.category === '必修' ? '必修優先' : '指定或重補修優先', {
      required: requiredIds.has(Number(course.id)),
    });
  }

  const optional = eligible.filter(course => !plan.schedule.some(c => c.id === course.id));
  const remaining = optional.filter(course => !requiredCourses.some(c => c.id === course.id));

  while (remaining.length > 0 && plan.totalCredits < plan.maxCredits) {
    remaining.sort((a, b) => (
      scoreCourse(b, plan.schedule, constraints, variant, requiredIds, retakeIds)
      - scoreCourse(a, plan.schedule, constraints, variant, requiredIds, retakeIds)
    ));

    const course = remaining.shift();
    addCourseToPlan(plan, course, constraints, variant.title);

    if (plan.totalCredits >= plan.minCredits && variant.id !== 'max_credits') {
      const canAddMore = remaining.some(next => plan.totalCredits + next.credits <= plan.maxCredits);
      if (!canAddMore) break;
    }
  }

  plan.schedule.sort((a, b) => {
    if (a.dayOfWeek !== b.dayOfWeek) return a.dayOfWeek - b.dayOfWeek;
    return a.startPeriod - b.startPeriod;
  });

  if (plan.totalCredits < plan.minCredits) {
    plan.warnings.push(`目前方案僅 ${plan.totalCredits} 學分，低於最低目標 ${plan.minCredits} 學分`);
  }

  if (constraints.preferredTrack && !candidateCourses.some(course => course.track)) {
    plan.warnings.push('目前課程資料缺少 track 欄位，尚無法完整支援核心選修路徑排序');
  }

  if (constraints.digitalCreditsNeeded && !candidateCourses.some(course => course.digitalCredits)) {
    plan.warnings.push('目前課程資料缺少 digitalCredits 欄位，尚無法完整檢查數位課程畢業門檻');
  }

  plan.success = plan.schedule.length > 0 && plan.failures.length === 0;
  plan.courseCount = plan.schedule.length;
  return plan;
}

function uniquePlans(plans) {
  const seen = new Set();
  return plans.filter(plan => {
    const key = plan.schedule.map(course => course.id).sort((a, b) => a - b).join(',');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function generateSchedule(candidateCourses, constraints = {}) {
  if (!Array.isArray(candidateCourses) || candidateCourses.length === 0) {
    return {
      success: false,
      schedule: [],
      plans: [],
      totalCredits: 0,
      courseCount: 0,
      excludedCourses: [],
      warnings: ['沒有可用的候選課程'],
      message: '找不到符合條件的候選課程，請調整搜尋條件或偏好設定。',
    };
  }

  const preferenceProfile = buildPreferenceProfile(constraints);
  const hasExpressedPreference = Object.values(preferenceProfile).some(weight => weight > 0);

  const plans = uniquePlans(
    PLAN_VARIANTS
      .map(variant => {
        const plan = buildPlan(candidateCourses, constraints, variant);
        const { score, breakdown } = evaluatePreference(plan, constraints, preferenceProfile);
        plan.preferenceScore = score;
        plan.preferenceBreakdown = breakdown;
        return plan;
      })
      .sort((a, b) => {
        if (a.success !== b.success) return a.success ? -1 : 1;
        const aMeetsMin = a.totalCredits >= a.minCredits ? 1 : 0;
        const bMeetsMin = b.totalCredits >= b.minCredits ? 1 : 0;
        if (aMeetsMin !== bMeetsMin) return bMeetsMin - aMeetsMin;
        // 偏好符合度優先於總學分，避免整條個人化管線在最後一步被學分數蓋掉。
        if (Math.abs(a.preferenceScore - b.preferenceScore) > PREFERENCE_SCORE_EPSILON) {
          return b.preferenceScore - a.preferenceScore;
        }
        return b.totalCredits - a.totalCredits;
      })
  );

  const primary = plans[0];
  if (!primary || !primary.success) {
    const warnings = plans.flatMap(plan => [...plan.failures, ...plan.warnings]);
    return {
      success: false,
      schedule: [],
      plans,
      totalCredits: 0,
      courseCount: 0,
      excludedCourses: primary?.excludedCourses || [],
      warnings,
      message: warnings[0] || '無法產生符合限制的課表。',
    };
  }

  const allWarnings = [...new Set(plans.flatMap(plan => plan.warnings))];
  if (!hasExpressedPreference) {
    allWarnings.push('未設定興趣關鍵字、集中排課或涼課偏好，主推方案改以總學分決定，個人化程度有限。');
  }

  const selectionReason = hasExpressedPreference
    ? `偏好符合度 ${Math.round(primary.preferenceScore * 100)}%`
    : '未表達偏好，改依總學分挑選';

  return {
    success: true,
    schedule: primary.schedule,
    plans,
    totalCredits: primary.totalCredits,
    courseCount: primary.schedule.length,
    excludedCourses: primary.excludedCourses,
    watchedCourses: primary.watchedCourses,
    warnings: allWarnings,
    preferenceProfile,
    hasExpressedPreference,
    message: `已產生 ${plans.length} 個課表方案，預設採用「${primary.title}」（${selectionReason}）：${primary.schedule.length} 門課，共 ${primary.totalCredits} 學分。`,
  };
}

export function validateSchedule(courses = []) {
  const selectedCourses = courses.filter(course => {
    const status = course.scheduleState || course.status || course.state || 'selected';
    return status !== 'watching' && status !== '關注';
  });

  const conflicts = [];
  for (let i = 0; i < selectedCourses.length; i += 1) {
    for (let j = i + 1; j < selectedCourses.length; j += 1) {
      if (timeConflict(selectedCourses[i], selectedCourses[j])) {
        conflicts.push({ course1: selectedCourses[i], course2: selectedCourses[j] });
      }
    }
  }

  return {
    valid: conflicts.length === 0,
    conflicts,
    totalCredits: selectedCourses.reduce((sum, course) => sum + (course.credits || 0), 0),
  };
}

export { timeConflict as checkConflict };

export default { generateSchedule, checkConflict: timeConflict, validateSchedule };
