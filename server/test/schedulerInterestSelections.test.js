// ADR-031：課程主題問答勾選的標籤（interestTagIds）併進排課的「興趣」軸。
// 每項都有「沒勾」的對照組：同一批候選，只差有沒有 interestTagIds。

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { interestTagCatalog } from '../src/data/interestTagCatalog.js';
import { isSelectableInterestTag } from '../src/data/interestTagEligibility.js';
import { generateSchedule } from '../src/skills/scheduler.js';
import { resolveScoringPolicy } from '../src/skills/scoringPolicy.js';
import { buildScheduleConstraints } from '../src/services/constraintService.js';
import { makeCourse } from './fixtures.js';

const selectable = interestTagCatalog.canonicalTags.filter(isSelectableInterestTag);
const tagX = selectable[0];
const tagY = selectable.find(tag => tag.id !== tagX.id);

const at = (id, day, start, overrides = {}) => makeCourse(id, {
  dayOfWeek: day, startPeriod: start, endPeriod: start + 1, category: '一般選修', ...overrides,
});
// 10 門普通選修＋1 門帶標籤 X 的課，學分上限只排得下 4 門，興趣軸才有取捨空間。
function pool() {
  const courses = [];
  let id = 100;
  for (let day = 1; day <= 5; day += 1) {
    for (const start of [3, 7]) {
      id += 1;
      courses.push(at(id, day, start, { ragTag: [`無關主題${id}`] }));
    }
  }
  courses.push(at(999, 1, 5, { ragTag: [tagX.name] }));
  return courses;
}
const base = { minCredits: 0, maxCredits: 12 };
const ticked = [{ id: tagX.id, name: tagX.name }];
const courseOf = (result, id) => result.plans.flatMap(plan => plan.schedule).find(course => course.id === id);
const breakdownOf = (course, name) => course?.recommendationReason?.scoreBreakdown
  ?.find(item => item.component === name)?.value ?? 0;

describe('SI 課程主題問答勾選的標籤 → 排課興趣軸', () => {
  test('fixture：找得到兩個可選標籤', () => {
    assert.ok(tagX && tagY);
  });

  test('SP 只有 interestTagIds 時興趣方向為 1；空陣列為 0', () => {
    assert.equal(resolveScoringPolicy({ interestTagIds: ticked }).weights.interest, 1);
    assert.equal(resolveScoringPolicy({ interestTagIds: [] }).weights.interest, 0);
    assert.equal(resolveScoringPolicy({}).weights.interest, 0);
  });

  test('SI1 勾了 X：含 X 的課被排進主方案，有 interest 分數，推薦理由列出 X（interestSelections）', () => {
    const without = generateSchedule(pool(), base);
    const withTag = generateSchedule(pool(), { ...base, interestTagIds: ticked });

    const course = withTag.plans[0].schedule.find(item => item.id === 999);
    assert.ok(course, '勾選標籤的課應排進主方案');
    assert.ok(breakdownOf(course, 'interest') > 0);
    const matched = course.recommendationReason.matchedPreferences
      .filter(item => item.preferenceId === 'interestSelections');
    assert.deepEqual(matched.map(item => item.label), [tagX.name]);
    assert.equal(breakdownOf(courseOf(without, 999), 'interest'), 0, '沒勾時沒有 interest 分數');
  });

  test('SI2 只有勾選標籤：hasExpressedPreference 為 true、preferenceProfile.interest > 0', () => {
    const withTag = generateSchedule(pool(), { ...base, interestTagIds: ticked });
    const without = generateSchedule(pool(), base);
    assert.equal(withTag.hasExpressedPreference, true);
    assert.ok(withTag.preferenceProfile.interest > 0);
    assert.equal(without.preferenceProfile.interest, 0);
  });

  test('SI3 聊天關鍵字與勾選標籤並存：關鍵字照常命中，兩種命中分開列在推薦理由', () => {
    const courses = pool();
    courses.push(at(998, 2, 5, { ragTag: ['資訊安全'] }));
    const result = generateSchedule(courses, { ...base, maxCredits: 15, interests: ['資訊安全'], interestTagIds: ticked });
    const keywordCourse = courseOf(result, 998);
    const tagCourse = courseOf(result, 999);
    assert.ok(keywordCourse && tagCourse, '關鍵字命中與標籤命中的課都應排入');
    assert.deepEqual(keywordCourse.recommendationReason.matchedPreferences
      .filter(item => item.type === 'interest').map(item => [item.preferenceId, item.label]), [['interests', '資訊安全']]);
    assert.deepEqual(tagCourse.recommendationReason.matchedPreferences
      .filter(item => item.type === 'interest').map(item => [item.preferenceId, item.label]), [['interestSelections', tagX.name]]);
  });

  test('SI5 不稀釋：加上勾選標籤後，關鍵字命中課的 interest 分數不變（關鍵字與標籤各自算比例取大者）', () => {
    const courses = () => [...pool(), at(998, 2, 5, { ragTag: ['資訊安全'] })];
    const constraints = { ...base, maxCredits: 15, interests: ['資訊安全'] };
    const keywordOnly = generateSchedule(courses(), constraints);
    const withTags = generateSchedule(courses(), {
      ...constraints, interestTagIds: [...ticked, { id: tagY.id, name: tagY.name }],
    });
    const before = breakdownOf(courseOf(keywordOnly, 998), 'interest');
    const after = breakdownOf(courseOf(withTags, 998), 'interest');
    assert.ok(before > 0);
    assert.equal(after, before, '聊天關鍵字的興趣分不可因勾選標籤變多而被稀釋');
  });

  test('SI4 沒有勾選也沒有關鍵字時，排課結果與加這個功能前相同（interestTagIds 為空陣列）', () => {
    const a = generateSchedule(pool(), base);
    const b = generateSchedule(pool(), { ...base, interestTagIds: [] });
    const fingerprint = result => result.plans.map(plan => plan.schedule.map(course => course.id).sort().join(','));
    assert.deepEqual(fingerprint(b), fingerprint(a));
  });
});

describe('SC constraintService 產生 interestTagIds', () => {
  const tick = tag => ({
    group: 'outside', categoryId: tag.categoryAssignments[0].mainCategoryId, level: 'main', mode: 'followup', tagIds: [tag.id],
  });

  test('SC1 從 profile 的 interestSelections 取勾選的標籤（依 ID 去重）', () => {
    const merged = buildScheduleConstraints({}, {
      interestSelections: [tick(tagX), { ...tick(tagX), group: 'department' }, tick(tagY)],
    });
    assert.deepEqual(merged.interestTagIds.map(tag => tag.id).sort(), [tagX.id, tagY.id].sort());
    assert.equal(merged.interestTagIds.find(tag => tag.id === tagX.id).name, tagX.name);
  });

  test('SC2 只選方向、沒勾標籤時是空陣列', () => {
    const merged = buildScheduleConstraints({}, { interestSelections: [{ ...tick(tagX), tagIds: [] }] });
    assert.deepEqual(merged.interestTagIds, []);
  });

  test('SC3 修法 A：這次請求帶了 interests 或 preferredKeywords 時，興趣軸只用這次的關鍵字', () => {
    const saved = { interestSelections: [tick(tagX)] };
    const viaInterests = buildScheduleConstraints({ interests: ['資訊安全'] }, saved);
    assert.deepEqual(viaInterests.interests, ['資訊安全']);
    assert.deepEqual(viaInterests.interestTagIds, []);
    assert.deepEqual(buildScheduleConstraints({ preferredKeywords: ['雲端'] }, saved).interestTagIds, []);
  });

  test('SC4 這次沒帶關鍵字（空陣列、只給修課路徑或其他條件）時，照常使用已存的勾選', () => {
    const saved = { interestSelections: [tick(tagX)], interests: ['舊關鍵字'] };
    for (const input of [{}, { interests: [] }, { preferredTrack: '網路安全類' }, { noMorningClasses: true }]) {
      assert.deepEqual(buildScheduleConstraints(input, saved).interestTagIds.map(tag => tag.id), [tagX.id],
        JSON.stringify(input));
    }
  });
});
