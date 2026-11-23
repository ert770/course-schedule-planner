// ADR-032：舊關鍵字一次性轉移成課程主題問答勾選的對應邏輯（純函式，不連資料庫）。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  LEGACY_DROP_REASON,
  SIMILAR_MIN,
  planLegacyInterestMigration,
  readLegacyTerms,
} from '../scripts/legacyInterestMigration.js';

// 假的目錄與候選方向，讓每條規則都能被單獨觸發。
const catalogTags = [
  { id: 'tag_sec', name: '資訊安全' },
  { id: 'tag_ml', name: '機器學習' },
  { id: 'tag_fe', name: '前端開發' },
  { id: 'tag_py', name: 'Python' },
  { id: 'tag_prog', name: '程式設計' },
];
const resolveTags = ([term]) => ({
  tags: catalogTags.filter(tag => tag.name === term).map(tag => ({ canonicalTagId: tag.id, canonicalName: tag.name })),
});
const directions = [
  { group: 'department', categoryId: 'main_cs', tagIds: new Set(['tag_sec', 'tag_fe', 'tag_prog']) },
  { group: 'department', categoryId: 'curated_ai', tagIds: new Set(['tag_ml']) },
];
const similarity = new Map([
  ['tag_py', new Map([['tag_prog', 0.71]])],
]);
const plan = (terms, existingSelections = []) => planLegacyInterestMigration({
  terms, existingSelections, directions, resolveTags, catalogTags, similarity,
});

test('LM1 直接對到候選方向的標籤（exact），放進第一個含它的方向', () => {
  const result = plan(['資訊安全', '機器學習']);
  assert.deepEqual(result.mapped.map(item => [item.term, item.method, item.categoryId]),
    [['資訊安全', 'exact', 'main_cs'], ['機器學習', 'exact', 'curated_ai']]);
  assert.deepEqual(result.dropped, []);
});

test('LM2 目錄找不到的詞：名稱以它開頭、且在候選池的標籤（prefix）', () => {
  const result = plan(['前端']);
  assert.deepEqual(result.mapped.map(item => [item.tagId, item.method]), [['tag_fe', 'prefix']]);
});

test('LM3 標籤存在但不在候選池：取相似度達門檻的相近標籤（similar），未達門檻就捨棄', () => {
  assert.equal(SIMILAR_MIN, 0.7);
  const result = plan(['Python']);
  assert.deepEqual(result.mapped.map(item => [item.tagId, item.method, item.similarity]), [['tag_prog', 'similar', 0.71]]);
  const strict = planLegacyInterestMigration({
    terms: ['Python'], directions, resolveTags, catalogTags,
    similarity: new Map([['tag_py', new Map([['tag_prog', 0.69]])]]),
  });
  assert.deepEqual(strict.dropped, [{ term: 'Python', reason: LEGACY_DROP_REASON.NOT_IN_POOL }]);
});

test('LM4 對不到任何東西的詞列為捨棄，不丟例外', () => {
  const result = plan(['我對 NLP 不感興趣', '']);
  assert.deepEqual(result.dropped.map(item => item.reason), [LEGACY_DROP_REASON.NO_TAG, LEGACY_DROP_REASON.NO_TAG]);
});

test('LM5 與已存勾選合併：同一方向併入 tagIds，不覆蓋原有勾選，不重複', () => {
  const existing = [{ group: 'department', categoryId: 'main_cs', level: 'main', mode: 'followup', tagIds: ['tag_fe'] }];
  const result = plan(['資訊安全', '前端開發'], existing);
  const cs = result.selections.find(item => item.categoryId === 'main_cs');
  assert.deepEqual(cs.tagIds, ['tag_fe', 'tag_sec']);
});

test('LM6 readLegacyTerms 合併 interests 與 preferredKeywords 並去重', () => {
  assert.deepEqual(readLegacyTerms({ preferencesJson: { values: { interests: ['資安', ' 資安 '], preferredKeywords: ['雲端'] } } }),
    ['資安', '雲端']);
  assert.deepEqual(readLegacyTerms({}), []);
});
