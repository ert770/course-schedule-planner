import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { interestTagCatalog } from '../src/data/interestTagCatalog.js';
import { buildCourseTextDocuments, buildCourseTextEmbeddingIndex, denseCosine,
  normalizeDenseVector, COURSE_TEXT_VECTOR_VERSION, COURSE_TEXT_MAX_CODE_POINTS } from '../src/skills/courseTextVector.js';
import { loadCourseTextEmbeddingIndex, resetCourseTextEmbeddingCache } from '../src/services/courseTextEmbeddingService.js';

const courses = [{ catalogCourseCode: 'A', name: '人工智慧', ragTag: ['人工智慧'], description: '機器學習方法' }];
const artifactFor = rows => ({ schemaVersion: 1, textVersion: COURSE_TEXT_VECTOR_VERSION,
  catalogVersion: interestTagCatalog.catalogVersion, embeddingModel: 'text-embedding-3-large', dimension: 2,
  generatedAt: '2026-10-14T00:00:00Z', courses: buildCourseTextDocuments(rows).map(doc => ({
    courseCode: doc.courseCode, contentHash: doc.contentHash, vector: [3, 4],
  })) });

test('CT1 多班次依穩定課號合併，文字與雜湊不依輸入順序且不含身分欄位', () => {
  const list = [courses[0], { ...courses[0], catalogCourseCode: ' a ', description: '較完整的機器學習與神經網路方法',
    instructor: '老師', userId: '不應傳出', grade: 90 }];
  const a = buildCourseTextDocuments(list);
  assert.deepEqual(a, buildCourseTextDocuments([...list].reverse()));
  assert.equal(a.length, 1);
  assert.equal(a[0].courseCode, 'A');
  assert.ok(a[0].text.includes('較完整的機器學習'));
  assert.equal(a[0].text.includes('不應傳出'), false);
  assert.equal(a[0].text.includes('老師'), false);
});

test('CT2 長文字以 code point 限制，內容變更會使雜湊變更', () => {
  const long = buildCourseTextDocuments([{ ...courses[0], description: '字'.repeat(10000) }])[0];
  assert.equal(Array.from(long.text).length, COURSE_TEXT_MAX_CODE_POINTS);
  assert.equal(long.truncated, true);
  assert.notEqual(long.contentHash, buildCourseTextDocuments(courses)[0].contentHash);
});

test('CT3 正規化與餘弦相似度，零向量、NaN 與維度不一致不得進產物', () => {
  const v = normalizeDenseVector([3, 4], 2);
  assert.ok(Math.abs(denseCosine(v, v) - 1) < 1e-6);
  assert.equal(denseCosine(v, normalizeDenseVector([-4, 3], 2)), 0);
  for (const values of [[0, 0], [NaN, 1], [1], [Infinity, 1]]) {
    assert.throws(() => normalizeDenseVector(values, 2));
  }
});

test('CT4 舊目錄與格式不相容、重複課號會拒絕；課程內容過期則逐門停用', () => {
  const artifact = artifactFor(courses);
  const good = buildCourseTextEmbeddingIndex(courses, artifact);
  assert.equal(good.vectors.size, 1);
  assert.equal(buildCourseTextEmbeddingIndex([{ ...courses[0], description: '內容已改' }], artifact).vectors.size, 0);
  assert.throws(() => buildCourseTextEmbeddingIndex(courses, { ...artifact, catalogVersion: 'old' }));
  assert.throws(() => buildCourseTextEmbeddingIndex(courses, { ...artifact, textVersion: 'old' }));
  assert.throws(() => buildCourseTextEmbeddingIndex(courses, { ...artifact, courses: [...artifact.courses, ...artifact.courses] }));
  assert.throws(() => buildCourseTextEmbeddingIndex(courses, { ...artifact, courses: [{ ...artifact.courses[0], vector: [0, 0] }] }));
});

test('CT5 本機產物缺少、損壞及重新產生，讀取路徑均有明確結果', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'course-text-vector-'));
  const file = path.join(directory, 'index.json');
  const previous = process.env.COURSE_TEXT_EMBEDDINGS_PATH;
  process.env.COURSE_TEXT_EMBEDDINGS_PATH = file;
  resetCourseTextEmbeddingCache();
  try {
    assert.equal((await loadCourseTextEmbeddingIndex(courses)).reason, 'text-embeddings-unavailable');
    await fs.writeFile(file, '{broken');
    assert.equal((await loadCourseTextEmbeddingIndex(courses)).reason, 'text-embeddings-invalid');
    await fs.writeFile(file, JSON.stringify(artifactFor(courses)));
    assert.equal((await loadCourseTextEmbeddingIndex(courses)).index.vectors.size, 1);
    assert.equal((await loadCourseTextEmbeddingIndex([{ ...courses[0], name: '更新課名' }])).index.vectors.size, 0);
  } finally {
    if (previous === undefined) delete process.env.COURSE_TEXT_EMBEDDINGS_PATH;
    else process.env.COURSE_TEXT_EMBEDDINGS_PATH = previous;
    resetCourseTextEmbeddingCache();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
