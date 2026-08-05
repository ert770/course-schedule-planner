// Skill 3: scheduling engine
// Rule-based scheduler that keeps hard constraints verifiable and leaves
// explanation/comparison to the AI Agent.

import { normalizeBlockedPeriods } from '../utils/periods.js';
import {
  buildStudentScope,
  isRequiredForStudent,
  isOtherStudentsRequiredCourse,
  parseClassName,
} from './courseScope.js';
import { annotateCourseCategory } from './courseCategory.js';
import { evaluateOutsideElective } from './outsideElective.js';
import {
  countsTowardGraduation,
  getNonGraduationCategory,
  UNRECOGNIZED_OUTSIDE_ELECTIVE,
} from '../data/generalEducation.js';

// 校規：每學期上限 25 學分、下限 12 學分（四年級 9），超修申請後至多 30。
// 見 `docs/COURSE_SELECTION_RULES.md`。先前寫死的 15／22 沒有出處。
const DEFAULT_MIN_CREDITS = 12;
const DEFAULT_MAX_CREDITS = 25;
const FINAL_YEAR_MIN_CREDITS = 9;
const FINAL_YEAR = 4;
const OVERLOAD_MAX_CREDITS = 30;
// 資料庫實際含週六與週日課程（週六 81 筆、週日 9 筆），因此以七天為準。
const WEEK_DAYS = 7;
const INTEREST_KEYWORD_SCORE = 40;
const MAX_EASY_COURSE_SCORE = 100;
const PREFERENCE_SCORE_EPSILON = 0.001;
const UNSCHEDULED_NAMES_IN_WARNING = 3;

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

// 警告訊息中只列出前幾個課名。全部列出會有數十行，反而讓其他警告看不到。
function summarizeNames(names, limit = UNSCHEDULED_NAMES_IN_WARNING) {
  const shown = names.slice(0, limit).join('、');
  return names.length > limit ? `${shown} 等 ${names.length} 門` : shown;
}

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

// 排序與評分用的類別優先度。
//
// `Courses.type = '必修'` 只代表「某個班級的必修」。若不是這位學生的必修，
// 就不該享有必修的最高優先度——否則通識、共同科目與跨系班級的必修會在選修填充
// 階段直接壓過本系選修，課表照樣出現 `商創一(RMIT)` 這種學生修不到的課。
// 這類課程仍保留為候選（適用對象規則尚未確認，見 #13），只是不再優先。
//
// 僅在學生範圍可判定時才降級。範圍不明時沒有更好的訊號，維持既有的必修優先排序，
// 而不是把所有必修一起打成選修——後者會讓未帶 profile 的呼叫端結果無聲變差。
function getEffectiveCategoryPriority(course, scope) {
  if (scope?.resolved && course.category === '必修' && !isRequiredForStudent(course, scope)) {
    return CATEGORY_PRIORITY['選修'];
  }
  return getCategoryPriority(course);
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

  // 時間類限制必須檢查課程的每一個時段，否則多時段課程只會被檢查第一段。
  const blocks = getTimeBlocks(course);

  if (constraints.noMorningClasses && blocks.some(block => block.startPeriod <= 1)) {
    return '不符合不上早八限制';
  }

  if (constraints.noEveningClasses && blocks.some(block => block.startPeriod >= 12)) {
    return '不符合不上晚課限制';
  }

  for (const bp of toArray(constraints.blockedPeriods)) {
    for (const block of blocks) {
      if (block.dayOfWeek !== bp.day) continue;
      if (bp.period >= block.startPeriod && bp.period <= block.endPeriod) {
        return '位於封鎖時段';
      }
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
  if (constraints.lunchBreakFree
    && blocks.some(block => block.startPeriod <= 5 && block.endPeriod >= 5)) {
    return '不符合午休保留偏好';
  }
  if (constraints.learnMore && !textIncludesAny(desc, ['實作', '專題', '深入', '進階', '應用'])) {
    return '不符合學到較多內容偏好';
  }

  return null;
}

// 一門課可能有多個時段，例如 `(四)01-04 (四)06-09 (五)01-04`。
// 資料庫中約 9% 的課程屬於此類，只比對第一段會漏判衝堂。
function getTimeBlocks(course) {
  if (Array.isArray(course.timeBlocks) && course.timeBlocks.length > 0) {
    return course.timeBlocks;
  }
  if (course.dayOfWeek == null || course.startPeriod == null) {
    return [];
  }
  return [{
    dayOfWeek: course.dayOfWeek,
    startPeriod: course.startPeriod,
    endPeriod: course.endPeriod ?? course.startPeriod,
  }];
}

function blocksOverlap(a, b) {
  if (a.dayOfWeek !== b.dayOfWeek) return false;
  return !(a.endPeriod < b.startPeriod || b.endPeriod < a.startPeriod);
}

function timeConflict(courseA, courseB) {
  const blocksA = getTimeBlocks(courseA);
  const blocksB = getTimeBlocks(courseB);
  return blocksA.some(a => blocksB.some(b => blocksOverlap(a, b)));
}

function getUsedDays(course) {
  return new Set(getTimeBlocks(course).map(block => block.dayOfWeek));
}

// 節次 `00`（例如 `(一)00`）代表尚未排定時間。這類課程解析後沒有任何時段，
// 因此不佔時段、不衝堂、也不受時間類限制。若讓它們參與貪婪填充，
// 會因為毫無限制而被無限塞入——實測 3560 筆資料時，主推方案 86 門課中有 65 門屬此類。
function hasScheduledTime(course) {
  return getTimeBlocks(course).length > 0;
}

function conflictsWithSchedule(course, schedule) {
  return schedule.find(existing => timeConflict(existing, course)) || null;
}

// 同一門課的識別。
//
// `Courses.course_id` **不是**課程識別碼，而是「班級 + 課程」的組合：
// 計算機演算法在資訊三甲／乙／丙／丁分別是 `CE07131-28010`、`CE07132-28010`、
// `CE07133-28010`、`CE07134-28010`，四筆各自不同。真正的課號在 `subid3`，
// 四筆都是 `IECS3002`。
//
// 一門課可能由不同老師開在不同班次，但學生只能選其中一個班次。先前排課引擎
// 把每個 section 當成獨立課程，實測課表因此出現兩門計算機演算法（許芳榮、黃秀芬）。
//
// 實習與正課是不同課號（`MATH1005P` 對 `MATH1005`），不會被誤判為同一門課
// ——它們本來就該一起修（見路線圖 #15）。
function getCourseKey(course) {
  const code = String(course.subid3 || '').trim();
  if (code) return `code:${code}`;

  const name = String(course.name || '').trim();
  if (name) return `name:${name}`;

  return `id:${course.id}`;
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

  // ragTag 是資料庫 `Course_Sections.rag_tag` 的主題標籤陣列，100% 有值，
  // 是比課名與課程描述更精準的興趣訊號，必須納入比對。
  const searchable = [
    course.name,
    course.code,
    course.instructor,
    course.department,
    course.category,
    course.description,
    course.track,
    ...toArray(course.ragTag),
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

  const usedDays = new Set(plan.schedule.flatMap(course => [...getUsedDays(course)])).size;
  if (usedDays === 0) return 0;

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

function scoreCourse(course, schedule, constraints, variant, requiredIds, retakeIds, scope) {
  let score = 1000;
  const id = Number(course.id);

  if (requiredIds.has(id)) score += 10000;
  if (retakeIds.has(id)) score += 9000;

  score -= getEffectiveCategoryPriority(course, scope) * 120;
  score += (course.credits || 0) * 12;

  if (variant.id === 'compact' || constraints.preferCompact) {
    const usedDays = new Set(schedule.flatMap(c => [...getUsedDays(c)]));
    const courseDays = [...getUsedDays(course)];
    const overlapping = courseDays.filter(day => usedDays.has(day)).length;
    score += overlapping > 0 ? 120 * overlapping : -20 * Math.max(1, courseDays.length);
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

  // 一門課只能選一個班次。同一門課的其他班次即使時段不衝突也不得再排入。
  const courseKey = getCourseKey(course);
  if (plan.placedCourseKeys.has(courseKey)) {
    const placed = plan.placedCourseKeys.get(courseKey);
    const message = `已排入同一門課的其他班次（${placed.department}／${placed.instructor || '未定'}）`;
    plan.excludedCourses.push({ course, reason: message });
    if (options.required) {
      plan.failures.push(`必要課程「${course.name}」${message}`);
    }
    return false;
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

  // 單日課程數需計入課程佔用的每一天，多時段課程可能橫跨多天。
  for (const day of getUsedDays(course)) {
    const dayCount = plan.schedule.filter(c => getUsedDays(c).has(day)).length;
    if (dayCount >= plan.maxCoursesPerDay) {
      plan.excludedCourses.push({ course, reason: `超過每日 ${plan.maxCoursesPerDay} 門課限制` });
      return false;
    }
  }

  plan.placedCourseKeys.set(courseKey, course);

  // 通識共同必修（軍訓國防科技 1、體育 2、班級活動）要排進課表，但**不計入畢業學分**。
  // 學期學分（12～25 上下限）仍然計入，因為那些課實際要修、也真的佔學分。
  // 見 `docs/COURSE_SELECTION_RULES.md` 第四節。
  const credits = course.credits || 0;
  const nonGraduationCategory = getNonGraduationCategory(course);
  const placed = {
    ...course,
    scheduleState: 'selected',
    reason,
    countsTowardGraduation: nonGraduationCategory === null,
    nonGraduationCategory,
  };

  // 尚未排定時間的課程仍會被排入（班級活動、論文等屬必要課程），但不放進
  // 課表格的 schedule，避免與有時段的課程混在一起造成畫面與學分對不上。
  if (!hasScheduledTime(course)) {
    plan.unscheduledCourses.push(placed);
  } else {
    plan.schedule.push(placed);
  }

  plan.totalCredits += credits;
  if (nonGraduationCategory === null) {
    plan.graduationCredits += credits;
  } else {
    plan.nonGraduationCredits += credits;
  }
  return true;
}

function createEmptyPlan(variant, constraints) {
  return {
    id: variant.id,
    title: variant.title,
    description: variant.description,
    schedule: [],
    unscheduledCourses: [],
    watchedCourses: [],
    excludedCourses: [],
    failures: [],
    warnings: [],
    // 已排入的課號 -> 該班次，用於擋掉同一門課的其他班次。
    placedCourseKeys: new Map(),
    // 學期修習學分，用於 12～25 學分的上下限檢查。含通識共同必修。
    totalCredits: 0,
    // 計入畢業的學分，用於畢業進度。不含通識共同必修（軍訓、體育、班級活動）。
    graduationCredits: 0,
    nonGraduationCredits: 0,
    minCredits: constraints.minCredits ?? defaultMinCredits(constraints),
    maxCredits: constraints.maxCredits ?? defaultMaxCredits(constraints),
    // 每日課程數上限沒有校方依據，預設不限制；呼叫端仍可自行指定。
    maxCoursesPerDay: constraints.maxCoursesPerDay ?? Infinity,
  };
}

// 四年級的學分下限為 9（其餘年級 12）。
function defaultMinCredits(constraints) {
  return Number(constraints.gradeLevel) >= FINAL_YEAR ? FINAL_YEAR_MIN_CREDITS : DEFAULT_MIN_CREDITS;
}

// 超修須由使用者明確選擇，不得預設開啟。
function defaultMaxCredits(constraints) {
  return constraints.allowCreditOverload ? OVERLOAD_MAX_CREDITS : DEFAULT_MAX_CREDITS;
}

// 非系所班級（通識、共同科目、學院綜合班、英語授課班、學分學程）的適用對象
// 尚未確認，因此不當成這位學生的必修，但也不排除——`國文綜合班`、`體育選修`、
// `軍訓` 這類全校共同科目若整批排除，學生會漏掉真正該修的課。
// 待確認問題整理於路線圖 #13 與 `docs/DEPARTMENT_MAPPING.md`。
function countDemotedRequiredByCategory(eligible, scope) {
  const counts = new Map();

  for (const course of eligible) {
    if (course.category !== '必修' || isRequiredForStudent(course, scope)) continue;
    const { category } = parseClassName(course.department);
    counts.set(category, (counts.get(category) || 0) + 1);
  }

  return counts;
}

function addScopeWarnings(plan, eligible, otherRequired, scope) {
  if (!scope.resolved) {
    // 「沒填」與「填了但對不到系所對照表」是兩種問題：前者要使用者去補，
    // 後者是資料錯誤（系所名稱打錯，或 A 表少了一個單位）。合併成同一句
    // 「未設定系所或年級」會讓後者永遠查不出來。
    if (scope.departmentUnmapped) {
      plan.failures.push(
        `系所「${scope.department}」不在系所對照表中，無法判定必修範圍。`
        + '請確認個人資料的系所名稱是否正確；若確為本校單位，需補進 `docs/DEPARTMENT_MAPPING.md` 的 A 表。'
      );
      return;
    }

    const missing = [
      scope.departmentMissing ? '系所' : null,
      scope.gradeMissing ? '年級' : null,
    ].filter(Boolean).join('與');
    plan.warnings.push(
      `未設定${missing}，無法判定必修範圍；本方案只會排入明確指定的課程與一般候選課程。`
    );
    return;
  }

  // 必修不得換班（資工系明文）。沒有班別時只能收斂到年級，同年級其他班的必修
  // 仍會進入候選，但學生實際上選不到——這件事必須講出來。
  if (scope.classMismatch) {
    plan.warnings.push(
      `班別「${scope.className}」不屬於 ${scope.department}，已忽略班別設定，`
      + '必修僅依系所與年級判定。'
    );
  } else if (scope.gradeOverriddenByClass) {
    // 年級以班別為準，但兩份資料不一致本身就是要修的問題，必須講出來。
    plan.warnings.push(
      `班別「${scope.className}」為 ${scope.grade} 年級，與個人資料的 `
      + `${scope.profileGrade} 年級不一致；已依班別判定。請確認個人資料的年級是否需要更新。`
    );
  } else if (!scope.classSuffix) {
    plan.warnings.push(
      '未設定班別，必修僅收斂到系所與年級。系上不接受必修換班，'
      + '請補上班別（例如 資訊三甲）才能排出你實際選得到的必修。'
    );
  }

  if (otherRequired.length > 0) {
    const scopeLabel = scope.classSuffix
      ? `依 ${scope.className} 判定`
      : `依 ${scope.department} ${scope.grade} 年級判定`;
    plan.warnings.push(
      `已排除 ${otherRequired.length} 門其他系所、學制、年級或班別的必修課（${scopeLabel}）。`
    );
  }

  const demoted = countDemotedRequiredByCategory(eligible, scope);
  const demotedTotal = [...demoted.values()].reduce((sum, count) => sum + count, 0);
  if (demotedTotal > 0) {
    plan.warnings.push(
      `另有 ${demotedTotal} 門通識、共同科目或跨系班級的必修尚無適用對象規則，`
      + '已視為一般候選課程而非必修。'
    );
  }
}

// 使用者明確指定的課程 id。
//
// `POST /api/schedule/generate` 的 `courseIds` 是「使用者在課程瀏覽器勾選的課」，
// 它同時決定候選池，但**不會**進入 `selectedCourseIds`。若只看 `selectedCourseIds`，
// 手動選課流程送進來的課會被當成系統自己撿的候選而遭系外選修條件靜默剔除。
function collectExplicitCourseIds(constraints) {
  return toIdSet([
    ...toArray(constraints.explicitCourseIds),
    ...toArray(constraints.selectedCourseIds),
    ...toArray(constraints.mustTakeCourseIds),
    ...toArray(constraints.mustTakeCourses),
    ...toArray(constraints.retakeCourseIds),
    ...toArray(constraints.failedRequiredCourseIds),
  ]);
}

// 候選課程前處理。五個方案共用同一批候選，因此類別解析與系外選修認列判定
// 只做一次——放進 buildPlan 會對 3560 筆課程重複解析五遍。
//
// 產出：
//   courses     解析過類別（核心選修／系外選修）與修課路徑的候選課程
//   exclusions  依系外選修認列條件排除的課程與原因
//   warnings    需提醒但不排除的事項
function prepareCandidates(candidateCourses, scope, explicitIds = new Set()) {
  const courses = [];
  const exclusions = [];
  const warnings = [];
  const officeConfirmationNames = new Set();
  const difficultyNames = new Set();
  const unrecognizedExplicit = [];

  for (const raw of candidateCourses) {
    const course = annotateCourseCategory(raw, scope);
    const outside = evaluateOutsideElective(course, scope);

    if (!outside.checked) {
      courses.push(course);
      continue;
    }

    if (!outside.eligible) {
      // 系統自己撿的候選：不推薦不能認列的課，整個剔除。
      if (!explicitIds.has(Number(course.id))) {
        exclusions.push({ course, reason: outside.reasons[0] });
        continue;
      }

      // 使用者自己指定的課：**保留**。這條規則講的是「能不能計入畢業學分」，
      // 不是「能不能修」——把使用者親手勾的課靜默刪掉，畫面上只會少一門課，
      // 沒有任何線索。改為排入但標記不計入畢業學分，由使用者自行決定去留。
      const marked = {
        ...course,
        nonGraduationCategory: UNRECOGNIZED_OUTSIDE_ELECTIVE,
        outsideElectiveRecognized: false,
        outsideElectiveReasons: outside.reasons,
      };
      unrecognizedExplicit.push(marked);
      courses.push(marked);
      continue;
    }

    for (const warning of outside.warnings) {
      if (warning.type === 'difficulty') difficultyNames.add(warning.name);
    }
    if (outside.needsOfficeConfirmation) officeConfirmationNames.add(course.name);

    courses.push(course);
  }

  if (exclusions.length > 0) {
    warnings.push(
      `已排除 ${exclusions.length} 門不符合系外選修認列條件的課程`
      + '（進修部、與本系課程重複、大一概論性課程）。'
    );
  }

  if (unrecognizedExplicit.length > 0) {
    const detail = unrecognizedExplicit
      .slice(0, UNSCHEDULED_NAMES_IN_WARNING)
      .map(course => `${course.name}（${course.outsideElectiveReasons[0]}）`)
      .join('；');
    const rest = unrecognizedExplicit.length > UNSCHEDULED_NAMES_IN_WARNING
      ? ` 等 ${unrecognizedExplicit.length} 門`
      : '';
    // 警告是純文字，直接顯示在畫面上，不得使用 markdown 語法——`**` 會原樣印出來。
    warnings.push(
      `你指定的課程中有 ${unrecognizedExplicit.length} 門不符合系外選修認列條件：`
      + `${detail}${rest}。已排入課表，但學分不計入畢業，請自行決定是否移除。`
    );
  }

  // 每門課各一條警告會有數十行，把其他警告全部淹掉。彙整成一行並只列出前幾門。
  if (difficultyNames.size > 0) {
    warnings.push(
      `候選課程中有 ${difficultyNames.size} 門系外選修屬大一層級課程`
      + `（${summarizeNames([...difficultyNames])}），難度是否不低於本系課程需自行確認。`
    );
  }

  if (officeConfirmationNames.size > 0) {
    warnings.push(
      `候選課程中有 ${officeConfirmationNames.size} 門系外選修，依系上規定須先向系辦公室`
      + '確認是否計入畢業學分。'
    );
  }

  return { courses, exclusions, warnings, scope, explicitIds };
}

function buildPlan(prepared, constraints, variant) {
  const candidateCourses = prepared.courses;
  const plan = createEmptyPlan(variant, constraints);
  // 系外選修認列條件的排除結果對每個方案都相同，直接帶進各方案的排除清單，
  // 讓使用者在任何一個方案上都看得到「為什麼這門課不見了」。
  plan.excludedCourses.push(...prepared.exclusions);
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

  // #13：`Courses.type = '必修'` 是「某系所某年級的必修」，不是「這位學生的必修」。
  // 未依系所與年級收斂時，全校 2094 筆必修都會被當成這位學生的必修。
  const { scope } = prepared;

  for (const course of candidateCourses) {
    if (isWatching(course, constraints)) {
      addCourseToPlan(plan, course, constraints, '關注課程');
    }
  }

  // 他系、他學制、其他年級或其他班別的必修，這位學生一般無法修習，因此整批排除，
  // 不是降低優先度——降低優先度仍可能在選修階段被貪婪填充排進來。
  //
  // **使用者明確指定的課程豁免。** 這裡的判定是「依系所、年級、班別推論」，
  // 不是校方的選課權限；轉系、輔系、雙主修、跨班加簽都可能讓學生真的修得到。
  // 把使用者親手指定的課靜默刪掉，畫面上只會少一門課而沒有任何線索。
  // 與系外選修的處理一致：保留、排入、明講。
  const allOtherRequired = candidateCourses.filter(
    course => isOtherStudentsRequiredCourse(course, scope)
  );
  const exemptedRequired = allOtherRequired.filter(
    course => prepared.explicitIds.has(Number(course.id))
  );
  const otherRequired = allOtherRequired.filter(
    course => !prepared.explicitIds.has(Number(course.id))
  );
  const otherRequiredIds = new Set(otherRequired.map(course => Number(course.id)));

  if (exemptedRequired.length > 0) {
    const names = [...new Set(exemptedRequired.map(course => `${course.name}（${course.department}）`))];
    plan.warnings.push(
      `你指定的課程中有 ${exemptedRequired.length} 門是其他班別或系所的必修：`
      + `${summarizeNames(names)}。系上不接受必修換班，能否修習需自行向系辦確認，`
      + '本方案仍依你的指定排入。'
    );
  }

  const eligible = candidateCourses.filter(course => (
    !completedIds.has(Number(course.id))
    && !isWatching(course, constraints)
    && !otherRequiredIds.has(Number(course.id))
  ));
  const requiredCourses = eligible
    .filter(course => requiredIds.has(Number(course.id)) || isRequiredForStudent(course, scope))
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
    addCourseToPlan(plan, course, constraints, isRequiredForStudent(course, scope) ? '必修優先' : '指定或重補修優先', {
      required: requiredIds.has(Number(course.id)),
    });
  }

  const placedIds = new Set([
    ...plan.schedule.map(c => Number(c.id)),
    ...plan.unscheduledCourses.map(c => Number(c.id)),
  ]);
  const optional = eligible.filter(course => !placedIds.has(Number(course.id)));

  // 貪婪填充只考慮有排定時間的課程。無時間課程不佔時段、不衝堂也不受任何限制，
  // 讓它們參與填充會被無限塞入；它們只有在被明確指定為必要課程時才會排入。
  const remaining = optional.filter(course => (
    !requiredCourses.some(c => c.id === course.id) && hasScheduledTime(course)
  ));

  while (remaining.length > 0 && plan.totalCredits < plan.maxCredits) {
    remaining.sort((a, b) => (
      scoreCourse(b, plan.schedule, constraints, variant, requiredIds, retakeIds, scope)
      - scoreCourse(a, plan.schedule, constraints, variant, requiredIds, retakeIds, scope)
    ));

    const course = remaining.shift();
    addCourseToPlan(plan, course, constraints, variant.title);

    if (plan.totalCredits >= plan.minCredits && variant.id !== 'max_credits') {
      // 只計入還能推進學分的課程。0 學分課程恆滿足學分上限條件，
      // 會讓這個中止判斷永遠為真，迴圈跑到候選清單耗盡。
      const canAddMore = remaining.some(next => (
        (next.credits || 0) > 0 && plan.totalCredits + next.credits <= plan.maxCredits
      ));
      if (!canAddMore) break;
    }
  }

  plan.schedule.sort((a, b) => {
    if (a.dayOfWeek !== b.dayOfWeek) return a.dayOfWeek - b.dayOfWeek;
    return a.startPeriod - b.startPeriod;
  });

  addScopeWarnings(plan, eligible, otherRequired, scope);
  plan.warnings.push(...prepared.warnings);

  // 學期學分與畢業學分不同時，必須明講。畫面只顯示一個數字的話，
  // 學生會把含軍訓體育的學期學分誤當成畢業進度。
  if (plan.nonGraduationCredits > 0) {
    const labels = [...new Set(
      [...plan.schedule, ...plan.unscheduledCourses]
        .map(course => course.nonGraduationCategory)
        .filter(Boolean)
    )].join('、');
    // 訊息要指名方案：`generateSchedule()` 會把所有方案的警告聯集後回傳，
    // 寫「本方案」的話，使用者看到的是主推方案旁邊掛著別的方案的學分數。
    // 不寫「依校規」——不計入的來源有兩種，通識共同必修是校規，
    // 系外選修未認列是系上規定，混為一談會讓使用者查不到依據。
    plan.warnings.push(
      `方案「${plan.title}」的 ${plan.totalCredits} 學分中有 ${plan.nonGraduationCredits} 學分`
      + `（${labels}）不計入畢業學分，計入畢業的為 ${plan.graduationCredits} 學分。`
    );
  }

  if (plan.totalCredits < plan.minCredits) {
    plan.warnings.push(`目前方案僅 ${plan.totalCredits} 學分，低於最低目標 ${plan.minCredits} 學分`);
  }

  // 修課路徑來自 `server/src/data/csCurriculum.js`（113 課程地圖），
  // 目前只涵蓋資訊工程學系。其他系所的候選課程解析後仍沒有 track。
  if (constraints.preferredTrack && !candidateCourses.some(course => course.track)) {
    plan.warnings.push(
      `候選課程中沒有屬於「${constraints.preferredTrack}」的課程，`
      + '修課路徑偏好對本次排課沒有作用。'
    );
  }

  if (constraints.digitalCreditsNeeded && !candidateCourses.some(course => course.digitalCredits)) {
    plan.warnings.push('目前課程資料缺少 digitalCredits 欄位，尚無法完整檢查數位課程畢業門檻');
  }

  // 關注課程不佔時段，因此「只有關注課程」是合法結果而非失敗。
  // 若把它判成失敗，使用者的關注課程會連同回應一起被丟掉。
  plan.watchOnly = plan.schedule.length === 0
    && plan.unscheduledCourses.length === 0
    && plan.watchedCourses.length > 0;
  plan.success = plan.failures.length === 0
    && (plan.schedule.length > 0
      || plan.unscheduledCourses.length > 0
      || plan.watchedCourses.length > 0);
  // 無時間課程也計入學分，門數必須一併計入，否則畫面上的門數與學分會對不起來。
  plan.courseCount = plan.schedule.length + plan.unscheduledCourses.length;

  if (plan.watchOnly) {
    plan.warnings.push('目前沒有排入任何正式加選課程，課表上只有關注課程。');
  }

  if (plan.unscheduledCourses.length > 0) {
    const uniqueNames = [...new Set(plan.unscheduledCourses.map(course => course.name))];
    const shown = uniqueNames.slice(0, UNSCHEDULED_NAMES_IN_WARNING).join('、');
    const rest = uniqueNames.length > UNSCHEDULED_NAMES_IN_WARNING
      ? `等 ${uniqueNames.length} 種課程`
      : '';
    plan.warnings.push(
      `有 ${plan.unscheduledCourses.length} 門課尚未排定上課時間，不會顯示在課表格上：${shown}${rest}`
    );
  }

  // 內部用的去重索引不必回傳給前端（Map 也無法序列化成有意義的 JSON）。
  delete plan.placedCourseKeys;

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

export function generateSchedule(candidateCourses, rawConstraints = {}) {
  // 封鎖時段在此統一正規化，而不是要求每個呼叫端各自處理。
  // 使用者偏好可能存成時間字串（例如 ["08:00"]），未轉換時 bp.day 為 undefined，
  // 比對會靜默跳過而讓設定完全失效——這正是 D2 的缺陷。
  // 由呼叫端負責轉換等於每新增一條呼叫路徑就多一次踩坑的機會。
  const constraints = {
    ...rawConstraints,
    blockedPeriods: normalizeBlockedPeriods(rawConstraints.blockedPeriods),
  };

  if (!Array.isArray(candidateCourses) || candidateCourses.length === 0) {
    return {
      success: false,
      schedule: [],
      plans: [],
      totalCredits: 0,
      graduationCredits: 0,
      nonGraduationCredits: 0,
      courseCount: 0,
      excludedCourses: [],
      watchedCourses: [],
      unscheduledCourses: [],
      warnings: ['沒有可用的候選課程'],
      message: '找不到符合條件的候選課程，請調整搜尋條件或偏好設定。',
    };
  }

  const preferenceProfile = buildPreferenceProfile(constraints);
  const hasExpressedPreference = Object.values(preferenceProfile).some(weight => weight > 0);

  // 類別解析（核心選修／系外選修／修課路徑）與系外選修認列條件對所有方案相同，
  // 在此做一次後共用。
  const prepared = prepareCandidates(
    candidateCourses,
    buildStudentScope(constraints),
    collectExplicitCourseIds(constraints)
  );

  const plans = uniquePlans(
    PLAN_VARIANTS
      .map(variant => {
        const plan = buildPlan(prepared, constraints, variant);
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
      graduationCredits: 0,
      nonGraduationCredits: 0,
      courseCount: 0,
      excludedCourses: primary?.excludedCourses || [],
      // 失敗時仍要帶回關注課程，否則使用者標記的關注會從畫面上消失。
      watchedCourses: primary?.watchedCourses || [],
      unscheduledCourses: primary?.unscheduledCourses || [],
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

  // 學分含尚未排定時間的課程，因此門數必須一併說明，否則「N 門課共 M 學分」
  // 會出現門數只算課表格、學分卻含表格外課程的矛盾。
  const unscheduledNote = primary.unscheduledCourses.length > 0
    ? `（另有 ${primary.unscheduledCourses.length} 門時間未定）`
    : '';
  // 學期學分含軍訓、體育、班級活動，畢業學分不含。兩者不同時一併寫出，
  // 否則學生會把學期學分當成畢業進度。
  const creditNote = primary.nonGraduationCredits > 0
    ? `共 ${primary.totalCredits} 學分（計入畢業 ${primary.graduationCredits} 學分）。`
    : `共 ${primary.totalCredits} 學分。`;
  const message = primary.watchOnly
    ? `目前沒有可排入的正式加選課程，僅顯示 ${primary.watchedCourses.length} 門關注課程供你比較時段。`
    : `已產生 ${plans.length} 個課表方案，預設採用「${primary.title}」（${selectionReason}）：${primary.schedule.length} 門課${unscheduledNote}，${creditNote}`;

  return {
    success: true,
    watchOnly: primary.watchOnly,
    schedule: primary.schedule,
    plans,
    totalCredits: primary.totalCredits,
    graduationCredits: primary.graduationCredits,
    nonGraduationCredits: primary.nonGraduationCredits,
    courseCount: primary.courseCount,
    excludedCourses: primary.excludedCourses,
    watchedCourses: primary.watchedCourses,
    unscheduledCourses: primary.unscheduledCourses,
    warnings: allWarnings,
    preferenceProfile,
    hasExpressedPreference,
    message,
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

  // 同一門課的兩個班次即使時段不衝突，也不是合法的課表。
  const duplicates = [];
  const seenByKey = new Map();
  for (const course of selectedCourses) {
    const key = getCourseKey(course);
    const first = seenByKey.get(key);
    if (first) {
      duplicates.push({ course1: first, course2: course });
      continue;
    }
    seenByKey.set(key, course);
  }

  const totalCredits = selectedCourses.reduce((sum, course) => sum + (course.credits || 0), 0);
  // 軍訓、體育、班級活動要排進課表但不計入畢業學分，因此驗證結果同時回報兩個數字。
  const graduationCredits = selectedCourses.reduce(
    (sum, course) => (countsTowardGraduation(course) ? sum + (course.credits || 0) : sum),
    0
  );

  return {
    valid: conflicts.length === 0 && duplicates.length === 0,
    conflicts,
    duplicates,
    totalCredits,
    graduationCredits,
    nonGraduationCredits: totalCredits - graduationCredits,
  };
}

export { timeConflict as checkConflict };

export default { generateSchedule, checkConflict: timeConflict, validateSchedule };
