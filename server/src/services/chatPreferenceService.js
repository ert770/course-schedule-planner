import { ALL_FLAGS, TAG_TO_FLAG } from '../data/preferenceTags.js';
import { normalizeBlockedPeriods, PERIODS_PER_DAY } from '../utils/periods.js';
import { peekPendingChange, stagePendingChange, consumePendingChange } from './pendingChangeService.js';
import { normalizeScheduleOptions, SCHEDULE_CATEGORIES } from '../data/scheduleOptions.js';

const SCOPE_QUESTION = 'chat-preference-scope';
const NEXT_SCHEDULE = 'chat-next-schedule';
const SAVED_TOPIC_CHOICE = 'chat-saved-topic-choice';
const CREDIT_GOAL_QUESTION = 'chat-credit-goal';
const PERIOD_FIELDS = ['blockedPeriods', 'addBlockedPeriods', 'removeBlockedPeriods'];
const WEEKDAYS = '一二三四五六日';
const DAY_PARTS = { 上午: [1, 4], 下午: [6, 10], 晚上: [11, 14] };

export const SCOPE_PROMPT = '這些條件只套用這次，還是存成以後的偏好？';
export const TEMPORARY_REPLY = '已暫存本次條件。10 分鐘內按「套用偏好排課」或告訴我「幫我重排」就會套用。';
export const SAVED_REPLY = '偏好已保存並同步設定。按「套用偏好排課」或告訴我「幫我重排」就會套用。';

export function preferenceScope(message) {
  const temporary = /這次|本次|這一?次|這回|這一輪|這學期先|先這樣/u.test(message);
  const saved = /以後|之後都|往後|未來都|每次都|長期|永久|(?:存|記)(?:成|為).{0,8}偏好/u.test(message);
  if (temporary === saved) return null;
  return temporary ? 'temporary' : 'saved';
}

export function isScopeAnswer(message) {
  return /^(?:就|只要|那就|選)?(?:這次|本次|這一次|以後|長期|永久)(?:就好|都這樣|都要|即可)?$/u.test(message);
}

export function requestsReplan(message) {
  return !/(?:先別|不要|不用|先不|不必|暫?緩)(?:幫我|先)?(?:重排|重新排|排課|排一下)/u.test(message)
    && /重排|重新(?:幫我)?排|幫我(?:再)?(?:排|安排|規劃)|(?:直接|開始)排|排(?:課表|一下|一份)|(?:套用|照這樣|照這些條件)排|(?:給我|我要).{0,5}課表/u.test(message);
}

// Match simple, unambiguous clauses locally. Compound requests and unfamiliar wording
// stay on the normal Agent tool path.
function preferenceClause(message) {
  return message
    .replace(/^(?:這次|本次|以後|往後)(?:都)?[，、 ]*/u, '')
    .replace(/[，、 ]*(?:(?:請|可以)?幫我(?:再)?(?:重排|重新排(?:課)?|排課|排一下|排)|直接重排)$/u, '')
    .trim();
}

function timeSlots(weekday, part) {
  const day = WEEKDAYS.indexOf(weekday === '天' ? '日' : weekday) + 1;
  const [start, end] = DAY_PARTS[part] ?? [1, PERIODS_PER_DAY];
  return Array.from({ length: end - start + 1 }, (_, index) => ({ day, period: start + index }));
}

function parseScheduleOptions(clause) {
  const credits = /^(最多|上限(?:是|設為)?|至少|最低|剛好|(?:想)?修到)\s*(\d{1,2})\s*學分$/u.exec(clause);
  if (credits && Number(credits[2]) <= 30) {
    const amount = Number(credits[2]);
    if (/最多|上限/u.test(credits[1]) && amount > 0) return { maxCredits: amount };
    if (/至少|最低/u.test(credits[1])) return { minCredits: amount };
    if (amount > 0) return { minCredits: amount, maxCredits: amount };
  }
  const approx = /^(\d{1,2})\s*學分左右$/u.exec(clause);
  if (approx && Number(approx[1]) > 0 && Number(approx[1]) <= 30) {
    const amount = Number(approx[1]);
    return { minCredits: amount - 1, maxCredits: Math.min(30, amount + 1) };
  }
  const cap = /^(?:每天|一天)(?:最多|只上|不要超過)\s*(\d|10)\s*門(?:課)?$/u.exec(clause);
  if (cap && Number(cap[1]) > 0) return { maxCoursesPerDay: Number(cap[1]) };
  const perCourse = /^(?:每門|單門)\s*(\d)\s*學分$/u.exec(clause);
  if (perCourse) return { courseCredits: Number(perCourse[1]) };
  if (/^(?:不排|不要|不上)晚課$/u.test(clause)) return { noEveningClasses: true };
  if (/^晚課(?:可以排|取消限制)$/u.test(clause)) return { noEveningClasses: false };
  const window = /^(?:只有|只在)(?:星期|禮拜|週|周)([一二三四五六日天])(上午|下午|晚上|全天|整天)(?:能上課|可以上課|有空|上課)?$/u.exec(clause);
  if (window) return { allowedPeriods: timeSlots(window[1], window[2]) };
  const preferOpen = /^(?:星期|禮拜|週|周)([一二三四五六日天])(上午|下午|晚上)(?:有空|空出來|留空)(?:會)?比較好$/u.exec(clause);
  if (preferOpen) {
    const blocked = timeSlots(preferOpen[1], preferOpen[2]);
    return { preferredPeriods: [...WEEKDAYS].flatMap(day => timeSlots(day)).filter(slot =>
      !blocked.some(item => item.day === slot.day && item.period === slot.period)) };
  }
  const teacher = /^(不要|避開|不想修|想修|想上|只上|只修)([\p{Script=Han}]{2,8})老師(?:的課)?$/u.exec(clause);
  if (teacher) {
    const key = /^(?:不要|避開|不想修)$/u.test(teacher[1]) ? 'avoidInstructors'
      : teacher[1].startsWith('只') ? 'includeInstructors' : 'preferredInstructors';
    return { [key]: [teacher[2]] };
  }
  const category = SCHEDULE_CATEGORIES.find(value => clause.includes(value));
  if (category) {
    const amount = new RegExp(`^${category}\\s*([一二兩三四五六七八九]|\\d{1,2})\\s*(門|學分)$`, 'u').exec(clause);
    if (amount) {
      const value = /^\d+$/u.test(amount[1]) ? Number(amount[1]) : '一二三四五六七八九'.indexOf(amount[1].replace('兩', '二')) + 1;
      const unit = amount[2] === '門' ? 'Courses' : 'Credits';
      if (value <= 30) return { categoryQuotas: [{ category, ['min' + unit]: value, ['max' + unit]: value }] };
    }
    for (const [prefix, key] of [
      ['只排', 'includeCategories'], ['不排', 'excludeCategories'], ['不要', 'excludeCategories'], ['想多修', 'preferCategories'],
    ]) {
      if (clause === prefix + category) return { [key]: [category] };
    }
  }
  const section = /^(排|要|不要|不排|保留)(?:班次|班次編號)\s*(\d+)$/u.exec(clause);
  if (section && Number.isSafeInteger(Number(section[2])) && Number(section[2]) > 0) {
    return { [/不/u.test(section[1]) ? 'excludedSectionIds' : 'requiredSectionIds']: [Number(section[2])] };
  }
  return null;
}

export function creditGoalQuestion(identity, message) {
  const bare = /^(\d{1,2})\s*學分$/u.exec(preferenceClause(message));
  if (bare && Number(bare[1]) > 0 && Number(bare[1]) <= 30) {
    stagePendingChange(identity, CREDIT_GOAL_QUESTION, {
      value: Number(bare[1]), scope: preferenceScope(message), replan: requestsReplan(message),
    });
    return { reply: `你想排到 ${bare[1]} 學分，還是最多 ${bare[1]} 學分？也可以告訴我這是最低目標。` };
  }
  const pending = peekPendingChange(identity, CREDIT_GOAL_QUESTION);
  if (!pending) return null;
  const answer = preferenceClause(message);
  if (!/^(?:最多|上限|最低|至少|排到|剛好|目標)$/u.test(answer)) {
    consumePendingChange(identity, CREDIT_GOAL_QUESTION, pending.token);
    return null;
  }
  const draft = consumePendingChange(identity, CREDIT_GOAL_QUESTION, pending.token);
  if (!draft) return null;
  return {
    scope: preferenceScope(message) ?? draft.scope,
    replan: requestsReplan(message) || draft.replan,
    toolName: 'update_preferences',
    args: { scheduleOptions: parseScheduleOptions(
      `${/上限|最多/u.test(answer) ? '最多' : /最低|至少/u.test(answer) ? '至少' : '剛好'}${draft.value}學分`
    ) },
  };
}

export function parseSimplePreference(message) {
  const clause = preferenceClause(message);
  const tag = TAG_TO_FLAG.get('#' + clause.replace(/^取消/u, ''));
  if (tag) return { [clause.startsWith('取消') ? 'uncheck' : 'check']: [tag] };
  if (/^(?:不(?:要|上|排)|別排|沒有)早八$/u.test(clause)) return { check: ['noMorningClasses'] };
  if (/^(?:取消不排早八|早八可以排)$/u.test(clause)) return { uncheck: ['noMorningClasses'] };
  const scheduleOptions = parseScheduleOptions(clause);
  if (scheduleOptions) return { scheduleOptions };
  const time = /^(?:星期|禮拜|週|周)([一二三四五六日天])(上午|下午|晚上|全天|整天)(?:(?:要)?打工|(?:不(?:用|能|要)?排|不能上課|沒空)(?:課)?|(?:可以|恢復)排(?:課)?)$/u.exec(clause);
  if (!time) return null;
  return {
    [/(?:可以|恢復)排/u.test(clause) ? 'removeBlockedPeriods' : 'addBlockedPeriods']:
      timeSlots(time[1], time[2]),
  };
}

export function cleanPreferenceArgs(args) {
  const clean = {};
  for (const key of ['check', 'uncheck']) {
    const flags = Array.isArray(args[key]) ? args[key].filter(flag => ALL_FLAGS.includes(flag)) : [];
    if (flags.length) clean[key] = [...new Set(flags)];
  }
  for (const key of PERIOD_FIELDS) {
    const periods = normalizeBlockedPeriods(args[key]);
    if (periods.length) clean[key] = periods;
  }
  if (Number.isInteger(args.targetCreditsMax) && args.targetCreditsMax > 0 && args.targetCreditsMax <= 30) {
    clean.targetCreditsMax = args.targetCreditsMax;
  }
  if (typeof args.preferredTrack === 'string' && args.preferredTrack.trim().length <= 80 && args.preferredTrack.trim()) {
    clean.preferredTrack = args.preferredTrack.trim();
  }
  if (args.preferredTrack === null) clean.preferredTrack = null;
  const scheduleOptions = normalizeScheduleOptions(args.scheduleOptions);
  if (Object.keys(scheduleOptions).length) clean.scheduleOptions = scheduleOptions;
  return clean;
}

export function mergeBlockedPeriodChanges(args, saved) {
  if (!Array.isArray(args.addBlockedPeriods) && !Array.isArray(args.removeBlockedPeriods)) {
    return args.blockedPeriods;
  }
  const removed = new Set(normalizeBlockedPeriods(args.removeBlockedPeriods).map(({ day, period }) => day * 100 + period));
  return normalizeBlockedPeriods([
    ...(args.blockedPeriods ?? saved ?? []),
    ...(args.addBlockedPeriods ?? []),
  ]).filter(({ day, period }) => !removed.has(day * 100 + period));
}

function temporaryConstraints(args, prefs) {
  const constraints = {};
  for (const [key, value] of [['check', true], ['uncheck', false]]) {
    for (const flag of args[key] ?? []) {
      if (args.check?.includes(flag) && args.uncheck?.includes(flag)) continue;
      constraints[flag === 'preferDiscussion' ? 'discussion' : flag] = value;
    }
  }
  if (args.targetCreditsMax !== undefined) constraints.maxCredits = args.targetCreditsMax;
  if (args.preferredTrack !== undefined) constraints.preferredTrack = args.preferredTrack;
  if (args.scheduleOptions) constraints.scheduleOptions = { ...prefs.scheduleOptions, ...args.scheduleOptions };
  const periods = mergeBlockedPeriodChanges(args, prefs.blockedPeriods);
  if (periods !== undefined) {
    constraints.blockedPeriods = periods;
    constraints.overrideBlockedPeriods = true;
  }
  return constraints;
}

export function deferPreferenceScope(identity, toolName, args, replan) {
  stagePendingChange(identity, SCOPE_QUESTION, { toolName, args, replan });
}

export function resolvePreferenceScope(identity, message) {
  const pending = peekPendingChange(identity, SCOPE_QUESTION);
  if (!pending) return null;
  const replan = requestsReplan(message);
  const reply = message.replace(/[，、 ]*(?:幫我重排|重新排課|重排)$/u, '');
  if (!isScopeAnswer(reply)) {
    consumePendingChange(identity, SCOPE_QUESTION, pending.token);
    return null;
  }
  const draft = consumePendingChange(identity, SCOPE_QUESTION, pending.token);
  return draft && { ...draft, scope: preferenceScope(reply), replan: draft.replan || replan };
}

export function stageTemporaryPreference(identity, args, { topic = false } = {}) {
  const prior = peekPendingChange(identity, NEXT_SCHEDULE)?.changes ?? [];
  stagePendingChange(identity, NEXT_SCHEDULE, [...prior.slice(-13), { args, topic }]);
}

export function readTemporaryPreference(identity, prefs) {
  const pending = peekPendingChange(identity, NEXT_SCHEDULE);
  if (!pending) return null;
  const constraints = pending.changes.reduce((current, { args, topic }) => ({
    ...current,
    ...(topic
      ? { interests: [...new Set([...(current.interests ?? []), ...args.addTerms])] }
      : temporaryConstraints(args, { ...prefs, ...current })),
  }), {});
  return { constraints, token: pending.token };
}

export function consumeTemporaryPreference(identity, pending) {
  if (pending) consumePendingChange(identity, NEXT_SCHEDULE, pending.token);
}

export function askSavedTopicChoice(identity, choices, replan) {
  const available = choices.filter(item => item.candidates.length > 0);
  if (available.length === 0) return '目前的候選課程找不到你說的主題。';
  const labels = available.map(item =>
    `「${item.term}」可以選 ${item.candidates.map(candidate => candidate.name).join('、')}`);
  stagePendingChange(identity, SAVED_TOPIC_CHOICE, { choices: available, replan });
  return `${labels.join('。')}。請告訴我你想保存或取消哪個主題。`;
}

export function resolveSavedTopicChoice(identity, args) {
  const pending = peekPendingChange(identity, SAVED_TOPIC_CHOICE);
  if (!pending || args.addTerms?.length || args.removeTerms?.length) return null;
  const { choices, replan } = pending.changes;
  const matches = choices.every(choice => {
    const ids = args[choice.action === 'add' ? 'addTagIds' : 'removeTagIds'];
    return Array.isArray(ids) && ids.some(id => choice.candidates.some(candidate => candidate.tagId === id));
  });
  const allKnown = ['add', 'remove'].every(action => {
    const ids = args[action === 'add' ? 'addTagIds' : 'removeTagIds'] ?? [];
    return Array.isArray(ids) && ids.every(id => choices.some(choice => choice.action === action
      && choice.candidates.some(candidate => candidate.tagId === id)));
  });
  if (!matches || !allKnown) return null;
  return consumePendingChange(identity, SAVED_TOPIC_CHOICE, pending.token) && { replan };
}
