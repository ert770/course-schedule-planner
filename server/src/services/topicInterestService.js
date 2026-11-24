// Agent 讀取與修改課程主題偏好（ADR-037，2026-11-24）。
//
// 課程主題偏好驅動三個分數：s_tag（主題問答勾選＋互動事件，`tagInterestLearning.js`）、
// s_vec（標籤向量，`userTagVector.js`）、s_cf（全體共現表，`itemItemCf.js`）。這裡提供：
//   - 把使用者的話（「資安」「生成式 AI」）對到他候選課程裡可勾選的主題代號；
//   - 加入／移除主題問答勾選（`interestSelections`）——s_tag 先驗與 s_vec 明確興趣的唯一來源；
//   - 「不想再排 X」：用既有的 `interest_exploration_feedback / not_interested` 事件記一筆負向
//     訊號（使用者決定不新增排除欄位）；
//   - 讀取目前的主題興趣與單門課的 s_tag／s_vec／s_cf 拆解。
// s_cf 不提供寫入：共現表是全體學生彙總的，改它會影響所有人。

import crypto from 'node:crypto';
import { resolveInterestTags, interestTagCatalog } from '../data/interestTagCatalog.js';
import { normalizeInterestTag } from '../data/interestTagVocabulary.js';
import { isSelectableInterestTag } from '../data/interestTagEligibility.js';
import { getInterestCategoryCandidates } from '../data/interestTopicGroups.js';
import { normalizeInterestSelections, readInterestPreferences } from '../data/interestPreferences.js';
import { ACTIVE_TERM } from '../data/activeTerm.js';
import { getInterestTopicGroups } from './interestMenuService.js';
import { sanitizeInterestSelectionsForSave } from './interestSelectionService.js';
import { buildSelectionSummary } from './interestQuestionnaireService.js';
import { updateUserPreferences } from './memoryService.js';
import { recordInteractionEvents } from './interactionEventService.js';
import { getTagInterestProfile } from './tagInterestService.js';
import { scoreCourseTagInterest } from '../skills/tagInterestLearning.js';
import { resolveInterestAlphas } from '../skills/interestAlphas.js';

const LEVEL_BY_GROUP = Object.freeze({ department: 'sub', generalEducation: 'main', outside: 'main' });
const GROUP_ORDER = Object.freeze(['department', 'generalEducation', 'outside']);
const MATCH_LIMIT = 10;
const ALL_TAGS = 100_000;

const tagById = new Map(interestTagCatalog.canonicalTags.map(tag => [tag.id, tag]));

export function scopeFiltersOf(prefs = {}) {
  return {
    department: prefs.department ?? null,
    gradeLevel: prefs.gradeLevel ?? null,
    className: prefs.className ?? null,
  };
}

function rawTagsOf(course) {
  const value = course?.ragTag;
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

function isTooCommon(tag) {
  return tag?.eligibility?.exclusionReason === 'too_common';
}

/**
 * 使用者候選課程裡出現的主題：可勾選的（含候選課數）與太常見的（只能單次帶進排課）。
 */
export function collectPoolTags(courses = []) {
  const selectable = new Map();
  const tooCommon = new Map();
  for (const course of courses) {
    for (const tag of resolveInterestTags(rawTagsOf(course)).tags) {
      if (isSelectableInterestTag(tag)) {
        if (!selectable.has(tag.canonicalTagId)) {
          selectable.set(tag.canonicalTagId, { tagId: tag.canonicalTagId, name: tag.canonicalName, courseCount: 0 });
        }
        selectable.get(tag.canonicalTagId).courseCount += 1;
      } else if (isTooCommon(tag)) {
        tooCommon.set(tag.canonicalTagId, { tagId: tag.canonicalTagId, name: tag.canonicalName });
      }
    }
  }
  return { selectable, tooCommon };
}

// 標籤的所有寫法（標準名稱＋原始寫法），已正規化。
function surfaceKeys(tagId) {
  const tag = tagById.get(tagId);
  if (!tag) return [];
  const forms = [tag.name, ...tag.categoryAssignments.flatMap(item => item.sourceRows.map(row => row.rawTag))];
  // 正規化版本給中文包含比對；保留空白的小寫版本給英文整字比對（正規化會拿掉空白）。
  return [...new Set([
    ...forms.map(normalizeInterestTag),
    ...forms.map(form => String(form ?? '').normalize('NFKC').toLowerCase().trim()),
  ].filter(Boolean))];
}

/**
 * 把使用者的一句話對到候選課程裡的主題。完全相同（標準名稱、別名、原始寫法）優先；
 * 其次是互相包含（「資安」→「資訊安全」不會命中，但「安全」「資訊安全」會互相命中）。
 * 太常見的主題另外列出，不能長期保存（ADR-026）。
 */
export function findTopicTags(term, poolTags) {
  const key = normalizeInterestTag(term);
  if (!key) return { exact: null, matches: [], tooCommon: [] };

  const exactId = resolveInterestTags([term]).tags[0]?.canonicalTagId ?? null;
  if (exactId && poolTags.selectable.has(exactId)) {
    return { exact: poolTags.selectable.get(exactId), matches: [poolTags.selectable.get(exactId)], tooCommon: [] };
  }

  // 太常見的完全相符（「AI」→人工智慧）不能存，但仍列出相近、可以存的主題（例如生成式AI）讓使用者選。
  // 英文字要整個字相符（「AI」不能命中 Sustainability、Blockchain）；中文用包含比對。
  const asciiTerm = /^[a-z0-9]+$/.test(key);
  const asciiPattern = asciiTerm ? new RegExp(`(^|[^a-z0-9])${key}([^a-z0-9]|$)`) : null;
  const contains = candidateKey => (asciiTerm
    ? asciiPattern.test(candidateKey)
    : candidateKey.includes(key) || (key.length >= 2 && key.includes(candidateKey) && candidateKey.length >= 2));
  const matches = [...poolTags.selectable.values()]
    .filter(item => surfaceKeys(item.tagId).some(contains))
    .sort((a, b) => b.courseCount - a.courseCount || a.name.localeCompare(b.name, 'zh-Hant'))
    .slice(0, MATCH_LIMIT);
  const tooCommon = [...new Set([
    ...(exactId && poolTags.tooCommon.has(exactId) ? [poolTags.tooCommon.get(exactId).name] : []),
    ...[...poolTags.tooCommon.values()].filter(item => surfaceKeys(item.tagId).some(contains)).map(item => item.name),
  ])];
  const exactIsTooCommon = Boolean(exactId && poolTags.tooCommon.has(exactId));
  return { exact: !exactIsTooCommon && matches.length === 1 ? matches[0] : null, matches, tooCommon };
}

/**
 * 找一個能放這個主題、而且保存驗證會接受的 `(group, categoryId)`：
 * 使用者已經有的方向優先，其次本系、通識、系外。
 */
export function locateTagCategory(tagId, menu, existing = []) {
  const tag = tagById.get(tagId);
  if (!tag || !menu?.grouped) return null;
  const containsTag = (group, categoryId) => getInterestCategoryCandidates(
    menu.grouped[group] ?? [], LEVEL_BY_GROUP[group], categoryId, { limit: ALL_TAGS },
  ).tags.some(item => item.tagId === tagId);

  const candidates = [];
  for (const group of GROUP_ORDER) {
    for (const assignment of tag.categoryAssignments) {
      const categoryId = LEVEL_BY_GROUP[group] === 'sub' ? assignment.subcategoryId : assignment.mainCategoryId;
      if (categoryId && !candidates.some(item => item.group === group && item.categoryId === categoryId)) {
        candidates.push({ group, categoryId });
      }
    }
  }
  const owned = candidates.filter(item => existing.some(entry => entry.group === item.group && entry.categoryId === item.categoryId));
  for (const item of [...owned, ...candidates]) {
    if (containsTag(item.group, item.categoryId)) return { ...item, level: LEVEL_BY_GROUP[item.group] };
  }
  return null;
}

function currentSelections(prefs) {
  return normalizeInterestSelections(readInterestPreferences(prefs).interestSelections ?? []);
}

function topicNamesOf(selections) {
  return [...new Set(selections.flatMap(item => item.tagIds).map(id => tagById.get(id)?.name ?? id))];
}

/** 加入主題：併進對應方向，經保存驗證後整份寫回。 */
export async function addTopics(identity, prefs, tagIds, deps = {}) {
  const {
    getMenu = getInterestTopicGroups,
    sanitize = sanitizeInterestSelectionsForSave,
    updatePreferences = updateUserPreferences,
  } = deps;
  const filters = scopeFiltersOf(prefs);
  const menu = await getMenu(filters);
  if (!menu?.scopeReady) {
    return { added: [], skipped: tagIds.map(id => ({ tagId: id, reason: '還沒設定系所、年級或班別，無法確認候選課程' })) };
  }
  const previous = currentSelections(prefs);
  const next = previous.map(item => ({ ...item, tagIds: [...item.tagIds] }));
  const skipped = [];
  for (const tagId of tagIds) {
    if (next.some(item => item.tagIds.includes(tagId))) continue;
    const place = locateTagCategory(tagId, menu, next);
    if (!place) {
      skipped.push({ tagId, reason: '這個主題不在你目前的候選課程裡' });
      continue;
    }
    const entry = next.find(item => item.group === place.group && item.categoryId === place.categoryId);
    if (entry) entry.tagIds.push(tagId);
    else next.push({ group: place.group, categoryId: place.categoryId, level: place.level, mode: 'direct', tagIds: [tagId] });
  }

  const result = await sanitize({ selections: next, previousSelections: previous, filters }, { getMenu: async () => menu });
  if (result.status === 'unverified') {
    return { added: [], skipped: tagIds.map(id => ({ tagId: id, reason: '目前無法確認候選課程，沒有寫入' })) };
  }
  const saved = result.selections;
  const savedIds = new Set(saved.flatMap(item => item.tagIds));
  const beforeIds = new Set(previous.flatMap(item => item.tagIds));
  const added = tagIds.filter(id => savedIds.has(id) && !beforeIds.has(id));
  for (const warning of result.warnings) {
    if (warning.tagId && tagIds.includes(warning.tagId)) skipped.push({ tagId: warning.tagId, reason: '保存驗證未通過' });
  }
  if (added.length > 0) {
    await updatePreferences(identity, { interestSelections: saved });
    if (prefs) Object.assign(prefs, { interestSelections: saved });
  }
  return { added, skipped, selections: saved };
}

/**
 * 移除主題：拿掉勾選，方向空了就整個刪掉。**不經保存驗證**：移除不會加入任何未驗證的東西，
 * 而驗證在候選池載不到時會把舊標籤放回去，移除會靜默失效。
 */
export async function removeTopics(identity, prefs, tagIds, deps = {}) {
  const { updatePreferences = updateUserPreferences } = deps;
  const previous = currentSelections(prefs);
  const drop = new Set(tagIds);
  const removed = tagIds.filter(id => previous.some(item => item.tagIds.includes(id)));
  if (removed.length === 0) return { removed: [], selections: previous };
  // 只刪「因為這次移除而變空」的方向。原本就只選方向、沒勾主題的項目要保留——
  // 2026-11-24 瀏覽器實測時一併刪掉了它們，D1249697 的方向從 12 個掉到 9 個。
  const next = previous
    .map(item => {
      const kept = item.tagIds.filter(id => !drop.has(id));
      return { item: { ...item, tagIds: kept }, emptied: kept.length === 0 && item.tagIds.length > 0 };
    })
    .filter(entry => !entry.emptied)
    .map(entry => entry.item);
  await updatePreferences(identity, { interestSelections: next });
  if (prefs) Object.assign(prefs, { interestSelections: next });
  return { removed, selections: next };
}

// 跟 `courseWithdrawalActionId()` 同一個做法：同一位使用者、同一個主題、同一學期只算一次。
function notInterestedActionId(identity, tagId) {
  const hex = crypto.createHash('sha256')
    .update(`topic-not-interested:${identity?.canonicalId}|${tagId}|${ACTIVE_TERM.academicYear}|${ACTIVE_TERM.semester}`)
    .digest('hex');
  return [hex.slice(0, 8), hex.slice(8, 12), `4${hex.slice(13, 16)}`, `8${hex.slice(17, 20)}`, hex.slice(20, 32)].join('-');
}

/**
 * 記一筆「對這個主題沒興趣」（既有的 `interest_exploration_feedback / not_interested`）。
 * 事件必須掛在一門帶有該主題、不是必修的課上：每個主題挑課號最小的那門，結果才穩定。
 * 副作用：那門課會被探索頁視為不推薦（`userTagVector.js` 的 rejectedCourseCodes）。
 */
export async function recordNotInterested(identity, prefs, tagIds, deps = {}) {
  const { getMenu = getInterestTopicGroups, recordEvents = recordInteractionEvents } = deps;
  const menu = await getMenu(scopeFiltersOf(prefs));
  const courses = (menu?.courses ?? []).filter(course => course.category !== '必修' && course.catalogCourseCode);
  const drafts = [];
  const anchors = [];
  const unanchored = [];
  for (const tagId of tagIds) {
    const carriers = courses
      .filter(course => resolveInterestTags(rawTagsOf(course)).tags
        .some(tag => tag.canonicalTagId === tagId && tag.eligibility?.interestLearningEligible === true))
      .sort((a, b) => String(a.catalogCourseCode).localeCompare(String(b.catalogCourseCode))
        || Number(a.sectionId ?? a.id) - Number(b.sectionId ?? b.id));
    const course = carriers[0];
    if (!course) {
      unanchored.push(tagId);
      continue;
    }
    const actionId = notInterestedActionId(identity, tagId);
    anchors.push({ tagId, courseName: course.name, catalogCourseCode: course.catalogCourseCode });
    drafts.push({
      eventType: 'interest_exploration_feedback',
      requestId: actionId,
      actionId,
      course: { catalogCourseCode: course.catalogCourseCode, sectionId: Number(course.sectionId ?? course.id) },
      term: { academicYear: ACTIVE_TERM.academicYear, semester: ACTIVE_TERM.semester },
      source: 'exploration',
      feedbackReason: null,
      interestFeedback: { response: 'not_interested', canonicalTagIds: [tagId] },
      versionSnapshot: { recommendationReasonVersion: null },
    });
  }
  if (drafts.length === 0) return { recorded: [], unanchored, reason: unanchored.length ? 'NO_CARRIER_COURSE' : null };
  const result = await recordEvents(identity, drafts);
  if (result?.recorded === false) {
    return { recorded: [], unanchored, reason: result.reason ?? 'NOT_RECORDED' };
  }
  const ok = new Set((result?.results ?? [])
    .filter(item => item.status === 'append' || item.status === 'duplicate')
    .map(item => item.actionId));
  return {
    recorded: anchors.filter((_, index) => ok.has(drafts[index].actionId)),
    unanchored,
    reason: null,
  };
}

function round(value, digits = 3) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

/**
 * 目前的主題興趣（只讀）：勾選的主題、s_tag 最高與最低的主題；給 `sectionId` 時加上該課的
 * s_tag／s_vec／s_cf 拆解。s_vec 是相對候選池 95 百分位的分數，因此用使用者整個候選池算。
 */
export async function describeTopicInterests(identity, prefs, { sectionId = null } = {}, deps = {}) {
  const {
    getMenu = getInterestTopicGroups,
    getProfile = getTagInterestProfile,
    loadVectorScores = null,
    loadCf = null,
    alphas = resolveInterestAlphas(),
  } = deps;
  const selections = currentSelections(prefs);
  const summary = buildSelectionSummary(null, selections);
  const learned = await getProfile(identity, { prefs });
  const tagInterests = learned?.profile?.tagInterests ?? [];
  const scored = tagInterests.filter(item => Number.isFinite(item.score) && (item.hasEvidence || item.prior > 0));
  const describe = item => ({
    name: item.canonicalName,
    score: round(item.score),
    fromSelection: item.prior > 0,
    positiveEvents: item.positiveEventCount ?? 0,
    negativeEvents: item.negativeEventCount ?? 0,
  });
  const out = {
    personalizationConsent: learned?.consented === true,
    selectedDirections: [...new Set(summary.directions.map(item => item.title))],
    selectedTopics: topicNamesOf(selections),
    strongestTopics: [...scored].sort((a, b) => b.score - a.score).filter(item => item.score > 0).slice(0, 8).map(describe),
    weakestTopics: [...scored].sort((a, b) => a.score - b.score).filter(item => item.score < 0).slice(0, 5).map(describe),
    weights: { s_tag: alphas.tag, s_vec: alphas.vec, s_cf: alphas.cf },
  };
  if (sectionId === null || sectionId === undefined) return out;

  const menu = await getMenu(scopeFiltersOf(prefs));
  const pool = menu?.courses ?? [];
  const course = pool.find(item => Number(item.sectionId ?? item.id) === Number(sectionId));
  if (!course) {
    return { ...out, course: { sectionId: Number(sectionId), error: '這門課不在使用者目前的候選課程裡，無法拆解分數。' } };
  }
  const tag = scoreCourseTagInterest(learned?.profile, rawTagsOf(course));
  let vector = { source: 'unavailable' };
  if (loadVectorScores) {
    const scores = await loadVectorScores(identity, prefs, pool);
    const entry = scores?.scores?.get?.(course.catalogCourseCode);
    vector = entry
      ? { source: scores.source, score: round(entry.score), positive: round(entry.positive), negative: round(entry.negative) }
      : { source: scores?.source ?? 'unavailable' };
  }
  let cf = { source: 'unavailable' };
  if (loadCf) {
    const context = await loadCf(identity, prefs, [course], { mode: 'active' });
    const entry = context?.coursesBySectionId?.[Number(course.sectionId ?? course.id)];
    cf = {
      source: context?.source ?? 'unavailable',
      score: round(entry?.score ?? null),
      note: context?.source === 'empty_table' || context?.source === 'unavailable'
        ? '同學選課的共現表目前沒有資料，這一項沒有作用。' : null,
    };
  }
  return {
    ...out,
    // 放進 `courses` 讓忠實度帳本認得這門課的課名（回答「為什麼推薦〈課名〉」時會提到）。
    // matchedPreferences 是 s_tag 命中的主題，讓「它符合你的主題偏好」這類說法有證據可對。
    courses: [{
      sectionId: Number(course.sectionId ?? course.id),
      name: course.name,
      recommendationReason: { matchedPreferences: tag.matchedTags.filter(item => item.score > 0).map(item => item.canonicalName) },
    }],
    course: {
      sectionId: Number(course.sectionId ?? course.id),
      name: course.name,
      s_tag: { score: round(tag.score), matchedTopics: tag.matchedTags.map(item => ({ name: item.canonicalName, score: round(item.score) })) },
      s_vec: vector,
      s_cf: cf,
    },
  };
}

// 移除時先比對使用者已勾選的主題：有些勾選來自策畫選項的太常見標籤（例如機器學習），
// 在一般候選清單裡找不到，但使用者說「不想再排機器學習」時一定要拿得掉。
function findSelectedTags(term, selections) {
  const key = normalizeInterestTag(term);
  if (!key) return [];
  const asciiTerm = /^[a-z0-9]+$/.test(key);
  const pattern = asciiTerm ? new RegExp(`(^|[^a-z0-9])${key}([^a-z0-9]|$)`) : null;
  const selected = [...new Set(selections.flatMap(item => item.tagIds))];
  return selected
    .filter(tagId => surfaceKeys(tagId).some(candidate => (asciiTerm ? pattern.test(candidate) : candidate.includes(key))))
    .map(tagId => ({ tagId, name: tagById.get(tagId)?.name ?? tagId }));
}

/**
 * `update_topic_interests` 的主流程。任何一個詞對不到唯一主題時**完全不寫入**，回 `needsChoice`
 * 讓 Agent 問使用者，再用 tagIds 呼叫一次——避免一半寫入、一半沒寫的狀態。
 */
export async function updateTopicInterests(identity, prefs, args = {}, deps = {}) {
  const { getMenu = getInterestTopicGroups } = deps;
  const addTerms = (args.addTerms ?? []).filter(Boolean);
  const removeTerms = (args.removeTerms ?? []).filter(Boolean);
  const addTagIds = new Set(args.addTagIds ?? []);
  const removeTagIds = new Set(args.removeTagIds ?? []);
  const notInterested = args.recordNotInterested !== false;

  const menu = await getMenu(scopeFiltersOf(prefs));
  const poolTags = collectPoolTags(menu?.courses ?? []);
  const selections = currentSelections(prefs);
  const needsChoice = [];
  const tooCommon = [];

  for (const term of addTerms) {
    const found = findTopicTags(term, poolTags);
    if (found.exact) addTagIds.add(found.exact.tagId);
    else if (found.matches.length > 0) needsChoice.push({ term, action: 'add', candidates: found.matches });
    else if (found.tooCommon.length === 0) needsChoice.push({ term, action: 'add', candidates: [] });
    if (found.tooCommon.length > 0 && !found.exact) tooCommon.push({ term, topics: found.tooCommon });
  }
  for (const term of removeTerms) {
    const selected = findSelectedTags(term, selections);
    if (selected.length > 0) {
      for (const item of selected) removeTagIds.add(item.tagId);
      continue;
    }
    const found = findTopicTags(term, poolTags);
    if (found.exact) removeTagIds.add(found.exact.tagId);
    else if (found.matches.length > 0) needsChoice.push({ term, action: 'remove', candidates: found.matches });
    else needsChoice.push({ term, action: 'remove', candidates: [] });
  }

  // 只剩太常見主題的「加入」不算要選：它本來就不能存，照實說明就好。
  const blocking = needsChoice.filter(item => item.candidates.length > 0 || !tooCommon.some(entry => entry.term === item.term));
  if (blocking.length > 0) {
    return {
      needsChoice: blocking.map(item => ({
        term: item.term,
        action: item.action,
        candidates: item.candidates.map(({ tagId, name, courseCount }) => ({ tagId, name, courseCount })),
      })),
      tooCommon,
      message: '有詞對不到唯一的主題，什麼都還沒寫入。請把候選念給使用者選（沒有候選代表他的候選課程裡沒有這個主題），'
        + '再用 addTagIds／removeTagIds 呼叫一次。',
    };
  }

  const added = addTagIds.size > 0 ? await addTopics(identity, prefs, [...addTagIds], deps) : { added: [], skipped: [] };
  const removed = removeTagIds.size > 0 ? await removeTopics(identity, prefs, [...removeTagIds], deps) : { removed: [] };
  const negative = notInterested && removeTagIds.size > 0
    ? await recordNotInterested(identity, prefs, [...removeTagIds], deps)
    : null;
  const nameOf = id => tagById.get(id)?.name ?? id;
  const changed = added.added.length > 0 || removed.removed.length > 0 || (negative?.recorded?.length ?? 0) > 0;

  return {
    // 沒有任何變更不算失敗（例如只說了太常見的主題），不回 success:false，否則忠實度檢查會要求揭露「操作失敗」。
    ...(changed ? { success: true } : { noChange: true }),
    added: added.added.map(nameOf),
    notAdded: added.skipped.map(item => ({ topic: nameOf(item.tagId), reason: item.reason })),
    removed: removed.removed.map(nameOf),
    notInterestedRecorded: (negative?.recorded ?? []).map(item => ({ topic: nameOf(item.tagId), viaCourse: item.courseName })),
    notInterestedSkipped: negative
      ? [
        ...(negative.reason === 'CONSENT_NOT_GRANTED'
          ? [...removeTagIds].map(id => ({ topic: nameOf(id), reason: '使用者沒有同意個人化學習，無法記錄「沒興趣」，只拿掉了勾選' }))
          : []),
        ...negative.unanchored.map(id => ({ topic: nameOf(id), reason: '候選課程裡沒有可以記錄這個主題的課（或它是太常見的主題），只拿掉了勾選' })),
      ]
      : [],
    tooCommon,
    selectedTopics: topicNamesOf(currentSelections(prefs)),
  };
}

export default {
  findTopicTags, collectPoolTags, locateTagCategory, addTopics, removeTopics, recordNotInterested,
  describeTopicInterests, updateTopicInterests,
};
