import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { interestTagCatalog } from '../src/data/interestTagCatalog.js';
import {
  buildCuratedTopicOptions,
  collectCuratedOptionTags,
  getCuratedInterestOption,
  isCuratedSelectableTag,
  isSelectionScoringExemptTag,
} from '../src/data/curatedInterestOptions.js';
import { lookupInterestCategory, resolveInterestSelections, SELECTION_IGNORE_REASON } from '../src/data/interestSelections.js';
import { buildInterestTopicGroups } from '../src/data/interestTopicGroups.js';
import {
  buildExplicitTagInterest,
  computeTagInterestProfile,
  scoreCourseTagInterest,
} from '../src/skills/tagInterestLearning.js';
import { SELECTION_WARNING, sanitizeInterestSelectionsForSave } from '../src/services/interestSelectionService.js';

// ADR-026：本系「人工智慧」策畫選項，與「明確選擇的 too_common 標籤才計分」的豁免。
// 全部用真實標籤目錄與合成課程，不連資料庫。

const tag = name => interestTagCatalog.canonicalTags.find(item => item.name === name);
const AI = tag('人工智慧');
const ML = tag('機器學習');
const DL = tag('深度學習');
const PYTHON = tag('Python');
const DATA_SCIENCE = tag('資料科學');
const AI_SUB = interestTagCatalog.subcategories.find(item => item.name === 'AI');
const option = getCuratedInterestOption('curated_ai');

// 《人工智慧導論》在真實資料裡的標籤（2026-11-20 查詢）。
const INTRO_AI_TAGS = ['Python', 'Spark', '人工智慧', '機器學習', '資料分析', '資料科學', '金融科技', '醫療科技'];
const course = (code, name, ragTag) => ({ catalogCourseCode: code, courseId: `${code}-1`, name, ragTag });
const DEPT_COURSES = [
  course('IECS3001', '人工智慧導論', INTRO_AI_TAGS),
  course('IECS3002', '人工智慧自然語言導論', ['深度學習', '生成式AI', '自然語言處理', '機器學習', 'Python']),
  course('IECS3003', '資料庫系統', ['資料庫', 'SQL']),
];
const aiSelection = tagIds => ({ group: 'department', categoryId: 'curated_ai', level: 'sub', mode: 'direct', tagIds });

describe('ADR-026 策畫選項：設定與標籤資格', () => {
  test('測試前提：人工智慧、機器學習、Python 是 too_common；深度學習、資料科學是可選標籤', () => {
    for (const item of [AI, ML, PYTHON]) assert.equal(item.eligibility.exclusionReason, 'too_common');
    for (const item of [DL, DATA_SCIENCE]) assert.equal(item.eligibility.crossCourseMatchEligible, true);
  });

  test('curated_ai 對應到目錄的「資訊與計算／AI」子類別，清單含人工智慧與機器學習', () => {
    assert.ok(option);
    assert.equal(option.subcategoryId, AI_SUB.id);
    assert.ok(option.tagIds.includes(AI.id) && option.tagIds.includes(ML.id));
    const category = lookupInterestCategory('curated_ai');
    assert.equal(category.type, 'subcategory');
    assert.equal(category.subcategoryId, AI_SUB.id);
    assert.equal(category.curatedOptionId, 'curated_ai');
  });

  test('清單內的 too_common 可從策畫選項選；清單外的 too_common（Python）不行', () => {
    assert.equal(isCuratedSelectableTag(option, AI), true);
    assert.equal(isCuratedSelectableTag(option, DL), true);
    assert.equal(isCuratedSelectableTag(option, PYTHON), false);
    assert.equal(isCuratedSelectableTag(option, DATA_SCIENCE), false);
  });

  test('計分豁免只給清單內的 too_common；本來就可選的標籤不需要豁免', () => {
    assert.equal(isSelectionScoringExemptTag(AI), true);
    assert.equal(isSelectionScoringExemptTag(ML), true);
    assert.equal(isSelectionScoringExemptTag(DL), false);
    assert.equal(isSelectionScoringExemptTag(PYTHON), false);
  });
});

describe('ADR-026 策畫選項：選單', () => {
  test('資工系：依候選池實際命中的標籤建立直接確認選項，含 too_common 的人工智慧', () => {
    const [built] = buildCuratedTopicOptions(DEPT_COURSES, '資訊工程學系');
    assert.equal(built.id, 'curated_ai');
    assert.equal(built.mode, 'direct');
    assert.equal(built.courseCount, 2, '資料庫系統沒有 AI 標籤，不算');
    const counts = Object.fromEntries(built.tags.map(item => [item.name, item.courseCount]));
    assert.equal(counts['人工智慧'], 1);
    assert.equal(counts['機器學習'], 2);
    assert.equal(counts['深度學習'], 1);
    assert.equal(counts.Python, undefined, '清單外的 too_common 不出現');
  });

  test('其他系所不顯示；候選池沒有命中時也不顯示', () => {
    assert.deepEqual(buildCuratedTopicOptions(DEPT_COURSES, '企業管理學系'), []);
    assert.deepEqual(buildCuratedTopicOptions([DEPT_COURSES[2]], '資訊工程學系'), []);
  });

  test('本系選單：策畫選項排第一個，而且不佔依課程數排序的名額', () => {
    const groups = buildInterestTopicGroups({ department: DEPT_COURSES }, { department: '資訊工程學系', limit: 1 });
    const department = groups.find(group => group.key === 'department');
    assert.equal(department.options[0].id, 'curated_ai');
    assert.equal(department.options.length, 2);
  });

  test('非資工系的本系選單沒有策畫選項', () => {
    const groups = buildInterestTopicGroups({ department: DEPT_COURSES }, { department: '企業管理學系' });
    const department = groups.find(group => group.key === 'department');
    assert.ok(!department?.options.some(item => item.id === 'curated_ai'));
  });
});

describe('ADR-026 策畫選項：目錄對照與先驗', () => {
  test('從 curated_ai 選人工智慧：接受並標記計分豁免；選清單外的標籤被忽略', () => {
    const resolved = resolveInterestSelections([aiSelection([AI.id, DL.id, DATA_SCIENCE.id])]);
    const byId = new Map(resolved.tags.map(item => [item.tag.id, item]));
    assert.equal(byId.get(AI.id).scoringExempt, true);
    assert.equal(byId.get(DL.id).scoringExempt, false);
    assert.deepEqual(resolved.ignored.map(item => item.reason), [SELECTION_IGNORE_REASON.TAG_NOT_IN_CATEGORY]);
  });

  test('豁免只走策畫選項：從目錄的「AI」子類別直接送人工智慧仍然不接受', () => {
    const resolved = resolveInterestSelections([
      { group: 'department', categoryId: AI_SUB.id, level: 'sub', mode: 'followup', tagIds: [AI.id] },
    ]);
    assert.equal(resolved.tags.length, 0);
    assert.equal(resolved.ignored[0].reason, SELECTION_IGNORE_REASON.TAG_NOT_SELECTABLE);
  });

  test('先驗：人工智慧 p0 = 1 並帶 selectionScoringExempt；類別記成目錄的 AI 子類別', () => {
    const explicit = buildExplicitTagInterest({ interestSelections: [aiSelection([AI.id, ML.id])] });
    const prior = explicit.tagPriors.find(item => item.canonicalTagId === AI.id);
    assert.equal(prior.prior, 1);
    assert.equal(prior.selectionScoringExempt, true);
    assert.ok(explicit.categoryInterests.some(item => item.subcategoryId === AI_SUB.id));
    assert.ok(!explicit.categoryInterests.some(item => 'curatedOptionId' in item), '不把內部欄位存進 profile');
  });
});

describe('ADR-026 策畫選項：單課計分', () => {
  const profileWith = interestSelections => computeTagInterestProfile([], { interestSelections });

  test('沒選：《人工智慧導論》只用資料科學、金融科技、醫療科技三個標籤計分', () => {
    const scored = scoreCourseTagInterest(profileWith([]), INTRO_AI_TAGS);
    assert.equal(scored.eligibleTagCount, 3);
    assert.equal(scored.score, 0);
  });

  test('選了人工智慧與機器學習：《人工智慧導論》多兩個計分標籤，分數 (1 + 1) / 5 = 0.4', () => {
    const scored = scoreCourseTagInterest(profileWith([aiSelection([AI.id, ML.id])]), INTRO_AI_TAGS);
    assert.equal(scored.eligibleTagCount, 5);
    assert.equal(scored.score, 0.4);
    assert.ok(!scored.matchedTags.some(item => item.canonicalName === 'Python'), 'Python 沒被選，仍不計分');
  });

  test('只選深度學習（不需豁免）：《人工智慧導論》分數不變，自然語言導論上升', () => {
    const profile = profileWith([aiSelection([DL.id])]);
    assert.equal(scoreCourseTagInterest(profile, INTRO_AI_TAGS).score, 0);
    assert.ok(scoreCourseTagInterest(profile, DEPT_COURSES[1].ragTag).score > 0);
  });

  test('profile 的 tagInterests 帶豁免標記，只出現在被選的 too_common 標籤上', () => {
    const profile = profileWith([aiSelection([AI.id, DL.id])]);
    const flags = Object.fromEntries(profile.tagInterests.map(item => [item.canonicalName, item.selectionScoringExempt === true]));
    assert.equal(flags['人工智慧'], true);
    assert.equal(flags['深度學習'], false);
  });
});

describe('ADR-026 策畫選項：保存驗證', () => {
  const FILTERS = { department: '資訊工程學系', gradeLevel: 3, className: '資訊三甲' };
  const getMenu = async () => ({
    scopeReady: true, grouped: { department: DEPT_COURSES, generalEducation: [], outside: [] },
  });
  const sanitize = (selections, filters = FILTERS) => sanitizeInterestSelectionsForSave(
    { selections, previousSelections: [], filters }, { getMenu },
  );

  test('資工學生：候選池命中的人工智慧、機器學習保留；池裡沒有的電腦視覺被丟掉並警告', async () => {
    const vision = tag('電腦視覺');
    const result = await sanitize([aiSelection([AI.id, ML.id, vision.id])]);
    assert.equal(result.status, 'verified');
    assert.deepEqual(result.selections[0].tagIds, [AI.id, ML.id]);
    assert.deepEqual(result.warnings.map(item => [item.tagId, item.reason]), [[vision.id, SELECTION_WARNING.TAG_NOT_IN_POOL]]);
  });

  test('非資工學生送 curated_ai：這個選項不適用，整筆丟掉', async () => {
    const result = await sanitize([aiSelection([AI.id])], { ...FILTERS, department: '企業管理學系' });
    assert.equal(result.selections.length, 0);
    assert.equal(result.warnings[0].reason, SELECTION_WARNING.CATEGORY_NOT_IN_POOL);
  });

  test('curated_ai 放在通識組：層級不符', async () => {
    const result = await sanitize([{ ...aiSelection([AI.id]), group: 'generalEducation', level: 'main' }]);
    assert.equal(result.warnings[0].reason, SELECTION_WARNING.WRONG_LEVEL);
  });

  test('collectCuratedOptionTags 與選單用同一套命中規則', () => {
    const { tags } = collectCuratedOptionTags(DEPT_COURSES, option);
    const [menuOption] = buildCuratedTopicOptions(DEPT_COURSES, '資訊工程學系');
    assert.deepEqual(tags, menuOption.tags);
  });
});
