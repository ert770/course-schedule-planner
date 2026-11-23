// ADR-035：探索頁三種相近程度（課名、課程說明、課程主題）的文件、編碼與分數。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildExplorationDocuments,
  buildExplorationVectorIndex,
  decodeVector,
  encodeVector,
  EXPLORATION_VECTOR_VERSION,
  explorationSimilarity,
} from '../src/skills/courseExplorationVectors.js';

test('EV1 每個課號一份文件；主題只放主題類標籤（工具軟體、上課方式不放）', () => {
  const docs = buildExplorationDocuments([
    { catalogCourseCode: 'iecs1001', name: '資料結構', description: '介紹資料結構。', ragTag: ['演算法', 'Python', '小組討論'] },
    { catalogCourseCode: 'IECS1001', name: '資料結構', description: '介紹資料結構與演算法，較長的說明。', ragTag: ['資料結構'] },
  ]);
  assert.equal(docs.length, 1);
  assert.equal(docs[0].courseCode, 'IECS1001');
  assert.equal(docs[0].texts.name, '資料結構');
  assert.equal(docs[0].texts.description, '介紹資料結構與演算法，較長的說明。');
  assert.equal(docs[0].texts.topic.includes('Python'), false);
  assert.equal(docs[0].texts.topic.includes('小組討論'), false);
  assert.ok(docs[0].texts.topic.includes('演算法'));
});

test('EV2 課程表沒有的已修課只建課名文件；課程表已有的課號不重複', () => {
  const docs = buildExplorationDocuments(
    [{ catalogCourseCode: 'IECS1001', name: '資料結構', description: '說明', ragTag: [] }],
    [{ courseCode: 'IECS2007', courseName: '離散數學' }, { courseCode: 'IECS1001', courseName: '資料結構' }],
  );
  const history = docs.find(doc => doc.courseCode === 'IECS2007');
  assert.deepEqual(history, { courseCode: 'IECS2007', source: 'history', name: '離散數學',
    texts: { name: '離散數學', description: null, topic: null } });
  assert.equal(docs.filter(doc => doc.courseCode === 'IECS1001').length, 1);
});

test('EV3 向量編碼後正規化，解碼維度不符會報錯', () => {
  const decoded = decodeVector(encodeVector([3, 4]), 2);
  assert.ok(Math.abs(decoded[0] - 0.6) < 1e-6 && Math.abs(decoded[1] - 0.8) < 1e-6);
  assert.throws(() => decodeVector(encodeVector([3, 4]), 3));
});

test('EV4 分數是兩邊都有的欄位的 cosine 平均', () => {
  const v = values => decodeVector(encodeVector(values), 2);
  const start = { vectors: { name: v([1, 0]), description: v([1, 0]), topic: null } };
  const candidate = { vectors: { name: v([0, 1]), description: v([1, 0]), topic: v([1, 0]) } };
  const result = explorationSimilarity(start, candidate);
  assert.equal(result.fields, 2);
  assert.equal(result.topic, null);
  assert.ok(Math.abs(result.score - 0.5) < 1e-6);
  assert.equal(explorationSimilarity({ vectors: {} }, candidate).score, null);
});

test('EV5 產物版本不符時拒絕', () => {
  assert.throws(() => buildExplorationVectorIndex({ schemaVersion: 1, version: 'old', dimension: 2, courses: [] }));
  const index = buildExplorationVectorIndex({ schemaVersion: 1, version: EXPLORATION_VECTOR_VERSION, dimension: 2,
    model: 'fixture', generatedAt: '2026-11-24T00:00:00Z',
    courses: [{ courseCode: 'A1', source: 'catalog', name: 'A', vectors: { name: encodeVector([1, 0]), description: null, topic: null } }] });
  assert.equal(index.entries.get('A1').vectors.description, null);
});
