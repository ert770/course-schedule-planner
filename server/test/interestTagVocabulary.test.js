import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildInterestTagVocabulary,
  getFrequentInterestTagCandidates,
  normalizeInterestTag,
} from '../src/data/interestTagVocabulary.js';

const course = (catalogCourseCode, ragTag) => ({ catalogCourseCode, ragTag });

describe('rag_tag 興趣詞彙正規化', () => {
  test('去除頭尾空白、英文字母不分大小寫，並忽略空白與連字號', () => {
    assert.equal(normalizeInterestTag('  Chat GPT '), 'chatgpt');
    assert.equal(normalizeInterestTag('Decision-Making'), 'decisionmaking');
    assert.equal(normalizeInterestTag('ＰＹＴＨＯＮ'), 'python');
    assert.equal(normalizeInterestTag('人工智慧'), '人工智慧');
    assert.equal(normalizeInterestTag('   '), '');
  });

  test('相同課號的不同班次不會重複計入標籤課程數', () => {
    const candidates = getFrequentInterestTagCandidates([
      course('CS101', ['人工智慧']),
      course('CS101', ['人工智慧', 'Python']),
      course('CS102', ['人工智慧']),
    ], 2);
    assert.deepEqual(candidates, [{ tag: '人工智慧', courseCount: 2 }]);
  });

  test('將正規化撞名、人工同義詞、通用標籤與單課標籤分別記錄', () => {
    const courses = [
      course('A', ['Python', '人工智慧', '實習', '單次標籤']),
      course('B', ['PYTHON', 'AI', '實習']),
      course('C', ['python', '人工智慧', '實習']),
      course('D', ['Python', '人工智慧']),
      course('E', ['其他內容']),
    ];
    const result = buildInterestTagVocabulary(courses, {
      aliases: { aliases: { AI: '人工智慧' } },
      genericTags: ['實習'],
      maxCourseRatio: 0.8,
      minCourseCount: 2,
    });

    assert.equal(result.summary.courseCount, 5);
    assert.equal(result.mergedGroups.some(group => group.canonical === 'Python'), true);
    assert.equal(result.mergedGroups.some(group => group.canonical === '人工智慧' && group.mergedBy === 'manual-alias'), true);
    assert.equal(result.excludedTags.find(item => item.tag === '實習')?.reason, 'explicit-generic');
    assert.equal(result.excludedTags.find(item => item.tag === '其他內容')?.reason, 'single-course');
    assert.equal(result.excludedTags.find(item => item.tag === '單次標籤')?.reason, 'single-course');
  });

  test('排除超過課程比例門檻的通用標籤', () => {
    const courses = [
      course('A', ['熱門主題', '小眾甲']),
      course('B', ['熱門主題', '小眾甲']),
      course('C', ['熱門主題', '小眾乙']),
      course('D', ['冷門課']),
    ];
    const result = buildInterestTagVocabulary(courses, {
      genericTags: [],
      maxCourseRatio: 0.5,
      minCourseCount: 2,
    });
    assert.equal(result.excludedTags.find(item => item.tag === '熱門主題')?.reason, 'too-common');
    assert.equal(result.includedTags.some(item => item.tag === '熱門主題'), false);
  });

  test('每門課保留的標籤權重總和為 1，較稀有標籤權重較高', () => {
    const courses = [
      course('A', ['稀有主題', '常見主題']),
      course('B', ['常見主題']),
      course('C', ['稀有主題']),
      course('D', ['常見主題']),
      course('E', ['常見主題']),
      course('F', []), course('G', []), course('H', []), course('I', []), course('J', []),
    ];
    const result = buildInterestTagVocabulary(courses, {
      genericTags: [],
      maxCourseRatio: 1,
      minCourseCount: 2,
    });
    const weights = result.courseTagWeights.get('A');
    assert.ok(Math.abs(weights.reduce((sum, item) => sum + item.weight, 0) - 1) < 1e-12);
    assert.ok(weights.find(item => item.tag === '稀有主題').weight > weights.find(item => item.tag === '常見主題').weight);
    assert.equal(result.courseTagWeights.has('F'), false);
  });
});
