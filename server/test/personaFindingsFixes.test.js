// 2026-10-15 Persona 實測第 5 節的發現：探索推薦被拒絕的課、科目名稱也搜描述、個人化來源誤判、系列課跳級。
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { interestTagCatalog } from '../src/data/interestTagCatalog.js';
import { isSeriesLevelReachable, parseCourseSeries, passedSeriesLevels } from '../src/data/courseSeries.js';
import { buildInterestExplorationCards } from '../src/services/interestExplorationService.js';
import { filterCatalogCourses } from '../src/skills/courseQuery.js';
import { hasExplicitPreferences } from '../src/services/preferenceLearningService.js';
import { buildTagInterestSnapshot } from '../src/skills/tagInterestLearning.js';
import { buildCourseTagVectors } from '../src/skills/tagVectorSpace.js';
import { buildUserTagVector } from '../src/skills/userTagVector.js';

const learningTag = interestTagCatalog.canonicalTags.find(tag => tag.eligibility?.interestLearningEligible === true);
const history = (courseName, passed = true) => ({
  courseCode: `X${courseName.length}`, courseName, passed, graduationCategory: 'general', academicYear: 113, semester: 1,
});

describe('SER：系列課只推薦下一級', () => {
  test('SER-1 解析系列與等級；第 1 級與非系列課一律可推薦', () => {
    assert.deepEqual(parseCourseSeries('西班牙文(四)'), { key: '西班牙文', level: 4 });
    assert.deepEqual(parseCourseSeries('程式設計（二）'), { key: '程式設計', level: 2 });
    assert.equal(parseCourseSeries('資料結構'), null);
    const levels = passedSeriesLevels([history('西班牙文(一)'), history('西班牙文(二)'), history('法文(一)', false)]);
    assert.equal(isSeriesLevelReachable('西班牙文(三)', levels), true);
    assert.equal(isSeriesLevelReachable('西班牙文(四)', levels), false);
    assert.equal(isSeriesLevelReachable('法文(二)', levels), false); // (一) 沒通過
    assert.equal(isSeriesLevelReachable('韓文(一)', levels), true);
    assert.equal(isSeriesLevelReachable('資料結構', levels), true);
  });

  test('SER-2 興趣探索卡不出現跳級的系列課', () => {
    const base = {
      department: '外文一甲', category: '一般選修', type: '選修', credits: 2, dayOfWeek: 2, timeStr: '星期二 3-4 節',
      year: 115, semester: '上學期', ragTag: [learningTag.name],
    };
    const cards = buildInterestExplorationCards([
      { ...base, id: 1, sectionId: 1, catalogCourseCode: 'SPAN1003', name: '西班牙文(三)' },
      { ...base, id: 2, sectionId: 2, catalogCourseCode: 'SPAN1004', name: '西班牙文(四)' },
    ], { courseHistory: [history('西班牙文(一)'), history('西班牙文(二)')] }, { limit: 8 });
    const names = cards.cards?.map(card => card.name) ?? cards.map(card => card.name);
    assert.ok(names.includes('西班牙文(三)'));
    assert.ok(!names.includes('西班牙文(四)'));
  });
});

describe('探索與查詢的其他修正', () => {
  test('REJ-1 使用者向量記下明確拒絕過的課（探索卡沒興趣）', () => {
    const course = { catalogCourseCode: 'HOME1001', name: '家計經濟學', ragTag: [learningTag.name], category: '通識' };
    const index = buildCourseTagVectors([course]);
    const event = {
      eventId: 'e1', eventType: 'interest_exploration_feedback', timestamp: '2026-10-14T00:00:00.000Z',
      course: { catalogCourseCode: 'HOME1001', sectionId: 1 }, term: { academicYear: 114, semester: 'second' },
      source: 'exploration', interestFeedback: { response: 'not_interested', canonicalTagIds: [learningTag.id] },
    };
    const snapshot = buildTagInterestSnapshot(event, course, { resolved: true });
    const user = buildUserTagVector({ events: [{ ...event, tagInterestSnapshot: snapshot }], index,
      activeTerm: { academicYear: 114, semester: '下學期' }, now: '2026-10-15T00:00:00.000Z' });
    assert.ok(user.rejectedCourseCodes.has('HOME1001'));
  });

  test('NAME-1 「科目名稱」只比對課名與課號，不比對描述；keyword 仍會比對描述', () => {
    const courses = [
      { id: 1, name: '機器學習', description: '使用 Python 實作', isEnglishTaught: false },
      { id: 2, name: 'Python程式設計', description: '入門', isEnglishTaught: false },
    ];
    assert.deepEqual(filterCatalogCourses(courses, { name: 'Python' }).map(c => c.id), [2]);
    assert.deepEqual(filterCatalogCourses(courses, { keyword: 'Python' }).map(c => c.id), [1, 2]);
  });

  test('PERS-1 有偏好標籤、興趣或避開時段就算已表達偏好', () => {
    assert.equal(hasExplicitPreferences({ preferenceTags: ['#不排早八'] }), true);
    assert.equal(hasExplicitPreferences({ interests: ['AI'] }), true);
    assert.equal(hasExplicitPreferences({ blockedPeriods: [{ day: 1, period: 1 }] }), true);
    assert.equal(hasExplicitPreferences({ preferenceTags: [], interests: [] }), false);
    assert.equal(hasExplicitPreferences({}), false);
  });
});
