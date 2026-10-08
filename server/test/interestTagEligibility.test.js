import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { buildInterestTagEligibility } from '../src/data/interestTagEligibility.js';

describe('rag_tag 課程層資格計算', () => {
  test('把同課不同班次、核准別名與多分類路徑合併後只計一次', () => {
    const result = buildInterestTagEligibility([
      { catalogCourseCode: 'CS101', name: '人工智慧導論', ragTag: ['AI'] },
      { catalogCourseCode: 'CS101', name: '人工智慧導論', ragTag: ['人工智慧', '機器學習'] },
      { catalogCourseCode: 'CS102', name: '機器學習', ragTag: ['機器學習'] },
    ], { maxCourseRatio: 0.8 });

    const ai = result.tags.find(tag => tag.canonicalName === '人工智慧');
    const ml = result.tags.find(tag => tag.canonicalName === '機器學習');
    const cs101 = result.courses.find(course => course.courseKey === 'CS101');
    assert.equal(result.summary.courseCount, 2);
    assert.equal(cs101.sectionCount, 2);
    assert.equal(ai.courseCount, 1);
    assert.equal(ai.interestLearningEligible, true);
    assert.equal(ai.crossCourseMatchEligible, false);
    assert.equal(ai.exclusionReason, 'single_course');
    assert.ok(ai.categoryPaths.length > 1);
    assert.equal(ml.courseCount, 2);
    assert.deepEqual(ai.rawTags, ['人工智慧', 'AI']);
    assert.equal(cs101.canonicalTagIds.length, 2);
  });

  test('高頻門檻採嚴格大於 2%，超過時停用學習與跨課配對', () => {
    const courses = Array.from({ length: 100 }, (_, index) => ({
      catalogCourseCode: `C${String(index).padStart(3, '0')}`,
      ragTag: index < 3 ? ['人工智慧'] : ['自然語言處理'],
    }));
    const result = buildInterestTagEligibility(courses);
    const ai = result.tags.find(tag => tag.canonicalName === '人工智慧');
    const nlp = result.tags.find(tag => tag.canonicalName === '自然語言處理');

    assert.equal(ai.courseRatio, 0.03);
    assert.equal(ai.exclusionReason, 'too_common');
    assert.equal(ai.interestLearningEligible, false);
    assert.equal(ai.crossCourseMatchEligible, false);
    assert.equal(nlp.courseRatio, 0.97);
    assert.equal(nlp.exclusionReason, 'too_common');
  });

  test('恰好 2% 不觸發高頻排除；明列通用標籤仍停用兩種資格', () => {
    const courses = Array.from({ length: 100 }, (_, index) => ({
      catalogCourseCode: `D${String(index).padStart(3, '0')}`,
      ragTag: index < 2
        ? ['資料分析']
        : index < 4
          ? ['團隊合作']
          : ['自然語言處理'],
    }));
    const result = buildInterestTagEligibility(courses);
    const data = result.tags.find(tag => tag.canonicalName === '資料分析');
    const teamwork = result.tags.find(tag => tag.canonicalName === '團隊合作');

    assert.equal(data.courseRatio, 0.02);
    assert.equal(data.exclusionReason, null);
    assert.equal(data.crossCourseMatchEligible, true);
    assert.equal(teamwork.exclusionReason, 'explicit_generic');
    assert.equal(teamwork.interestLearningEligible, false);
    assert.equal(teamwork.crossCourseMatchEligible, false);
  });

  test('缺少穩定課號的班次不污染分母，未映射標籤列在診斷資料中', () => {
    const result = buildInterestTagEligibility([
      { id: 1, sectionId: 1, ragTag: ['資料分析'] },
      { catalogCourseCode: 'DS101', ragTag: ['資料分析', '未知標籤'] },
      { catalogCourseCode: 'DS101', ragTag: ['自然語言處理'] },
      { catalogCourseCode: '', courseId: 'DS102', ragTag: ['資料分析'] },
    ]);

    assert.equal(result.summary.sectionCount, 4);
    assert.equal(result.summary.skippedSectionCount, 1);
    assert.equal(result.summary.courseCount, 2);
    assert.deepEqual(result.unknownTags, [{ courseKey: 'DS101', rawTag: '未知標籤', status: 'unmapped' }]);
  });
});
