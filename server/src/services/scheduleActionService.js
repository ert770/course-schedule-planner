import { isActiveTermCourse } from '../data/activeTerm.js';
import { INTERACTION_FEEDBACK_REASONS } from '../data/interactionEventSchema.js';
import { SCHEDULE_CATEGORIES } from '../data/scheduleOptions.js';
import { annotateCourseCategory } from '../skills/courseCategory.js';
import { isRequiredForStudent } from '../skills/courseScope.js';
import { validateScheduleAgainstConstraints } from '../skills/scheduleValidator.js';
import { buildScheduleConstraints } from './constraintService.js';
import { consumePendingChange, peekPendingChange, stagePendingChange } from './pendingChangeService.js';

export const SCHEDULE_ACTIONS = Object.freeze([
  'add', 'remove', 'swap', 'lock', 'unlock', 'avoid', 'restore', 'watch', 'unwatch',
  'compare', 'switch', 'check', 'feedback',
]);
const CURRENT_COURSE_ACTIONS = new Set(['remove', 'lock', 'unlock']);
const FEEDBACK_REASONS = new Set(Object.values(INTERACTION_FEEDBACK_REASONS));
const CHOICE = 'schedule-action-choice';
const positive = value => Number.isSafeInteger(value) && value > 0;
const sectionIdOf = course => Number(course.sectionId ?? course.id);
const trim = value => typeof value === 'string' ? value.trim().slice(0, 100) : '';

function parseReference(text) {
  const query = trim(text).replace(/^「|」$/gu, '');
  const explicit = /^(?:班次(?:編號)?\s*|#)(\d+)$/u.exec(query);
  if (explicit && positive(Number(explicit[1]))) return { sectionId: Number(explicit[1]) };
  return query ? { courseQuery: query } : {};
}

function planNumber(text) {
  const number = /^第?([一二三四五六七八]|[1-8])(?:個|案)?(?:方案)?$/u.exec(text);
  if (!number) return null;
  return Number(number[1]) || '一二三四五六七八'.indexOf(number[1]) + 1;
}

export function parseScheduleAction(message) {
  const text = message.trim().replace(/[。！!]+$/u, '').replace(/^(?:可以)?(?:請)?(?:幫我|請我)?\s*/u, '');
  if (/^(?:比較|對照)(?:一下)?(?:目前|這些|兩個|三個|所有)?(?:的)?(?:課表)?方案[嗎?？]*$/u.test(text)) return { action: 'compare' };
  if (/^(?:檢查|驗證)(?:一下)?(?:目前|這份|現在的)?(?:的)?課表[嗎?？]*$/u.test(text)
    || /^(?:有沒有|看看有沒有)衝堂[嗎?？]*$/u.test(text)) return { action: 'check' };
  if (/^(?:這份)?課表(?:很)?符合(?:我的)?需求$|^(?:這份|目前的)課表(?:可以|符合|沒問題)$|^(?:記錄)?符合(?:需求)?$|^記錄接受$/u.test(text)) {
    return { action: 'feedback', feedback: 'accept' };
  }
  if (/^(?:這份|目前的)課表(?:需要調整|不符合需求)$|^(?:記錄)?需要調整$/u.test(text)) {
    return { action: 'feedback', feedback: 'adjust' };
  }
  const feedback = /^記錄\s*(班次(?:編號)?\s*\d+)\s*(?:因為|原因是)?\s*(時間不行|衝堂|作業太多|課太重|太難|內容不適合|資格不符|額滿)$/u.exec(text);
  if (feedback) {
    const reasons = { 時間不行: 'time', 衝堂: 'time', 作業太多: 'workload', 課太重: 'workload', 太難: 'workload', 內容不適合: 'content', 資格不符: 'eligibility', 額滿: 'full' };
    return { action: 'feedback', feedback: 'adjust', ...parseReference(feedback[1]), reason: reasons[feedback[2]] };
  }
  const switchPlan = /^(?:切換到|切換成|切換|切到|改用)\s*(.+)$/u.exec(text);
  if (switchPlan && /方案|^第|^(?:綜合|輕鬆|興趣|集中)$/u.test(switchPlan[1])) {
    return { action: 'switch', planQuery: switchPlan[1] };
  }
  if (/[?？]$/u.test(text)) return null;
  const swap = /^(?:把)?(.+?)\s*(?:換到|換成|換為|換班到|改成)\s*(.+)$/u.exec(text);
  if (swap && (/班次|^把/u.test(text))) {
    const target = parseReference(swap[2]);
    return { action: 'swap', ...parseReference(swap[1]), targetSectionId: target.sectionId, targetQuery: target.courseQuery };
  }
  const add = /^把(.+?)(?:加入|加到|排進)(?:目前的?)?課表$/u.exec(text);
  if (add) return { action: 'add', ...parseReference(add[1]) };
  const remove = /^把(.+?)(?:從課表移除|移出課表|從課表拿掉)$/u.exec(text);
  if (remove) return { action: 'remove', ...parseReference(remove[1]) };
  const action = /^(?:(這次|本次|以後|長期)\s*)?(解除避開|取消避開|取消關注|取消鎖定|解除鎖定|解鎖|加入課表|加到課表|加課|加選|移除|退掉|鎖定|避開|關注)\s*(.+)$/u.exec(text);
  if (!action) return null;
  const codes = {
    解除避開: 'restore', 取消避開: 'restore', 取消關注: 'unwatch', 取消鎖定: 'unlock', 解除鎖定: 'unlock', 解鎖: 'unlock',
    加入課表: 'add', 加到課表: 'add', 加課: 'add', 加選: 'add', 移除: 'remove', 退掉: 'remove',
    鎖定: 'lock', 避開: 'avoid', 關注: 'watch',
  };
  // Conditions like avoiding a teacher or a time window belong to the preference flow.
  if (action[2] === '避開' && !/^(?:班次|#)/u.test(action[3])
    && (/老師|星期|禮拜|週[一二三四五六日]|早八|午休|時段/u.test(action[3]) || SCHEDULE_CATEGORIES.includes(action[3]))) return null;
  const scope = /這次|本次/u.test(action[1] ?? '') ? 'temporary' : action[1] ? 'saved' : undefined;
  return { action: codes[action[2]], ...parseReference(action[3]), ...(scope ? { scope } : {}) };
}

export function rememberScheduleActionChoice(identity, action, choice) {
  stagePendingChange(identity, CHOICE, { action, choice });
}

export function resumeScheduleAction(identity, message) {
  const pending = peekPendingChange(identity, CHOICE);
  if (!pending) return null;
  const { action, choice } = pending.changes;
  const text = message.trim().replace(/[。！!]+$/u, '');
  let update;
  if (choice.kind === 'scope') {
    if (/^(?:只要|就|只)?(?:這次|本次)(?:就好)?$/u.test(text)) update = { scope: 'temporary' };
    if (/^(?:就)?(?:以後|長期|永久)(?:都要|都這樣)?$/u.test(text)) update = { scope: 'saved' };
  } else if (choice.kind === 'plan') {
    const candidate = choice.items[planNumber(text) - 1]
      ?? choice.items.find(item => item.title === text);
    if (candidate) update = { variantId: candidate.id };
  } else {
    const ref = parseReference(text);
    const ordinal = planNumber(text);
    const candidate = ref.sectionId
      ? choice.items.find(item => item.sectionId === ref.sectionId)
      : choice.items[ordinal - 1];
    if (candidate) update = { [choice.field]: candidate.sectionId };
  }
  const draft = consumePendingChange(identity, CHOICE, pending.token);
  return draft && update ? { ...action, ...update } : null;
}

function showCourse(course) {
  const name = course.name ?? `班次 ${sectionIdOf(course)}`;
  return [name, course.instructor ?? course.teacher, course.timeStr ?? course.time_str, `班次 ${sectionIdOf(course)}`].filter(Boolean).join('｜');
}

async function resolveCourse({ value, query, field, candidates }, lookupCourses, searchCourses, scope) {
  if (positive(value)) {
    if (candidates && !candidates.some(course => sectionIdOf(course) === value)) {
      return { error: '這個班次目前不在課表。' };
    }
    const course = (await lookupCourses([value])).get(value);
    return course ? { course } : { error: '查不到這個班次，請確認課名或班次編號。' };
  }
  const keyword = trim(query);
  if (!keyword) return { error: '請告訴我課名或班次編號。' };
  const key = keyword.toLowerCase();
  const sameCode = course => [course.catalogCourseCode, course.code, course.courseCode, course.selectionCode]
    .some(value => String(value ?? '').toLowerCase() === key);
  const sameName = course => String(course.name ?? '').trim().toLowerCase() === key;
  const near = course => sameName(course) || sameCode(course) || String(course.name ?? '').toLowerCase().includes(key);
  const matches = (candidates ?? await searchCourses({ keyword }, scope)).filter(near);
  const exact = matches.filter(course => sameName(course) || sameCode(course));
  const unique = [...new Map((exact.length ? exact : matches).map(course => [sectionIdOf(course), course])).values()];
  if (unique.length === 1) {
    const id = sectionIdOf(unique[0]);
    const course = (await lookupCourses([id])).get(id);
    return course ? { course } : { error: '這個班次目前查不到，請重新查課。' };
  }
  if (unique.length === 0) return { error: '找不到符合的班次，請確認課名或班次編號。' };
  const items = unique.slice(0, 8).map(course => ({ sectionId: sectionIdOf(course), label: showCourse(course) }));
  return {
    choice: { kind: 'section', field, items },
    message: ['有多個符合的班次，你要哪一個？', ...items.map((item, index) => `${index + 1}. ${item.label}`)].join('\n'),
  };
}

export async function prepareScheduleAction(args, ctx, { lookupCourses, searchCourses, recordFeedback }) {
  const { action } = args;
  if (!SCHEDULE_ACTIONS.includes(action)) return { error: '請指定要對課表做的操作。' };
  if (!['compare', 'check'].includes(action) && /^(?:如果|假如|假設)|會怎樣|有什麼影響|怎麼操作/u.test(ctx.userMessage ?? '')) {
    return { error: '你是在詢問結果，我先保留目前狀態。要實際套用時，再告訴我想執行的操作。' };
  }
  const planning = ctx.planningContext;
  if (!planning && !['watch', 'unwatch'].includes(action)) return { error: '目前無法核對課表，請在首頁開啟課表後再試。' };
  const current = planning?.currentCourses ?? [];
  const plans = planning?.plans ?? [];
  const ready = details => ({ success: true, scheduleAction: { action, ...details } });

  if (action === 'compare') return ready({});
  if (action === 'switch') {
    const query = trim(args.variantId ?? args.planQuery);
    const ordinal = planNumber(query);
    const matches = ordinal ? [plans[ordinal - 1]].filter(Boolean)
      : plans.filter(plan => plan.id === query || (query && plan.title.includes(query.replace(/方案$/u, ''))));
    if (matches.length === 1) return ready({ variantId: matches[0].id });
    const labels = plans.map((plan, index) => `${index + 1}. ${plan.title}`);
    return labels.length
      ? { choice: { kind: 'plan', items: plans }, message: ['你想切到哪個方案？', ...labels].join('\n') }
      : { error: '目前沒有可切換的方案，請先產生課表。' };
  }
  if (action === 'check') {
    if (planning.unresolvedCurrentCourses) return { error: '目前有班次資料查不到，無法完整檢查課表。' };
    if (!current.length) return ready({ empty: true });
    const ids = current.map(sectionIdOf);
    const byId = await lookupCourses(ids);
    if (ids.some(id => !byId.has(id))) return { error: '目前有班次資料查不到，無法完整檢查課表。' };
    const courses = ids.map(id => ({
      ...annotateCourseCategory(byId.get(id), ctx.studentScope),
      formallyRequired: isRequiredForStudent(byId.get(id), ctx.studentScope),
    }));
    const constraints = buildScheduleConstraints({ selectedCourseIds: planning.selectedCourseIds }, ctx.prefs);
    const verified = validateScheduleAgainstConstraints(courses, constraints);
    const credits = courses.reduce((sum, course) => sum + (Number(course.credits) || 0), 0);
    const issues = verified.violations.map(item => item.reason);
    if (credits < constraints.minCredits && !verified.violations.some(item => item.constraintId === 'CREDIT_TARGET')) {
      issues.push(`目前 ${credits} 學分，低於最低目標 ${constraints.minCredits} 學分。`);
    }
    return ready({
      valid: issues.length === 0, credits, issues, unchecked: verified.unchecked,
    });
  }
  if (action === 'feedback') {
    if (!['accept', 'adjust'].includes(args.feedback)) return { error: '這份課表符合需求，還是需要調整？' };
    if (args.feedback === 'accept') return ready({ feedback: 'accept' });
    if (!positive(args.sectionId) || !FEEDBACK_REASONS.has(args.reason)) return ready({ feedback: 'adjust' });
    if (!current.some(course => sectionIdOf(course) === args.sectionId) || !planning.exposureBacked || !planning.requestId) {
      return { error: '目前沒有可核對的推薦課程可記錄這筆回饋。' };
    }
    const result = await recordFeedback(ctx.identity, {
      requestId: planning.requestId, accepted: false,
      rejectedCourses: [{ sectionId: args.sectionId, reason: args.reason }],
    });
    if (result.error) return result;
    return ready({ feedback: 'adjust', feedbackResult: result });
  }

  const input = { value: args.sectionId, query: args.courseQuery, field: 'sectionId' };
  const isCurrent = CURRENT_COURSE_ACTIONS.has(action) || action === 'swap';
  const found = await resolveCourse({ ...input, ...(isCurrent ? { candidates: current } : {}) },
    lookupCourses, searchCourses, ctx.studentScope);
  if (!found.course) return found;
  const course = found.course;
  if (action === 'avoid' && !['temporary', 'saved'].includes(args.scope)) {
    return {
      choice: { kind: 'scope' }, resolvedSectionId: sectionIdOf(course),
      message: `「${course.name}」要只在本次避開，還是以後也避開？`,
    };
  }
  if (action === 'add' && (!isActiveTermCourse(course) || annotateCourseCategory(course, ctx.studentScope).eligibility === 'ineligible')) {
    return { error: '這個班次的開課學期或修課資格不符合，未加入課表。' };
  }
  if (action === 'swap') {
    const target = await resolveCourse({ value: args.targetSectionId, query: args.targetQuery, field: 'targetSectionId' },
      lookupCourses, searchCourses, ctx.studentScope);
    if (!target.course) return { ...target, resolvedSectionId: sectionIdOf(course) };
    if (!isActiveTermCourse(target.course) || annotateCourseCategory(target.course, ctx.studentScope).eligibility === 'ineligible') {
      return { error: '替代班次的開課學期或修課資格不符合，未換課。' };
    }
    return ready({ sectionId: sectionIdOf(course), course, target: target.course });
  }
  return ready({ sectionId: sectionIdOf(course), course, scope: args.scope, reason: FEEDBACK_REASONS.has(args.reason) ? args.reason : null });
}
