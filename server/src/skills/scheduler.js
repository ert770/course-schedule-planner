// Skill 3: scheduling engine
// Rule-based scheduler that keeps hard constraints verifiable and leaves
// explanation/comparison to the AI Agent.

import { normalizeBlockedPeriods } from '../utils/periods.js';
import {
  buildStudentScope,
  isRequiredForStudent,
  isOtherStudentsRequiredCourse,
} from './courseScope.js';
import { annotateCourseCategory, refineOutsideElectiveScopeReason } from './courseCategory.js';
import { evaluateOutsideElective } from './outsideElective.js';
import { ACTIVE_TERM } from '../data/activeTerm.js';
import {
  countsTowardGraduation,
  getNonGraduationCategory,
  UNRECOGNIZED_OUTSIDE_ELECTIVE,
} from '../data/generalEducation.js';
import {
  getFailedRequiredCourses,
  getPassedCourseCodes,
} from '../data/courseHistory.js';
import {
  buildReviewIndex,
  buildReviewPrior,
  deriveReviewEvidence,
  getNeutralEasyScore,
  EASY_SCORE_MAX,
} from './courseReviewStats.js';
import { CONSTRAINTS, DEFAULT_TIME_PREFERENCE_PRIORITY } from '../data/constraintSchema.js';
import { validateScheduleAgainstConstraints } from './scheduleValidator.js';

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
// 涼度覆蓋率低於此比例時，主推方案要提醒使用者「涼度只由少數幾門課推得」，
// 不能讓使用者把它當成整份課表的涼度。
const LOW_REVIEW_COVERAGE_RATIO = 0.5;

// 內容偏好軟性加分的單一量級（roadmap #3）。與 INTEREST_KEYWORD_SCORE 同量級
// （同屬「使用者陳述的關鍵字類偏好」），小於一個 category priority 級距（120），
// 大於 3 學分的差距（36）——單一命中應能撼動排序，但不該讓一門課單靠內容偏好
// 就跳過整個類別優先度（必修 > 核心選修 > 一般選修 > 通識 > 系外選修）。
const CONTENT_PREFERENCE_SCORE = 40;
// 候選池中某內容偏好的關鍵字命中率低於此比例：幾乎沒有課符合，加分近乎無效。
const CONTENT_PREFERENCE_LOW_SIGNAL_RATIO = 0.05;
// 高於此比例：幾乎每門課都符合，等於不篩選，使用者卻可能以為有效。
const CONTENT_PREFERENCE_HIGH_SIGNAL_RATIO = 0.95;

const CATEGORY_PRIORITY = {
  '必修': 0,
  '核心選修': 1,
  '一般選修': 2,
  // 尚未能由正式規則細分的 MySQL 原始選修保留相同優先度。
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
    return CATEGORY_PRIORITY['一般選修'];
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

// 內容偏好設定表（roadmap #3）：8 個以課程描述關鍵字判定的「盡量要／盡量不要」
// 偏好。這些原本是 hardConstraintReason() 的硬性排除條件，但關鍵字比對對
// 3560 筆真實課程描述的命中率兩極化——weightDaily 僅 1.7% 命中（未命中即排除
// 模式下等於候選集幾乎全滅）、learnMore 97.6% 命中（等於幾乎不篩選卻回報
// 已生效）、noMidterm 僅 0.1% 命中（「免期中考」幾乎從未真正排除任何課，是
// 靜默假承諾）。關鍵字比對的可靠度不足以支撐「不符合就整批排除」的硬性判定，
// 因此全部改為軟性加分，見 `getContentPreferenceScore()`。
//
// mode: 'avoid'  -> 命中代表課程有這個特徵，使用者想避免 -> 命中扣分
// mode: 'prefer' -> 命中代表課程有這個特徵，使用者想要   -> 命中加分
//
// **這是軟性評分，不是 roadmap #21 的正式 hard/soft schema**——沒有 weight、
// relaxable、source、confidence 欄位，那是分開的任務。
const CONTENT_PREFERENCE_RULES = [
  { flag: 'noMidterm', mode: 'avoid', label: '免期中考', keywords: ['期中', '期中考'] },
  { flag: 'noGroupReport', mode: 'avoid', label: '免分組報告', keywords: ['分組', '團體報告', '小組'] },
  { flag: 'discussion', mode: 'prefer', label: '討論課', keywords: ['討論', '互動', '參與'] },
  { flag: 'weightDaily', mode: 'prefer', label: '重視平時成績', keywords: ['平時', '作業', '出席'] },
  { flag: 'practicalExam', mode: 'prefer', label: '實作評量', keywords: ['實作', '實驗', '專題'] },
  { flag: 'finalReport', mode: 'prefer', label: '期末報告', keywords: ['期末報告', '報告', '專題'] },
  // 與原 hardConstraintReason() 的判定完全一致（只用「英文」一個關鍵字，
  // language 欄位另用 extra 判定），不擴大既有的比對範圍。language 欄位
  // 3560/3560 全為 undefined（roadmap #4 已查證），extra 保留判斷式以便
  // 欄位補齊後自動生效，不必回頭改這裡。
  {
    flag: 'englishTaught', mode: 'prefer', label: '英文授課', keywords: ['英文'],
    extra: course => course.language === 'English',
  },
  { flag: 'learnMore', mode: 'prefer', label: '學到較多內容', keywords: ['實作', '專題', '深入', '進階', '應用'] },
];

function matchesContentPreference(course, rule) {
  const desc = course.description || '';
  if (textIncludesAny(desc, rule.keywords)) return true;
  return typeof rule.extra === 'function' && rule.extra(course);
}

// 內容偏好的軟性加分，不分 PLAN_VARIANT 一律套用（見 scoreCourse()）。
//
// **未命中不給負分，avoid／prefer 兩種 mode 都適用**：關鍵字沒出現在描述裡，
// 代表「描述沒提到」，不代表「這門課真的沒有這個特徵」——跟 #4 對缺席評價
// 「不當成 0 分」是同一個誠實原則的延伸（見 docs/DECISIONS.md ADR-010）。
// 完全沒有設定任何內容偏好時，這個函式對每門課都回傳 0，排序與改動前
// （8 個旗標全 undefined/false）逐項一致。
function getContentPreferenceScore(course, constraints) {
  let score = 0;
  for (const rule of CONTENT_PREFERENCE_RULES) {
    if (!constraints[rule.flag]) continue;
    if (!matchesContentPreference(course, rule)) continue;
    score += rule.mode === 'avoid' ? -CONTENT_PREFERENCE_SCORE : CONTENT_PREFERENCE_SCORE;
  }
  return score;
}

// 候選池中每個「使用者實際啟用」的內容偏好旗標，其關鍵字命中率。獨立於任何
// 一個排課方案——5 個 PLAN_VARIANTS 共用同一批候選池，這個訊號對所有方案
// 完全相同，因此只算一次（見 prepareCandidates()），不必等特定方案選出來。
function computeContentPreferenceSignal(courses, constraints) {
  if (courses.length === 0) return [];
  return CONTENT_PREFERENCE_RULES
    .filter(rule => constraints[rule.flag])
    .map(rule => {
      const hits = courses.filter(course => matchesContentPreference(course, rule)).length;
      return { flag: rule.flag, label: rule.label, hits, total: courses.length, ratio: hits / courses.length };
    });
}

// 命中率過低或過高都代表關鍵字比對其實無法有效區分課程（過低=幾乎排不到
// 任何課、過高=幾乎每門課都符合），應該讓使用者知道這個偏好的訊號很弱，
// 結果可能不準——不是靜默失敗，也不是靜默假裝已滿足。
function buildContentPreferenceWarnings(signals) {
  return signals
    .filter(s => s.ratio < CONTENT_PREFERENCE_LOW_SIGNAL_RATIO || s.ratio > CONTENT_PREFERENCE_HIGH_SIGNAL_RATIO)
    .map(s => {
      const pct = Math.round(s.ratio * 1000) / 10;
      return s.ratio < CONTENT_PREFERENCE_LOW_SIGNAL_RATIO
        ? `偏好「${s.label}」目前以課程描述關鍵字判定，候選課程中僅 ${s.hits}/${s.total} 門`
          + `（${pct}%）符合這個判定，訊號極弱，這項偏好對排序幾乎不起作用，結果可能不如預期。`
        : `偏好「${s.label}」目前以課程描述關鍵字判定，候選課程中有 ${s.hits}/${s.total} 門`
          + `（${pct}%）符合這個判定，幾乎每門課都符合，這項偏好實際上無法有效區分課程，效果接近沒有設定。`;
    });
}

// `reason` 字串 -> `constraintSchema.js` 的 constraintId 對照。`hardConstraintReason()`
// 的回傳值維持字串（既有呼叫端與 S7 等測試都靠字串比對），這張表只給需要
// 結構化資訊的呼叫端（`addCourseToPlan()` 的 conflictSet 標籤、
// `scheduleValidator.js` 的時段檢查）反查用，避免同一組對照散落多處。
const HARD_REASON_TO_CONSTRAINT_ID = {
  '不符合不上早八限制': 'NO_MORNING_CLASSES',
  '不符合不上晚課限制': 'NO_EVENING_CLASSES',
  '位於封鎖時段': 'BLOCKED_PERIODS',
  '不符合午休保留偏好': 'LUNCH_BREAK_FREE',
};

function constraintIdForHardReason(reason) {
  return HARD_REASON_TO_CONSTRAINT_ID[reason] ?? null;
}

// roadmap #21：`options.skipTimePreferences` 讓呼叫端（`addCourseToPlan()`）
// 對正式必修課無條件豁免 3 個時段類「舒適偏好」——`不排早八`／`不排晚課`／
// `午休保留`是使用者比較希望的事，不是外部事實；必修課本學期一定要修，
// 不該因為這種偏好被排除。`blockedPeriods`（真實的外部不可用時段，例如
// 學生有工作）**不受此參數影響，永遠檢查**，即使是必修課也一樣——這正是
// roadmap #21 驗收標準舉的例子：「盡量不排早八」可放寬、「週一絕對不能
// 上課」不可放寬。豁免只在呼叫端明確帶入時生效，預設（不帶 options 或
// `skipTimePreferences` 為 false）行為與改動前逐位元組相同。
function hardConstraintReason(course, constraints, options = {}) {
  if (isWatching(course, constraints)) return null;

  // 時間類限制必須檢查課程的每一個時段，否則多時段課程只會被檢查第一段。
  // 這 4 項是對課程時段的結構化事實判定，不是對自由文字做關鍵字猜測，
  // 沒有「命中率」這種失效模式，資料本身可信，維持硬性（roadmap #3 範圍
  // 只涵蓋內容偏好關鍵字判定，不含這 4 項）。
  const blocks = getTimeBlocks(course);
  const skipTimePreferences = options.skipTimePreferences === true;

  if (!skipTimePreferences
    && constraints.noMorningClasses && blocks.some(block => block.startPeriod <= 1)) {
    return '不符合不上早八限制';
  }

  if (!skipTimePreferences
    && constraints.noEveningClasses && blocks.some(block => block.startPeriod >= 12)) {
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

  if (!skipTimePreferences
    && constraints.lunchBreakFree
    && blocks.some(block => block.startPeriod <= 5 && block.endPeriod >= 5)) {
    return '不符合午休保留偏好';
  }

  return null;
}

// 課程違反了哪些「時段類舒適偏好」（不含 blockedPeriods——那是絕對限制，
// 不受必修豁免規則影響）。只用來組出必修豁免發生時的揭露警告文字，刻意與
// `hardConstraintReason()` 的排除判斷分開：一個回答「該不該擋」，一個回答
// 「擋的話警告要講什麼」，避免兩件事混在同一個函式裡。
function getViolatedTimePreferences(course, constraints) {
  const blocks = getTimeBlocks(course);
  const violated = [];

  if (constraints.noMorningClasses && blocks.some(block => block.startPeriod <= 1)) {
    violated.push(CONSTRAINTS.NO_MORNING_CLASSES.label);
  }
  if (constraints.lunchBreakFree
    && blocks.some(block => block.startPeriod <= 5 && block.endPeriod >= 5)) {
    violated.push(CONSTRAINTS.LUNCH_BREAK_FREE.label);
  }
  if (constraints.noEveningClasses && blocks.some(block => block.startPeriod >= 12)) {
    violated.push(CONSTRAINTS.NO_EVENING_CLASSES.label);
  }

  return violated;
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
// `CE07133-28010`、`CE07134-28010`，四筆各自不同。真正的課號在 `catalogCourseCode`，
// 四筆都是 `IECS3002`。
//
// 一門課可能由不同老師開在不同班次，但學生只能選其中一個班次。先前排課引擎
// 把每個 section 當成獨立課程，實測課表因此出現兩門計算機演算法（許芳榮、黃秀芬）。
//
// 實習與正課是不同課號（`MATH1005P` 對 `MATH1005`），不會被誤判為同一門課
// ——它們本來就該一起修（見路線圖 #15）。
function getCourseKey(course) {
  const code = String(course.catalogCourseCode || '').trim();
  if (code) return `code:${code}`;

  const name = String(course.name || '').trim();
  if (name) return `name:${name}`;

  return `id:${course.id}`;
}

// roadmap #15：正課與實習的配對規則純粹以 `subid3`／`catalogCourseCode` 的
// `P` 後綴（大小寫敏感，已用真實 MySQL 資料確認全庫無小寫 p）為準，
// **不看課名、學分或系所**——`LAND2012P`（實際 1.0 學分，一般實習慣例是 0）
// 與 `MKT2020P`↔`MKT2020`（dept 完全不重疊，合班命名差異）都是真實例外，
// 任何加上學分或 dept 條件的判斷式都會誤判其中一種。
//
// 回傳去掉 `P` 後的課號字串；不是 `P` 後綴或空字串一律回傳 null——呼叫端
// 還要另外查詢這個去尾碼的課號是否真的存在於候選池，本函式只做字串推導，
// 不做存在性判斷（存在性判斷需要看整個候選池，不屬於單一課程的純函式）。
function deriveBaseCourseCode(catalogCourseCode) {
  const code = String(catalogCourseCode || '').trim();
  if (!code || !code.endsWith('P')) return null;
  return code.slice(0, -1);
}

// 把配對結果寫回課程物件本身，而不是回傳另一份對照表——這樣
// `buildPlan()`／`scheduleValidator.js` 讀到的每個課程物件天生帶著這個
// 資訊，且 `addCourseToPlan()` 的 `{ ...course, ... }` 展開語法會讓這些
// 欄位自動流進 `plan.schedule`／`unscheduledCourses`，validator 因此不需要
// 任何額外接線就能看到它們。
//
// `allCandidateCodes` 必須是候選池的**原始輸入**（未經 term／eligibility
// 過濾），否則某門課的搭檔若因非本學期或資格未知被排除，會誤判成
// 「找不到搭檔」，即使它其實只是被別的規則擋掉，不是真的不存在。
function annotateCorequisite(course, allCandidateCodes) {
  const code = String(course.catalogCourseCode || '').trim();
  if (!code) {
    course.corequisiteCode = null;
    course.corequisiteRole = null;
    return;
  }

  const baseCode = deriveBaseCourseCode(code);
  if (baseCode) {
    // 這門課本身是 P 後綴——`BUS1121P`／`HY2073P` 這類「P 後綴但候選池
    // 中沒有對應正課」的例外，落在 corequisiteRole:null，視為一般課程，
    // 不受任何共同必修規則影響。
    if (allCandidateCodes.has(baseCode)) {
      course.corequisiteCode = baseCode;
      course.corequisiteRole = 'internship';
    } else {
      course.corequisiteCode = null;
      course.corequisiteRole = null;
    }
    return;
  }

  // 這門課不是 P 後綴，檢查是否有人拿它當正課。
  const pCode = `${code}P`;
  if (allCandidateCodes.has(pCode)) {
    course.corequisiteCode = pCode;
    course.corequisiteRole = 'regular';
  } else {
    course.corequisiteCode = null;
    course.corequisiteRole = null;
  }
}

// 涼度分數 0-100，來自課程評價（見 `courseReviewStats.deriveReviewEvidence`）。
//
// **回傳 null 代表「沒有評價可判斷」，不是「不涼」。** 呼叫端自己決定要用
// 中性值（排序時每門課都得有名次）還是排除（聚合統計不必也不該猜）。
//
// 先前這裡靠課程描述的「涼／容易／輕鬆／高分／甜」關鍵字計分。實測 3560 筆
// 只有 26 筆命中（0.7%），且「教室很涼」這類敘述會被判成涼課——關鍵字法在
// 真實資料上既幾乎不動作，動作時還是錯的。
function getEasyCourseScore(course) {
  return course.reviewEvidence?.easyScore ?? null;
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

// 方案層的涼度：**只在有評價證據的課上平均**，回傳 null 代表整個方案沒有
// 任何一門課帶評價。
//
// 這裡刻意與 `scoreCourse()`／`getEasyCourseScore()` 的「無證據給中性分」不
// 同調——兩者回答的是不同問題：排序需要對每門候選課給名次，所以無證據時
// 要有分數；這裡是**對使用者的宣稱**（「這個方案涼度 68%」），用非證據支撐
// 宣稱是不誠實的，因此只採有證據的課，覆蓋率另外由 `plan.reviewCoverage` 回報。
// 與 `weightedAverageScore()` 丟棄缺值而不當成 0 是同一個原則。
function getEasiness(plan) {
  const scores = plan.schedule
    .map(course => getEasyCourseScore(course))
    .filter(score => score !== null);

  if (scores.length === 0) return null;

  const average = scores.reduce((sum, score) => sum + score, 0) / scores.length;
  return clamp01(average / MAX_EASY_COURSE_SCORE);
}

function evaluatePreference(plan, constraints, profile) {
  const breakdown = {
    interest: getInterestCoverage(plan, constraints),
    compact: getCompactness(plan),
    // number|null；null = 排入的課全部沒有評價證據，見 getEasiness() 的說明。
    easy: getEasiness(plan),
  };

  // 無證據的軸連同它的權重一起排除，不是以 0 分參與加權。以 0 參與會讓
  // 「查不到涼度」直接扣掉使用者的偏好符合度，連帶稀釋其他有證據的軸——
  // 那是用資料缺口懲罰使用者，不是誠實回報「這個維度無法評分」。
  const axes = [
    { value: breakdown.interest, weight: profile.interest },
    { value: breakdown.compact, weight: profile.compact },
    { value: breakdown.easy, weight: profile.easy },
  ].filter(axis => axis.weight > 0 && axis.value !== null);

  const weightSum = axes.reduce((sum, axis) => sum + axis.weight, 0);
  const score = weightSum === 0
    ? 0
    : axes.reduce((sum, axis) => sum + axis.value * axis.weight, 0) / weightSum;

  return { score, breakdown };
}

function scoreCourse(course, schedule, constraints, variant, requiredIds, scope, neutralEasyScore = EASY_SCORE_MAX / 2) {
  let score = 1000;
  const id = Number(course.id);

  if (requiredIds.has(id)) score += 10000;
  score -= getEffectiveCategoryPriority(course, scope) * 120;
  score += (course.credits || 0) * 12;
  // 內容偏好（roadmap #3）不分 variant 一律套用，比照 category/credits 的
  // 基礎分寫法——這 8 個旗標原本就是候選篩選層級，不是特定 variant 的行為。
  score += getContentPreferenceScore(course, constraints);

  if (variant.id === 'compact' || constraints.preferCompact) {
    const usedDays = new Set(schedule.flatMap(c => [...getUsedDays(c)]));
    const courseDays = [...getUsedDays(course)];
    const overlapping = courseDays.filter(day => usedDays.has(day)).length;
    score += overlapping > 0 ? 120 * overlapping : -20 * Math.max(1, courseDays.length);
  }

  if (variant.id === 'easy_score') {
    // 沒有評價的課給母體先驗換算的中性分，不給 0。給 0 會讓 95% 沒有評價的課
    // 全部沉底，等於用「查不到」冒充「很硬」。完全沒有評價資料時
    // `neutralEasyScore` 對每門課相同，是常數偏移，排序與改動前逐項一致。
    score += getEasyCourseScore(course) ?? neutralEasyScore;
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
    plan.excludedCourses.push({ course, reason: message, constraintId: 'DUPLICATE_SECTION' });
    if (options.required) {
      plan.failures.push(`必要課程「${course.name}」${message}`);
    }
    return false;
  }

  // roadmap #21：正式必修（`isRequiredForStudent()===true`，見 buildPlan()
  // 的 currentRequiredCourses 排入迴圈）無條件豁免 3 個時段類舒適偏好。
  // `options.formallyRequired` 與 `options.required` 是兩個獨立欄位——
  // 後者仍然只綁定 `requiredIds`（使用者手動指定的必排課）與 plan.failures
  // 回報，語意完全不變，因此 mustTakeCourseIds 類的課（例如 S10）不受影響。
  const skipTimePreferences = options.formallyRequired === true;
  const hardReason = hardConstraintReason(course, constraints, { skipTimePreferences });
  if (hardReason) {
    plan.excludedCourses.push({
      course, reason: hardReason, constraintId: constraintIdForHardReason(hardReason),
    });
    if (options.required) {
      plan.failures.push(`必要課程「${course.name}」${hardReason}`);
    }
    return false;
  }

  // 豁免只在課程真的被排入時才揭露——若稍後因衝堂或學分上限等其他原因
  // 排不進去，揭露豁免反而誤導使用者以為問題出在時段偏好。
  const violatedTimePreferences = skipTimePreferences
    ? getViolatedTimePreferences(course, constraints)
    : [];

  const conflict = conflictsWithSchedule(course, plan.schedule);
  if (conflict) {
    const message = `與「${conflict.name}」衝堂`;
    plan.excludedCourses.push({ course, reason: message, constraintId: 'TIME_CONFLICT' });
    if (options.required) {
      plan.failures.push(`必要課程「${course.name}」${message}`);
    }
    return false;
  }

  if (plan.totalCredits + course.credits > plan.maxCredits) {
    const message = `超過學分上限 ${plan.maxCredits}`;
    plan.excludedCourses.push({ course, reason: message, constraintId: 'CREDIT_CEILING' });
    if (options.required) {
      plan.failures.push(`必要課程「${course.name}」${message}`);
    }
    return false;
  }

  // 單日課程數需計入課程佔用的每一天，多時段課程可能橫跨多天。
  for (const day of getUsedDays(course)) {
    const dayCount = plan.schedule.filter(c => getUsedDays(c).has(day)).length;
    if (dayCount >= plan.maxCoursesPerDay) {
      const message = `超過每日 ${plan.maxCoursesPerDay} 門課限制`;
      plan.excludedCourses.push({ course, reason: message, constraintId: 'DAILY_COURSE_CAP' });
      // 修復既有缺口：先前這個分支即使 options.required 為真也不會推入
      // plan.failures，跟其他每個排除分支不一致，導致被每日上限擋掉的
      // 必排課會靜默消失而不回報失敗原因（見 X10 測試）。
      if (options.required) {
        plan.failures.push(`必要課程「${course.name}」${message}`);
      }
      return false;
    }
  }

  plan.placedCourseKeys.set(courseKey, course);

  if (violatedTimePreferences.length > 0) {
    for (const label of violatedTimePreferences) {
      plan.warnings.push(
        `必修課「${course.name}」不符合「${label}」偏好，但必修優先，已排入課表。`
      );
    }
  }

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
    // roadmap #21：這門課是否透過必修對時段偏好的無條件豁免排入。標在課程
    // 物件上（而非只留在函式區域變數），讓 `scheduleValidator.js` 的自我
    // 檢查（以及外部呼叫端）能就事論事判斷這門課的時段偏好違規是不是刻意
    // 允許的結果，而不必重新計算一次 scope／isRequiredForStudent()。
    formallyRequired: skipTimePreferences,
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

// roadmap #15：正課與實習必須整組成功才算數，任一失敗則兩者皆不排入。
// 刻意不改 addCourseToPlan()——它已經很密集且被 roadmap #21 期間新增的
// 大量 regression 測試釘住；改用快照/回滾包一層，讓 addCourseToPlan()
// 本身邏輯完全不變，只是被連續呼叫兩次，第二次失敗時把第一次的效果撤銷。
//
// 安全性：plan.schedule／unscheduledCourses／excludedCourses／failures／
// warnings 皆為 push-only 陣列（addCourseToPlan() 從不 splice 或重排），
// 因此只記錄長度、失敗時把陣列截回原長度即可精確復原，不論成功的那次
// 呼叫把課推進 schedule 還是 unscheduledCourses。placedCourseKeys 是唯一
// 非陣列的可變狀態，用淺拷貝 Map 記錄快照。
//
// `options` 是同一個物件傳給兩次 addCourseToPlan() 呼叫，讓 `formallyRequired`
// 自動從正課傳給實習——正課因必修豁免時段偏好時，實習不會被同一個時段
// 偏好單獨擋下，否則就違反「兩者要嘛都排、要嘛都不排」。
//
// Codex adversarial review 修正（2026-08-20）：這個函式本身**刻意不再
// 寫入 excludedCourses／failures**——只做「試一次、失敗就靜默回滾」。
// 原因：呼叫端（`placeCourseWithCorequisite()`）可能對同一門正課逐一嘗試
// 多個實習班次，若每次失敗都在這裡留下訊息，前面失敗的嘗試會在後面某個
// 班次成功排入後仍然殘留在 plan 裡，讓最終驗證器誤判整組不完整（即使
// plan.schedule 裡其實已經同時有正課與某個成功排入的實習班次）。訊息只
// 應該在「所有候選班次都試過且全部失敗」時才由呼叫端統一寫入一次。
function attemptCorequisitePair(plan, regularCourse, internshipCourse, constraints, reason, options = {}) {
  const snapshot = {
    scheduleLength: plan.schedule.length,
    unscheduledLength: plan.unscheduledCourses.length,
    excludedLength: plan.excludedCourses.length,
    failuresLength: plan.failures.length,
    warningsLength: plan.warnings.length,
    totalCredits: plan.totalCredits,
    graduationCredits: plan.graduationCredits,
    nonGraduationCredits: plan.nonGraduationCredits,
    placedCourseKeys: new Map(plan.placedCourseKeys),
  };

  const regularPlaced = addCourseToPlan(plan, regularCourse, constraints, reason, options);
  const internshipPlaced = regularPlaced
    && addCourseToPlan(plan, internshipCourse, constraints, reason, options);

  if (regularPlaced && internshipPlaced) return true;

  plan.schedule.length = snapshot.scheduleLength;
  plan.unscheduledCourses.length = snapshot.unscheduledLength;
  plan.excludedCourses.length = snapshot.excludedLength;
  plan.failures.length = snapshot.failuresLength;
  plan.warnings.length = snapshot.warningsLength;
  plan.totalCredits = snapshot.totalCredits;
  plan.graduationCredits = snapshot.graduationCredits;
  plan.nonGraduationCredits = snapshot.nonGraduationCredits;
  plan.placedCourseKeys = snapshot.placedCourseKeys;
  return false;
}

// roadmap #15 + Codex adversarial review 修正（2026-08-20）：把「正課帶
// 對應實習、逐一嘗試候選班次、整組原子排入」的邏輯抽成單一共用函式，讓
// 本學期必修排入迴圈、貪婪填充、不及格必修重補修三個呼叫端共用同一套
// 規則——原本重補修路徑完全沒有接上這套邏輯（Codex 抓到的第二個 bug：
// 重修正課排入了、對應實習卻被貪婪填充的「實習不得單獨排入」規則擋下，
// 排出「有正課沒實習」的不合法課表，被驗證器攔下來變成整批失敗）。
//
// 對候選實習班次逐一呼叫 attemptCorequisitePair()（失敗即靜默回滾，見
// 上方註解），只有全部班次都試過且全部失敗，才在這裡統一寫入一次
// excludedCourses／failures，修正 Codex 抓到的第一個 bug：多班次重試時
// 不會再被中途失敗的嘗試污染最終判定。
function placeCourseWithCorequisite(plan, regularCourse, internshipCandidates, constraints, reason, options = {}) {
  if (internshipCandidates.length === 0) {
    const message = `此課程需與實習（課號 ${regularCourse.corequisiteCode}）一併排入，`
      + '但候選課程中找不到對應實習班次，兩者皆不排入';
    plan.excludedCourses.push({ course: regularCourse, reason: message, constraintId: 'COREQUISITE_PAIR_INCOMPLETE' });
    if (options.required) {
      plan.failures.push(`必要課程「${regularCourse.name}」${message}`);
    }
    return false;
  }

  for (const internship of internshipCandidates) {
    if (attemptCorequisitePair(plan, regularCourse, internship, constraints, reason, options)) {
      return true;
    }
  }

  const message = `此課程需與實習（課號 ${regularCourse.corequisiteCode}）一併排入，`
    + '但所有候選實習班次皆無法一併排入，兩者皆不排入';
  plan.excludedCourses.push(
    { course: regularCourse, reason: message, constraintId: 'COREQUISITE_PAIR_INCOMPLETE' },
    ...internshipCandidates.map(internship => ({
      course: internship, pairedCourse: regularCourse,
      reason: message, constraintId: 'COREQUISITE_PAIR_INCOMPLETE',
    })),
  );
  if (options.required) {
    plan.failures.push(`必要課程「${regularCourse.name}」${message}`);
  }
  return false;
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

function addScopeWarnings(plan, otherRequired, scope) {
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
  ]);
}

// 候選課程前處理。五個方案共用同一批候選，因此類別解析與系外選修認列判定
// 只做一次——放進 buildPlan 會對 3560 筆課程重複解析五遍。
//
// 產出：
//   courses     解析過類別（核心選修／系外選修）與修課路徑的候選課程
//   exclusions  依系外選修認列條件排除的課程與原因
//   warnings    需提醒但不排除的事項
function prepareCandidates(candidateCourses, scope, explicitIds = new Set(), reviewContext = {}, constraints = {}) {
  const reviewIndex = reviewContext.index ?? new Map();
  const reviewPrior = reviewContext.prior ?? { easiness: null, courseCount: 0, reviewCount: 0 };
  const neutralEasyScore = getNeutralEasyScore(reviewPrior);

  const courses = [];
  const exclusions = [];
  const warnings = [];
  const officeConfirmationNames = new Set();
  const difficultyNames = new Set();
  const unrecognizedExplicit = [];
  const unknownEligibilityNames = new Set();
  const unknownEligibilityExplicit = [];
  const offTermNames = new Set();
  const offTermExplicit = [];
  let outsideExclusionCount = 0;
  // 有評價卻因資格待確認（#13C）而被排除的課程要單獨統計。使用者看到
  // 「涼課方案沒有通識」時，必須分得出來是「沒抓到評價」還是「抓到了但規則擋住」。
  let unknownEligibilityWithReviews = 0;
  let unknownEligibilityReviewCount = 0;
  // roadmap #15：P 後綴但候選池中找不到對應正課的課程（例如 BUS1121P／
  // HY2073P），彙總成一則警告，不逐課發。
  const orphanedInternshipNames = new Set();

  // roadmap #15：配對存在性必須看候選池的**原始輸入**，不能看下面迴圈過濾後
  // 的 `courses` 輸出——否則某門課的實習若因非本學期／資格未知被 term/
  // eligibility gate `continue` 掉，這門課本身永遠不會進入 `courses`，用
  // `courses` 當索引會誤判成「找不到搭檔」，即使它其實只是被別的規則排除。
  const allCandidateCodes = new Set(
    candidateCourses
      .map(course => String(course.catalogCourseCode || '').trim())
      .filter(Boolean)
  );

  for (const raw of candidateCourses) {
    const course = annotateCourseCategory(raw, scope);
    // 評價證據在候選前處理階段附上，五個 variant 共用同一份結果。刻意放在
    // term gate 與 eligibility gate **之前**——被排除的課也要帶著它，
    // 才能統計「有評價但因資格待確認而未納入」的門數。
    course.reviewEvidence = deriveReviewEvidence(reviewIndex, reviewPrior, course);

    // roadmap #15：共同必修配對同樣要在任何排除 continue 之前標記，
    // 理由與上面 reviewEvidence 相同——被排除的那一半也要帶著這個資訊，
    // 另一半才查得到「我曾經有配對，只是被別的規則擋住」。
    annotateCorequisite(course, allCandidateCodes);
    if (deriveBaseCourseCode(course.catalogCourseCode) && course.corequisiteRole === null) {
      orphanedInternshipNames.add(`${course.name}（${course.catalogCourseCode}）`);
    }

    // Roadmap #20：term 是比 eligibility 更外層的閘門——這門課這學期根本沒開，
    // 不管系所年級班別是否符合都不該被排入。這一段只處理繞過
    // `courseQuery.js`（已在那邊統一過濾掉非本學期候選）、直接查
    // `getAll('courses')` 的兩條路徑：`scheduleService.js` 的明確 courseIds
    // 與 #19 重補修 union，因此沿用與 eligibility=unknown 相同的
    // 「系統自撿排除＋原因、使用者明確指定保留＋警告」模式。
    if (!course.term.isActiveTerm) {
      const label = `${course.name}（${course.department}）`;

      if (!explicitIds.has(Number(course.id))) {
        offTermNames.add(label);
        exclusions.push({ course, reason: course.scopeReason, constraintId: 'OFF_TERM' });
        continue;
      }

      offTermExplicit.push(course);
    }

    if (course.eligibility === 'unknown') {
      const label = `${course.name}（${course.department}）`;

      // unknown 不是確定不可修，但也不能讓自動排課把它當成確定可修。
      // 使用者明確指定時保留並警告；否則保守排除。
      if (!explicitIds.has(Number(course.id))) {
        unknownEligibilityNames.add(label);
        exclusions.push({ course, reason: course.eligibilityReason, constraintId: 'ELIGIBILITY_UNKNOWN' });
        if (course.reviewEvidence) {
          unknownEligibilityWithReviews += 1;
          unknownEligibilityReviewCount += course.reviewEvidence.reviewCount;
        }
        continue;
      }

      unknownEligibilityExplicit.push(course);
    }

    const outside = evaluateOutsideElective(course, scope);
    const refinedScopeReason = refineOutsideElectiveScopeReason(outside);
    if (refinedScopeReason) course.scopeReason = refinedScopeReason;

    if (!outside.checked) {
      courses.push(course);
      continue;
    }

    if (!outside.eligible) {
      // 系統自己撿的候選：不推薦不能認列的課，整個剔除。
      if (!explicitIds.has(Number(course.id))) {
        exclusions.push({ course, reason: outside.reasons[0], constraintId: 'OUTSIDE_ELECTIVE_INELIGIBLE' });
        outsideExclusionCount += 1;
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

  if (outsideExclusionCount > 0) {
    warnings.push(
      `已排除 ${outsideExclusionCount} 門不符合系外選修認列條件的課程`
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

  if (unknownEligibilityNames.size > 0) {
    warnings.push(
      `已保守排除 ${unknownEligibilityNames.size} 門資格待確認的 B～F 類課程`
      + `（${summarizeNames([...unknownEligibilityNames])}）。`
      + '系統尚無正式適用對象規則，不會自動把它們排入課表。'
    );
  }

  if (unknownEligibilityExplicit.length > 0) {
    const detail = unknownEligibilityExplicit
      .slice(0, UNSCHEDULED_NAMES_IN_WARNING)
      .map(course => `${course.name}（${course.eligibilityReason}）`)
      .join('；');
    const rest = unknownEligibilityExplicit.length > UNSCHEDULED_NAMES_IN_WARNING
      ? ` 等 ${unknownEligibilityExplicit.length} 門`
      : '';
    warnings.push(
      `你指定的課程中有 ${unknownEligibilityExplicit.length} 門資格待確認：${detail}${rest}。`
      + '本方案保留這些課程，但請先向開課單位確認能否修習。'
    );
  }

  if (unknownEligibilityWithReviews > 0) {
    warnings.push(
      `已保守排除的資格待確認課程中有 ${unknownEligibilityWithReviews} 門有課程評價`
      + `（共 ${unknownEligibilityReviewCount} 則），因適用對象規則尚未確認`
      + '（roadmap #13C）而未納入涼度評分。'
    );
  }

  if (offTermNames.size > 0) {
    warnings.push(
      `已排除 ${offTermNames.size} 門非本學期（${ACTIVE_TERM.academicYear}學年${ACTIVE_TERM.semester}）`
      + `開課的候選課程（${summarizeNames([...offTermNames])}）。`
    );
  }

  if (offTermExplicit.length > 0) {
    const detail = offTermExplicit
      .slice(0, UNSCHEDULED_NAMES_IN_WARNING)
      .map(course => `${course.name}（${course.scopeReason}）`)
      .join('；');
    const rest = offTermExplicit.length > UNSCHEDULED_NAMES_IN_WARNING
      ? ` 等 ${offTermExplicit.length} 門`
      : '';
    warnings.push(
      `你指定的課程中有 ${offTermExplicit.length} 門非本學期開課：${detail}${rest}。`
      + '本方案仍保留這些課程，請自行確認是否可加選。'
    );
  }

  // 內容偏好的關鍵字命中率是候選池本身的性質，5 個 PLAN_VARIANTS 共用同一批
  // 候選池、這個訊號對所有方案完全相同，因此在候選層算一次即可（不必等某個
  // 方案選出來才算，也不必逐一方案重算五次）。
  warnings.push(...buildContentPreferenceWarnings(computeContentPreferenceSignal(courses, constraints)));

  if (orphanedInternshipNames.size > 0) {
    warnings.push(
      `${orphanedInternshipNames.size} 門課程符合實習／實驗代碼慣例（課號以 P 結尾）`
      + `但找不到對應正課（${summarizeNames([...orphanedInternshipNames])}），`
      + '本規則對這些課程不生效，視為一般課程處理。'
    );
  }

  return { courses, exclusions, warnings, scope, explicitIds, neutralEasyScore };
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
  const failedRequired = getFailedRequiredCourses(constraints.courseHistory);
  const failedRequiredCodes = new Set(failedRequired.map(entry => entry.courseCode));
  const completedCodes = new Set(getPassedCourseCodes(constraints.courseHistory));
  const requiredIds = new Set([...selectedIds, ...mustTakeIds]);

  // #13：`Courses.type = '必修'` 是「某系所某年級的必修」，不是「這位學生的必修」。
  // 未依系所與年級收斂時，全校 2094 筆必修都會被當成這位學生的必修。
  const { scope, neutralEasyScore } = prepared;

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
    course => (
      !prepared.explicitIds.has(Number(course.id))
      && !failedRequiredCodes.has(course.catalogCourseCode)
    )
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

  // 已修排除必須用跨學期穩定的課號，不能用每學期、每班次都會改變的 section id。
  // 兩側是相同值域，因此刻意不做 trim、大小寫轉換或課名 fallback；沒有 catalogCourseCode
  // 的課程會自然得到 Set.has(undefined) === false，不會被誤判為已修。
  for (const course of candidateCourses) {
    if (completedCodes.has(course.catalogCourseCode)) {
      plan.excludedCourses.push({
        course,
        reason: `已修過並通過（課號 ${course.catalogCourseCode}）`,
        constraintId: 'ALREADY_TAKEN_PASSED',
      });
    }
  }

  const eligible = candidateCourses.filter(course => (
    !completedCodes.has(course.catalogCourseCode)
    && !isWatching(course, constraints)
    && !otherRequiredIds.has(Number(course.id))
  ));
  const currentRequiredCourses = eligible
    .filter(course => requiredIds.has(Number(course.id)) || isRequiredForStudent(course, scope))
    .sort((a, b) => {
      const aRequired = requiredIds.has(Number(a.id)) ? 0 : 1;
      const bRequired = requiredIds.has(Number(b.id)) ? 0 : 1;
      if (aRequired !== bRequired) return aRequired - bRequired;
      return getCategoryPriority(a) - getCategoryPriority(b);
    });

  const currentRequiredIds = new Set(currentRequiredCourses.map(course => Number(course.id)));
  const currentRequiredCodes = new Set(
    currentRequiredCourses.map(course => course.catalogCourseCode).filter(Boolean)
  );
  const retakeCourses = eligible
    .filter(course => (
      failedRequiredCodes.has(course.catalogCourseCode)
      && !currentRequiredCodes.has(course.catalogCourseCode)
      && !currentRequiredIds.has(Number(course.id))
    ))
    .sort((a, b) => getCategoryPriority(a) - getCategoryPriority(b));

  const offeredRetakeCodes = new Set(
    eligible
      .filter(course => failedRequiredCodes.has(course.catalogCourseCode))
      .map(course => course.catalogCourseCode)
  );
  for (const entry of failedRequired) {
    if (!offeredRetakeCodes.has(entry.courseCode)) {
      plan.warnings.push(
        `${entry.courseCode} ${entry.courseName || '未命名課程'}本學期沒有開課，請下學期記得重修。`
      );
    }
  }

  const requiredCourseIdsInData = new Set(currentRequiredCourses.map(course => Number(course.id)));
  for (const requiredId of requiredIds) {
    if (!requiredCourseIdsInData.has(requiredId)) {
      plan.warnings.push(`指定課程 ID:${requiredId} 不在候選課程資料中`);
    }
  }

  for (const course of currentRequiredCourses) {
    // roadmap #15：實習不得單獨排入，由對應正課的分支帶動——這裡直接跳過，
    // 不會漏排：只要它的正課也在 currentRequiredCourses 裡，下面的
    // 'regular' 分支會把兩者一併處理。若正課不在必修清單裡（使用者只把
    // 實習的 id 放進 mustTakeCourseIds），本規則刻意不反向把正課升級為
    // 必排——見 docs/SCHEDULING_LOGIC.md 的「共同必修」單向設計說明。
    if (course.corequisiteRole === 'internship') continue;

    // roadmap #21：`formallyRequired` 與 `required` 是兩個獨立欄位——
    // `required` 只在課程屬於 requiredIds（使用者手動指定的必排課）時為真，
    // 語意與改動前完全相同；`formallyRequired` 只給時段偏好豁免機制讀取
    // （見 addCourseToPlan()），不影響 plan.failures 的既有回報方式。
    const required = requiredIds.has(Number(course.id));
    const formallyRequired = isRequiredForStudent(course, scope);
    const reasonLabel = formallyRequired ? '本學期必修優先' : '指定課程優先';

    if (course.corequisiteRole !== 'regular') {
      addCourseToPlan(plan, course, constraints, reasonLabel, { required, formallyRequired });
      continue;
    }

    // roadmap #15：正課帶著共同必修的實習——從 eligible 找同課號的實習
    // 候選（可能有多個班次），透過 placeCourseWithCorequisite() 逐一嘗試、
    // 整組原子排入；候選池裡完全沒有這門實習、或全部班次都排不進去時，
    // 由該函式統一寫入一次「找不到對應實習」／「全部班次皆排不進去」的
    // 訊息，不會有中途失敗殘留。
    const internshipCandidates = eligible.filter(
      c => c.catalogCourseCode === course.corequisiteCode
    );

    placeCourseWithCorequisite(
      plan, course, internshipCandidates, constraints, `${reasonLabel}（共同必修）`,
      { required, formallyRequired }
    );
  }

  // 不及格必修只由 courseHistory 自動推導，且固定排在本學期必修之後。
  //
  // Codex adversarial review 修正（2026-08-20）：重修的正課若帶共同必修
  // （corequisiteRole === 'regular'），一併透過 placeCourseWithCorequisite()
  // 嘗試排入對應實習——原本這裡直接呼叫 addCourseToPlan()，只排正課，
  // 實習又因「不得單獨排入」規則被貪婪填充排除，排出「重修正課排入了、
  // 實習卻缺席」的不合法課表，被驗證器攔下來變成整批排課失敗。實習本身
  // 不會單獨進入這個迴圈嘗試排入——一律由它對應的正課那一側帶動。
  for (const failedCourse of failedRequired) {
    if (currentRequiredCodes.has(failedCourse.courseCode)) continue;
    const sections = retakeCourses.filter(
      course => course.catalogCourseCode === failedCourse.courseCode
    );
    if (sections.length === 0) continue;

    const placed = sections.some(course => {
      if (course.corequisiteRole === 'internship') return false;
      if (course.corequisiteRole === 'regular') {
        const internshipCandidates = eligible.filter(
          c => c.catalogCourseCode === course.corequisiteCode
        );
        return placeCourseWithCorequisite(
          plan, course, internshipCandidates, constraints, '不及格必修重補修優先'
        );
      }
      return addCourseToPlan(plan, course, constraints, '不及格必修重補修優先');
    });
    if (!placed) {
      plan.warnings.push(
        `${failedCourse.courseCode} ${failedCourse.courseName}雖於本學期開課，但因衝堂或排課限制未能排入，請優先調整課表。`
      );
    }
  }

  const placedIds = new Set([
    ...plan.schedule.map(c => Number(c.id)),
    ...plan.unscheduledCourses.map(c => Number(c.id)),
  ]);
  const autoRetakeSectionIds = new Set(retakeCourses.map(course => Number(course.id)));
  const optional = eligible.filter(course => (
    !placedIds.has(Number(course.id)) && !autoRetakeSectionIds.has(Number(course.id))
  ));

  // 貪婪填充只考慮有排定時間的課程。無時間課程不佔時段、不衝堂也不受任何限制，
  // 讓它們參與填充會被無限塞入；它們只有在被明確指定為必要課程時才會排入。
  // roadmap #15：實習（corequisiteRole === 'internship'）不得單獨進入候選
  // 競爭——它只能靠對應正課帶動排入，見下方 while 迴圈內的 'regular' 分支。
  const remaining = optional.filter(course => (
    !currentRequiredCourses.some(c => c.id === course.id)
    && hasScheduledTime(course)
    && course.corequisiteRole !== 'internship'
  ));

  while (remaining.length > 0 && plan.totalCredits < plan.maxCredits) {
    remaining.sort((a, b) => (
      scoreCourse(b, plan.schedule, constraints, variant, requiredIds, scope, neutralEasyScore)
      - scoreCourse(a, plan.schedule, constraints, variant, requiredIds, scope, neutralEasyScore)
    ));

    const course = remaining.shift();

    if (course.corequisiteRole === 'regular') {
      // roadmap #15：貪婪填充選中一門帶共同必修的正課時，兩者一併嘗試
      // 排入，不是只排正課。找不到候選實習或整組排不進去時，皆不進入
      // plan.schedule／plan.failures（此處與必修迴圈不同，貪婪填充失敗
      // 從不影響 plan.failures，比照既有的 addCourseToPlan(..., variant.title)
      // 呼叫慣例，不傳 options.required）。
      const internshipCandidates = eligible.filter(
        c => c.catalogCourseCode === course.corequisiteCode
      );
      placeCourseWithCorequisite(plan, course, internshipCandidates, constraints, variant.title);
    } else {
      addCourseToPlan(plan, course, constraints, variant.title);
    }

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

  addScopeWarnings(plan, otherRequired, scope);
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

// 「7 門課涼度 85%」與「7 門裡 1 門有評價、那門 85%」是完全不同的兩件事，
// 只給一個百分比會讓使用者把後者當成前者。
function buildReviewCoverage(plan) {
  const total = plan.schedule.length;
  const rated = plan.schedule.filter(course => Boolean(course.reviewEvidence)).length;
  return { rated, total, ratio: total === 0 ? 0 : rated / total };
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

// roadmap #21：無解時的結構化 conflict set，取代「只回傳第一個錯誤字串」。
// 走訪所有方案的 excludedCourses，依 constraintId + 相關課程 id 去重，
// 附加於既有的 message／warnings 之外，**不取代它們**——舊呼叫端只讀
// message／warnings 仍能得到跟改動前一樣的內容。沒有 constraintId 的排除項
// （少數尚未標記的邊界情況）不強行歸類，直接略過。
function buildConflictSet(plans) {
  const seen = new Set();
  const conflictSet = [];

  for (const plan of plans) {
    for (const item of plan.excludedCourses) {
      const constraintId = item.constraintId;
      if (!constraintId || !item.course) continue;
      const key = `${constraintId}:${item.course.id}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const def = CONSTRAINTS[constraintId];
      // roadmap #15：共同必修排除項帶 pairedCourse 時，一併列出兩門課；
      // 既有排除項從不設定這個欄位，維持原本的單一課程陣列，向下相容。
      const courses = item.pairedCourse
        ? [{ id: item.course.id, name: item.course.name }, { id: item.pairedCourse.id, name: item.pairedCourse.name }]
        : [{ id: item.course.id, name: item.course.name }];
      conflictSet.push({
        constraintId,
        severity: 'hard',
        relaxable: def?.relaxable ?? null,
        source: def?.source ?? null,
        courses,
        reason: item.reason,
      });
    }
  }

  return conflictSet;
}

// roadmap #21：opt-in 放寬階梯。**獨立於**必修對時段偏好的無條件豁免
// （見 hardConstraintReason() 的 skipTimePreferences）——那個豁免永遠生效、
// 不需要任何旗標；這裡處理的是「方案的選修側因為時段偏好排掉太多候選、
// 導致湊不到學分下限或選修排不出來」，只在使用者明確開啟
// `constraints.allowRelaxation` 時才會動作，而且一定會透過 relaxedConstraints
// 與 warnings 揭露，不做靜默改動——比照 ADR-006／009／010「絕不悄悄假設」
// 的一貫原則。
//
// 放寬順序讀取使用者提供的 `constraints.timePreferencePriority`（constraintId
// 陣列），未提供時退回 schema 的 DEFAULT_TIME_PREFERENCE_PRIORITY。只有
// `relaxable:true` 且有對應 `flag` 的條目會真的被放寬——`BLOCKED_PERIODS`
// 沒有 `relaxable:true`，就算被塞進 timePreferencePriority 也只會被忽略，
// 結構上不可能被放寬，不是靠執行期判斷擋掉。
function tryRelaxationLadder(prepared, constraints, variant) {
  const order = Array.isArray(constraints.timePreferencePriority)
    && constraints.timePreferencePriority.length > 0
    ? constraints.timePreferencePriority
    : DEFAULT_TIME_PREFERENCE_PRIORITY;

  let relaxedFlags = constraints;
  const relaxedConstraints = [];

  for (const constraintId of order) {
    const def = CONSTRAINTS[constraintId];
    if (!def || !def.relaxable || !def.flag) continue;

    relaxedFlags = { ...relaxedFlags, [def.flag]: false };
    relaxedConstraints.push({
      constraintId,
      reason: `已放寬「${def.label}」限制以產生可行課表`,
      order: relaxedConstraints.length + 1,
    });

    const plan = buildPlan(prepared, relaxedFlags, variant);
    if (plan.success) {
      return { plan, relaxedFlags, relaxedConstraints };
    }
  }

  return null;
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

  // 接線是否正常的訊號，與是否成功排出課表無關，因此在所有回傳路徑都帶上。
  const reviewDataLoaded = Array.isArray(constraints.courseReviews) && constraints.courseReviews.length > 0;

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
      reviewDataLoaded,
      message: '找不到符合條件的候選課程，請調整搜尋條件或偏好設定。',
    };
  }

  const preferenceProfile = buildPreferenceProfile(constraints);
  const hasExpressedPreference = Object.values(preferenceProfile).some(weight => weight > 0);

  // 評價索引與母體先驗對五個方案完全相同，在此做一次。母體先驗刻意由
  // **傳進來的全部評價**計算，不是候選池——否則同一門課在不同搜尋條件下
  // 會得到不同的收縮後涼度，那就是漂移。
  const reviewIndex = buildReviewIndex(constraints.courseReviews);
  const reviewPrior = buildReviewPrior(reviewIndex);

  // 類別解析（核心選修／系外選修／修課路徑）與系外選修認列條件對所有方案相同，
  // 在此做一次後共用。
  const prepared = prepareCandidates(
    candidateCourses,
    buildStudentScope(constraints),
    collectExplicitCourseIds(constraints),
    { index: reviewIndex, prior: reviewPrior },
    constraints
  );

  const plans = uniquePlans(
    PLAN_VARIANTS
      .map(variant => {
        const plan = buildPlan(prepared, constraints, variant);
        const { score, breakdown } = evaluatePreference(plan, constraints, preferenceProfile);
        plan.preferenceScore = score;
        plan.preferenceBreakdown = breakdown;
        plan.reviewCoverage = buildReviewCoverage(plan);
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
    // roadmap #21：opt-in 放寬階梯，預設不啟用（constraints.allowRelaxation
    // 未設定或為 false 時，以下整段不會執行，行為與改動前完全相同）。
    if (constraints.allowRelaxation) {
      const requiredFirstVariant = PLAN_VARIANTS.find(v => v.id === 'required_first');
      const relaxed = tryRelaxationLadder(prepared, constraints, requiredFirstVariant);

      if (relaxed) {
        const { score, breakdown } = evaluatePreference(
          relaxed.plan, relaxed.relaxedFlags, buildPreferenceProfile(relaxed.relaxedFlags)
        );
        relaxed.plan.preferenceScore = score;
        relaxed.plan.preferenceBreakdown = breakdown;
        relaxed.plan.reviewCoverage = buildReviewCoverage(relaxed.plan);

        const relaxedWarnings = [...new Set([
          ...relaxed.plan.warnings,
          ...relaxed.relaxedConstraints.map(r => r.reason),
        ])];

        return {
          success: true,
          watchOnly: relaxed.plan.watchOnly,
          schedule: relaxed.plan.schedule,
          plans: uniquePlans([relaxed.plan, ...plans]),
          totalCredits: relaxed.plan.totalCredits,
          graduationCredits: relaxed.plan.graduationCredits,
          nonGraduationCredits: relaxed.plan.nonGraduationCredits,
          courseCount: relaxed.plan.courseCount,
          excludedCourses: relaxed.plan.excludedCourses,
          watchedCourses: relaxed.plan.watchedCourses,
          unscheduledCourses: relaxed.plan.unscheduledCourses,
          warnings: relaxedWarnings,
          relaxedConstraints: relaxed.relaxedConstraints,
          preferenceProfile,
          hasExpressedPreference,
          reviewDataLoaded,
          message: `已放寬部分時段偏好以產生可行課表：${relaxed.plan.schedule.length} 門課，`
            + `共 ${relaxed.plan.totalCredits} 學分。`,
        };
      }
    }

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
      // roadmap #21：結構化 conflict set，附加於 message／warnings 之外，
      // 不取代它們——舊呼叫端只讀 message／warnings 仍得到跟改動前一樣的內容。
      conflictSet: buildConflictSet(plans),
      reviewDataLoaded,
      message: warnings[0] || '無法產生符合限制的課表。',
    };
  }

  // roadmap #21：內部自我檢查，落實驗收標準「所有成功方案經 validator 驗證
  // hard constraint violation 為 0」——不是口頭宣稱，是每次成功回應前實際
  // 執行一次獨立於方案產生器的檢查。理論上不該觸發（上游已經排除過），
  // 若真的觸發，寧可誠實回報失敗，也不要悄悄送出一份實際上不合法的課表。
  //
  // 必須連同 unscheduledCourses 一起檢查：尚未排定時間的必要課程（例如
  // 論文、班級活動）依設計會排入 `unscheduledCourses` 而非 `schedule`
  // （見 `addCourseToPlan()` 的說明），只查 `schedule` 會讓
  // REQUIRED_COURSE_COVERAGE 對這類課程誤判為缺漏。
  const selfCheck = validateScheduleAgainstConstraints(
    [...primary.schedule, ...primary.unscheduledCourses], constraints
  );
  if (!selfCheck.valid) {
    return {
      success: false,
      schedule: [],
      plans,
      totalCredits: 0,
      graduationCredits: 0,
      nonGraduationCredits: 0,
      courseCount: 0,
      excludedCourses: primary.excludedCourses,
      watchedCourses: primary.watchedCourses,
      unscheduledCourses: primary.unscheduledCourses,
      warnings: [
        '內部一致性檢查失敗：主推方案未通過完整硬性限制驗證，已中止並回報，而非送出不合法的課表。',
        ...selfCheck.violations.map(v => v.reason),
      ],
      conflictSet: selfCheck.violations,
      reviewDataLoaded,
      message: '內部一致性檢查失敗，請回報此問題。',
    };
  }

  const allWarnings = [...new Set(plans.flatMap(plan => plan.warnings))];
  if (!hasExpressedPreference) {
    allWarnings.push('未設定興趣關鍵字、集中排課或涼課偏好，主推方案改以總學分決定，個人化程度有限。');
  }

  // 評價相關的誠實性警告。第一條不受偏好限制——沒有取得評價資料是接線壞掉的
  // 訊號，必須大聲；專案已被「兩邊恆空、已修排除數月未生效」教訓過
  // （見 `constraintService.js` 的 courseHistory 註解），同樣的靜默失效不能再發生。
  if (!reviewDataLoaded) {
    allWarnings.push(
      '本次排課沒有取得任何課程評價資料，涼度無法評分；所有課程一律以中性涼度計算。'
    );
  } else if (preferenceProfile.easy === 1 && primary.reviewCoverage.rated === 0) {
    allWarnings.push(
      `你設定了涼課偏好，但方案「${primary.title}」排入的 ${primary.reviewCoverage.total} 門課`
      + '全部沒有課程評價，涼度無法評分，主推方案改由其他偏好與總學分決定。'
    );
  } else if (
    preferenceProfile.easy === 1
    && primary.reviewCoverage.total > 0
    && primary.reviewCoverage.ratio < LOW_REVIEW_COVERAGE_RATIO
  ) {
    allWarnings.push(
      `方案「${primary.title}」的涼度僅由 ${primary.reviewCoverage.rated}／`
      + `${primary.reviewCoverage.total} 門有評價的課推得，其餘課程沒有評價、未計入涼度。`
    );
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
    reviewDataLoaded,
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

// roadmap #21：供 `scheduleValidator.js`（與方案產生器分離的獨立 validator）
// 重用，避免重複實作同一套衝堂／重複班次／時段類判定邏輯。
export {
  timeConflict,
  getCourseKey,
  getTimeBlocks,
  hardConstraintReason,
  constraintIdForHardReason,
  collectExplicitCourseIds,
  DEFAULT_MAX_CREDITS,
  OVERLOAD_MAX_CREDITS,
  // roadmap #15：供 scheduleValidator.js 的共同必修完整性複查重用。
  deriveBaseCourseCode,
};

export default { generateSchedule, checkConflict: timeConflict, validateSchedule };
