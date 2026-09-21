// Roadmap #37：在 Agent 的自然語言回覆送出前，以本回合真正看過的 tool result
// 建立證據帳本並檢查高風險事實。Prompt 仍負責引導模型；這個模組是最後一道
// 確定性 guard，避免「提示寫得很嚴格」被誤當成已經驗證過。
//
// Roadmap #41（第二段）：課程指涉解析到 section 實體，而不是只到課名——見
// `courseReferenceResolver.js`；捏造偵測改抽「課名形狀的片段」而不是「這句話
// 在談課程」——見本檔 `extractCourseShapedSpans()`；以及 `evidenceRole`，讓被
// 排課器排除掉的課不能被講成推薦。

import { resolveCourseReferences } from './courseReferenceResolver.js';
import {
  extractTimeClaims, matchAssertedTeacher, extractCreditValues,
  splitTableCells, findTableColumnIndex, extractTableFacts,
} from './sentenceFacts.js';

const COURSE_LIST_KEYS = Object.freeze([
  'schedule', 'draftSchedule', 'unscheduledCourses', 'watchedCourses',
  'excludedCoursesSample', 'courses', 'results',
]);

// 每個 bucket 對應的證據角色（roadmap #41）。`courses`／`results`／直接回傳單一
// 課程物件的工具（如評價查詢）沒有專屬 bucket，一律算 `candidate`——它們只是
// 「查得到這門課」，不代表被排入或被排除。
const COURSE_LIST_ROLES = Object.freeze({
  schedule: 'recommended',
  draftSchedule: 'draft',
  unscheduledCourses: 'unscheduled',
  excludedCoursesSample: 'excluded',
  watchedCourses: 'watched',
  courses: 'candidate',
  results: 'candidate',
});
const DEFAULT_ROLE = 'candidate';
const NON_RECOMMENDING_ROLES = new Set(['excluded', 'unscheduled']);

const SUCCESS_PATTERNS = Object.freeze({
  run_csp_scheduler: /(?:已|成功).{0,10}(?:排好|排出|完成|產生).{0,6}課表|課表.{0,6}(?:已完成|產生成功)/u,
  update_preferences: /(?:已|成功).{0,10}(?:更新|修改|儲存).{0,6}偏好|偏好.{0,6}(?:已更新|更新成功)/u,
  update_student_profile: /(?:已|成功).{0,10}(?:更新|修改|儲存).{0,6}(?:資料|Profile|profile)|(?:資料|Profile|profile).{0,6}(?:已更新|更新成功)/u,
  record_schedule_feedback: /(?:已|成功).{0,10}(?:記錄|收到|儲存).{0,6}(?:回饋|退選)|(?:回饋|退選).{0,6}(?:已記錄|記錄成功)/u,
});

const FAILURE_DISCLOSURE = /失敗|錯誤|無法|未完成|尚未|沒有成功|逾時|timeout/u;
const REVIEW_CLAIM = /(?:很|較|比較|非常)?(?:涼|甜|好拿分|容易過)|評價.{0,8}(?:很好|很高|正面|推薦)|學生.{0,8}(?:認為|表示).{0,8}(?:涼|甜|容易)/u;
const REVIEW_UNKNOWN = /沒有(?:任何)?評價|無評價|評價資料(?:不足|缺少|尚無)|目前(?:無法|不能)判斷|不知道/u;
const ELIGIBILITY_CLAIM = /(?:確定|一定|可以|可)(?:直接)?修|符合(?:修課)?資格/u;
const GRADUATION_CLAIM = /(?:確定|可以|可)?(?:計入|認列).{0,5}畢業學分|符合畢業(?:資格|要求)/u;
const GRADUATION_RULE_CLAIM = /(?:畢業(?:門檻|要求).{0,12}(\d+)\s*學分)|(\d+)\s*學分.{0,12}(?:才能|即可|可以)?畢業/u;
const PREFERENCE_CLAIM = /(?:符合|命中|配合).{0,8}(?:你的|使用者)?偏好|因為.{0,12}偏好.{0,8}(?:推薦|選入)/u;
const SECRET_DISCLOSURE = /(?:OPENAI_API_KEY|SESSION_SECRET|DB_PASSWORD)\s*[:=]\s*[^\s，。；]+|\bsk-[A-Za-z0-9_-]{8,}/u;
const REASON_QUESTION = /為什麼|推薦理由|推薦原因/u;
// roadmap #41 regression：這裡必須認得出 `summarizeReason()` 對**每一種**
// `selectedBecause` 產生的自然語言轉述，不能只挑幾個好認的關鍵字。原本只有
// `必修|重修|補修|你指定|關注課程|…` 這幾個字面詞，`USER_SPECIFIED`
// （「你**明確**指定這門課」）、`COREQUISITE_PAIR`（「成對排入」）、
// `WATCHING`（「關注**清單**」，不是「關注課程」）、`CREDIT_FILL`
// （「補足目標學分」）四種轉述文字都對不上，導致後端自己的安全回答在
// 使用者問「為什麼推薦」時，反而被自己的 `MISSING_RECOMMENDATION_REASON`
// 判定違規——F22 逐一走過全部 `selectedBecause` 值時抓到。
const REASON_PARAPHRASE = /必修|重修|補修|你指定|明確指定|關注課程|關注清單|成對排入|補足.{0,4}學分|沒有命中任何偏好|主要推薦原因.{0,8}(?:未知|未提供|無法確認)/u;

// 「推薦形狀」的斷言——捏造偵測（動賓片語規則）與 EXCLUDED_COURSE_PRESENTED_AS_RECOMMENDED
// 共用同一份，不要各寫一次判斷標準。
const RECOMMENDATION_VERBS = '推薦|加選|選修|修習';
const RECOMMENDATION_SHAPE = new RegExp(RECOMMENDATION_VERBS, 'u');

const REASON_ASSERTIONS = Object.freeze([
  { pattern: /推薦.{0,12}(?:主要)?原因.{0,5}(?:必修|必選)/u, value: 'REQUIRED_COURSE' },
  { pattern: /推薦.{0,12}(?:主要)?原因.{0,5}(?:重修|補修)/u, value: 'RETAKE_REQUIRED' },
  { pattern: /推薦.{0,12}(?:主要)?原因.{0,5}(?:你指定|使用者指定)/u, value: 'USER_SPECIFIED' },
  { pattern: /推薦.{0,12}(?:主要)?原因.{0,5}(?:共同必修|實習搭配)/u, value: 'COREQUISITE_PAIR' },
  { pattern: /推薦.{0,12}(?:主要)?原因.{0,8}(?:符合|命中).{0,5}偏好/u, value: 'PREFERENCE_MATCH' },
  { pattern: /推薦.{0,12}(?:主要)?原因.{0,5}關注/u, value: 'WATCHING' },
]);

// 捏造偵測（roadmap #41）：抽「課名形狀的片段」，不是判斷「這句話在談課程」。
// 後者連「以下是推薦的課程：」這種正常開場白都會誤擋，且後端自己安全回答裡的
// 「主要推薦原因：你明確指定這門課」也會因為同時出現「推薦」與「這門課」自我
// 違規——這是第一版設計被推翻的直接原因。
//
// 三種抽取規則：
//   1. 引號（含全形／半形／書名號／方框號）內的片段。
//   2. 「推薦／選修／必修／加選／開設／修習」等動詞之後，或句首，接一段不含
//      標點與常見虛詞的文字，且以「課程／概論／導論／實習／實驗／專題」結尾
//      ——後綴一併算進片段本身，這樣才能跟帳本裡本來就以這些字結尾的真實
//      課名（例如「程式設計實習」）比對，而不是誤判成「一定要跟已知課名有
//      後綴差異」。
//   3. 「推薦／加選／選修／修習」+ 中文詞組，後面接標點或句尾（動賓片語）。
//
// 抽出來的片段仍可能是通用詞組（「以下課程」「任何課程」）而不是特定課名，
// 因此還要過一次停用詞與「數量詞＋門/堂/個」的通用量詞判斷才會真的判定為
// 捏造。
const QUOTED_SPAN = /[「『](?<q1>[^」』]{2,40})[」』]|"(?<q2>[^"]{2,40})"|“(?<q3>[^”]{2,40})”|《(?<q4>[^》]{2,40})》|【(?<q5>[^】]{2,40})】/gu;
const COURSE_NAME_SUFFIXES = '課程|概論|導論|實習|實驗|專題';
// 引號字元也排除在前綴之外，避免片段跨過引號邊界，抓出「另外推薦「量子魔法課程」
// 這種夾帶開引號的雜訊片段——不影響判定結果（引號內那份已經單獨抓到了），
// 純粹是讓違規訊息乾淨一點。
const EXCLUDED_PREFIX_CHARS = '，。；、：「『」』""“”《》【】\\s的了是有和與及也都這該此門';
const SUFFIX_SPAN = new RegExp(
  `(?:^|[，。；、：\\s]|${RECOMMENDATION_VERBS}|開設)([^${EXCLUDED_PREFIX_CHARS}]{2,12}?(?:${COURSE_NAME_SUFFIXES}))`,
  'gu'
);
const VERB_OBJECT_SPAN = new RegExp(`(?:${RECOMMENDATION_VERBS})\\s*([\\u4e00-\\u9fff]{2,12})(?=[，。；、]|$)`, 'gu');

// 抽出來的片段就算不在已知課程清單，也可能只是通用詞組而不是特定課名。
// 兩種判法分開處理，不能混用同一套「結尾符合就算」邏輯：
//   - `EXACT` 詞組必須整段完全相等才算通用——這裡面包含「課程」等單一後綴詞，
//     它們本身就是每個抽出片段的結尾，若也用「結尾符合」比對，會讓所有片段
//     （包括真正捏造的課名）都通過，等於整個偵測失效。
//   - `SUFFIX` 詞組允許片段帶著額外前綴（例如「其中部分課程」），只要結尾是
//     這些通用詞組就不算特定課名；這裡只放「至少兩個字的通用詞組」，不放
//     單一後綴詞，避免上面那個問題。
const GENERIC_COURSE_PHRASES_EXACT = new Set([
  '課表', '偏好', '資格', '畢業學分', '未知', '待確認', '沒有評價',
  '課程', '概論', '導論', '實習', '實驗', '專題',
  // 「推薦原因」是這個系統自己的常用詞彙（recommendationReason），動賓片語
  // 規則會把「推薦」後面接的「原因」抓成受詞——但那是在講推薦這件事本身的
  // 理由，不是在推薦一門叫「原因」的課。
  '原因', '理由',
]);
const GENERIC_COURSE_PHRASES_SUFFIX = [
  '必修課程', '選修課程', '通識課程', '這些課程', '其他課程', '部分課程',
  '相關課程', '以下課程', '該課程', '全部課程', '任何課程', '所有課程',
];
const GENERIC_COUNT_SPAN = /(?:\d+|[一二兩三四五六七八九十幾]+)(?:門|堂|個)/u;

function isGenericCoursePhrase(span) {
  if (GENERIC_COUNT_SPAN.test(span)) return true;
  if (GENERIC_COURSE_PHRASES_EXACT.has(span)) return true;
  return GENERIC_COURSE_PHRASES_SUFFIX.some(phrase => span.endsWith(phrase));
}

function extractCourseShapedSpans(sentence) {
  const spans = new Set();
  for (const match of sentence.matchAll(QUOTED_SPAN)) {
    const value = (match.groups.q1 ?? match.groups.q2 ?? match.groups.q3 ?? match.groups.q4 ?? match.groups.q5 ?? '').trim();
    if (value) spans.add(value);
  }
  for (const match of sentence.matchAll(SUFFIX_SPAN)) {
    const value = match[1]?.trim();
    if (value) spans.add(value);
  }
  for (const match of sentence.matchAll(VERB_OBJECT_SPAN)) {
    const value = match[1]?.trim();
    if (value) spans.add(value);
  }
  return [...spans];
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined) return [];
  return [value];
}

function normalizeText(value) {
  return String(value ?? '').trim();
}

function normalizeCourse(raw, role = null) {
  const course = raw?.course && typeof raw.course === 'object' ? raw.course : raw;
  if (!course || typeof course !== 'object') return null;
  const sectionId = course.sectionId ?? course.id ?? course.courseId;
  const name = normalizeText(course.name ?? course.courseName);
  if (sectionId === undefined && !name) return null;
  const reason = course.recommendationReason && typeof course.recommendationReason === 'object'
    ? course.recommendationReason
    : null;
  const rankedReviewEvidence = Number(course.reviewCount) > 0
    ? {
      reviewCount: Number(course.reviewCount),
      positiveRatio: course.positiveRatio ?? null,
      adjustedEasiness: course.adjustedEasiness ?? null,
      easiness: course.easiness ?? null,
    }
    : null;
  return {
    sectionId: sectionId === undefined || sectionId === null ? null : String(sectionId),
    catalogCourseCode: normalizeText(course.catalogCourseCode ?? course.courseCode) || null,
    name: name || null,
    teacher: normalizeText(course.teacher ?? course.instructor) || null,
    credits: Number.isFinite(Number(course.credits)) ? Number(course.credits) : null,
    timeStr: normalizeText(course.timeStr ?? course.time) || null,
    category: normalizeText(course.category) || null,
    eligibility: normalizeText(course.eligibility) || null,
    eligibilityReason: normalizeText(course.eligibilityReason) || null,
    countsTowardGraduation: course.countsTowardGraduation === true
      ? true
      : course.countsTowardGraduation === false ? false : null,
    reviewEvidence: course.reviewEvidence ?? reason?.reviewEvidence ?? rankedReviewEvidence,
    recommendationReason: reason,
    dataSources: Array.isArray(reason?.dataSources) ? [...reason.dataSources] : [],
    // roadmap #41：被排課器排除或未排入的課，不該被回覆講成推薦——見
    // `auditExcludedCourseRecommended()`。`exclusionReason` 只有 `excluded`
    // bucket 的項目會帶（`agentService.js` 的 `excludedCoursesSample` 在
    // `compactCourse()` 之外另外附了 `reason`），其餘角色一律是 null。
    evidenceRoles: role ? [role] : [],
    exclusionReason: normalizeText(course.reason) || null,
  };
}

function collectCourses(result) {
  const collected = [];
  if (Array.isArray(result)) {
    for (const item of result) {
      const course = normalizeCourse(item, DEFAULT_ROLE);
      if (course) collected.push(course);
    }
    return collected;
  }
  if (!result || typeof result !== 'object') return collected;

  const direct = normalizeCourse(result, DEFAULT_ROLE);
  if (direct) collected.push(direct);
  for (const key of COURSE_LIST_KEYS) {
    const role = COURSE_LIST_ROLES[key] ?? DEFAULT_ROLE;
    for (const item of asArray(result[key])) {
      const course = normalizeCourse(item, role);
      if (course) collected.push(course);
    }
  }
  return collected;
}

function mergeCourse(previous, next) {
  if (!previous) return next;
  const merged = { ...previous };
  for (const [key, value] of Object.entries(next)) {
    if (key === 'dataSources' || key === 'evidenceRoles') {
      merged[key] = [...new Set([...(previous[key] ?? []), ...(value ?? [])])];
      continue;
    }
    if (value !== null && value !== undefined && value !== '') merged[key] = value;
  }
  return merged;
}

export function createEvidenceLedger() {
  return {
    tools: [], courses: [], courseIndex: new Map(), operations: [],
  };
}

// 把 append-only 的 `tools` 攤平成「同一個邏輯操作重試幾次，最後結果是什麼」。
// 分組鍵是呼叫端算好傳進來的 `operationKey`（同工具＋同參數雜湊；沒帶的話退回
// `toolName`，等同以前整個工具共用一筆歷史的行為）。
//
// 用 Map 的 delete → re-set 讓「最後一次被摸到」的操作排在最後——這樣
// `buildSafeFaithfulnessFallback` 只要從尾端往回找，找到的就是這回合真正
// 「最近一次仍未完成」的操作，而不是這回合任何時間點出現過的任何一次失敗。
function buildOperations(tools) {
  const order = new Map();
  for (const attempt of tools) {
    const key = attempt.operationKey ?? attempt.toolName ?? '';
    const attempts = order.has(key) ? [...order.get(key).attempts, attempt] : [attempt];
    order.delete(key);
    order.set(key, { operationKey: key, toolName: attempt.toolName, attempts });
  }
  return [...order.values()].map(op => {
    const terminal = op.attempts[op.attempts.length - 1];
    const terminalIncomplete = terminal.status !== 'succeeded'
      || (op.toolName === 'run_csp_scheduler' && terminal.solverStatus && terminal.solverStatus !== 'solved');
    return {
      ...op,
      terminalStatus: terminal.status,
      terminalError: terminal.error,
      terminalErrorCode: terminal.errorCode,
      terminalSolverStatus: terminal.solverStatus,
      terminalCallId: terminal.callId,
      terminalIncomplete,
    };
  });
}

export function recordToolEvidence(ledger, {
  toolName,
  callId = null,
  result,
  dataSource = null,
  operationKey = null,
} = {}) {
  const target = ledger ?? createEvidenceLedger();
  const malformed = result === null || result === undefined || typeof result !== 'object';
  const status = result?.pendingConfirmation
    ? 'pending'
    : malformed || result?.error || result?.success === false ? 'failed' : 'succeeded';
  target.tools.push({
    toolName: toolName ?? null,
    callId,
    // 同一工具、不同參數的兩次呼叫必須算成兩個操作，否則「對 A 課失敗、對 B 課
    // 成功」會被合併成一筆終態成功，靜默吃掉 A 課的失敗（見呼叫端如何算這個值：
    // `agentService.js` 對 args 取雜湊，不記錄參數內容本身）。沒帶時退回
    // `toolName`，等同同一工具的所有呼叫共用一段歷史——維持呼叫端未升級前的舊行為。
    operationKey: operationKey ?? toolName ?? null,
    status,
    error: malformed ? '工具回傳格式不正確' : normalizeText(result?.error) || null,
    errorCode: malformed ? 'MALFORMED_TOOL_RESULT' : normalizeText(result?.errorCode) || null,
    dataSource,
    solverStatus: normalizeText(result?.solver?.status) || null,
  });
  target.operations = buildOperations(target.tools);

  for (const course of collectCourses(result)) {
    if (!course.dataSources.includes('Course_Sections')) course.dataSources.push('Course_Sections');
    if (toolName === 'search_dcard_reviews' && Number(result?.count) > 0) {
      course.reviewEvidence = result;
      if (!course.dataSources.includes('Course_Reviews')) course.dataSources.push('Course_Reviews');
    }
    if (toolName === 'get_easy_courses' && Number(course.reviewEvidence?.reviewCount) > 0) {
      if (!course.dataSources.includes('Course_Reviews')) course.dataSources.push('Course_Reviews');
    }
    const key = course.sectionId ? `section:${course.sectionId}` : `name:${course.name}`;
    const merged = mergeCourse(target.courseIndex.get(key), course);
    target.courseIndex.set(key, merged);
  }
  target.courses = [...target.courseIndex.values()];
  return target;
}


/**
 * 把「伺服器主動放進 prompt 的課程事實」登記為證據。
 *
 * 忠實度閘門的本意是「沒有依據就不要講」，而**不是**「沒呼叫工具就不要講」。
 * 規劃狀態裡的課名、課號與教師是伺服器自己從 `Courses` 解析出來的
 * （`planningContextService.js`），可信度不低於一次工具呼叫的結果——但它不經過
 * `recordToolEvidence()`，因此原本不在帳本裡。結果是 Agent 被要求「追問使用者為什麼
 * 移除『軟體框架設計』」，卻一提到課名就被判成幻覺，只能回一句沒有資料的安全答案。
 *
 * 刻意**只寫 `courses`／`courseIndex`，不碰 `tools`／`operations`**：這不是一次工具
 * 呼叫，不該出現在「這回合做了哪些操作」的歷史裡，也不該影響
 * `buildSafeFaithfulnessFallback()` 對「最近一次未完成操作」的判斷。
 */
export function recordContextCourseEvidence(ledger, courses = []) {
  const target = ledger ?? createEvidenceLedger();
  for (const raw of asArray(courses)) {
    const course = normalizeCourse(raw, DEFAULT_ROLE);
    if (!course) continue;
    if (!course.dataSources.includes('Course_Sections')) course.dataSources.push('Course_Sections');
    const key = course.sectionId ? `section:${course.sectionId}` : `name:${course.name}`;
    target.courseIndex.set(key, mergeCourse(target.courseIndex.get(key), course));
  }
  target.courses = [...target.courseIndex.values()];
  return target;
}

function splitSentences(reply) {
  return normalizeText(reply).split(/(?<=[。！？!?；;\n])/u).map(x => x.trim()).filter(Boolean);
}

function assertedSelectionReason(sentence) {
  return REASON_ASSERTIONS.find(item => item.pattern.test(sentence))?.value ?? null;
}

function addViolation(violations, code, message, sentence = null, evidence = null) {
  if (violations.some(item => item.code === code && item.sentence === sentence)) return;
  violations.push({ code, message, sentence, evidence });
}

function evidenceRefFor(candidate, mentionText) {
  return candidate.sectionId ? `section:${candidate.sectionId}` : `course:${candidate.name ?? mentionText}`;
}

// 對單一候選 section 檢查這句話主張的每一項事實，回傳「矛盾清單」而不是直接
// push 進 violations——這樣呼叫端才能先看完所有候選再決定要不要真的判違規
// （roadmap #41：逐 candidate 一致性，見 `auditCourseReference`）。
function evaluateCandidate(sentence, candidate, facts, mentionText) {
  const evidenceRef = evidenceRefFor(candidate, mentionText);
  const contradictions = [];
  const supportedClaims = [];

  const creditValues = [...facts.creditValues];
  if (facts.tableFacts?.credits !== null && facts.tableFacts?.credits !== undefined) {
    creditValues.push(facts.tableFacts.credits);
  }
  if (creditValues.length > 0 && candidate.credits !== null) {
    const supported = creditValues.includes(candidate.credits);
    supportedClaims.push({ type: 'course_credits', subject: evidenceRef, assertedValue: creditValues, supported, evidence: ['Course_Sections'] });
    if (!supported) {
      contradictions.push({ code: 'COURSE_CREDITS_MISMATCH', message: `「${candidate.name}」的學分與課程資料不一致。` });
    }
  }

  const assertedTeacher = facts.assertedTeacher ?? facts.tableFacts?.teacher ?? null;
  if (assertedTeacher && candidate.teacher) {
    const supported = assertedTeacher === candidate.teacher;
    supportedClaims.push({ type: 'course_teacher', subject: evidenceRef, assertedValue: assertedTeacher, supported, evidence: ['Course_Sections'] });
    if (!supported) {
      contradictions.push({ code: 'COURSE_TEACHER_MISMATCH', message: `「${candidate.name}」的教師與課程資料不一致。` });
    }
  }

  const evidenceTimes = extractTimeClaims(candidate.timeStr);
  if (facts.times.length > 0 && evidenceTimes.length > 0) {
    const supported = facts.times.some(value => evidenceTimes.includes(value));
    supportedClaims.push({ type: 'course_time', subject: evidenceRef, assertedValue: facts.times, supported, evidence: ['Course_Sections'] });
    if (!supported) {
      contradictions.push({ code: 'COURSE_TIME_MISMATCH', message: `「${candidate.name}」的上課時間與課程資料不一致。` });
    }
  }

  if (REVIEW_CLAIM.test(sentence) && !REVIEW_UNKNOWN.test(sentence)) {
    const reason = candidate.recommendationReason;
    const sources = [...new Set([...(candidate.dataSources ?? []), ...(reason?.dataSources ?? [])])];
    const hasReviewEvidence = Boolean(candidate.reviewEvidence) && sources.includes('Course_Reviews');
    const proxy = reason?.easinessSource === 'proxy';
    supportedClaims.push({ type: 'review_claim', subject: evidenceRef, supported: hasReviewEvidence && !proxy, evidence: sources });
    if (proxy) {
      contradictions.push({ code: 'PROXY_PRESENTED_AS_REVIEW', message: `「${candidate.name}」只有課程屬性推估，不能說成學生評價。` });
    } else if (!hasReviewEvidence) {
      contradictions.push({ code: 'REVIEW_WITHOUT_EVIDENCE', message: `「${candidate.name}」沒有可支持此評價結論的資料。` });
    }
  }

  if (ELIGIBILITY_CLAIM.test(sentence) && candidate.eligibility !== 'eligible') {
    contradictions.push({ code: 'ELIGIBILITY_OVERCLAIM', message: `「${candidate.name}」的修課資格尚未確認。` });
  }
  if (GRADUATION_CLAIM.test(sentence) && candidate.countsTowardGraduation !== true) {
    contradictions.push({ code: 'GRADUATION_OVERCLAIM', message: `「${candidate.name}」沒有確定的畢業學分認列證據。` });
  }
  if (PREFERENCE_CLAIM.test(sentence) && (candidate.recommendationReason?.matchedPreferences ?? []).length === 0) {
    contradictions.push({ code: 'PREFERENCE_OVERCLAIM', message: `「${candidate.name}」沒有命中任何已記錄偏好。` });
  }

  const assertedReason = assertedSelectionReason(sentence);
  const actualReason = candidate.recommendationReason?.selectedBecause ?? null;
  if (assertedReason && actualReason && assertedReason !== actualReason) {
    contradictions.push({ code: 'RECOMMENDATION_REASON_REVERSED', message: `「${candidate.name}」的主要推薦原因與 recommendationReason 不一致。` });
  }

  return {
    candidate, evidenceRef, contradictions, supportedClaims,
  };
}

// 逐 candidate 一致性檢查（roadmap #41，取代逐事實 disjunction）：只要候選集合
// 裡「有任何一個真實 section 同時滿足整句話的所有主張」就算通過；不能讓 A 班
// 的教師配上 B 班的時間各自單獨成立就放行——那樣會讓一門現實不存在的課
// （教師來自 A、時間來自 B）憑空通過。
//
// 一致性不成立時，取「矛盾最少」的候選發違規，並列出其餘候選當作證據，
// 讓修正模型知道「你把哪幾個班次混在一起了」，而不是只看到單一個矛盾代號。
function auditCourseReference(sentence, reference, claims, violations) {
  const tableCells = splitTableCells(sentence);
  const tableColumnIndex = tableCells ? findTableColumnIndex(tableCells, reference.mentionText) : -1;
  const tableFacts = tableCells && tableColumnIndex >= 0 ? extractTableFacts(tableCells, tableColumnIndex) : null;
  const facts = {
    creditValues: extractCreditValues(sentence),
    assertedTeacher: matchAssertedTeacher(sentence),
    times: extractTimeClaims(sentence),
    tableFacts,
  };

  const evaluations = reference.candidates.map(candidate => (
    evaluateCandidate(sentence, candidate, facts, reference.mentionText)
  ));
  const survivors = evaluations.filter(item => item.contradictions.length === 0);

  const referenceLabel = evaluations.length === 1
    ? evaluations[0].evidenceRef
    : evaluations.map(item => item.evidenceRef);
  claims.push({ type: 'course_reference', subject: referenceLabel, supported: survivors.length > 0, evidence: ['Course_Sections'] });

  if (survivors.length > 0) {
    for (const claim of survivors[0].supportedClaims) claims.push(claim);
    return survivors.map(item => item.candidate);
  }

  const best = [...evaluations].sort((a, b) => (
    a.contradictions.length - b.contradictions.length
    || Number(a.candidate.sectionId ?? Number.MAX_SAFE_INTEGER) - Number(b.candidate.sectionId ?? Number.MAX_SAFE_INTEGER)
  ))[0];
  for (const claim of best.supportedClaims) claims.push(claim);
  const evidence = evaluations.length > 1 ? evaluations.map(item => item.evidenceRef) : best.evidenceRef;
  for (const contradiction of best.contradictions) {
    addViolation(violations, contradiction.code, contradiction.message, sentence, evidence);
  }
  return [best.candidate];
}

function buildKnownCourseNames(courses) {
  return new Set(courses.flatMap(course => [
    course.name,
    course.catalogCourseCode,
    ...(course.recommendationReason?.matchedPreferences ?? []).map(item => (
      typeof item === 'string' ? item : item?.label ?? item?.name ?? item?.id
    )),
    ...(course.recommendationReason?.alternativesRejected?.candidates ?? []).flatMap(item => [
      item?.name, item?.catalogCourseCode, item?.courseCode,
    ]),
  ]).filter(Boolean).map(normalizeText));
}

function auditFabricatedCourseSpans(sentence, known, violations) {
  for (const span of extractCourseShapedSpans(sentence)) {
    if (known.has(span)) continue;
    if (isGenericCoursePhrase(span)) continue;
    addViolation(violations, 'UNSUPPORTED_COURSE', `回答提到工具結果中不存在的課程「${span}」。`, sentence, null);
  }
}

// roadmap #41：被排課器排除、或未排入課表的課，不能被講成推薦或建議加選——
// 「查得到這門課」不等於「這門課被選中」。只在候選**全部**角色都屬於
// 排除／未排入時才判違規；角色混雜（例如同名但不同 section 一個排入、一個
// 被排除）時無法確定回覆指的是哪一個，不誤判。
function auditExcludedCourseRecommended(sentence, reference, violations) {
  if (!RECOMMENDATION_SHAPE.test(sentence)) return;
  const { candidates } = reference;
  if (candidates.length === 0) return;
  const allNonRecommending = candidates.every(candidate => (
    candidate.evidenceRoles.length > 0 && candidate.evidenceRoles.every(role => NON_RECOMMENDING_ROLES.has(role))
  ));
  if (!allNonRecommending) return;
  const evidence = candidates.length === 1
    ? evidenceRefFor(candidates[0], reference.mentionText)
    : candidates.map(candidate => evidenceRefFor(candidate, reference.mentionText));
  addViolation(
    violations,
    'EXCLUDED_COURSE_PRESENTED_AS_RECOMMENDED',
    `「${reference.mentionText}」已被排課結果排除或未排入，不能講成推薦或建議加選。`,
    sentence,
    evidence
  );
}

// 只看每個邏輯操作的**終態**，不看它重試過程中留下的每一筆歷史紀錄——
// 一個操作重試後成功，就不該再因為它中途失敗過而被要求揭露或被判定造假宣稱成功。
function auditToolOutcomes(reply, operations, violations) {
  const incomplete = operations.filter(op => op.terminalIncomplete);
  if (incomplete.length > 0 && !FAILURE_DISCLOSURE.test(reply)) {
    addViolation(
      violations,
      'TOOL_FAILURE_NOT_DISCLOSED',
      '工具未完成或仍等待確認時，回答必須明確說明未完成狀態。'
    );
  }
  for (const op of operations) {
    const pattern = SUCCESS_PATTERNS[op.toolName];
    if (!pattern) continue;
    if (op.terminalIncomplete && pattern.test(reply)) {
      addViolation(
        violations,
        'TOOL_FAILURE_PRESENTED_AS_SUCCESS',
        `${op.toolName} 並未成功，回答卻宣稱操作完成。`,
        null,
        op.terminalCallId
      );
    }
  }
}

export function validateFaithfulnessReply(reply, ledger, { userMessage = '' } = {}) {
  const text = normalizeText(reply);
  const operations = ledger?.operations ?? [];
  const courses = ledger?.courses ?? [];
  const claims = [];
  const violations = [];

  if (SECRET_DISCLOSURE.test(text)) {
    addViolation(violations, 'SENSITIVE_SYSTEM_DISCLOSURE', '回答包含不應公開的系統憑證或秘密值。');
  }

  auditToolOutcomes(text, operations, violations);

  const known = buildKnownCourseNames(courses);
  let carryOver = null;
  for (const sentence of splitSentences(text)) {
    const resolved = resolveCourseReferences(sentence, courses, { carryOver });
    carryOver = resolved.carryOver;

    auditFabricatedCourseSpans(sentence, known, violations);

    for (const reference of resolved.references) {
      auditCourseReference(sentence, reference, claims, violations);
      auditExcludedCourseRecommended(sentence, reference, violations);
    }

    if (resolved.references.length === 0 && GRADUATION_RULE_CLAIM.test(sentence)) {
      addViolation(
        violations,
        'GRADUATION_RULE_WITHOUT_EVIDENCE',
        '回答提出畢業門檻，但本回合沒有可追溯的畢業規則證據。',
        sentence,
        null
      );
    }
  }

  const asksForReviews = /評價|涼|甜|好拿分/u.test(userMessage);
  const relevantCourses = courses.filter(course => (
    !userMessage || (course.name && userMessage.includes(course.name))
      || (course.catalogCourseCode && userMessage.includes(course.catalogCourseCode))
  ));
  if (asksForReviews && relevantCourses.length > 0
    && relevantCourses.every(course => !course.reviewEvidence)
    && !REVIEW_UNKNOWN.test(text)) {
    addViolation(violations, 'MISSING_REVIEW_UNCERTAINTY', '查不到評價時必須明確說明目前沒有評價資料。');
  }

  const reasonCourses = relevantCourses.length > 0 ? relevantCourses : courses;
  if (REASON_QUESTION.test(userMessage) && reasonCourses.length > 0) {
    const reasonMentioned = reasonCourses.some(course => (
      course.name && text.includes(course.name)
      && (assertedSelectionReason(text) || PREFERENCE_CLAIM.test(text) || REASON_PARAPHRASE.test(text))
    ));
    if (!reasonMentioned) {
      addViolation(violations, 'MISSING_RECOMMENDATION_REASON', '使用者詢問推薦原因時，回答必須轉述 recommendationReason。');
    }
  }

  return {
    passed: violations.length === 0,
    hallucinationCount: violations.length,
    claims,
    violations,
  };
}

function summarizeReason(course) {
  const reason = course.recommendationReason;
  const matched = (reason?.matchedPreferences ?? []).map(item => (
    typeof item === 'string' ? item : item?.label ?? item?.name ?? item?.id
  )).filter(Boolean);
  switch (reason?.selectedBecause) {
    case 'REQUIRED_COURSE': return '必修優先';
    case 'RETAKE_REQUIRED': return '重補修優先';
    case 'USER_SPECIFIED': return '你明確指定這門課';
    case 'COREQUISITE_PAIR': return '與同名正課或實習課成對排入';
    case 'WATCHING': return '來自你的關注清單';
    case 'CREDIT_FILL': return '補足目標學分';
    case 'PREFERENCE_MATCH':
      return matched.length > 0
        ? `命中偏好：${matched.join('、')}`
        : '沒有命中任何偏好；工具未提供更具體的主要推薦原因';
    // 呼叫端（`courseSummary`）已經先印過一次「主要推薦原因：」當標籤，
    // 這裡不要重複講「主要推薦原因」，否則會疊成「主要推薦原因：主要推薦
    // 原因未提供」這種說了兩次的怪句子。
    default: return '未提供，無法確認';
  }
}

function courseSummary(course, { includeReason = false } = {}) {
  const facts = [
    course.name ?? course.catalogCourseCode ?? `班次 ${course.sectionId}`,
    course.teacher ? `${course.teacher}老師` : null,
    course.credits !== null ? `${course.credits} 學分` : null,
    course.timeStr,
  ].filter(Boolean).join('，');
  return includeReason ? `${facts}；主要推薦原因：${summarizeReason(course)}` : facts;
}

export function buildSafeFaithfulnessFallback(ledger, { userMessage = '' } = {}) {
  const operations = ledger?.operations ?? [];
  const courses = ledger?.courses ?? [];
  // 找「最近一次仍未完成」的操作，而不是整段歷史裡任何一次失敗——後者會讓
  // 一個已經重試成功的操作，因為它中途失敗過，就一直卡在「尚未完成」的安全回答。
  const failed = [...operations].reverse().find(op => op.terminalIncomplete);
  if (failed) {
    const detail = failed.terminalError ? `：${failed.terminalError}` : '';
    return `這次操作尚未完成${detail}。請確認資料後再試。`;
  }
  if (courses.length > 0) {
    const asksForReason = REASON_QUESTION.test(userMessage);
    const listed = courses.slice(0, 8).map((course, index) => (
      courseSummary(course, { includeReason: asksForReason && index === 0 })
    )).join('\n');
    const hasMissingReviews = courses.some(course => !course.reviewEvidence);
    return `目前可確認的課程資料如下：\n${listed}`
      + (hasMissingReviews ? '\n其中部分課程沒有評價資料，無法判斷是否涼或好拿分。' : '');
  }
  return '目前沒有足夠的可驗證資料回答這個問題，請提供更明確的課程或需求。';
}

export async function enforceFaithfulReply({
  reply,
  ledger,
  userMessage = '',
  repair = null,
} = {}) {
  const firstAudit = validateFaithfulnessReply(reply, ledger, { userMessage });
  if (firstAudit.passed) {
    return { reply, audit: firstAudit, initialAudit: firstAudit, repaired: false, fallback: false };
  }

  if (typeof repair === 'function') {
    let repairedReply = '';
    try {
      repairedReply = normalizeText(await repair({
        reply,
        violations: firstAudit.violations,
        ledger: {
          tools: ledger?.tools ?? [],
          operations: ledger?.operations ?? [],
          courses: ledger?.courses ?? [],
        },
      }));
    } catch {
      repairedReply = '';
    }
    if (repairedReply) {
      const repairedAudit = validateFaithfulnessReply(repairedReply, ledger, { userMessage });
      if (repairedAudit.passed) {
        return {
          reply: repairedReply,
          audit: repairedAudit,
          initialAudit: firstAudit,
          repaired: true,
          fallback: false,
        };
      }
    }
  }

  const fallbackReply = buildSafeFaithfulnessFallback(ledger, { userMessage });
  return {
    reply: fallbackReply,
    audit: validateFaithfulnessReply(fallbackReply, ledger, { userMessage }),
    initialAudit: firstAudit,
    repaired: false,
    fallback: true,
  };
}

export default {
  createEvidenceLedger,
  recordToolEvidence,
  validateFaithfulnessReply,
  buildSafeFaithfulnessFallback,
  enforceFaithfulReply,
};
