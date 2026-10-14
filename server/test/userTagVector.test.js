import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interestTagCatalog } from '../src/data/interestTagCatalog.js';
import { buildTagInterestSnapshot } from '../src/skills/tagInterestLearning.js';
import {
  buildCourseTagVectors,
  buildTagSimilarity,
  cosineWithContributions,
  softCosine,
} from '../src/skills/tagVectorSpace.js';
import {
  buildUserTagVector,
  explainCourseForUser,
  scoreCoursesForUser,
} from '../src/skills/userTagVector.js';

const cross = interestTagCatalog.canonicalTags.filter(tag => tag.eligibility?.crossCourseMatchEligible === true);
const [a, b, c, d, e, f] = cross;
const tooCommon = interestTagCatalog.canonicalTags.find(tag => tag.eligibility?.exclusionReason === 'too_common');
const activeTerm = { academicYear: 114, semester: '下學期' };

const courses = [
  { catalogCourseCode: 'H1', name: 'History AB', ragTag: [a.name, b.name] },
  { catalogCourseCode: 'H2', name: 'History CD', ragTag: [c.name, d.name] },
  { catalogCourseCode: 'R1', name: 'Required AB', ragTag: [a.name, b.name, e.name] },
  { catalogCourseCode: 'X1', name: 'Near AB', ragTag: [a.name, f.name] },
  { catalogCourseCode: 'X2', name: 'Near CD', ragTag: [c.name, f.name] },
  { catalogCourseCode: 'X3', name: 'Only E', ragTag: [e.name] },
  { catalogCourseCode: 'X4', name: 'Common', ragTag: [tooCommon.name, f.name] },
];
const index = buildCourseTagVectors(courses);
const history = (code, graduationCategory, academicYear, semester = 1) => ({
  courseCode: code, courseName: code, passed: true, graduationCategory, academicYear, semester,
});

test('UV1 history counts only passed non-required courses and older terms weigh less', () => {
  const user = buildUserTagVector({
    courseHistory: [
      history('H1', 'elective', 114, 1),
      history('H2', 'general', 112, 1),
      history('R1', 'required', 114, 1),
      { ...history('X3', 'elective', 114, 1), passed: false },
    ],
    index, activeTerm,
  });
  assert.equal(user.sources.historyCourses, 2);
  const [recent, older] = ['H1', 'H2'].map(code => user.evidence.find(item => item.courseCode === code).weight);
  assert.ok(Math.abs(recent - 0.5 * 0.8) < 1e-12, 'one term ago');
  assert.ok(Math.abs(older - 0.5 * 0.8 ** 5) < 1e-12, 'five terms ago');
  const eId = [...index.vectors.get('X3').weights.keys()][0];
  assert.equal(user.positive.has(eId), false, 'required course tags never enter the vector');
});

test('UV2 explicit interests map common topics into the vector; unmapped topics are reported', () => {
  const user = buildUserTagVector({ prefs: { interests: [tooCommon.name, '不存在的主題XYZ'] }, index, activeTerm });
  assert.equal(user.sources.explicitTags, 1);
  assert.deepEqual(user.sources.unmappedTopics, ['不存在的主題XYZ']);
  const scored = scoreCoursesForUser(user, index, ['X4', 'X1']);
  assert.ok(scored.get('X4').raw > 0);
  assert.equal(scored.get('X1').raw, 0);
});

test('UV3 no similarity means no score rather than a penalty; the pool reference scales to 1', () => {
  const user = buildUserTagVector({ courseHistory: [history('H1', 'elective', 114, 1)], index, activeTerm });
  const scored = scoreCoursesForUser(user, index, ['X1', 'X2', 'X3']);
  assert.equal(scored.get('X1').score, 1, 'the best match in the pool reaches the reference');
  assert.equal(scored.get('X2').raw, 0);
  assert.equal(scored.get('X2').score, null, 'no shared tags is not evidence of dislike');
  assert.equal(scored.get('X3').score, null);
  const empty = scoreCoursesForUser(buildUserTagVector({ index, activeTerm }), index, ['X1']);
  assert.equal(empty.get('X1').raw, null);
  assert.equal(empty.get('X1').score, null);
});

test('UV4 the neighbor table lets related tags count; without it soft cosine equals plain cosine', () => {
  const left = index.vectors.get('H2');
  const right = index.vectors.get('X3');
  assert.equal(softCosine(left.weights, right.weights).similarity, 0);
  const [cId] = [...buildCourseTagVectors([{ catalogCourseCode: 'Z', ragTag: [c.name] }]).idf.keys()];
  const [eId] = [...index.vectors.get('X3').weights.keys()];
  const similarity = buildTagSimilarity({ neighbors: { [cId]: [{ canonicalTagId: eId, similarity: 0.8 }] } });
  assert.equal(similarity.get(eId).get(cId), 0.8, 'table is symmetrised');
  assert.ok(softCosine(left.weights, right.weights, similarity).similarity > 0);
  const plain = cosineWithContributions(index.vectors.get('H1'), index.vectors.get('X1')).similarity;
  assert.ok(Math.abs(softCosine(index.vectors.get('H1').weights, index.vectors.get('X1').weights).similarity - plain) < 1e-12);
});

test('UV5 events use rag-tag-interest-v1 weights; negatives are kept apart; excluded codes are dropped', () => {
  const eventFor = (eventType, code, extra = {}) => {
    const course = courses.find(item => item.catalogCourseCode === code);
    const event = {
      eventId: `${eventType}-${code}`, eventType, timestamp: '2026-10-01T00:00:00.000Z',
      course: { catalogCourseCode: code, sectionId: 1 }, term: { academicYear: 114, semester: 'second' },
      source: 'explicit_selection', ...extra,
    };
    return { ...event, tagInterestSnapshot: buildTagInterestSnapshot(event, { ...course, category: '選修' }, { resolved: true }) };
  };
  const events = [
    eventFor('course_favorited', 'H1'),
    eventFor('course_withdrawn', 'H2', { feedbackReason: 'content' }),
  ];
  const user = buildUserTagVector({ events, index, activeTerm, now: '2026-10-01T00:00:00.000Z' });
  assert.equal(user.sources.positiveEvents, 1);
  assert.equal(user.sources.negativeEvents, 1);
  const scored = scoreCoursesForUser(user, index, ['X1', 'X2']);
  assert.ok(scored.get('X1').raw > 0 && scored.get('X2').raw < 0);
  assert.ok(scored.get('X1').score > 0 && scored.get('X2').score < 0, 'only negative evidence lowers a score');
  const heldOut = buildUserTagVector({ events, index, activeTerm, excludeCourseCodes: ['h1'] });
  assert.equal(heldOut.sources.positiveEvents, 0);
});

test('UV6 explanation names the closest evidence course and the contributing tags', () => {
  const user = buildUserTagVector({
    courseHistory: [history('H1', 'elective', 114, 1), history('H2', 'elective', 114, 1)], index, activeTerm,
  });
  const explanation = explainCourseForUser(user, index, 'X1');
  assert.equal(explanation.closestEvidence.courseCode, 'H1');
  assert.equal(explanation.tags[0].courseTag, a.name);
  assert.equal(explanation.tags[0].viaNeighbor, false);
  assert.notEqual(explainCourseForUser(user, index, 'H1').closestEvidence?.courseCode, 'H1', 'a course never explains itself');
});
