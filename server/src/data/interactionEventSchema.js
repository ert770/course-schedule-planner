import crypto from 'node:crypto';
import { normalizeSemesterLabel } from './activeTerm.js';

// Roadmap #29：這個模組只定義 interaction event 的資料契約、版本遷移、
// 驗證與 idempotency 純邏輯。它刻意不接 API、不寫檔、不寫 MySQL；正式蒐集
// 必須先完成 #33 的 consent／匿名化／保存規則，再由 #2 接上產品埋點。
export const INTERACTION_EVENT_SCHEMA_VERSION = 1;

export const INTERACTION_EVENT_TYPES = Object.freeze({
  RECOMMENDATION_EXPOSED: 'recommendation_exposed',
  COURSE_VIEWED: 'course_viewed',
  COURSE_FAVORITED: 'course_favorited',
  COURSE_UNFAVORITED: 'course_unfavorited',
  COURSE_SELECTED: 'course_selected',
  COURSE_DESELECTED: 'course_deselected',
  RECOMMENDATION_ACCEPTED: 'recommendation_accepted',
  COURSE_REMOVED: 'course_removed',
  COURSE_WITHDRAWN: 'course_withdrawn',
  SCHEDULE_REGENERATED: 'schedule_regenerated',
});

export const INTERACTION_SOURCES = Object.freeze({
  EXPLICIT_SELECTION: 'explicit_selection',
  REQUIRED: 'required',
  SYSTEM_RECOMMENDATION: 'system_recommendation',
  EXPLORATION: 'exploration',
});

export const INTERACTION_FEEDBACK_REASONS = Object.freeze({
  TIME: 'time',
  CONTENT: 'content',
  INSTRUCTOR: 'instructor',
  WORKLOAD: 'workload',
  FULL: 'full',
  ELIGIBILITY: 'eligibility',
  OTHER: 'other',
});

export const INTERACTION_SURFACES = Object.freeze({
  DASHBOARD: 'dashboard',
  SCHEDULE: 'schedule',
  SEARCH: 'search',
  CHAT: 'chat',
});

export const INTERACTION_TRIGGERS = Object.freeze({
  INITIAL_LOAD: 'initial_load',
  MANUAL_GENERATE: 'manual_generate',
  PREFERENCE_REGENERATE: 'preference_regenerate',
  CHAT_TOOL: 'chat_tool',
  COURSE_SEARCH: 'course_search',
});

const EVENT_TYPE_SET = new Set(Object.values(INTERACTION_EVENT_TYPES));
const SOURCE_SET = new Set(Object.values(INTERACTION_SOURCES));
const FEEDBACK_REASON_SET = new Set(Object.values(INTERACTION_FEEDBACK_REASONS));
const SURFACE_SET = new Set(Object.values(INTERACTION_SURFACES));
const TRIGGER_SET = new Set(Object.values(INTERACTION_TRIGGERS));

const COURSE_REQUIRED_EVENTS = new Set([
  INTERACTION_EVENT_TYPES.COURSE_VIEWED,
  INTERACTION_EVENT_TYPES.COURSE_FAVORITED,
  INTERACTION_EVENT_TYPES.COURSE_UNFAVORITED,
  INTERACTION_EVENT_TYPES.COURSE_SELECTED,
  INTERACTION_EVENT_TYPES.COURSE_DESELECTED,
  INTERACTION_EVENT_TYPES.COURSE_REMOVED,
  INTERACTION_EVENT_TYPES.COURSE_WITHDRAWN,
]);

const FEEDBACK_EVENTS = new Set([
  INTERACTION_EVENT_TYPES.COURSE_REMOVED,
  INTERACTION_EVENT_TYPES.COURSE_WITHDRAWN,
]);

const SOURCE_REQUIRED_EVENTS = new Set([
  ...COURSE_REQUIRED_EVENTS,
  INTERACTION_EVENT_TYPES.RECOMMENDATION_EXPOSED,
  INTERACTION_EVENT_TYPES.RECOMMENDATION_ACCEPTED,
]);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const IDEMPOTENCY_KEY_PATTERN = /^sha256:[0-9a-f]{64}$/u;

function asTrimmedString(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function asPositiveInteger(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : value;
}

function normalizeCourseRef(course) {
  if (!course || typeof course !== 'object' || Array.isArray(course)) return null;
  return {
    catalogCourseCode: asTrimmedString(course.catalogCourseCode),
    sectionId: asPositiveInteger(course.sectionId),
  };
}

function normalizeCourseRefList(value) {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeCourseRef);
}

function normalizePlan(plan) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) return null;
  return {
    planId: asTrimmedString(plan.planId),
    variantId: asTrimmedString(plan.variantId),
  };
}

function normalizePosition(position) {
  if (!position || typeof position !== 'object' || Array.isArray(position)) {
    return { planRank: null, courseRank: null };
  }
  return {
    planRank: asPositiveInteger(position.planRank),
    courseRank: asPositiveInteger(position.courseRank),
  };
}

function normalizeTerm(term) {
  if (!term || typeof term !== 'object' || Array.isArray(term)) {
    return { academicYear: null, semester: null };
  }
  const academicYear = Number(term.academicYear);
  return {
    academicYear: Number.isInteger(academicYear) && academicYear > 0
      ? academicYear
      : term.academicYear ?? null,
    semester: normalizeSemesterLabel(term.semester),
  };
}

function normalizeExposureContext(context) {
  if (!context || typeof context !== 'object' || Array.isArray(context)) return null;
  return {
    surface: asTrimmedString(context.surface),
    trigger: asTrimmedString(context.trigger),
    candidateSet: normalizeCourseRefList(context.candidateSet),
    displayedSet: normalizeCourseRefList(context.displayedSet),
  };
}

function normalizeVersionSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return {
      profileSchemaVersion: null,
      modelVersion: null,
      recommendationReasonVersion: null,
    };
  }
  const profileSchemaVersion = Number(snapshot.profileSchemaVersion);
  return {
    profileSchemaVersion: Number.isInteger(profileSchemaVersion) && profileSchemaVersion > 0
      ? profileSchemaVersion
      : snapshot.profileSchemaVersion ?? null,
    modelVersion: asTrimmedString(snapshot.modelVersion),
    recommendationReasonVersion: asTrimmedString(snapshot.recommendationReasonVersion),
  };
}

export function normalizeInteractionEvent(event = {}) {
  return {
    schemaVersion: Number(event.schemaVersion),
    eventId: asTrimmedString(event.eventId),
    eventType: asTrimmedString(event.eventType),
    userId: asTrimmedString(event.userId),
    timestamp: asTrimmedString(event.timestamp),
    requestId: asTrimmedString(event.requestId),
    actionId: asTrimmedString(event.actionId),
    idempotencyKey: asTrimmedString(event.idempotencyKey),
    course: normalizeCourseRef(event.course),
    term: normalizeTerm(event.term),
    plan: normalizePlan(event.plan),
    position: normalizePosition(event.position),
    exposureContext: normalizeExposureContext(event.exposureContext),
    versionSnapshot: normalizeVersionSnapshot(event.versionSnapshot),
    source: asTrimmedString(event.source),
    feedbackReason: asTrimmedString(event.feedbackReason),
  };
}

// v0 不是曾經持久化過的正式格式，而是 #29 以前可能出現在測試或呼叫端的
// 無版本 flat draft。保留明確 migration，未來真的升級 schema 時才不會把
// 「缺 schemaVersion」與「最新版資料」混為一談。
export function migrateInteractionEventV0ToV1(event = {}) {
  return normalizeInteractionEvent({
    ...event,
    schemaVersion: INTERACTION_EVENT_SCHEMA_VERSION,
    timestamp: event.timestamp ?? event.occurredAt,
    course: event.course ?? (
      event.catalogCourseCode !== undefined || event.sectionId !== undefined
        ? { catalogCourseCode: event.catalogCourseCode, sectionId: event.sectionId }
        : null
    ),
    term: event.term ?? {
      academicYear: event.academicYear,
      semester: event.semester,
    },
    plan: event.plan ?? (
      event.planId !== undefined || event.variantId !== undefined
        ? { planId: event.planId, variantId: event.variantId }
        : null
    ),
    position: event.position ?? {
      planRank: event.planRank,
      courseRank: event.courseRank,
    },
    versionSnapshot: event.versionSnapshot ?? {
      profileSchemaVersion: event.profileSchemaVersion,
      modelVersion: event.modelVersion,
      recommendationReasonVersion: event.recommendationReasonVersion,
    },
    feedbackReason: event.feedbackReason ?? event.reason,
  });
}

export function migrateInteractionEvent(event = {}) {
  const version = event?.schemaVersion;
  if (version === undefined || version === null || Number(version) === 0) {
    return migrateInteractionEventV0ToV1(event);
  }
  if (Number(version) === INTERACTION_EVENT_SCHEMA_VERSION) {
    return normalizeInteractionEvent(event);
  }
  throw new RangeError(`不支援的 interaction event schemaVersion：${JSON.stringify(version)}`);
}

function validateCourseRef(course, path, errors) {
  if (!course || typeof course !== 'object' || Array.isArray(course)) {
    errors.push(`${path} 必須是課程識別物件`);
    return;
  }
  if (typeof course.catalogCourseCode !== 'string' || !course.catalogCourseCode.trim()) {
    errors.push(`${path}.catalogCourseCode 必須是非空字串`);
  }
  if (!Number.isInteger(course.sectionId) || course.sectionId <= 0) {
    errors.push(`${path}.sectionId 必須是正整數`);
  }
}

function validateCourseRefList(list, path, errors) {
  if (!Array.isArray(list)) {
    errors.push(`${path} 必須是陣列`);
    return;
  }
  const seen = new Set();
  list.forEach((course, index) => {
    validateCourseRef(course, `${path}[${index}]`, errors);
    if (Number.isInteger(course?.sectionId)) {
      if (seen.has(course.sectionId)) errors.push(`${path} 不得包含重複 sectionId：${course.sectionId}`);
      seen.add(course.sectionId);
    }
  });
}

function isIsoTimestamp(value) {
  if (typeof value !== 'string') return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

export function validateInteractionEvent(input) {
  const errors = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { valid: false, errors: ['InteractionEvent 必須是物件'] };
  }

  const event = normalizeInteractionEvent(input);
  if (event.schemaVersion !== INTERACTION_EVENT_SCHEMA_VERSION) {
    errors.push(`schemaVersion 必須是 ${INTERACTION_EVENT_SCHEMA_VERSION}`);
  }
  if (!UUID_PATTERN.test(event.eventId || '')) errors.push('eventId 必須是 UUID');
  if (!EVENT_TYPE_SET.has(event.eventType)) errors.push('eventType 不在允許清單');
  if (!event.userId) errors.push('userId 必須是非空 canonical ID');
  if (!isIsoTimestamp(event.timestamp)) errors.push('timestamp 必須是 UTC ISO 8601 格式');
  if (!UUID_PATTERN.test(event.requestId || '')) errors.push('requestId 必須是 UUID');
  if (!UUID_PATTERN.test(event.actionId || '')) errors.push('actionId 必須是 UUID');
  if (!IDEMPOTENCY_KEY_PATTERN.test(event.idempotencyKey || '')) {
    errors.push('idempotencyKey 必須是 sha256:<64 hex>');
  }

  if (!Number.isInteger(event.term.academicYear) || event.term.academicYear <= 0) {
    errors.push('term.academicYear 必須是正整數');
  }
  if (!['first', 'second'].includes(event.term.semester)) {
    errors.push('term.semester 必須是 first 或 second');
  }

  if (event.plan !== null) {
    if (!event.plan.planId) errors.push('plan.planId 必須是非空字串');
    if (!event.plan.variantId) errors.push('plan.variantId 必須是非空字串');
  }
  for (const [field, value] of Object.entries(event.position)) {
    if (value !== null && (!Number.isInteger(value) || value <= 0)) {
      errors.push(`position.${field} 必須是從 1 起算的正整數或 null`);
    }
  }

  if (!Number.isInteger(event.versionSnapshot.profileSchemaVersion)
    || event.versionSnapshot.profileSchemaVersion <= 0) {
    errors.push('versionSnapshot.profileSchemaVersion 必須是正整數');
  }
  if (!event.versionSnapshot.modelVersion) {
    errors.push('versionSnapshot.modelVersion 必須是非空字串');
  }
  if (event.versionSnapshot.recommendationReasonVersion !== null
    && typeof event.versionSnapshot.recommendationReasonVersion !== 'string') {
    errors.push('versionSnapshot.recommendationReasonVersion 必須是字串或 null');
  }

  if (SOURCE_REQUIRED_EVENTS.has(event.eventType) && !SOURCE_SET.has(event.source)) {
    errors.push('此 eventType 必須提供允許的 source');
  } else if (event.source !== null && !SOURCE_SET.has(event.source)) {
    errors.push('source 不在允許清單');
  }

  if (COURSE_REQUIRED_EVENTS.has(event.eventType)) {
    validateCourseRef(event.course, 'course', errors);
  } else if (event.course !== null) {
    validateCourseRef(event.course, 'course', errors);
  }

  if (event.eventType === INTERACTION_EVENT_TYPES.RECOMMENDATION_ACCEPTED
    && event.course === null && event.plan === null) {
    errors.push('recommendation_accepted 必須指定 course 或 plan');
  }

  if (FEEDBACK_EVENTS.has(event.eventType)) {
    if (event.feedbackReason !== null && !FEEDBACK_REASON_SET.has(event.feedbackReason)) {
      errors.push('feedbackReason 不在允許清單');
    }
  } else if (event.feedbackReason !== null) {
    errors.push('只有 course_removed／course_withdrawn 可提供 feedbackReason');
  }

  if (event.eventType === INTERACTION_EVENT_TYPES.RECOMMENDATION_EXPOSED) {
    if (!event.exposureContext) {
      errors.push('recommendation_exposed 必須提供 exposureContext');
    }
  }
  if (event.exposureContext) {
    if (!SURFACE_SET.has(event.exposureContext.surface)) {
      errors.push('exposureContext.surface 不在允許清單');
    }
    if (!TRIGGER_SET.has(event.exposureContext.trigger)) {
      errors.push('exposureContext.trigger 不在允許清單');
    }
    validateCourseRefList(event.exposureContext.candidateSet, 'exposureContext.candidateSet', errors);
    validateCourseRefList(event.exposureContext.displayedSet, 'exposureContext.displayedSet', errors);

    const candidateIds = new Set(
      event.exposureContext.candidateSet
        .filter(Boolean)
        .map(course => course.sectionId)
    );
    for (const displayed of event.exposureContext.displayedSet) {
      if (displayed && !candidateIds.has(displayed.sectionId)) {
        errors.push(`displayedSet 的 sectionId ${displayed.sectionId} 不在 candidateSet`);
      }
    }
  }

  return { valid: errors.length === 0, errors, event };
}

function canonicalIdempotencyPayload(event) {
  return {
    schemaVersion: event.schemaVersion,
    requestId: event.requestId,
    actionId: event.actionId,
    eventType: event.eventType,
    plan: event.plan
      ? { planId: event.plan.planId, variantId: event.plan.variantId }
      : null,
    course: event.course
      ? {
          catalogCourseCode: event.course.catalogCourseCode,
          sectionId: event.course.sectionId,
        }
      : null,
  };
}

export function buildInteractionIdempotencyKey(input) {
  const event = normalizeInteractionEvent(input);
  const digest = crypto.createHash('sha256')
    .update(JSON.stringify(canonicalIdempotencyPayload(event)))
    .digest('hex');
  return `sha256:${digest}`;
}

export function createInteractionEvent(identity, input = {}, options = {}) {
  if (!identity?.canonicalId) {
    throw new TypeError('建立 interaction event 需要 authenticated canonical identity');
  }

  const randomUUID = options.randomUUID || crypto.randomUUID;
  const now = options.now || (() => new Date());
  const timestampValue = now();
  const timestamp = timestampValue instanceof Date
    ? timestampValue.toISOString()
    : new Date(timestampValue).toISOString();

  // userId、eventId、timestamp、schemaVersion 與 idempotencyKey 全由 server 建立；
  // 即使 input 帶入同名欄位也會被覆寫，避免偽造身分或事件發生時間。
  const event = normalizeInteractionEvent({
    ...input,
    schemaVersion: INTERACTION_EVENT_SCHEMA_VERSION,
    eventId: randomUUID(),
    userId: String(identity.canonicalId),
    timestamp,
    idempotencyKey: null,
  });
  event.idempotencyKey = buildInteractionIdempotencyKey(event);

  const validation = validateInteractionEvent(event);
  if (!validation.valid) {
    throw new TypeError(`InteractionEvent 驗證失敗：${validation.errors.join('；')}`);
  }
  return validation.event;
}

function comparableEvent(event) {
  const normalized = normalizeInteractionEvent(event);
  // eventId 與 timestamp 是每次 server 嘗試建立時產生的 envelope 欄位；重送
  // 同一 logical action 時可以不同，不得因此繞過 idempotency。
  return {
    schemaVersion: normalized.schemaVersion,
    eventType: normalized.eventType,
    userId: normalized.userId,
    requestId: normalized.requestId,
    actionId: normalized.actionId,
    course: normalized.course,
    term: normalized.term,
    plan: normalized.plan,
    position: normalized.position,
    exposureContext: normalized.exposureContext,
    versionSnapshot: normalized.versionSnapshot,
    source: normalized.source,
    feedbackReason: normalized.feedbackReason,
  };
}

export function resolveIdempotentAppend(existingEvents, input) {
  if (!Array.isArray(existingEvents)) {
    throw new TypeError('existingEvents 必須是陣列');
  }
  const validation = validateInteractionEvent(input);
  if (!validation.valid) {
    throw new TypeError(`InteractionEvent 驗證失敗：${validation.errors.join('；')}`);
  }
  const event = validation.event;
  const existing = existingEvents.find(item => (
    String(item.userId) === String(event.userId)
    && item.idempotencyKey === event.idempotencyKey
  ));

  if (!existing) {
    return {
      status: 'append',
      event,
      events: [...existingEvents, event],
    };
  }

  const samePayload = JSON.stringify(comparableEvent(existing))
    === JSON.stringify(comparableEvent(event));
  return {
    status: samePayload ? 'duplicate' : 'conflict',
    event: existing,
    events: existingEvents,
  };
}

export default {
  INTERACTION_EVENT_SCHEMA_VERSION,
  INTERACTION_EVENT_TYPES,
  INTERACTION_SOURCES,
  INTERACTION_FEEDBACK_REASONS,
  INTERACTION_SURFACES,
  INTERACTION_TRIGGERS,
  normalizeInteractionEvent,
  migrateInteractionEventV0ToV1,
  migrateInteractionEvent,
  validateInteractionEvent,
  buildInteractionIdempotencyKey,
  createInteractionEvent,
  resolveIdempotentAppend,
};
