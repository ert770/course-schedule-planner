// ADR-033：探索頁的主題配對門檻。標籤分類來自標籤目錄，不是手寫清單之外的猜測。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { interestTagCatalog } from '../src/data/interestTagCatalog.js';
import {
  buildTagDepartmentSpread,
  createExplorationTagGate,
  EXPLORATION_GENERIC_MIN_SIMILARITY,
  EXPLORATION_MIN_SIMILARITY,
  profileExactTags,
  TAG_KIND,
  tagKind,
} from '../src/skills/explorationTagGate.js';

const idOf = name => interestTagCatalog.canonicalTags.find(tag => tag.name === name)?.id;

test('EG1 工具軟體、上課方式、太常見、主題四類', () => {
  // 具名軟體子類，或手列的 Microsoft Teams（目錄把它歸在社會科學）。
  assert.equal(tagKind(idOf('Teams')), TAG_KIND.TOOL);
  assert.equal(tagKind(idOf('Microsoft Teams')), TAG_KIND.TOOL);
  // Python 同時是太常見與具名軟體：先算工具。
  assert.equal(tagKind(idOf('Python')), TAG_KIND.TOOL);
  // 課程活動與評量、學習階段兩個主類，以及手列的上課方式標籤。
  assert.equal(tagKind(idOf('小組討論')), TAG_KIND.FORMAT);
  assert.equal(tagKind(idOf('碩士課程')), TAG_KIND.FORMAT);
  assert.equal(tagKind(idOf('教育')), TAG_KIND.FORMAT);
  assert.equal(tagKind(idOf('機器學習')), TAG_KIND.TOO_COMMON);
  assert.equal(tagKind(idOf('災害管理')), TAG_KIND.TOPIC);
  assert.equal(tagKind('tag_not_in_catalog'), TAG_KIND.UNKNOWN);
});

test('EG2 相同主題標籤只算主題類；籠統標籤門檻較高', () => {
  const topic = idOf('災害管理');
  const generic = idOf('生成式AI');
  const tool = idOf('Teams');
  const vectors = new Map([
    ['A', { weights: new Map([[topic, 1], [generic, 1], [tool, 1]]) }],
    ['B', { weights: new Map([[generic, 1], [tool, 1]]) }],
  ]);
  // 生成式AI 出現在 13 個系所，災害管理只在 1 個。
  const courses = [
    { catalogCourseCode: 'A', department: '土木二甲' },
    ...Array.from({ length: 13 }, (_, i) => ({ catalogCourseCode: 'B', department: `系所${i}` })),
  ];
  const tagIndex = { vectors };
  const spread = buildTagDepartmentSpread(courses, tagIndex);
  assert.equal(spread.get(generic), 14);
  assert.equal(spread.get(topic), 1);

  const gate = createExplorationTagGate(courses, tagIndex);
  assert.deepEqual(gate.sharedTopicTags(vectors.get('A').weights, vectors.get('B').weights), [generic]);
  assert.equal(gate.minimumSimilarity([generic]), EXPLORATION_GENERIC_MIN_SIMILARITY);
  assert.equal(gate.minimumSimilarity([topic, generic]), EXPLORATION_MIN_SIMILARITY);
});

test('EG3 修課輪廓的完全相同標籤：太常見可以，工具與上課方式不行', () => {
  const user = new Map([[idOf('機器學習'), 1], [idOf('Teams'), 1], [idOf('小組討論'), 1]]);
  assert.deepEqual(profileExactTags(user, new Map([[idOf('機器學習'), 1]])), [idOf('機器學習')]);
  assert.deepEqual(profileExactTags(user, new Map([[idOf('Teams'), 1], [idOf('小組討論'), 1]])), []);
  assert.deepEqual(profileExactTags(user, null), []);
});
