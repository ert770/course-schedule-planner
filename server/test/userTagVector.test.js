import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interestTagCatalog } from '../src/data/interestTagCatalog.js';
import { buildTagInterestSnapshot } from '../src/skills/tagInterestLearning.js';
import {
  buildCourseTagVectors,
  buildTagSimilarity,
  cosineWithContributions,
  softCosine,
  vectorTagsOf,
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

// ADR-030：明確興趣只讀課程主題問答勾選的標籤（interestSelections，依 ID）。
const tick = (tag, group = 'outside') => ({
  group, categoryId: tag.categoryAssignments[0].mainCategoryId, level: 'main', mode: 'followup', tagIds: [tag.id],
});

test('UV2 questionnaire-ticked tags enter the vector; courses without them score zero', () => {
  const user = buildUserTagVector({ prefs: { interestSelections: [tick(e)] }, index, activeTerm });
  assert.equal(user.sources.explicitTags, 1);
  const scored = scoreCoursesForUser(user, index, ['X3', 'X2']);
  assert.ok(scored.get('X3').raw > 0, 'the course with the ticked tag gets similarity');
  assert.equal(scored.get('X2').raw, 0);
});

test('UV-SEL1 legacy interests/preferredKeywords no longer reach the vector', () => {
  const user = buildUserTagVector({
    prefs: { interests: [e.name, tooCommon.name], preferredKeywords: [e.name] }, index, activeTerm,
  });
  assert.equal(user.sources.explicitTags, 0);
  assert.equal(user.positive.size, 0);
});

test('UV-SEL2 a direction without ticked tags adds nothing', () => {
  const user = buildUserTagVector({
    prefs: { interestSelections: [{ ...tick(e), tagIds: [] }] }, index, activeTerm,
  });
  assert.equal(user.sources.explicitTags, 0);
  assert.equal(user.positive.size, 0);
});

test('UV-SEL3 too_common tags ticked under the curated AI option are usable in the vector', async () => {
  const { getCuratedInterestOption } = await import('../src/data/curatedInterestOptions.js');
  const option = getCuratedInterestOption('curated_ai');
  const byId = new Map(interestTagCatalog.canonicalTags.map(tag => [tag.id, tag]));
  const common = option.tagIds.map(id => byId.get(id)).find(tag => tag?.eligibility?.exclusionReason === 'too_common');
  assert.ok(common, 'curated AI option should contain a too_common tag');
  const aiIndex = buildCourseTagVectors([
    { catalogCourseCode: 'AI1', name: 'AI course', ragTag: [common.name, f.name] },
    { catalogCourseCode: 'N1', name: 'Other course', ragTag: [c.name, d.name] },
  ]);
  const user = buildUserTagVector({
    prefs: { interestSelections: [{ group: 'department', categoryId: 'curated_ai', level: 'sub', tagIds: [common.id] }] },
    index: aiIndex, activeTerm,
  });
  assert.equal(user.sources.explicitTags, 1);
  const scored = scoreCoursesForUser(user, aiIndex, ['AI1', 'N1']);
  assert.ok(scored.get('AI1').raw > 0);
  assert.equal(scored.get('N1').raw, 0);
});

test('UV-SEL4 unknown categories or tags are ignored without throwing', () => {
  const user = buildUserTagVector({
    prefs: {
      interestSelections: [
        { group: 'outside', categoryId: 'main_does_not_exist', tagIds: [e.id] },
        { ...tick(e), tagIds: ['tag_does_not_exist', e.id] },
      ],
    },
    index, activeTerm,
  });
  assert.equal(user.sources.explicitTags, 1, 'only the valid tag under an existing category counts');
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
  // 課程的同一個標籤和使用者兩個標籤都相近時，理由只列一次。
  const [aId] = [...vectorTagsOf([a.name]).keys()];
  const [cId] = [...vectorTagsOf([c.name]).keys()];
  const [fId] = [...vectorTagsOf([f.name]).keys()];
  const similarity = buildTagSimilarity({ neighbors: { [fId]: [{ canonicalTagId: aId, similarity: 0.9 }, { canonicalTagId: cId, similarity: 0.8 }] } });
  const near = explainCourseForUser(user, index, 'X2', { similarity }).tags.map(tag => tag.courseTag);
  assert.equal(new Set(near).size, near.length);
});

test('UV7 歷史修課回饋：不喜歡取消該課的 +0.5 並記負向，喜歡另加 +1', () => {
  const feedback = (response, code = 'H1') => {
    const course = courses.find(item => item.catalogCourseCode === code);
    const event = {
      eventId: `hf-${response}-${code}`, eventType: 'history_course_feedback', timestamp: '2026-10-01T00:00:00.000Z',
      course: { catalogCourseCode: code, sectionId: 1 }, term: { academicYear: 114, semester: 'second' },
      source: 'history_review', interestFeedback: { response, canonicalTagIds: [] },
    };
    return { ...event, tagInterestSnapshot: buildTagInterestSnapshot(event, { ...course, category: '選修' }, { resolved: true }) };
  };
  const courseHistory = [history('H1', 'elective', 114, 1)];
  const plain = buildUserTagVector({ courseHistory, index, activeTerm });
  const disliked = buildUserTagVector({ courseHistory, events: [feedback('disliked')], index, activeTerm });
  assert.equal(disliked.sources.historyCourses, 0);
  assert.equal(disliked.sources.historyDisliked, 1);
  assert.equal(disliked.positive.size, 0);
  assert.ok(disliked.negative.size > 0);
  const liked = buildUserTagVector({ courseHistory, events: [feedback('liked')], index, activeTerm });
  assert.equal(liked.sources.historyCourses, 1);
  assert.equal(liked.sources.positiveEvents, 1);
  const [id] = [...plain.positive.keys()];
  assert.ok(liked.positive.get(id) > plain.positive.get(id));
});
