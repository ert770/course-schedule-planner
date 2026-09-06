import { v5 as uuidv5 } from 'uuid';
import {
  createInteractionEvent,
  INTERACTION_EVENT_TYPES,
  INTERACTION_FEEDBACK_REASONS,
  INTERACTION_SOURCES,
} from './interactionEventSchema.js';
import { PROFILE_SCHEMA_VERSION } from './profileSchema.js';
import { SCORING_POLICY_VERSION } from '../skills/scoringPolicy.js';
import { learnPreferenceWeights } from '../skills/preferenceLearning.js';

export const DEMO_REFERENCE_TIME = '2026-09-06T04:00:00.000Z';
export const DEMO_EVENT_COUNT_PER_PERSONA = 50;
export const DEMO_UUID_NAMESPACE = 'f8dd4c66-ef59-4fe2-92dd-08e8754beeed';

export const DEMO_PERSONAS = Object.freeze([
  {
    userId: 2,
    name: '黃廷崴',
    historyFileName: '修課成績資料_黃廷威.md',
    preferenceTags: ['#盡量集中排課', '#不排早八'],
    signal: {
      axis: 'compact',
      eventType: INTERACTION_EVENT_TYPES.COURSE_WITHDRAWN,
      source: INTERACTION_SOURCES.EXPLICIT_SELECTION,
      feedbackReason: INTERACTION_FEEDBACK_REASONS.TIME,
    },
  },
  {
    userId: 3,
    name: '陳彥齊',
    historyFileName: '修課成績資料_陳彥齊.md',
    preferenceTags: ['#挑戰難課', '#學到許多知識'],
    signal: {
      axis: 'interest',
      eventType: INTERACTION_EVENT_TYPES.COURSE_VIEWED,
      source: INTERACTION_SOURCES.SYSTEM_RECOMMENDATION,
      feedbackReason: null,
    },
  },
  {
    userId: 4,
    studentId: 'D1249196',
    name: '黃思瑋',
    historyFileName: '修課成績資料_黃思瑋.md',
    preferenceTags: ['#涼課優先', '#期末報告為主'],
    signal: {
      axis: 'easy',
      eventType: INTERACTION_EVENT_TYPES.COURSE_WITHDRAWN,
      source: INTERACTION_SOURCES.EXPLICIT_SELECTION,
      feedbackReason: INTERACTION_FEEDBACK_REASONS.WORKLOAD,
    },
  },
]);

function deterministicUuid(value) {
  return uuidv5(value, DEMO_UUID_NAMESPACE);
}

export function demoPersonaCanonicalId(persona) {
  return String(persona?.studentId ?? persona?.userId ?? '');
}

export function buildDemoPersonaEvents(persona, courseRefs, {
  count = DEMO_EVENT_COUNT_PER_PERSONA,
  referenceTime = DEMO_REFERENCE_TIME,
} = {}) {
  if (!persona || !Number.isInteger(persona.userId)) throw new TypeError('缺少 demo persona userId');
  if (!Array.isArray(courseRefs) || courseRefs.length === 0) throw new TypeError('至少需要一門真實課程');

  const identity = {
    canonicalId: demoPersonaCanonicalId(persona),
    numericId: String(persona.userId),
  };
  const referenceMs = new Date(referenceTime).getTime();
  if (!Number.isFinite(referenceMs)) throw new TypeError('referenceTime 必須是有效時間');

  return Array.from({ length: count }, (_, index) => {
    const course = courseRefs[index % courseRefs.length];
    const eventTime = new Date(referenceMs - (count - index - 1) * 6 * 60 * 60 * 1000);
    const prefix = `demo-persona-${persona.userId}-${index + 1}`;
    return createInteractionEvent(identity, {
      eventType: persona.signal.eventType,
      requestId: deterministicUuid(`${prefix}-request`),
      actionId: deterministicUuid(`${prefix}-action`),
      course: {
        catalogCourseCode: String(course.catalogCourseCode),
        sectionId: Number(course.sectionId),
      },
      term: { academicYear: 114, semester: 'second' },
      position: { planRank: null, courseRank: (index % 10) + 1 },
      versionSnapshot: {
        profileSchemaVersion: PROFILE_SCHEMA_VERSION,
        modelVersion: SCORING_POLICY_VERSION,
        recommendationReasonVersion: 'recommendation-reason-v1',
      },
      source: persona.signal.source,
      feedbackReason: persona.signal.feedbackReason,
    }, {
      randomUUID: () => deterministicUuid(`${prefix}-event`),
      now: () => eventTime,
    });
  });
}

export function learnDemoPersonaWeights(persona, events, {
  referenceTime = DEMO_REFERENCE_TIME,
} = {}) {
  return learnPreferenceWeights(events, {
    // 與 preferenceLearningService.deriveExplicitProfile() 相同：目前只有 compact
    // 標籤會成為學習先驗；easy 的方向由排課標籤處理，權重仍只從事件學強度。
    explicitProfile: {
      interest: 0,
      compact: persona.preferenceTags.includes('#盡量集中排課') ? 1 : 0,
      easy: 0,
    },
    now: referenceTime,
    activeTerm: { academicYear: 114, semester: 'second' },
  });
}

export default {
  DEMO_REFERENCE_TIME,
  DEMO_EVENT_COUNT_PER_PERSONA,
  DEMO_PERSONAS,
  demoPersonaCanonicalId,
  buildDemoPersonaEvents,
  learnDemoPersonaWeights,
};
