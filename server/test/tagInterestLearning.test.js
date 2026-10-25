import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { interestTagCatalog } from '../src/data/interestTagCatalog.js';
import { buildStudentScope } from '../src/skills/courseScope.js';
import {
  buildTagInterestSnapshot,
  computeTagInterestProfile,
  scoreCourseTagInterest,
  tagInterestDecay,
} from '../src/skills/tagInterestLearning.js';

const matchableTags = interestTagCatalog.canonicalTags.filter(tag => (
  tag.eligibility?.interestLearningEligible === true
  && tag.eligibility?.crossCourseMatchEligible === true
));
const firstTag = matchableTags[0];
const secondTag = matchableTags[1];

function courseFor(tags = [firstTag]) {
  return {
    sectionId: 101,
    catalogCourseCode: 'TEST1001',
    category: '選修',
    department: '資訊一甲',
    ragTag: tags.map(tag => tag.name),
  };
}

function baseEvent(overrides = {}) {
  return {
    eventId: 'event-1',
    eventType: 'interest_exploration_feedback',
    timestamp: '2026-10-01T00:00:00.000Z',
    course: { catalogCourseCode: 'TEST1001', sectionId: 101 },
    term: { academicYear: 115, semester: 'first' },
    source: 'exploration',
    interestFeedback: { response: 'interested', canonicalTagIds: [] },
    ...overrides,
  };
}

function snapshot(event, course = courseFor()) {
  return buildTagInterestSnapshot(event, course, { resolved: true });
}

describe('rag-tag-interest-v1 pure model', () => {
  test('explicit broad category is retained as category intent without expanding descendant tags', () => {
    const category = interestTagCatalog.mainCategories[0];
    const profile = computeTagInterestProfile([], { interests: [category.name] });
    assert.deepEqual(profile.categoryInterests.map(item => item.mainCategoryId), [category.id]);
    assert.deepEqual(profile.tagInterests, []);
  });

  test('exploration positive can cover eligible course tags, while explicit negative requires selected tags', () => {
    const positive = snapshot(baseEvent(), courseFor([firstTag, secondTag]));
    assert.deepEqual(positive.evidenceTagIds, [firstTag.id, secondTag.id]);

    const negativeEvent = baseEvent({
      interestFeedback: { response: 'not_interested', canonicalTagIds: [secondTag.id] },
    });
    const negative = snapshot(negativeEvent, courseFor([firstTag, secondTag]));
    assert.deepEqual(negative.evidenceTagIds, [secondTag.id]);
    assert.throws(() => snapshot(baseEvent({
      interestFeedback: { response: 'not_interested', canonicalTagIds: [] },
    }), courseFor()), /必須指定/u);
  });

  test('required course and unresolved required scope fail closed', () => {
    const requiredCourse = { ...courseFor(), category: '必修' };
    const unresolved = buildTagInterestSnapshot(baseEvent(), requiredCourse, { resolved: false });
    assert.equal(unresolved.requiredStatus, 'unknown');
    assert.equal(unresolved.evidenceTagIds.length, 0);

    const scope = buildStudentScope({
      department: '資訊工程學系', gradeLevel: 1, className: '資訊一甲',
    });
    const required = buildTagInterestSnapshot(baseEvent(), requiredCourse, scope);
    assert.equal(required.requiredStatus, 'required');
    assert.equal(required.evidenceTagIds.length, 0);

    const anotherClassRequired = buildTagInterestSnapshot(baseEvent(), {
      ...requiredCourse, department: '資訊二甲',
    }, scope);
    assert.equal(anotherClassRequired.exclusionReason, 'required_course');
    assert.equal(anotherClassRequired.evidenceTagIds.length, 0,
      '其他班級的必修也不能被當成自願興趣');
  });

  test('multi-tag event weight is split evenly and repeated browsing caps at 0.15 per course', () => {
    const events = [0, 1, 2].map(index => {
      const event = {
        ...baseEvent({ eventId: `view-${index}`, eventType: 'course_viewed', interestFeedback: undefined }),
        timestamp: '2026-10-09T00:00:00.000Z',
        source: 'explicit_selection',
      };
      return { ...event, tagInterestSnapshot: snapshot(event, courseFor([firstTag, secondTag])) };
    });
    const profile = computeTagInterestProfile(events, {}, {
      now: '2026-10-09T00:00:00.000Z',
      activeTerm: { academicYear: 115, semester: 'first' },
    });
    const scores = new Map(profile.tagInterests.map(tag => [tag.canonicalTagId, tag]));
    assert.equal(scores.get(firstTag.id).positiveEvidence, 0.075);
    assert.equal(scores.get(secondTag.id).positiveEvidence, 0.075);
  });

  test('120-day and old-term factors are applied to the same event', () => {
    const event = baseEvent({
      timestamp: '2026-06-11T00:00:00.000Z',
      term: { academicYear: 114, semester: 'second' },
    });
    const decay = tagInterestDecay(event, {
      now: '2026-10-09T00:00:00.000Z',
      activeTerm: { academicYear: 115, semester: 'first' },
    });
    assert.ok(Math.abs(decay.factor - 0.25) < 0.002);
    assert.equal(decay.oldTerm, true);
  });

  test('new-course score uses only cross-course eligible tags and reports evidence coverage', () => {
    const singleCourseTag = interestTagCatalog.canonicalTags.find(tag => (
      tag.eligibility?.interestLearningEligible === true
      && tag.eligibility?.crossCourseMatchEligible === false
    ));
    const profile = {
      tagInterests: [{
        canonicalTagId: firstTag.id,
        score: 0.6,
        hasEvidence: true,
        prior: 0,
      }, {
        canonicalTagId: singleCourseTag.id,
        score: 1,
        hasEvidence: true,
        prior: 0,
      }],
    };
    const result = scoreCourseTagInterest(profile, [firstTag.name, singleCourseTag.name]);
    assert.equal(result.score, 0.6);
    assert.equal(result.eligibleTagCount, 1);
    assert.equal(result.evidenceTagCount, 1);
    assert.deepEqual(result.matchedTags.map(tag => tag.canonicalTagId), [firstTag.id]);
  });
});

test('TIL-MERGE 事件快照中已被同義詞合併的標籤 ID，依名稱對應到目前的標準標籤', async () => {
  const { resolveInterestTag } = await import('../src/data/interestTagCatalog.js');
  const target = resolveInterestTag('資訊安全');
  assert.equal(resolveInterestTag('資安').canonicalTagId, target.canonicalTagId, '資安 已併入 資訊安全');
  const removedId = 'tag_merged_away_for_test';
  const event = {
    eventId: 'merge-1', eventType: 'course_favorited', timestamp: '2026-10-01T00:00:00.000Z',
    course: { catalogCourseCode: 'TEST1001', sectionId: 101 }, term: { academicYear: 114, semester: 'second' },
    source: 'explicit_selection',
    tagInterestSnapshot: {
      schemaVersion: 1, modelVersion: 'rag-tag-interest-v1', requiredStatus: 'not-required',
      course: { catalogCourseCode: 'TEST1001', sectionId: 101 },
      tags: [{ canonicalTagId: removedId, canonicalName: '資安', categoryPaths: [], crossCourseMatchEligible: false }],
      evidenceTagIds: [removedId],
    },
  };
  const profile = computeTagInterestProfile([event], {}, { now: '2026-10-02T00:00:00.000Z' });
  const ids = profile.tagInterests.map(tag => tag.canonicalTagId);
  assert.deepEqual(ids, [target.canonicalTagId]);
  assert.equal(profile.tagInterests[0].canonicalName, '資訊安全');
  assert.equal(profile.tagInterests[0].crossCourseMatchEligible, target.eligibility.crossCourseMatchEligible);
});

test('TIL-HF 歷史修課回饋：喜歡 +1、不喜歡 −1、以最後一次為準、不套用時間衰減', () => {
  const event = (eventId, response, timestamp) => {
    const draft = {
      eventId, eventType: 'history_course_feedback', timestamp,
      course: { catalogCourseCode: 'TEST1001', sectionId: 101 }, term: { academicYear: 114, semester: 'second' },
      source: 'history_review', interestFeedback: { response, canonicalTagIds: [] },
    };
    return { ...draft, tagInterestSnapshot: snapshot(draft) };
  };
  const now = '2027-06-01T00:00:00.000Z'; // 一年多以後：若套用 120 天半衰期，權重會降到約 0.1
  const liked = computeTagInterestProfile([event('h1', 'liked', '2026-03-01T00:00:00.000Z')], {}, { now });
  assert.equal(liked.tagInterests[0].positiveEvidence, 1);
  const changed = computeTagInterestProfile([
    event('h1', 'liked', '2026-03-01T00:00:00.000Z'),
    event('h2', 'disliked', '2026-04-01T00:00:00.000Z'),
  ], {}, { now });
  assert.equal(changed.tagInterests[0].positiveEvidence, 0);
  assert.equal(changed.tagInterests[0].negativeEvidence, 1);
  const neutral = computeTagInterestProfile([event('h3', 'neutral', '2026-03-01T00:00:00.000Z')], {}, { now });
  assert.equal(neutral.tagInterests.length, 0);
});
