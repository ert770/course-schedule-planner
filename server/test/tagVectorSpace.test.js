import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interestTagCatalog } from '../src/data/interestTagCatalog.js';
import {
  buildCourseTagVectors,
  cosineWithContributions,
  isVectorEligibleTag,
  nearestCourses,
  vectorTagsOf,
} from '../src/skills/tagVectorSpace.js';

const byReason = reason => interestTagCatalog.canonicalTags.filter(tag => (
  reason === 'cross' ? tag.eligibility?.crossCourseMatchEligible === true : tag.eligibility?.exclusionReason === reason
));
const [crossA, crossB, crossC, crossD] = byReason('cross').map(tag => tag.name);
const tooCommon = byReason('too_common')[0].name;
const singleCourse = byReason('single_course')[0].name;
const generic = byReason('explicit_generic')[0].name;

test('TV5 committed tag neighbor table matches the catalog and its own threshold', async () => {
  const { default: table } = await import('../src/data/tagVectorNeighbors.json', { with: { type: 'json' } });
  const byId = new Map(interestTagCatalog.canonicalTags.map(tag => [tag.id, tag]));
  assert.equal(table.catalogVersion, interestTagCatalog.catalogVersion);
  assert.ok(table.tau > 0 && table.tau < 1);
  for (const [id, neighbors] of Object.entries(table.neighbors)) {
    assert.ok(isVectorEligibleTag(byId.get(id)), `${id} must be a vector tag`);
    assert.ok(neighbors.length > 0 && neighbors.length <= table.topK);
    for (const item of neighbors) {
      assert.notEqual(item.canonicalTagId, id);
      assert.ok(isVectorEligibleTag(byId.get(item.canonicalTagId)));
      assert.ok(item.similarity >= table.tau && item.similarity <= 1);
    }
  }
});

test('TV1 vector tags keep cross-course and too_common tags, drop single-course and generic tags', () => {
  const names = [...vectorTagsOf([crossA, tooCommon, singleCourse, generic]).values()];
  assert.deepEqual(names.sort(), [crossA, tooCommon].sort());
  assert.equal(isVectorEligibleTag(null), false);
});

test('TV2 sections of one course code are merged and idf is computed per course code', () => {
  const index = buildCourseTagVectors([
    { catalogCourseCode: 'c1', name: 'One', ragTag: [crossA] },
    { catalogCourseCode: 'C1', name: 'One', ragTag: [crossB] },
    { catalogCourseCode: 'C2', name: 'Two', ragTag: [crossA] },
    { catalogCourseCode: 'C3', name: 'Three', ragTag: [crossC] },
  ]);
  assert.equal(index.courseCount, 3);
  assert.deepEqual([...index.vectors.get('C1').weights.keys()].length, 2);
  const idA = [...vectorTagsOf([crossA]).keys()][0];
  const idB = [...vectorTagsOf([crossB]).keys()][0];
  assert.ok(Math.abs(index.idf.get(idA) - Math.log(3 / 2)) < 1e-12);
  assert.ok(index.idf.get(idB) > index.idf.get(idA), 'rarer tag weighs more');
});

test('TV3 contributions add up to the cosine similarity; zero vectors are not comparable', () => {
  const index = buildCourseTagVectors([
    { catalogCourseCode: 'A', ragTag: [crossA, crossB, crossC] },
    { catalogCourseCode: 'B', ragTag: [crossA, crossB] },
    { catalogCourseCode: 'C', ragTag: [crossD] },
    { catalogCourseCode: 'D', ragTag: [singleCourse] },
  ]);
  const { similarity, contributions } = cosineWithContributions(index.vectors.get('A'), index.vectors.get('B'));
  assert.ok(similarity > 0 && similarity <= 1);
  assert.equal(contributions.length, 2);
  assert.ok(Math.abs(contributions.reduce((sum, item) => sum + item.contribution, 0) - similarity) < 1e-12);
  assert.equal(cosineWithContributions(index.vectors.get('A'), index.vectors.get('D')).similarity, null);
});

test('TV4 nearest courses exclude itself, skip unrelated courses and honour the filter', () => {
  const index = buildCourseTagVectors([
    { catalogCourseCode: 'A', ragTag: [crossA, crossB] },
    { catalogCourseCode: 'B', ragTag: [crossA, crossB] },
    { catalogCourseCode: 'C', ragTag: [crossA, crossC] },
    { catalogCourseCode: 'D', ragTag: [crossD] },
  ]);
  const near = nearestCourses(index, 'a', { k: 5 });
  assert.deepEqual(near.map(item => item.courseCode), ['B', 'C']);
  assert.ok(near[0].similarity > near[1].similarity);
  assert.equal(near[0].sharedTags.length, 2);
  assert.deepEqual(nearestCourses(index, 'A', { filter: code => code !== 'B' }).map(item => item.courseCode), ['C']);
  assert.deepEqual(nearestCourses(index, 'missing'), []);
});
