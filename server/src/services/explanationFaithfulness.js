// Roadmap #37：在 Agent 的自然語言回覆送出前，以本回合真正看過的 tool result
// 建立證據帳本並檢查高風險事實。Prompt 仍負責引導模型；這個模組是最後一道
// 確定性 guard，避免「提示寫得很嚴格」被誤當成已經驗證過。

const COURSE_LIST_KEYS = Object.freeze([
  'schedule', 'draftSchedule', 'unscheduledCourses', 'watchedCourses',
  'excludedCoursesSample', 'courses', 'results',
]);

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

const REASON_ASSERTIONS = Object.freeze([
  { pattern: /推薦.{0,12}(?:主要)?原因.{0,5}(?:必修|必選)/u, value: 'REQUIRED_COURSE' },
  { pattern: /推薦.{0,12}(?:主要)?原因.{0,5}(?:重修|補修)/u, value: 'RETAKE_REQUIRED' },
  { pattern: /推薦.{0,12}(?:主要)?原因.{0,5}(?:你指定|使用者指定)/u, value: 'USER_SPECIFIED' },
  { pattern: /推薦.{0,12}(?:主要)?原因.{0,5}(?:共同必修|實習搭配)/u, value: 'COREQUISITE_PAIR' },
  { pattern: /推薦.{0,12}(?:主要)?原因.{0,8}(?:符合|命中).{0,5}偏好/u, value: 'PREFERENCE_MATCH' },
  { pattern: /推薦.{0,12}(?:主要)?原因.{0,5}關注/u, value: 'WATCHING' },
]);

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined) return [];
  return [value];
}

function normalizeText(value) {
  return String(value ?? '').trim();
}

function normalizeCourse(raw) {
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
  };
}

function collectCourses(result) {
  const collected = [];
  if (Array.isArray(result)) {
    for (const item of result) {
      const course = normalizeCourse(item);
      if (course) collected.push(course);
    }
    return collected;
  }
  if (!result || typeof result !== 'object') return collected;

  const direct = normalizeCourse(result);
  if (direct) collected.push(direct);
  for (const key of COURSE_LIST_KEYS) {
    for (const item of asArray(result[key])) {
      const course = normalizeCourse(item);
      if (course) collected.push(course);
    }
  }
  return collected;
}

function mergeCourse(previous, next) {
  if (!previous) return next;
  const merged = { ...previous };
  for (const [key, value] of Object.entries(next)) {
    if (key === 'dataSources') {
      merged.dataSources = [...new Set([...(previous.dataSources ?? []), ...(value ?? [])])];
      continue;
    }
    if (value !== null && value !== undefined && value !== '') merged[key] = value;
  }
  return merged;
}

export function createEvidenceLedger() {
  return { tools: [], courses: [], courseIndex: new Map() };
}

export function recordToolEvidence(ledger, {
  toolName,
  callId = null,
  result,
  dataSource = null,
} = {}) {
  const target = ledger ?? createEvidenceLedger();
  const malformed = result === null || result === undefined || typeof result !== 'object';
  const status = result?.pendingConfirmation
    ? 'pending'
    : malformed || result?.error || result?.success === false ? 'failed' : 'succeeded';
  target.tools.push({
    toolName: toolName ?? null,
    callId,
    status,
    error: malformed ? '工具回傳格式不正確' : normalizeText(result?.error) || null,
    errorCode: malformed ? 'MALFORMED_TOOL_RESULT' : normalizeText(result?.errorCode) || null,
    dataSource,
    solverStatus: normalizeText(result?.solver?.status) || null,
  });

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

function splitSentences(reply) {
  return normalizeText(reply).split(/(?<=[。！？!?；;\n])/u).map(x => x.trim()).filter(Boolean);
}

function mentionedCourses(sentence, courses) {
  return courses.filter(course => (
    (course.name && sentence.includes(course.name))
    || (course.catalogCourseCode && sentence.includes(course.catalogCourseCode))
  ));
}

function extractTimeClaims(value) {
  const text = normalizeText(value);
  const claims = [];
  const patterns = [
    /(?:星期|週)([一二三四五六日天])\s*(?:第)?\s*(\d{1,2})(?:\s*[-~～–—至到]\s*(\d{1,2}))?\s*節?/gu,
    /[（(]?([一二三四五六日天])[）)]?\s*(?:第)?\s*(\d{1,2})\s*[-~～–—至到]\s*(\d{1,2})/gu,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const day = match[1] === '天' ? '日' : match[1];
      const start = Number(match[2]);
      const end = Number(match[3] ?? match[2]);
      claims.push(`${day}:${start}-${end}`);
    }
  }
  return [...new Set(claims)];
}

function extractTableCourseFacts(sentence, course) {
  if (!sentence.includes('|')) return null;
  const cells = sentence.split('|')
    .map(cell => cell.replace(/[*_`]/g, '').trim())
    .filter(Boolean);
  const courseIndex = cells.findIndex(cell => (
    (course.name && cell.includes(course.name))
    || (course.catalogCourseCode && cell.includes(course.catalogCourseCode))
  ));
  if (courseIndex < 0) return null;
  const creditText = cells[courseIndex + 2] ?? '';
  const creditMatch = creditText.match(/^\s*(\d+(?:\.\d+)?)\s*(?:學分)?\s*$/u);
  return {
    teacher: normalizeText(cells[courseIndex + 1]).replace(/(?:老師|教授)$/u, '') || null,
    credits: creditMatch ? Number(creditMatch[1]) : null,
  };
}

function assertedSelectionReason(sentence) {
  return REASON_ASSERTIONS.find(item => item.pattern.test(sentence))?.value ?? null;
}

function addViolation(violations, code, message, sentence = null, evidence = null) {
  if (violations.some(item => item.code === code && item.sentence === sentence)) return;
  violations.push({ code, message, sentence, evidence });
}

function auditCourseSentence(sentence, course, claims, violations) {
  const evidenceRef = course.sectionId ? `section:${course.sectionId}` : `course:${course.name}`;
  const tableFacts = extractTableCourseFacts(sentence, course);
  claims.push({ type: 'course_reference', subject: evidenceRef, supported: true, evidence: ['Course_Sections'] });

  const creditValues = [...sentence.matchAll(/(\d+(?:\.\d+)?)\s*學分/gu)].map(match => Number(match[1]));
  if (tableFacts?.credits !== null && tableFacts?.credits !== undefined) creditValues.push(tableFacts.credits);
  if (creditValues.length > 0 && course.credits !== null) {
    const supported = creditValues.includes(course.credits);
    claims.push({ type: 'course_credits', subject: evidenceRef, assertedValue: creditValues, supported, evidence: ['Course_Sections'] });
    if (!supported) {
      addViolation(violations, 'COURSE_CREDITS_MISMATCH', `「${course.name}」的學分與課程資料不一致。`, sentence, evidenceRef);
    }
  }

  const teacherMatch = sentence.match(/由\s*([^，。；、\s]{1,16})\s*(?:老師|教授)(?:授課|開設)?/u);
  const assertedTeacher = teacherMatch?.[1] ?? tableFacts?.teacher ?? null;
  if (assertedTeacher && course.teacher) {
    const asserted = assertedTeacher;
    const supported = asserted === course.teacher;
    claims.push({ type: 'course_teacher', subject: evidenceRef, assertedValue: asserted, supported, evidence: ['Course_Sections'] });
    if (!supported) {
      addViolation(violations, 'COURSE_TEACHER_MISMATCH', `「${course.name}」的教師與課程資料不一致。`, sentence, evidenceRef);
    }
  }

  const assertedTimes = extractTimeClaims(sentence);
  const evidenceTimes = extractTimeClaims(course.timeStr);
  if (assertedTimes.length > 0 && evidenceTimes.length > 0) {
    const supported = assertedTimes.some(value => evidenceTimes.includes(value));
    claims.push({ type: 'course_time', subject: evidenceRef, assertedValue: assertedTimes, supported, evidence: ['Course_Sections'] });
    if (!supported) {
      addViolation(violations, 'COURSE_TIME_MISMATCH', `「${course.name}」的上課時間與課程資料不一致。`, sentence, evidenceRef);
    }
  }

  if (REVIEW_CLAIM.test(sentence) && !REVIEW_UNKNOWN.test(sentence)) {
    const reason = course.recommendationReason;
    const sources = [...new Set([...(course.dataSources ?? []), ...(reason?.dataSources ?? [])])];
    const hasReviewEvidence = Boolean(course.reviewEvidence) && sources.includes('Course_Reviews');
    const proxy = reason?.easinessSource === 'proxy';
    claims.push({ type: 'review_claim', subject: evidenceRef, supported: hasReviewEvidence && !proxy, evidence: sources });
    if (proxy) {
      addViolation(violations, 'PROXY_PRESENTED_AS_REVIEW', `「${course.name}」只有課程屬性推估，不能說成學生評價。`, sentence, evidenceRef);
    } else if (!hasReviewEvidence) {
      addViolation(violations, 'REVIEW_WITHOUT_EVIDENCE', `「${course.name}」沒有可支持此評價結論的資料。`, sentence, evidenceRef);
    }
  }

  if (ELIGIBILITY_CLAIM.test(sentence) && course.eligibility !== 'eligible') {
    addViolation(violations, 'ELIGIBILITY_OVERCLAIM', `「${course.name}」的修課資格尚未確認。`, sentence, evidenceRef);
  }
  if (GRADUATION_CLAIM.test(sentence) && course.countsTowardGraduation !== true) {
    addViolation(violations, 'GRADUATION_OVERCLAIM', `「${course.name}」沒有確定的畢業學分認列證據。`, sentence, evidenceRef);
  }
  if (PREFERENCE_CLAIM.test(sentence)
    && (course.recommendationReason?.matchedPreferences ?? []).length === 0) {
    addViolation(violations, 'PREFERENCE_OVERCLAIM', `「${course.name}」沒有命中任何已記錄偏好。`, sentence, evidenceRef);
  }

  const assertedReason = assertedSelectionReason(sentence);
  const actualReason = course.recommendationReason?.selectedBecause ?? null;
  if (assertedReason && actualReason && assertedReason !== actualReason) {
    addViolation(
      violations,
      'RECOMMENDATION_REASON_REVERSED',
      `「${course.name}」的主要推薦原因與 recommendationReason 不一致。`,
      sentence,
      evidenceRef
    );
  }
}

function auditUnknownQuotedCourses(sentence, courses, violations) {
  if (!/(?:課程|推薦|選修|必修|學分|授課|評價)/u.test(sentence)) return;
  const known = new Set(courses.flatMap(course => [
    course.name,
    course.catalogCourseCode,
    ...(course.recommendationReason?.matchedPreferences ?? []).map(item => (
      typeof item === 'string' ? item : item?.label ?? item?.name ?? item?.id
    )),
    ...(course.recommendationReason?.alternativesRejected?.candidates ?? []).flatMap(item => [
      item?.name, item?.catalogCourseCode, item?.courseCode,
    ]),
  ]).filter(Boolean).map(normalizeText));
  for (const match of sentence.matchAll(/[「『]([^」』]{2,40})[」』]/gu)) {
    const value = match[1].trim();
    if (known.has(value)) continue;
    if (/^(?:課表|偏好|資格|畢業學分|未知|待確認|沒有評價)$/u.test(value)) continue;
    addViolation(violations, 'UNSUPPORTED_COURSE', `回答提到工具結果中不存在的課程「${value}」。`, sentence, null);
  }
}

function auditToolOutcomes(reply, tools, violations) {
  const incomplete = tools.filter(tool => (
    tool.status !== 'succeeded'
    || (tool.toolName === 'run_csp_scheduler' && tool.solverStatus && tool.solverStatus !== 'solved')
  ));
  if (incomplete.length > 0 && !FAILURE_DISCLOSURE.test(reply)) {
    addViolation(
      violations,
      'TOOL_FAILURE_NOT_DISCLOSED',
      '工具未完成或仍等待確認時，回答必須明確說明未完成狀態。'
    );
  }
  for (const tool of tools) {
    const pattern = SUCCESS_PATTERNS[tool.toolName];
    if (!pattern) continue;
    const toolIncomplete = tool.status !== 'succeeded'
      || (tool.toolName === 'run_csp_scheduler' && tool.solverStatus && tool.solverStatus !== 'solved');
    if (toolIncomplete && pattern.test(reply)) {
      addViolation(
        violations,
        'TOOL_FAILURE_PRESENTED_AS_SUCCESS',
        `${tool.toolName} 並未成功，回答卻宣稱操作完成。`,
        null,
        tool.callId
      );
    }
  }
}

export function validateFaithfulnessReply(reply, ledger, { userMessage = '' } = {}) {
  const text = normalizeText(reply);
  const tools = ledger?.tools ?? [];
  const courses = ledger?.courses ?? [];
  const claims = [];
  const violations = [];

  if (SECRET_DISCLOSURE.test(text)) {
    addViolation(violations, 'SENSITIVE_SYSTEM_DISCLOSURE', '回答包含不應公開的系統憑證或秘密值。');
  }

  auditToolOutcomes(text, tools, violations);
  for (const sentence of splitSentences(text)) {
    const mentioned = mentionedCourses(sentence, courses);
    auditUnknownQuotedCourses(sentence, courses, violations);
    for (const course of mentioned) auditCourseSentence(sentence, course, claims, violations);
    if (mentioned.length === 0 && GRADUATION_RULE_CLAIM.test(sentence)) {
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
      && (assertedSelectionReason(text) || PREFERENCE_CLAIM.test(text)
        || /必修|重修|補修|你指定|關注課程|沒有命中任何偏好|主要推薦原因.{0,8}(?:未知|未提供|無法確認)/u.test(text))
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
    default: return '主要推薦原因未提供，無法確認';
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
  const tools = ledger?.tools ?? [];
  const courses = ledger?.courses ?? [];
  const failed = [...tools].reverse().find(tool => tool.status !== 'succeeded');
  if (failed) {
    const detail = failed.error ? `：${failed.error}` : '';
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
