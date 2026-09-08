import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  INTERACTION_EVENT_SCHEMA_VERSION,
  INTERACTION_EVENT_TYPES,
  INTERACTION_FEEDBACK_REASONS,
  INTERACTION_SOURCES,
  createInteractionEvent,
  migrateInteractionEvent,
  resolveIdempotentAppend,
  validateInteractionEvent,
} from '../src/data/interactionEventSchema.js';

const REQUEST_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACTION_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const EVENT_ID_1 = '11111111-1111-4111-8111-111111111111';
const EVENT_ID_2 = '22222222-2222-4222-8222-222222222222';
const IDENTITY = { canonicalId: 'D1249697' };

function course(sectionId = 101, catalogCourseCode = 'IECS3002') {
  return { catalogCourseCode, sectionId };
}

function exposureInput(overrides = {}) {
  return {
    eventType: INTERACTION_EVENT_TYPES.RECOMMENDATION_EXPOSED,
    requestId: REQUEST_ID,
    actionId: ACTION_ID,
    term: { academicYear: 114, semester: '下學期' },
    plan: { planId: 'plan-a', variantId: 'required_first' },
    position: { planRank: 1, courseRank: null },
    exposureContext: {
      surface: 'dashboard',
      trigger: 'initial_load',
      candidateSet: [course(101), course(102, 'IECS3059')],
      displayedSet: [course(101)],
    },
    versionSnapshot: {
      profileSchemaVersion: 1,
      modelVersion: 'scheduler-greedy-v1',
      // Roadmap #26 尚未完成，必須誠實保留 null。
      recommendationReasonVersion: null,
    },
    source: INTERACTION_SOURCES.SYSTEM_RECOMMENDATION,
    feedbackReason: null,
    ...overrides,
  };
}

function courseEventInput(eventType, overrides = {}) {
  return {
    eventType,
    requestId: REQUEST_ID,
    actionId: ACTION_ID,
    course: course(),
    term: { academicYear: 114, semester: 'second' },
    plan: { planId: 'plan-a', variantId: 'required_first' },
    position: { planRank: 1, courseRank: 1 },
    exposureContext: null,
    versionSnapshot: {
      profileSchemaVersion: 1,
      modelVersion: 'scheduler-greedy-v1',
      recommendationReasonVersion: null,
    },
    source: INTERACTION_SOURCES.SYSTEM_RECOMMENDATION,
    feedbackReason: null,
    ...overrides,
  };
}

describe('Roadmap #29 InteractionEvent v1 schema', () => {
  test('I29-1 server 建立 authoritative envelope 並正規化學期', () => {
    const event = createInteractionEvent(
      IDENTITY,
      exposureInput({
        userId: 'forged-user',
        eventId: EVENT_ID_2,
        timestamp: '2000-01-01T00:00:00.000Z',
        idempotencyKey: `sha256:${'f'.repeat(64)}`,
      }),
      {
        randomUUID: () => EVENT_ID_1,
        now: () => new Date('2026-08-21T01:02:03.000Z'),
      }
    );

    assert.equal(event.schemaVersion, INTERACTION_EVENT_SCHEMA_VERSION);
    assert.equal(event.eventId, EVENT_ID_1);
    assert.equal(event.userId, IDENTITY.canonicalId);
    assert.equal(event.timestamp, '2026-08-21T01:02:03.000Z');
    assert.equal(event.term.semester, 'second');
    assert.match(event.idempotencyKey, /^sha256:[0-9a-f]{64}$/u);
    assert.equal(validateInteractionEvent(event).valid, true);
  });

  test('I29-2 曝光事件保存完整候選集、實際顯示清單與排名', () => {
    const event = createInteractionEvent(IDENTITY, exposureInput(), {
      randomUUID: () => EVENT_ID_1,
      now: () => new Date('2026-08-21T01:02:03.000Z'),
    });

    assert.deepEqual(event.exposureContext.candidateSet, [course(101), course(102, 'IECS3059')]);
    assert.deepEqual(event.exposureContext.displayedSet, [course(101)]);
    assert.equal(event.position.planRank, 1);
    assert.equal(event.versionSnapshot.recommendationReasonVersion, null);
  });

  test('#7 曝光事件正規化並驗證版本化方案權重', () => {
    const planId = 'plan-personalized';
    const event = createInteractionEvent(IDENTITY, exposureInput({
      plan: { planId, variantId: 'personalized' },
      exposureContext: {
        surface: 'dashboard',
        trigger: 'initial_load',
        candidateSet: [course(101)],
        displayedSet: [course(101)],
        displayedPlanIds: [planId],
        planPolicies: [{
          planId,
          variantId: 'personalized',
          version: 'personalized-scoring-v1',
          weights: { interest: 1, compact: 0, easy: -1.4 },
          categoryCoefficient: 0.35,
          creditCoefficient: 1,
          stopWhen: 'no-credit-progress',
          source: {
            learnedApplied: true,
            reason: 'applied',
            modelVersion: 'preference-learning-v2',
          },
        }],
      },
    }), {
      randomUUID: () => EVENT_ID_1,
      now: () => new Date('2026-08-21T01:02:03.000Z'),
    });

    assert.deepEqual(event.exposureContext.planPolicies[0].weights, {
      interest: 1, compact: 0, easy: -1.4,
    });
    assert.equal(validateInteractionEvent(event).valid, true);

    assert.throws(() => createInteractionEvent(IDENTITY, exposureInput({
      exposureContext: {
        surface: 'dashboard',
        trigger: 'initial_load',
        candidateSet: [course(101)],
        displayedSet: [course(101)],
        displayedPlanIds: [planId],
        planPolicies: [{
          planId,
          variantId: 'personalized',
          version: 'personalized-scoring-v1',
          weights: { interest: -1, compact: 0, easy: 0 },
          categoryCoefficient: 0.35,
          creditCoefficient: 1,
          stopWhen: 'no-credit-progress',
          source: { learnedApplied: false, reason: 'absent', modelVersion: null },
        }],
      },
    })), /planPolicies 含無效/u);
  });

  test('I29-3 displayedSet 不是 candidateSet 子集時拒絕', () => {
    assert.throws(
      () => createInteractionEvent(IDENTITY, exposureInput({
        exposureContext: {
          surface: 'dashboard',
          trigger: 'initial_load',
          candidateSet: [course(101)],
          displayedSet: [course(999, 'IECS9999')],
        },
      })),
      /不在 candidateSet/u
    );
  });

  test('I29-4 四種來源皆可區分，必修不會混成興趣正回饋', () => {
    for (const source of Object.values(INTERACTION_SOURCES)) {
      const event = createInteractionEvent(
        IDENTITY,
        courseEventInput(INTERACTION_EVENT_TYPES.RECOMMENDATION_ACCEPTED, { source }),
        { randomUUID: () => EVENT_ID_1 }
      );
      assert.equal(event.source, source);
      assert.equal(event.eventType, 'recommendation_accepted');
    }
  });

  test('I29-5 移除與退選可帶結構化原因，其餘事件不可帶', () => {
    for (const eventType of [
      INTERACTION_EVENT_TYPES.COURSE_REMOVED,
      INTERACTION_EVENT_TYPES.COURSE_WITHDRAWN,
    ]) {
      for (const feedbackReason of Object.values(INTERACTION_FEEDBACK_REASONS)) {
        const event = createInteractionEvent(
          IDENTITY,
          courseEventInput(eventType, { feedbackReason }),
          { randomUUID: () => EVENT_ID_1 }
        );
        assert.equal(event.feedbackReason, feedbackReason);
      }
    }

    assert.throws(
      () => createInteractionEvent(
        IDENTITY,
        courseEventInput(INTERACTION_EVENT_TYPES.COURSE_VIEWED, { feedbackReason: 'content' })
      ),
      /只有 course_removed／course_withdrawn/u
    );
    assert.throws(
      () => createInteractionEvent(
        IDENTITY,
        courseEventInput(INTERACTION_EVENT_TYPES.COURSE_REMOVED, { feedbackReason: 'price' })
      ),
      /feedbackReason 不在允許清單/u
    );
  });

  test('I29-6 同一 logical action 重送只保留第一筆事件', () => {
    const first = createInteractionEvent(IDENTITY, exposureInput(), {
      randomUUID: () => EVENT_ID_1,
      now: () => new Date('2026-08-21T01:02:03.000Z'),
    });
    const retry = createInteractionEvent(IDENTITY, exposureInput(), {
      randomUUID: () => EVENT_ID_2,
      now: () => new Date('2026-08-21T01:02:04.000Z'),
    });

    assert.equal(first.idempotencyKey, retry.idempotencyKey);
    const appended = resolveIdempotentAppend([], first);
    const duplicate = resolveIdempotentAppend(appended.events, retry);

    assert.equal(appended.status, 'append');
    assert.equal(duplicate.status, 'duplicate');
    assert.equal(duplicate.events.length, 1);
    assert.equal(duplicate.event.eventId, EVENT_ID_1);
  });

  test('I29-7 相同 idempotency key 但 payload 改變時回 conflict', () => {
    const first = createInteractionEvent(IDENTITY, exposureInput(), {
      randomUUID: () => EVENT_ID_1,
    });
    const conflicting = {
      ...first,
      position: { ...first.position, planRank: 2 },
    };

    const result = resolveIdempotentAppend([first], conflicting);
    assert.equal(result.status, 'conflict');
    assert.deepEqual(result.events, [first]);
  });

  test('I29-8 不同 actionId 產生不同 key，可視為獨立操作', () => {
    const first = createInteractionEvent(IDENTITY, exposureInput(), {
      randomUUID: () => EVENT_ID_1,
    });
    const second = createInteractionEvent(IDENTITY, exposureInput({
      actionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    }), {
      randomUUID: () => EVENT_ID_2,
    });

    assert.notEqual(first.idempotencyKey, second.idempotencyKey);
    assert.equal(resolveIdempotentAppend([first], second).status, 'append');
  });

  test('I29-9 無版本 flat draft 可遷移為 v1 固定形狀', () => {
    const migrated = migrateInteractionEvent({
      eventId: EVENT_ID_1,
      eventType: 'course_removed',
      userId: 'D1249697',
      timestamp: '2026-08-21T01:02:03.000Z',
      requestId: REQUEST_ID,
      actionId: ACTION_ID,
      idempotencyKey: `sha256:${'a'.repeat(64)}`,
      catalogCourseCode: 'IECS3002',
      sectionId: 101,
      academicYear: 114,
      semester: '下學期',
      planId: 'plan-a',
      variantId: 'required_first',
      planRank: 1,
      courseRank: 1,
      profileSchemaVersion: 1,
      modelVersion: 'scheduler-greedy-v1',
      recommendationReasonVersion: null,
      source: 'system_recommendation',
      reason: 'time',
    });

    assert.equal(migrated.schemaVersion, 1);
    assert.deepEqual(migrated.course, course());
    assert.deepEqual(migrated.term, { academicYear: 114, semester: 'second' });
    assert.equal(migrated.feedbackReason, 'time');
    assert.equal(validateInteractionEvent(migrated).valid, true);
  });

  test('I29-10 未知未來版本與 malformed event 會被拒絕', () => {
    assert.throws(
      () => migrateInteractionEvent({ schemaVersion: 2 }),
      /不支援的 interaction event schemaVersion/u
    );
    assert.throws(
      () => createInteractionEvent(IDENTITY, courseEventInput('not-a-real-event')),
      /eventType 不在允許清單/u
    );
    assert.throws(
      () => createInteractionEvent(null, exposureInput()),
      /authenticated canonical identity/u
    );
    assert.throws(
      () => createInteractionEvent(IDENTITY, courseEventInput(
        INTERACTION_EVENT_TYPES.COURSE_SELECTED,
        { position: { planRank: 0, courseRank: -1 } }
      )),
      /從 1 起算/u
    );
  });
});
