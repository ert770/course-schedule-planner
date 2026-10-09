import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createInteractionEvent, validateInteractionEvent } from '../src/data/interactionEventSchema.js';
import { interestTagCatalog } from '../src/data/interestTagCatalog.js';

const identity = { canonicalId: 'D0000999' };
const tag = interestTagCatalog.canonicalTags.find(item => (
  item.eligibility?.interestLearningEligible === true
));

function draft(eventType, overrides = {}) {
  return {
    eventType,
    requestId: randomUUID(),
    actionId: randomUUID(),
    course: { catalogCourseCode: 'TAG1001', sectionId: 701 },
    term: { academicYear: 115, semester: 'first' },
    versionSnapshot: {
      profileSchemaVersion: 1,
      modelVersion: 'test-model',
      recommendationReasonVersion: null,
    },
    source: eventType === 'interest_exploration_feedback' ? 'exploration' : 'explicit_selection',
    ...overrides,
  };
}

describe('rag-tag-interest-v1 event contract', () => {
  test('course rating and exploration responses preserve their validated payload', () => {
    const rated = createInteractionEvent(identity, draft('course_rated', { rating: 4 }));
    const explored = createInteractionEvent(identity, draft('interest_exploration_feedback', {
      interestFeedback: { response: 'interested', canonicalTagIds: [tag.id] },
    }));

    assert.equal(rated.rating, 4);
    assert.deepEqual(explored.interestFeedback, {
      response: 'interested', canonicalTagIds: [tag.id],
    });
  });

  test('negative response needs a tag and client cannot submit server-owned snapshots', () => {
    assert.throws(() => createInteractionEvent(identity,
      draft('interest_exploration_feedback', {
        interestFeedback: { response: 'not_interested', canonicalTagIds: [] },
      })), /至少一個標籤/u);

    const validRating = createInteractionEvent(identity, draft('course_rated', { rating: 5 }));
    assert.equal(validateInteractionEvent({
      ...validRating, tagInterestSnapshot: {},
    }).valid, false);
  });
});
