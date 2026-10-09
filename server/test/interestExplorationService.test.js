import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { interestTagCatalog } from '../src/data/interestTagCatalog.js';
import { ACTIVE_TERM } from '../src/data/activeTerm.js';
import {
  buildInterestCategoryPrompts,
  buildInterestExplorationCards,
  getInterestExplorationCards,
} from '../src/services/interestExplorationService.js';

const learningTags = interestTagCatalog.canonicalTags.filter(tag => (
  tag.eligibility?.interestLearningEligible === true
));
const tagWithDistinctPath = learningTags.find(tag => (
  tag.categoryAssignments.some(path => !learningTags[0].categoryAssignments.some(first => (
    first.mainCategoryId === path.mainCategoryId && first.subcategoryId === path.subcategoryId
  )))
));

function course(overrides = {}) {
  return {
    id: 100,
    sectionId: 100,
    catalogCourseCode: 'TEST1001',
    name: '資料庫測試課程',
    department: '資訊一甲',
    category: '一般選修',
    type: '選修',
    credits: 3,
    dayOfWeek: 1,
    timeStr: '星期一 1-2 節',
    year: 115,
    semester: '上學期',
    ragTag: [learningTags[0].name],
    ...overrides,
  };
}

describe('initial rag-tag interest exploration cards', () => {
  test('只回傳有排課時段、非必修、未修過且含可學習標籤的真實課程', () => {
    const cards = buildInterestExplorationCards([
      course(),
      course({ id: 101, sectionId: 101, catalogCourseCode: 'TEST1002', category: '必修', type: '必修' }),
      course({ id: 102, sectionId: 102, catalogCourseCode: 'TEST1003', eligibility: 'unknown' }),
      course({ id: 103, sectionId: 103, catalogCourseCode: 'TEST1004', timeBlocks: [], dayOfWeek: null }),
      course({ id: 104, sectionId: 104, catalogCourseCode: 'TEST1005', ragTag: ['not-in-catalog'] }),
      course({ id: 105, sectionId: 105, catalogCourseCode: 'TEST1006' }),
    ], {
      courseHistory: [{ courseCode: 'TEST1006', passed: true, academicYear: 114, semester: 2 }],
    });

    assert.deepEqual(cards.map(card => card.courseCode), ['TEST1001']);
    assert.equal(cards[0].tags[0].canonicalTagId, learningTags[0].id);
    assert.equal(cards[0].term.semester, 'first');
  });

  test('同一課號不重複出卡，並選用可顯示最多合格標籤的班次', () => {
    const cards = buildInterestExplorationCards([
      course({ id: 120, sectionId: 120, catalogCourseCode: 'TEST1200' }),
      course({
        id: 121,
        sectionId: 121,
        catalogCourseCode: 'TEST1200',
        ragTag: [learningTags[0].name, learningTags[1].name],
      }),
    ]);

    assert.equal(cards.length, 1);
    assert.equal(cards[0].sectionId, 121);
    assert.equal(cards[0].tags.length, 2);
  });

  test('優先回傳明確主題相關課程，並在首輪卡片中分散子分類', () => {
    assert.ok(tagWithDistinctPath, 'fixture catalog should contain a second category path');
    const cards = buildInterestExplorationCards([
      course({ id: 201, sectionId: 201, catalogCourseCode: 'TEST2001', ragTag: [tagWithDistinctPath.name] }),
      course({ id: 202, sectionId: 202, catalogCourseCode: 'TEST2002', ragTag: [learningTags[0].name] }),
      course({ id: 203, sectionId: 203, catalogCourseCode: 'TEST2003', ragTag: [learningTags[0].name] }),
    ], { interests: [tagWithDistinctPath.name] }, { limit: 2 });

    assert.equal(cards.length, 2);
    assert.equal(cards[0].courseCode, 'TEST2001');
    const firstPath = cards[0].tags[0].categoryPaths[0];
    const secondPath = cards[1].tags[0].categoryPaths[0];
    assert.notDeepEqual(
      [firstPath.mainCategoryId, firstPath.subcategoryId],
      [secondPath.mainCategoryId, secondPath.subcategoryId]
    );
  });

  test('只選廣泛主分類時追問目前卡片中可用的子分類，已選子分類則不重複追問', () => {
    const tag = learningTags.find(item => item.categoryAssignments.some(path => path.subcategoryId));
    const assignment = tag.categoryAssignments.find(path => path.subcategoryId);
    const main = interestTagCatalog.mainCategories.find(item => item.id === assignment.mainCategoryId);
    const subcategory = interestTagCatalog.subcategories.find(item => item.id === assignment.subcategoryId);
    const cards = buildInterestExplorationCards([
      course({ ragTag: [tag.name] }),
    ]);

    const prompts = buildInterestCategoryPrompts(cards, { interests: [main.name] });
    assert.equal(prompts.length, 1);
    assert.equal(prompts[0].mainCategoryId, main.id);
    assert.ok(prompts[0].subcategories.some(item => item.id === subcategory.id));
    assert.deepEqual(buildInterestCategoryPrompts(cards, {
      interests: [main.name, subcategory.name],
    }), []);
  });

  test('候選服務套用登入者班級範圍與目前學期', async () => {
    const current = course({
      department: '資訊一甲',
      gradeLevel: 1,
      year: ACTIVE_TERM.academicYear,
      semester: ACTIVE_TERM.semester,
    });
    const oldTerm = course({
      id: 301,
      sectionId: 301,
      catalogCourseCode: 'TEST3002',
      department: '資訊一甲',
      gradeLevel: 1,
      year: ACTIVE_TERM.academicYear - 1,
      semester: ACTIVE_TERM.semester,
    });
    const result = await getInterestExplorationCards({ canonicalId: 'test-user' }, {
      loadProfile: async () => ({
        department: '資訊工程學系',
        gradeLevel: 1,
        className: '資訊一甲',
      }),
      loadCourses: async () => [current, oldTerm],
    });

    assert.deepEqual(result.cards.map(card => card.courseCode), ['TEST1001']);
    assert.deepEqual(result.term, ACTIVE_TERM);
  });
});
