import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildInterestOptions,
  mergeInterestPreferences,
  normalizeInterestList,
  readInterestPreferences,
} from '../src/data/interestPreferences.js';

describe('興趣偏好的 preferences_json 契約', () => {
  test('正規化會去除空白、空值與重複項目', () => {
    assert.deepEqual(
      normalizeInterestList([' 資安 ', '', '資安', null, '雲端']),
      ['資安', '雲端']
    );
  });

  test('更新興趣時保留 values 內其他個人化資料', () => {
    const merged = mergeInterestPreferences({
      schemaVersion: 1,
      values: { learnedWeights: { interest: 1.4 }, untouched: true },
    }, {
      preferredTrack: '網路與安全類',
      interests: ['資安', ' 網路 '],
    });

    assert.deepEqual(merged.values.learnedWeights, { interest: 1.4 });
    assert.equal(merged.values.untouched, true);
    assert.equal(merged.values.preferredTrack, '網路與安全類');
    assert.deepEqual(merged.values.interests, ['資安', '網路']);
  });

  test('能從正式儲存格式還原排課器使用的頂層欄位', () => {
    const interest = readInterestPreferences({
      preferencesJson: {
        schemaVersion: 1,
        values: {
          preferredTrack: '技術應用類',
          interests: ['人工智慧'],
          preferredKeywords: ['深度學習'],
        },
      },
    });

    assert.deepEqual(interest, {
      preferredTrack: '技術應用類',
      interests: ['人工智慧'],
      preferredKeywords: ['深度學習'],
    });
  });
});

describe('課程 rag_tag 興趣選項', () => {
  test('同一課程的不同 section 對相同主題只計一次', () => {
    const result = buildInterestOptions([
      { id: 1, courseId: 'CS101', ragTag: ['人工智慧', 'Python'] },
      { id: 2, courseId: 'CS101', ragTag: ['人工智慧'] },
      { id: 3, courseId: 'CS102', ragTag: ['人工智慧', '資安'] },
    ]);

    assert.equal(result.topics[0].name, '人工智慧');
    assert.deepEqual(
      Object.fromEntries(result.topics.map(topic => [topic.name, topic.courseCount])),
      { 人工智慧: 2, 資安: 1, Python: 1 }
    );
    assert.ok(result.tracks.includes('網路與安全類'));
  });

  test('主題數量受上限控制', () => {
    const result = buildInterestOptions([
      { courseId: 'A', ragTag: ['甲', '乙', '丙'] },
    ], { topicLimit: 2 });

    assert.equal(result.topics.length, 2);
  });
});
