import crypto from 'node:crypto';
import { normalizeSemesterLabel } from './activeTerm.js';

// Roadmap #29：這個模組只定義 interaction event 的資料契約、版本遷移、
// 驗證與 idempotency 純邏輯。它刻意不接 API、不寫檔、不寫 MySQL；正式蒐集
// 必須先完成 #33 的 consent／匿名化／保存規則，再由 #2 接上產品埋點。
export const INTERACTION_EVENT_SCHEMA_VERSION = 1;

// roadmap #10 任務 3A：方案特徵向量 φ 的定義版本。**刻意與 `SCORING_POLICY_VERSION` 分開**——
// 評分規則的版本與 φ 的定義版本是兩件事，φ 改了但評分沒改（或反之）都可能發生，混用會讓
// 「這批特徵能不能餵給學習器」無法判定。
export const PLAN_FEATURE_VERSION = 'plan-feature-v1';
const SUPPORTED_PLAN_FEATURE_VERSIONS = new Set([PLAN_FEATURE_VERSION]);

// 供 service 層判定「這筆曝光的特徵能不能餵給學習器」。把集合本身留在模組內，
// 呼叫端只問是非，不要各自維護一份版本清單。
export function isSupportedPlanFeatureVersion(version) {
  return SUPPORTED_PLAN_FEATURE_VERSIONS.has(version);
}
const PLAN_FEATURE_AXES = Object.freeze(['interest', 'compact', 'easy']);

export const INTERACTION_EVENT_TYPES = Object.freeze({
  RECOMMENDATION_EXPOSED: 'recommendation_exposed',
  COURSE_VIEWED: 'course_viewed',
  COURSE_FAVORITED: 'course_favorited',
  COURSE_UNFAVORITED: 'course_unfavorited',
  COURSE_SELECTED: 'course_selected',
  COURSE_DESELECTED: 'course_deselected',
  RECOMMENDATION_ACCEPTED: 'recommendation_accepted',
  // roadmap #10 任務 3A：真正的 set-wise choice——使用者在**看得到多個方案**的情況下
  // 挑了其中一個。與 `recommendation_accepted` 刻意分成兩個型別而不是加旗標：後者包含
  // 「Agent 只顯示主推方案、使用者說好」這種情況，那只代表接受推薦，不能證明使用者
  // 比較過整組方案。混在同一個型別裡，日後就再也分不出哪些能餵給 Choice Perceptron。
  PLAN_CHOSEN: 'plan_chosen',
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

// Roadmap #27：一次推薦可能同時顯示好幾個方案（方案切換列），使用者接受的
// 不一定是 `plan`（主推）那一個。`displayedPlanIds` 記下**這次曝光實際顯示過
// 的每一個方案 id**，讓 `interactionEventService.assertProvenance()` 判斷
// `recommendation_accepted` 時不會誤判「使用者切到別的方案再接受」是偽造。
function normalizePlanIdList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(asTrimmedString).filter(Boolean))];
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

// #7 對 v1 增加的附加欄位：歷史事件可缺席；新事件依 scoring policy 版本回放。

// ---------------------------------------------------------------------------
// roadmap #10 任務 3B-0：signed weight 的休眠契約
// ---------------------------------------------------------------------------
// Choice Perceptron 產生的是**三軸都帶號**的權重，而現行 `planPolicies[].weights`
// 的值域只允許 `easy` 為負（見下方 validate）。CP 一旦套用，曝光事件就會驗證失敗被拒，
// 而 `plan_chosen` 需要真實曝光佐證——等於 CP 啟用的那一刻切斷自己的訓練資料來源。
//
// 因此先把契約準備好，但**維持 v2 的形狀完全不變**：
//
//   - `weightMode` 缺席 ＝ `boost`，套用今天的值域。v2 **不輸出這個欄位**。
//     （`resolveScoringPolicy()` 的回傳同時出現在課表 API 的 `generationPolicy` 與曝光事件的
//     `planPolicies`，多一個 key 兩邊都不可能與改動前 deep-equal，所以連 `weightMode: null`
//     都不行——正規化時用條件展開，不是固定建欄位。）
//   - `signed` 三軸皆 `[-2, 2]`（`CHOICE_WEIGHT_LIMIT` 的投影界線）。
//
// **三個版本軸互不相干，不可互相代用**：`planPolicies[].version` 管評分／權重契約、
// `source.modelVersion` 管偏好學習模型、`planFeatureVersion` 管特徵格式（φ）。
// 所以這裡**不**用 `isSupportedPlanFeatureVersion()` 判 signed。
export const PLAN_POLICY_WEIGHT_MODES = Object.freeze({ BOOST: 'boost', SIGNED: 'signed' });

// 目前沒有任何正式路徑會產生這個 scoring policy 版本——它是休眠的，
// 只讓 schema 認得。`resolveScoringPolicy()` 不得產生它。
const SIGNED_SCORING_POLICY_VERSIONS = new Set(['personalized-scoring-v3-signed']);
const SIGNED_LEARNER_VERSIONS = new Set(['choice-perceptron-v1']);
const SIGNED_WEIGHT_LIMIT = 2;

// `signed` 必須三項條件同時成立，缺一不可。呼叫端光是送 `weightMode: 'signed'`
// 不會生效：曝光事件只有伺服器寫得進來（`allowExposureWrite`），而 `weightMode`
// 由 `buildExposureDraft()` 依它剛才實際用的 scoring policy 推導。
function planPolicyWeightRange(policy) {
  if (policy.weightMode === undefined) {
    return { ok: true, min: axis => (axis === 'easy' ? -3 : 0), max: 3 };
  }
  if (policy.weightMode !== PLAN_POLICY_WEIGHT_MODES.SIGNED) return { ok: false };
  if (!SIGNED_SCORING_POLICY_VERSIONS.has(policy.version)) return { ok: false };
  if (!SIGNED_LEARNER_VERSIONS.has(policy.source?.modelVersion)) return { ok: false };
  return { ok: true, min: () => -SIGNED_WEIGHT_LIMIT, max: SIGNED_WEIGHT_LIMIT };
}

function normalizePlanPolicies(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return value;
  return value.map(item => {
    // **條件展開，不是固定建欄位。** 寫成 `weightMode: asTrimmedString(...)` 會讓 v2 得到
    // `weightMode: null`，曝光 JSON 與課表 API 就都多一個 key，不可能 deep-equal。
    const weightMode = asTrimmedString(item?.weightMode);
    return {
    planId: asTrimmedString(item?.planId), variantId: asTrimmedString(item?.variantId),
    version: asTrimmedString(item?.version),
    ...(weightMode === null ? {} : { weightMode }),
    weights: Object.fromEntries(['interest', 'compact', 'easy'].map(axis => [axis, item?.weights?.[axis]])),
    categoryCoefficient: item?.categoryCoefficient,
    creditCoefficient: item?.creditCoefficient,
    stopWhen: asTrimmedString(item?.stopWhen),
    archetype: asTrimmedString(item?.archetype),
    solver: item?.solver && typeof item.solver === 'object' ? {
      method: asTrimmedString(item.solver.method),
      category: asTrimmedString(item.solver.category),
      rawStatus: asTrimmedString(item.solver.rawStatus),
      approximate: item.solver.approximate,
    } : null,
    source: { learnedApplied: item?.source?.learnedApplied,
      reason: asTrimmedString(item?.source?.reason), modelVersion: asTrimmedString(item?.source?.modelVersion) },
    };
  });
}

// roadmap #10 任務 3A：Choice Perceptron 的特徵向量 φ(x, y)。與 `planPolicies` **並列**而不是
// 合併進去：policy 是「生成這個方案用了什麼權重」（輸入），features 是「生成出來的方案量到
// 什麼」（輸出）；而且 `assertProvenance()` 拿 planPolicies 當契約用，把測量值塞進契約會讓
// 「policy 對不上」與「特徵缺一軸」變成同一種錯誤。舊事件沒有這個欄位，視為空陣列。
//
// `easy` 允許為 null（該方案排入的課全無評價證據，見 scheduler.js 的 getEasiness()）；
// `interest`／`compact` 不得為 null——它們對空課表也回 0，真的缺值代表上游壞了。
function normalizePlanFeatures(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return value;
  return value.map(item => ({
    planId: asTrimmedString(item?.planId),
    variantId: asTrimmedString(item?.variantId),
    ...Object.fromEntries(PLAN_FEATURE_AXES.map(axis => [axis, item?.[axis] ?? null])),
  }));
}

function normalizeExposureContext(context) {
  if (!context || typeof context !== 'object' || Array.isArray(context)) return null;
  return {
    surface: asTrimmedString(context.surface),
    trigger: asTrimmedString(context.trigger),
    candidateSet: normalizeCourseRefList(context.candidateSet),
    displayedSet: normalizeCourseRefList(context.displayedSet),
    // roadmap #27：省略時（例如遷移前寫入的舊事件）視為空陣列，
    // `assertProvenance()` 會另外 fallback 到 `plan.planId` 維持相容。
    displayedPlanIds: normalizePlanIdList(context.displayedPlanIds),
    planPolicies: normalizePlanPolicies(context.planPolicies),
    planFeatureVersion: asTrimmedString(context.planFeatureVersion),
    planFeatures: normalizePlanFeatures(context.planFeatures),
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

  // `plan_chosen` 的語意是「在這組方案裡選了這一個」，所以方案是必填；
  // 課程層級的欄位無意義，帶了就是形狀不對。
  if (event.eventType === INTERACTION_EVENT_TYPES.PLAN_CHOSEN) {
    if (!event.plan?.planId) errors.push('plan_chosen 必須指定 plan.planId');
    if (event.course !== null) errors.push('plan_chosen 不得帶 course');
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
    const policies = event.exposureContext.planPolicies;
    if (!Array.isArray(policies) || policies.length > 6) {
      errors.push('planPolicies 必須是至多 6 筆的陣列');
    } else {
      const seenPlans = new Set();
      for (const policy of policies) {
        // `weightMode` 缺席＝`boost`（今天唯一的情況）；`signed` 另需版本相符，見上方說明。
        // `Number.isFinite()` 本身就擋掉 NaN、Infinity 與字串。
        const range = planPolicyWeightRange(policy);
        if (!policy.planId || !event.exposureContext.displayedPlanIds.includes(policy.planId)
          || seenPlans.has(policy.planId) || !policy.variantId || !policy.version
          || !range.ok
          || !Object.entries(policy.weights).every(([axis, value]) => Number.isFinite(value)
            && value >= range.min(axis) && value <= range.max)
          || ![0.35, 1].includes(policy.categoryCoefficient)
          || ![1, 3].includes(policy.creditCoefficient)
          || !['no-credit-progress', 'candidate-exhausted', 'milp-optimized'].includes(policy.stopWhen)
          || (policy.archetype && !['balanced', 'easy', 'challenge', 'interest', 'compact'].includes(policy.archetype))
          || (policy.solver && (
            policy.solver.method !== 'dinkelbach-milp'
            || !['optimal', 'limit-with-solution'].includes(policy.solver.category)
            || typeof policy.solver.approximate !== 'boolean'
          ))
          || typeof policy.source.learnedApplied !== 'boolean') {
          errors.push('planPolicies 含無效方案、版本或權重');
        }
        seenPlans.add(policy.planId);
      }
    }
    // roadmap #10 任務 3A：φ 的三態相容規則。
    // (a) 沒有版本也沒有特徵 → 合法的舊事件，但不得用於 Choice Perceptron；
    // (b) 有支援的版本 → `displayedPlanIds` 與 `planFeatures[].planId` 必須一對一完全相符
    //     （公式需要「其餘方案的平均」，少一筆就不是同一個 query set）；
    // (c) 有版本但只覆蓋一部分 → 直接拒絕，不靜默略過。靜默略過會讓「上游壞掉」與
    //     「這批資料不能用」變成同一種沉默。
    const features = event.exposureContext.planFeatures;
    const featureVersion = event.exposureContext.planFeatureVersion;
    if (!featureVersion) {
      if (Array.isArray(features) && features.length > 0) {
        errors.push('planFeatures 必須搭配 planFeatureVersion');
      }
    } else if (!SUPPORTED_PLAN_FEATURE_VERSIONS.has(featureVersion)) {
      errors.push('planFeatureVersion 不在支援清單');
    } else if (!Array.isArray(features) || features.length > 6) {
      errors.push('planFeatures 必須是至多 6 筆的陣列');
    } else {
      const displayedIds = event.exposureContext.displayedPlanIds;
      const policyByPlanId = new Map(
        (event.exposureContext.planPolicies || [])
          .filter(policy => policy?.planId)
          .map(policy => [policy.planId, policy])
      );
      const seenFeaturePlans = new Set();
      for (const feature of features) {
        const policy = policyByPlanId.get(feature.planId);
        if (!feature.planId || !displayedIds.includes(feature.planId)
          || seenFeaturePlans.has(feature.planId) || !feature.variantId
          // policy 可缺席（放寬階梯與 fallback 方案沒有 generationPolicy，但照樣被展示、
          // 照樣是 query set 的一員）；有 policy 時才比對 variantId 一致性。
          || (policy && policy.variantId !== feature.variantId)
          || !PLAN_FEATURE_AXES.every(axis => {
            const value = feature[axis];
            if (axis === 'easy' && value === null) return true;
            return Number.isFinite(value) && value >= 0 && value <= 1;
          })) {
          errors.push('planFeatures 含無效方案或特徵值');
        }
        seenFeaturePlans.add(feature.planId);
      }
      if (seenFeaturePlans.size !== displayedIds.length) {
        errors.push('planFeatures 必須與 displayedPlanIds 一對一對應');
      }
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
  // roadmap #10 任務 3A：`plan_chosen` 用專屬 payload，唯一性只由 requestId + eventType
  // 決定（subject 由資料庫的 `(subject_id, idempotency_key)` UNIQUE 索引另外界定）。
  // **刻意不含被選方案**：一次詢問只能產生一次學習更新，否則使用者先選 A 再改選 B 會
  // 算出兩個不同的 key、兩筆都寫得進去，同一個 query set 就被學了兩次。改選另一個方案
  // 會撞到同一個 key 而被判為 conflict，那正是我們要的語意。
  if (event.eventType === INTERACTION_EVENT_TYPES.PLAN_CHOSEN) {
    return {
      schemaVersion: event.schemaVersion,
      requestId: event.requestId,
      eventType: event.eventType,
    };
  }
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


/**
 * `course_withdrawn` 的確定性 actionId。
 *
 * 同一次移除可能由兩條路徑各記一次：使用者在畫面上按移除（`POST /api/interactions`），
 * 以及他接著在 Chat 講同一件事（Agent 的 `record_schedule_feedback`）。前端用的是隨機
 * UUID，而 `canonicalIdempotencyPayload()` 把 `actionId` 算進 key，兩邊因此永遠撞不到
 * 同一個鍵，同一個動作會被寫成兩筆。
 *
 * 解法與 `plan_chosen` 相同：識別碼由**伺服器**依 `(requestId, sectionId)` 決定，
 * 呼叫端送什麼都覆寫。兩個 service 共用這一份，不各自複製種子字串——複製的那天
 * 起，兩邊只要有一邊改了格式就會靜默地又變成兩筆。
 */
export function courseWithdrawalActionId(requestId, sectionId) {
  const hex = crypto.createHash('sha256')
    .update(`course-withdrawn:${requestId}|${sectionId}`)
    .digest('hex');
  return [
    hex.slice(0, 8), hex.slice(8, 12), `4${hex.slice(13, 16)}`,
    `8${hex.slice(17, 20)}`, hex.slice(20, 32),
  ].join('-');
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

  // `course_withdrawn` 用專屬比較，只看「誰、哪一次、哪門課、什麼原因」。
  //
  // 理由是兩條路徑的 `source` 本來就不同：UI 依課程動態決定（`courseSource()` 會回
  // `required`／`system_recommendation`／`explicit_selection`），Agent 固定寫
  // `system_recommendation`。把 `source` 納入比較的話，移除一門正式必修時即使
  // `actionId` 與原因都一樣，也會被判成 `conflict`——那不是衝突，是同一件事的兩種記法。
  // `versionSnapshot` 同理：它是伺服器當下的版本，跨部署重送不該變成衝突。
  //
  // **`feedbackReason` 仍然比較**：使用者改了說法是真的衝突，不該靜默覆蓋。
  if (normalized.eventType === INTERACTION_EVENT_TYPES.COURSE_WITHDRAWN) {
    return {
      schemaVersion: normalized.schemaVersion,
      eventType: normalized.eventType,
      userId: normalized.userId,
      requestId: normalized.requestId,
      actionId: normalized.actionId,
      course: normalized.course ? { sectionId: normalized.course.sectionId } : null,
      feedbackReason: normalized.feedbackReason,
    };
  }

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
  courseWithdrawalActionId,
  createInteractionEvent,
  resolveIdempotentAppend,
};
