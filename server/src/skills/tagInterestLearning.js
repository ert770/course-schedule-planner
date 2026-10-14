import { normalizeSemesterLabel } from '../data/activeTerm.js';
import { interestTagCatalog, resolveInterestTag, resolveInterestTags } from '../data/interestTagCatalog.js';
import { readInterestPreferences } from '../data/interestPreferences.js';
import { isRequiredForStudent } from './courseScope.js';

export const TAG_INTEREST_MODEL_VERSION = 'rag-tag-interest-v1';
export const TAG_INTEREST_SNAPSHOT_VERSION = 1;
export const TAG_INTEREST_HALF_LIFE_DAYS = 120;
export const TAG_INTEREST_STALE_TERM_FACTOR = 0.5;
export const TAG_INTEREST_PRIOR_MASS = 2;
export const TAG_INTEREST_EVENT_WEIGHTS = Object.freeze({
  explorationInterested: 1,
  highRating: 1,
  favorite: 1,
  voluntarySelection: 0.5,
  browse: 0.1,
  browsePerCourseCap: 0.15,
  explicitNotInterested: -1,
  contentWithdrawal: -1,
  // 歷史修課回饋（階段 5）：對修過的課表示喜歡／不喜歡；普通為 0。
  historyLiked: 1,
  historyDisliked: -1,
});

const catalogVersion = interestTagCatalog.catalogVersion;
const eligibilityVersion = interestTagCatalog.canonicalTags
  .find(tag => tag.eligibility?.version)?.eligibility.version ?? null;

function normalizeTagIds(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map(value => String(value ?? '').trim())
    .filter(Boolean))];
}

function normalizeTopic(value) {
  return String(value ?? '').trim().normalize('NFKC').toLocaleLowerCase('zh-Hant');
}

function categoryPathsFor(tag) {
  return (tag?.categoryAssignments ?? []).map(assignment => ({
    mainCategoryId: assignment.mainCategoryId,
    subcategoryId: assignment.subcategoryId,
  }));
}

function snapshotTag(resolved) {
  return {
    canonicalTagId: resolved.canonicalTagId,
    canonicalName: resolved.canonicalName,
    categoryPaths: (resolved.categoryPaths ?? []).map(path => ({
      mainCategoryId: path.mainCategoryId,
      subcategoryId: path.subcategoryId,
    })),
    crossCourseMatchEligible: resolved.eligibility?.crossCourseMatchEligible === true,
  };
}

function normalizedRawCourseTags(course) {
  if (Array.isArray(course?.ragTag)) return course.ragTag.map(value => String(value ?? '').trim()).filter(Boolean);
  if (typeof course?.ragTag === 'string') {
    try {
      const parsed = JSON.parse(course.ragTag);
      if (Array.isArray(parsed)) return parsed.map(value => String(value ?? '').trim()).filter(Boolean);
    } catch {
      return course.ragTag.split(/[,、，]/u).map(value => value.trim()).filter(Boolean);
    }
  }
  return [];
}

/**
 * Build a server-owned, versioned snapshot for a course-related interaction.
 * A required course with unresolved student scope fails closed: its rag_tag must
 * never teach this learner merely because the event source says "elective".
 */
export function buildTagInterestSnapshot(event, course, scope) {
  const base = {
    schemaVersion: TAG_INTEREST_SNAPSHOT_VERSION,
    modelVersion: TAG_INTEREST_MODEL_VERSION,
    catalogVersion,
    eligibilityVersion,
    course: {
      catalogCourseCode: event?.course?.catalogCourseCode ?? course?.catalogCourseCode ?? null,
      sectionId: event?.course?.sectionId ?? course?.sectionId ?? course?.id ?? null,
    },
    requiredStatus: 'not-required',
    exclusionReason: null,
    rawTags: [],
    tags: [],
    evidenceTagIds: [],
    feedbackResponse: event?.interestFeedback?.response ?? null,
  };

  if (!course) {
    return { ...base, requiredStatus: 'unknown', exclusionReason: 'course_not_resolved' };
  }
  if (course.category === '必修') {
    if (!scope?.resolved) {
      return { ...base, requiredStatus: 'unknown', exclusionReason: 'required_scope_unresolved' };
    }
    // 必修課一律不拿來推興趣：不論這門必修屬於本人或其他班級，修課／瀏覽
    // 都不是可靠的自願興趣訊號。scope 用來留下可稽核的排除原因；未知時 fail closed。
    return {
      ...base,
      requiredStatus: 'required',
      exclusionReason: isRequiredForStudent(course, scope)
        ? 'required_for_student'
        : 'required_course',
    };
  }
  // An explicit "required" source is an additional fail-closed signal. It is
  // never sufficient to classify a course as required on its own.
  if (event?.source === 'required') {
    return { ...base, requiredStatus: 'required', exclusionReason: 'required_event_source' };
  }

  const rawTags = normalizedRawCourseTags(course);
  const resolved = resolveInterestTags(rawTags).tags
    .filter(tag => tag.eligibility?.interestLearningEligible === true);
  const tags = resolved.map(snapshotTag);
  if (tags.length === 0) {
    return {
      ...base,
      exclusionReason: rawTags.length ? 'no_learning_eligible_tags' : 'course_has_no_tags',
      rawTags,
    };
  }

  let evidenceTagIds = tags.map(tag => tag.canonicalTagId);
  const feedback = event?.interestFeedback;
  if (event?.eventType === 'interest_exploration_feedback') {
    const chosenIds = normalizeTagIds(feedback?.canonicalTagIds);
    if (feedback?.response === 'interested' && chosenIds.length > 0) {
      evidenceTagIds = chosenIds;
    } else if (feedback?.response === 'not_interested') {
      if (chosenIds.length === 0) {
        throw new TypeError('明確表示不感興趣時，必須指定至少一個主題標籤');
      }
      evidenceTagIds = chosenIds;
    } else if (feedback?.response === 'learn_more') {
      evidenceTagIds = [];
    }

    const eligibleIds = new Set(tags.map(tag => tag.canonicalTagId));
    const invalid = evidenceTagIds.filter(id => !eligibleIds.has(id));
    if (invalid.length > 0) {
      throw new TypeError(`回饋標籤不屬於這門課的可學習標籤：${invalid.join('、')}`);
    }
  }

  return {
    ...base,
    rawTags,
    tags,
    evidenceTagIds,
    exclusionReason: evidenceTagIds.length === 0 ? 'no_learning_evidence' : null,
  };
}

function explicitInputs(prefs = {}) {
  const interestPrefs = readInterestPreferences(prefs);
  return [...new Set([...interestPrefs.interests, ...interestPrefs.preferredKeywords])];
}

/**
 * Convert explicit, user-selected terms to priors without expanding a broad
 * category over all of its descendant tags.
 */
export function buildExplicitTagInterest(prefs = {}) {
  const terms = explicitInputs(prefs);
  const categoryNames = new Map();
  for (const category of interestTagCatalog.mainCategories) {
    categoryNames.set(normalizeTopic(category.name), { type: 'main', category });
  }
  for (const category of interestTagCatalog.subcategories) {
    categoryNames.set(normalizeTopic(category.name), { type: 'sub', category });
  }

  const tagNames = new Map(
    interestTagCatalog.canonicalTags
      .filter(tag => tag.eligibility?.interestLearningEligible === true)
      .map(tag => [normalizeTopic(tag.name), tag])
  );
  const categories = new Map();
  const tagPriors = new Map();
  const unmappedTopics = [];

  for (const term of terms) {
    const key = normalizeTopic(term);
    const categoryMatch = categoryNames.get(key);
    if (categoryMatch?.type === 'main') {
      const item = categoryMatch.category;
      categories.set(`main:${item.id}`, {
        type: 'main', mainCategoryId: item.id, subcategoryId: null, name: item.name,
      });
      continue;
    }
    if (categoryMatch?.type === 'sub') {
      const item = categoryMatch.category;
      categories.set(`sub:${item.id}`, {
        type: 'subcategory', mainCategoryId: item.mainCategoryId,
        subcategoryId: item.id, name: item.name,
      });
      continue;
    }
    const tag = tagNames.get(key);
    if (tag) {
      tagPriors.set(tag.id, {
        canonicalTagId: tag.id, canonicalName: tag.name, prior: 1,
        categoryPaths: categoryPathsFor(tag),
        crossCourseMatchEligible: tag.eligibility?.crossCourseMatchEligible === true,
      });
    } else {
      unmappedTopics.push(term);
    }
  }

  return {
    explicitTopics: terms,
    categoryInterests: [...categories.values()],
    tagPriors: [...tagPriors.values()],
    unmappedTopics,
    priorMass: TAG_INTEREST_PRIOR_MASS,
  };
}

function courseKey(event) {
  if (event?.course?.catalogCourseCode) return `code:${event.course.catalogCourseCode}`;
  if (event?.course?.sectionId !== null && event?.course?.sectionId !== undefined) {
    return `section:${event.course.sectionId}`;
  }
  return null;
}

function sortEvents(events) {
  return [...events].sort((left, right) => (
    String(left.timestamp ?? '').localeCompare(String(right.timestamp ?? ''))
    || String(left.eventId ?? '').localeCompare(String(right.eventId ?? ''))
  ));
}

function termOrdinal(term) {
  const year = Number(term?.academicYear);
  const semester = normalizeSemesterLabel(term?.semester);
  if (!Number.isInteger(year) || year <= 0 || semester === null) return null;
  return year * 2 + (semester === 'second' ? 1 : 0);
}

export function tagInterestDecay(event, { now = null, activeTerm = null } = {}) {
  const timestamp = Date.parse(event?.timestamp ?? '');
  const ageDays = now === null || !Number.isFinite(timestamp)
    ? 0
    : Math.max(0, (new Date(now).getTime() - timestamp) / 86400000);
  const recency = Math.pow(0.5, ageDays / TAG_INTEREST_HALF_LIFE_DAYS);
  const eventTerm = termOrdinal(event?.term);
  const activeTermValue = termOrdinal(activeTerm);
  const oldTerm = eventTerm !== null && activeTermValue !== null && eventTerm < activeTermValue;
  return { factor: recency * (oldTerm ? TAG_INTEREST_STALE_TERM_FACTOR : 1), oldTerm };
}

function snapshotFor(event) {
  const snapshot = event?.tagInterestSnapshot;
  return snapshot?.schemaVersion === TAG_INTEREST_SNAPSHOT_VERSION
    && snapshot.modelVersion === TAG_INTEREST_MODEL_VERSION
    && snapshot.requiredStatus === 'not-required'
    && Array.isArray(snapshot.tags)
    && Array.isArray(snapshot.evidenceTagIds)
    ? snapshot
    : null;
}

// 事件快照保存的是事件當時的標籤 ID。目錄合併同義詞後（例：2026-10-14 合併 480 個標籤），
// 被併掉的 ID 不再存在；依快照中的標籤名稱解析到目前的標準標籤，避免使用者的互動證據流失。
// 目前目錄仍有的 ID 一律不變，所以沒有合併時行為完全相同。
const currentCatalogTagIds = new Set(interestTagCatalog.canonicalTags.map(tag => tag.id));
const remappedTagCache = new Map();
function currentTagFor(tag) {
  if (!tag?.canonicalTagId || currentCatalogTagIds.has(tag.canonicalTagId)) return tag;
  if (!remappedTagCache.has(tag.canonicalTagId)) {
    const resolved = resolveInterestTag(tag.canonicalName);
    remappedTagCache.set(tag.canonicalTagId, resolved.status === 'resolved'
      ? {
        ...tag,
        canonicalTagId: resolved.canonicalTagId,
        canonicalName: resolved.canonicalName,
        categoryPaths: resolved.categoryPaths.map(path => ({ mainCategoryId: path.mainCategoryId, subcategoryId: path.subcategoryId })),
        crossCourseMatchEligible: resolved.eligibility?.crossCourseMatchEligible === true,
      }
      : tag);
  }
  return remappedTagCache.get(tag.canonicalTagId);
}

function currentSnapshot(snapshot) {
  if (snapshot.tags.every(tag => currentCatalogTagIds.has(tag.canonicalTagId))) return snapshot;
  const mapping = new Map(snapshot.tags.map(tag => [tag.canonicalTagId, currentTagFor(tag)]));
  const tags = [...new Map([...mapping.values()].map(tag => [tag.canonicalTagId, tag])).values()];
  const evidenceTagIds = normalizeTagIds(snapshot.evidenceTagIds.map(id => mapping.get(id)?.canonicalTagId ?? id));
  return { ...snapshot, tags, evidenceTagIds };
}

function eventWeight(event) {
  const feedback = event?.interestFeedback?.response ?? event?.tagInterestSnapshot?.feedbackResponse;
  if (event?.eventType === 'history_course_feedback') {
    if (feedback === 'liked') return TAG_INTEREST_EVENT_WEIGHTS.historyLiked;
    if (feedback === 'disliked') return TAG_INTEREST_EVENT_WEIGHTS.historyDisliked;
    return 0;
  }
  if (event?.eventType === 'interest_exploration_feedback') {
    if (feedback === 'interested') return TAG_INTEREST_EVENT_WEIGHTS.explorationInterested;
    if (feedback === 'not_interested') return TAG_INTEREST_EVENT_WEIGHTS.explicitNotInterested;
    return 0;
  }
  if (event?.eventType === 'course_favorited') return TAG_INTEREST_EVENT_WEIGHTS.favorite;
  if (event?.eventType === 'course_rated' && Number(event.rating) >= 4) {
    return TAG_INTEREST_EVENT_WEIGHTS.highRating;
  }
  if (event?.eventType === 'course_selected'
    && event.source !== 'required'
    && ['explicit_selection', 'system_recommendation'].includes(event.source)) {
    return TAG_INTEREST_EVENT_WEIGHTS.voluntarySelection;
  }
  if (event?.eventType === 'recommendation_accepted' && event.course) {
    return TAG_INTEREST_EVENT_WEIGHTS.voluntarySelection;
  }
  if (event?.eventType === 'course_viewed') return TAG_INTEREST_EVENT_WEIGHTS.browse;
  if (event?.eventType === 'course_withdrawn' && event.feedbackReason === 'content') {
    return TAG_INTEREST_EVENT_WEIGHTS.contentWithdrawal;
  }
  return 0;
}

function invalidatedPositiveEvents(events) {
  const invalid = new Set();
  const withdraws = new Map();
  const unfavorites = new Map();
  for (const event of events) {
    const key = courseKey(event);
    if (!key) continue;
    if (event.eventType === 'course_withdrawn') {
      if (!withdraws.has(key)) withdraws.set(key, []);
      withdraws.get(key).push(event.timestamp);
    }
    if (event.eventType === 'course_unfavorited') {
      if (!unfavorites.has(key)) unfavorites.set(key, []);
      unfavorites.get(key).push(event.timestamp);
    }
  }
  for (const event of events) {
    if (!['course_viewed', 'course_selected', 'course_favorited', 'course_rated', 'recommendation_accepted'].includes(event.eventType)) {
      continue;
    }
    const key = courseKey(event);
    if (!key) continue;
    if ((withdraws.get(key) ?? []).some(time => time > event.timestamp)) invalid.add(event.eventId);
    if (event.eventType === 'course_favorited'
      && (unfavorites.get(key) ?? []).some(time => time > event.timestamp)) invalid.add(event.eventId);
  }
  return invalid;
}

/**
 * 依 rag-tag-interest-v1 的規則逐筆算出事件的有效權重（含失效、時間衰減與瀏覽上限）。
 * 標籤興趣檔與標籤空間使用者向量（userTagVector.js）共用這一份規則。
 * 回傳的 `weight` 已乘上衰減；正值為正向證據、負值為負向證據。
 */
export function collectWeightedTagInterestEvents(events = [], options = {}) {
  const now = options.now ?? null;
  const activeTerm = options.activeTerm ?? null;
  const sorted = sortEvents(Array.isArray(events) ? events : []);
  const invalidated = invalidatedPositiveEvents(sorted);
  // 歷史修課回饋以每門課最後一次回答為準（使用者改主意時，舊回答不再計入）。
  const latestHistoryFeedback = new Map();
  for (const event of sorted) {
    if (event.eventType === 'history_course_feedback') latestHistoryFeedback.set(courseKey(event), event.eventId);
  }
  const browseTotals = new Map();
  const items = [];
  let excludedEventCount = 0;

  for (const event of sorted) {
    if (event.eventType === 'history_course_feedback'
      && latestHistoryFeedback.get(courseKey(event)) !== event.eventId) continue;
    const original = snapshotFor(event);
    if (!original) {
      if (event.tagInterestSnapshot) excludedEventCount += 1;
      continue; // historical events without an immutable tag snapshot are not guessed
    }
    const snapshot = currentSnapshot(original);
    if (invalidated.has(event.eventId)) continue;
    const weight = eventWeight(event);
    if (weight === 0) continue;
    const course = courseKey(event);
    const tagIds = normalizeTagIds(snapshot.evidenceTagIds);
    if (tagIds.length === 0) continue;

    // 對修過的課的看法不會像瀏覽紀錄一樣隨時間淡化，歷史修課回饋不套用時間衰減；
    // 事件到期（180 天）後該課退回歷史修課的預設權重。
    const factor = event.eventType === 'history_course_feedback'
      ? 1
      : tagInterestDecay(event, { now, activeTerm }).factor;
    let effectiveWeight = weight * factor;
    if (event.eventType === 'course_viewed') {
      const used = browseTotals.get(course) ?? 0;
      const allowed = Math.max(0, TAG_INTEREST_EVENT_WEIGHTS.browsePerCourseCap - used);
      const nominal = Math.min(TAG_INTEREST_EVENT_WEIGHTS.browse, allowed);
      if (nominal <= 0) continue;
      browseTotals.set(course, used + nominal);
      effectiveWeight = nominal * factor;
    }
    items.push({ event, snapshot, tagIds, weight: effectiveWeight });
  }
  return { items, excludedEventCount };
}

/** Rebuild the sparse per-user profile from versioned event snapshots and explicit preferences. */
export function computeTagInterestProfile(events = [], prefs = {}, options = {}) {
  const priors = buildExplicitTagInterest(prefs);
  const evidence = new Map();
  let usableEventCount = 0;
  const { items, excludedEventCount } = collectWeightedTagInterestEvents(events, options);

  for (const { event, snapshot, tagIds, weight: effectiveWeight } of items) {
    const split = effectiveWeight / tagIds.length;
    for (const id of tagIds) {
      const tagSnapshot = snapshot.tags.find(tag => tag.canonicalTagId === id);
      if (!tagSnapshot) continue;
      const current = evidence.get(id) ?? {
        canonicalTagId: id,
        canonicalName: tagSnapshot.canonicalName,
        categoryPaths: tagSnapshot.categoryPaths ?? [],
        crossCourseMatchEligible: tagSnapshot.crossCourseMatchEligible === true,
        positiveEvidence: 0,
        negativeEvidence: 0,
        positiveEventCount: 0,
        negativeEventCount: 0,
        lastEventAt: null,
        sources: new Set(),
      };
      if (split > 0) {
        current.positiveEvidence += split;
        current.positiveEventCount += 1;
      } else {
        current.negativeEvidence += Math.abs(split);
        current.negativeEventCount += 1;
      }
      current.sources.add(event.eventType);
      current.lastEventAt = event.timestamp;
      evidence.set(id, current);
    }
    usableEventCount += 1;
  }

  const priorById = new Map(priors.tagPriors.map(tag => [tag.canonicalTagId, tag]));
  const ids = new Set([...evidence.keys(), ...priorById.keys()]);
  const tagInterests = [...ids].map(id => {
    const observed = evidence.get(id);
    const prior = priorById.get(id);
    const tag = observed ?? {
      canonicalTagId: id,
      canonicalName: prior.canonicalName,
      categoryPaths: prior.categoryPaths,
      crossCourseMatchEligible: prior.crossCourseMatchEligible,
      positiveEvidence: 0,
      negativeEvidence: 0,
      positiveEventCount: 0,
      negativeEventCount: 0,
      lastEventAt: null,
      sources: new Set(),
    };
    const p0 = prior?.prior ?? 0;
    const denominator = TAG_INTEREST_PRIOR_MASS + tag.positiveEvidence + tag.negativeEvidence;
    const score = denominator > 0
      ? (TAG_INTEREST_PRIOR_MASS * p0 + tag.positiveEvidence - tag.negativeEvidence) / denominator
      : 0;
    return {
      canonicalTagId: id,
      canonicalName: tag.canonicalName,
      categoryPaths: tag.categoryPaths,
      crossCourseMatchEligible: tag.crossCourseMatchEligible,
      prior: p0,
      positiveEvidence: Number(tag.positiveEvidence.toFixed(6)),
      negativeEvidence: Number(tag.negativeEvidence.toFixed(6)),
      positiveEventCount: tag.positiveEventCount,
      negativeEventCount: tag.negativeEventCount,
      score: Number(score.toFixed(6)),
      lastEventAt: tag.lastEventAt,
      sources: [...tag.sources].sort(),
      hasEvidence: tag.positiveEvidence + tag.negativeEvidence > 0,
    };
  }).sort((left, right) => left.canonicalTagId.localeCompare(right.canonicalTagId));

  return {
    modelVersion: TAG_INTEREST_MODEL_VERSION,
    catalogVersion,
    eligibilityVersion,
    categoryInterests: priors.categoryInterests,
    explicitTopics: priors.explicitTopics,
    unmappedExplicitTopics: priors.unmappedTopics,
    tagInterests,
    summary: {
      usableEventCount,
      tagCount: tagInterests.length,
      evidenceTagCount: tagInterests.filter(tag => tag.hasEvidence).length,
      crossCourseMatchTagCount: tagInterests.filter(tag => tag.crossCourseMatchEligible).length,
      excludedEventCount,
    },
    parameters: {
      halfLifeDays: TAG_INTEREST_HALF_LIFE_DAYS,
      staleTermFactor: TAG_INTEREST_STALE_TERM_FACTOR,
      priorMass: TAG_INTEREST_PRIOR_MASS,
      eventWeights: TAG_INTEREST_EVENT_WEIGHTS,
    },
  };
}

/** Score a new course from cross-course eligible canonical tags only. */
export function scoreCourseTagInterest(profile, rawTags) {
  const resolved = resolveInterestTags(rawTags).tags
    .filter(tag => tag.eligibility?.crossCourseMatchEligible === true);
  if (resolved.length === 0) {
    return {
      score: null,
      eligibleTagCount: 0,
      evidenceTagCount: 0,
      matchedTags: [],
      reason: 'no_cross_course_match_tags',
    };
  }

  const interests = new Map((profile?.tagInterests ?? [])
    .map(tag => [tag.canonicalTagId, tag]));
  const matchedTags = resolved.map(tag => {
    const interest = interests.get(tag.canonicalTagId);
    return {
      canonicalTagId: tag.canonicalTagId,
      canonicalName: tag.canonicalName,
      score: interest?.score ?? 0,
      hasEvidence: interest?.hasEvidence === true || (interest?.prior ?? 0) > 0,
    };
  });
  return {
    score: Number((matchedTags.reduce((sum, tag) => sum + tag.score, 0) / matchedTags.length).toFixed(6)),
    eligibleTagCount: matchedTags.length,
    evidenceTagCount: matchedTags.filter(tag => tag.hasEvidence).length,
    matchedTags: matchedTags.filter(tag => tag.score !== 0),
    reason: 'scored',
  };
}

export default {
  TAG_INTEREST_MODEL_VERSION,
  TAG_INTEREST_SNAPSHOT_VERSION,
  buildTagInterestSnapshot,
  buildExplicitTagInterest,
  tagInterestDecay,
  collectWeightedTagInterestEvents,
  computeTagInterestProfile,
  scoreCourseTagInterest,
};
