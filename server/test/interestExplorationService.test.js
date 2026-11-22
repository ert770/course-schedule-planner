import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { interestTagCatalog } from '../src/data/interestTagCatalog.js';
import { ACTIVE_TERM } from '../src/data/activeTerm.js';
import {
  buildInterestCategoryPrompts,
  buildInterestExplorationCards,
  buildInterestExplorationPairs,
  getInterestExplorationCards,
} from '../src/services/interestExplorationService.js';

const learningTags = interestTagCatalog.canonicalTags.filter(tag => (
  tag.eligibility?.interestLearningEligible === true
));
// 課程主題問答能勾的標籤（可學習且可跨課配對），探索卡的主題意圖只讀這種標籤的 ID。
const selectableTags = learningTags.filter(tag => tag.eligibility?.crossCourseMatchEligible === true);
const tagWithDistinctPath = selectableTags.find(tag => (
  tag.categoryAssignments.some(path => !learningTags[0].categoryAssignments.some(first => (
    first.mainCategoryId === path.mainCategoryId && first.subcategoryId === path.subcategoryId
  )))
));
const mainIdsOf = tag => new Set(tag.categoryAssignments.map(path => path.mainCategoryId));
// 勾某個標籤：放在它所屬的第一個大類方向底下（與問答存檔的形狀相同）。
const tickSelection = (tag, group = 'outside') => ({
  group, categoryId: tag.categoryAssignments[0].mainCategoryId, level: 'main', mode: 'followup', tagIds: [tag.id],
});

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
    ], { interestSelections: [tickSelection(tagWithDistinctPath)] }, { limit: 2 });

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

test('雙卡探索最多三組，不重複課號，優先搭配不同標籤的同類課程', () => {
  const [a, b, c, d, e, f] = learningTags.filter(tag => tag.eligibility.crossCourseMatchEligible === true);
  const cards = buildInterestExplorationCards([a, a, b, c, d, e, f].map((tag, index) => course({
    id: 3000 + index, sectionId: 3000 + index, catalogCourseCode: `PAIR${index}`, ragTag: [tag.name],
  })), {}, { limit: 7 });
  const pairs = buildInterestExplorationPairs(cards);
  assert.equal(pairs.length, 3);
  assert.equal(new Set(pairs.flat().map(card => card.courseCode)).size, 6);
  assert.ok(pairs.every(pair => pair.length === 2));
  assert.notEqual(pairs[0][0].representativeTags[0].canonicalTagId, pairs[0][1].representativeTags[0].canonicalTagId);
  const learningOnly = learningTags.find(tag => !tag.eligibility.crossCourseMatchEligible);
  const noMatch = buildInterestExplorationCards([course({ ragTag: [learningOnly.name] })]);
  assert.equal(noMatch[0].representativeTags.length, 0);
  assert.deepEqual(buildInterestExplorationPairs([noMatch[0], cards[0]]), []);
});

// ADR-029：探索卡只讀課程主題問答的結果（interestSelections，依 ID），不再讀 interests／preferredKeywords。
describe('IE-SEL 探索卡依課程主題問答結果排序', () => {
  // tagA、tagB 不共用任何大類，避免選 A 的方向時連帶命中 B。
  const tagA = selectableTags.find(tag => tag.categoryAssignments.some(path => path.subcategoryId));
  const tagB = selectableTags.find(tag => [...mainIdsOf(tag)].every(id => !mainIdsOf(tagA).has(id)));
  // 課號 AAA 排在 ZZZ 前面：沒有任何主題意圖時，AAA（標籤 B）先出。
  const sections = () => [
    course({ id: 401, sectionId: 401, catalogCourseCode: 'AAA401', ragTag: [tagB.name] }),
    course({ id: 402, sectionId: 402, catalogCourseCode: 'ZZZ402', ragTag: [tagA.name] }),
  ];
  const order = profile => buildInterestExplorationCards(sections(), profile, { limit: 2 })
    .map(card => card.courseCode);

  test('fixture：找得到不共用大類的兩個可選標籤', () => {
    assert.ok(tagA && tagB);
  });

  test('IE-SEL1 勾了標籤的課排在前面；沒有問答結果時維持課號順序', () => {
    assert.deepEqual(order({}), ['AAA401', 'ZZZ402']);
    assert.deepEqual(order({ interestSelections: [tickSelection(tagA)] }), ['ZZZ402', 'AAA401']);
  });

  test('IE-SEL2 只選大類方向、沒勾標籤時，該大類的課往前排', () => {
    const direction = { group: 'outside', categoryId: tagA.categoryAssignments[0].mainCategoryId, tagIds: [] };
    assert.deepEqual(order({ interestSelections: [direction] }), ['ZZZ402', 'AAA401']);
  });

  test('IE-SEL3 子類別方向只讓落在該子類別路徑的課命中', () => {
    const path = tagA.categoryAssignments.find(item => item.subcategoryId);
    const direction = { group: 'department', categoryId: path.subcategoryId, level: 'sub', tagIds: [] };
    assert.deepEqual(order({ interestSelections: [direction] }), ['ZZZ402', 'AAA401']);
    // 同大類、但不在這個子類別的標籤不會被拉到前面。
    const sibling = selectableTags.find(tag => tag.id !== tagA.id
      && tag.categoryAssignments.some(item => item.mainCategoryId === path.mainCategoryId)
      && tag.categoryAssignments.every(item => item.subcategoryId !== path.subcategoryId));
    if (sibling) {
      const cards = buildInterestExplorationCards([
        course({ id: 411, sectionId: 411, catalogCourseCode: 'AAA411', ragTag: [sibling.name] }),
        course({ id: 412, sectionId: 412, catalogCourseCode: 'ZZZ412', ragTag: [tagA.name] }),
      ], { interestSelections: [direction] }, { limit: 2 });
      assert.deepEqual(cards.map(card => card.courseCode), ['ZZZ412', 'AAA411']);
    }
  });

  test('IE-SEL4 只有舊的 interests／preferredKeywords 時不影響探索卡順序', () => {
    assert.deepEqual(order({ interests: [tagA.name], preferredKeywords: [tagA.name] }), ['AAA401', 'ZZZ402']);
  });

  test('IE-SEL5 目錄裡沒有的分類或標籤會被忽略，不丟例外', () => {
    // 不存在的大類（底下勾了 A）整筆忽略，所以 ZZZ402 不會被拉到前面；
    // 存在的 B 大類方向仍然有效（不存在的標籤只是被忽略），AAA401 照樣在前。
    const profile = {
      interestSelections: [
        { group: 'outside', categoryId: 'main_does_not_exist', tagIds: [tagA.id] },
        { group: 'department', categoryId: tagB.categoryAssignments[0].mainCategoryId, tagIds: ['tag_does_not_exist'] },
      ],
    };
    assert.doesNotThrow(() => order(profile));
    assert.deepEqual(order(profile), ['AAA401', 'ZZZ402']);
  });

  test('IE-SEL6 勾中的標籤可以疊加：多勾中一個就排到前面', () => {
    // tagC 與 tagA 不共用大類，只勾 A 時兩門課相關度相同（都是 A ×2 ＋ A 的方向路徑 1）。
    const tagC = selectableTags.find(tag => tag.id !== tagA.id
      && [...mainIdsOf(tag)].every(id => !mainIdsOf(tagA).has(id)));
    assert.ok(tagC);
    const deck = () => [
      course({ id: 421, sectionId: 421, catalogCourseCode: 'AAA421', ragTag: [tagA.name] }),
      course({ id: 422, sectionId: 422, catalogCourseCode: 'ZZZ422', ragTag: [tagA.name, tagC.name] }),
    ];
    const first = selections => buildInterestExplorationCards(deck(), { interestSelections: selections }, { limit: 1 })[0]
      .courseCode;
    assert.equal(first([tickSelection(tagA)]), 'AAA421');
    assert.equal(first([tickSelection(tagA), tickSelection(tagC, 'department')]), 'ZZZ422');
  });
});

test('IE-SVEC 主題相關度相同時依 s_vec 排序；沒有分數時維持課號順序', async () => {
  const { buildInterestExplorationCards } = await import('../src/services/interestExplorationService.js');
  const { interestTagCatalog } = await import('../src/data/interestTagCatalog.js');
  const [x, y] = interestTagCatalog.canonicalTags.filter(tag => tag.eligibility?.interestLearningEligible === true
    && tag.eligibility?.crossCourseMatchEligible === true).map(tag => tag.name);
  const card = (id, code, tag) => ({
    id, sectionId: id, catalogCourseCode: code, name: code, category: '選修', type: '選修',
    eligibility: 'eligible', timeBlocks: [{ dayOfWeek: 1, startPeriod: 1, endPeriod: 2 }], ragTag: [tag],
  });
  const sections = [card(1, 'AAA1', x), card(2, 'BBB1', y)];
  const plain = buildInterestExplorationCards(sections, {}, { limit: 2 });
  assert.deepEqual(plain.map(item => item.courseCode), ['AAA1', 'BBB1']);
  const ranked = buildInterestExplorationCards(sections, {}, { limit: 2, vectorScores: new Map([['BBB1', 0.4], ['AAA1', 0.1]]) });
  assert.deepEqual(ranked.map(item => item.courseCode), ['BBB1', 'AAA1']);
});
