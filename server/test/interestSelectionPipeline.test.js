import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { interestTagCatalog } from '../src/data/interestTagCatalog.js';
import { isSelectableInterestTag } from '../src/data/interestTagEligibility.js';
import { readInterestPreferences, mergeInterestPreferences } from '../src/data/interestPreferences.js';
import { normalizeProfile } from '../src/data/profileSchema.js';
import {
  buildTagInterestSnapshot,
  computeTagInterestProfile,
} from '../src/skills/tagInterestLearning.js';
import {
  DEFAULT_TAG_INTEREST_COURSE_ALPHA,
  buildTagInterestContext,
  scoreCandidateWithTagInterest,
  scorePlanTagInterest,
} from '../src/skills/tagInterestRanking.js';

// 整條訊號鏈（不連資料庫）：
//   interestSelections（存進 preferences_json）→ 讀回 Profile 頂層 → 標籤先驗 tagPriors p0 = 1
//   → 標籤分 tag_score → 單課 S_tag → 候選分 → 方案分
// 每個斷言都有「沒選」的對照組：只差有沒有 interestSelections，才能說差異是它造成的。

const NOW = '2026-10-09T00:00:00.000Z';
const TERM = { academicYear: 115, semester: 'first' };
const selectable = interestTagCatalog.canonicalTags.filter(isSelectableInterestTag);

// 在同一個大類別裡找三個可選標籤：A（會被選）、B（同類別但不選）、
// 再找另一個大類別的標籤 Z（完全無關）。
const byMain = new Map();
for (const tag of selectable) {
  const mainId = tag.categoryAssignments[0]?.mainCategoryId;
  if (!mainId) continue;
  if (!byMain.has(mainId)) byMain.set(mainId, []);
  byMain.get(mainId).push(tag);
}
const mains = [...byMain].sort((a, b) => b[1].length - a[1].length);
const [mainId, [tagA, tagB]] = mains[0];
const tagZ = mains.find(([id]) => id !== mainId)[1].find(tag => (
  !tag.categoryAssignments.some(a => a.mainCategoryId === mainId)
));

const selection = (group, categoryId, tagIds = []) => ({
  group, categoryId, level: 'main', mode: 'followup', tagIds,
});

// 三門候選課：只含 A、只含 B（同類別沒被選）、只含 Z（無關類別）、沒有可用標籤。
const candidates = [
  { sectionId: 1, ragTag: [tagA.name] },
  { sectionId: 2, ragTag: [tagB.name] },
  { sectionId: 3, ragTag: [tagZ.name] },
  { sectionId: 4, ragTag: [] },
];

function contextFor(prefs, events = []) {
  const profile = computeTagInterestProfile(events, prefs, { now: NOW, activeTerm: TERM });
  return buildTagInterestContext({
    mode: 'active', profileSource: 'explicit-prior', profile, candidates,
  });
}

function negativeEventOn(tag) {
  const course = { sectionId: 1, catalogCourseCode: 'TEST1', category: '選修', department: '資訊一甲', ragTag: [tag.name] };
  const event = {
    eventId: 'neg', eventType: 'interest_exploration_feedback', timestamp: NOW,
    course: { catalogCourseCode: 'TEST1', sectionId: 1 }, term: TERM, source: 'exploration',
    interestFeedback: { response: 'not_interested', canonicalTagIds: [tag.id] },
  };
  return { ...event, tagInterestSnapshot: buildTagInterestSnapshot(event, course, { resolved: true }) };
}

describe('Step B：interestSelections → S_tag 的整條管線（不連資料庫）', () => {
  test('測試前提：A、B 同大類別、Z 在別的大類別，且三者都是可選標籤', () => {
    assert.ok(tagA && tagB && tagZ);
    assert.notEqual(tagA.id, tagB.id);
    for (const tag of [tagA, tagB, tagZ]) assert.equal(isSelectableInterestTag(tag), true);
  });

  test('SPL1 儲存→讀回：選擇存進 preferences_json 後，能還原成 Profile 頂層並產生先驗', () => {
    const stored = mergeInterestPreferences(null, {
      interestSelections: [selection('outside', mainId, [tagA.id])],
    });
    const profile = normalizeProfile({ userId: 'D1', preferencesJson: stored });
    assert.equal(profile.interestSelections.length, 1);

    const reread = readInterestPreferences(profile);
    assert.deepEqual(reread.interestSelections[0].tagIds, [tagA.id]);

    const tagProfile = computeTagInterestProfile([], profile, { now: NOW, activeTerm: TERM });
    assert.deepEqual(tagProfile.tagInterests.map(tag => tag.canonicalTagId), [tagA.id]);
  });

  test('SPL2 A/B 對照：同一批候選課，只差有沒有選擇 → 只有被選標籤對應的課分數改變', () => {
    const without = contextFor({}).coursesBySectionId;
    const withSel = contextFor({
      interestSelections: [selection('outside', mainId, [tagA.id])],
    }).coursesBySectionId;

    // 沒選：每門課都沒有使用者訊號。
    for (const sectionId of ['1', '2', '3']) {
      assert.equal(without[sectionId].reason, 'no_user_signal', `課 ${sectionId} 沒選時不該有訊號`);
      assert.equal(without[sectionId].score, 0);
    }
    // 有選：只有含標籤 A 的課 1 變成 scored、分數 1。
    assert.equal(withSel['1'].reason, 'scored');
    assert.equal(withSel['1'].score, 1);
    assert.equal(withSel['1'].evidenceTagCount, 1);
    // 對照：同類別但沒被選的 B、無關類別的 Z、沒標籤的課，完全不變。
    assert.deepEqual(withSel['2'], without['2'], '同類別但沒被選的標籤不得受影響（類別不展開）');
    assert.deepEqual(withSel['3'], without['3']);
    assert.deepEqual(withSel['4'], without['4']);
    assert.equal(withSel['4'].reason, 'no_cross_course_match_tags');
  });

  test('SPL3 候選分：含被選標籤的課乘上 1 + α×S_tag，名次超過其他基礎分相同的課', () => {
    const scores = contextFor({
      interestSelections: [selection('outside', mainId, [tagA.id])],
    }).coursesBySectionId;
    const candidateScore = sectionId => scoreCandidateWithTagInterest({
      poolBaseScore: 100, courseTagScore: scores[sectionId].score,
    }).candidateScore;

    assert.equal(candidateScore('1'), 100 * (1 + DEFAULT_TAG_INTEREST_COURSE_ALPHA * 1));
    assert.equal(candidateScore('2'), 100 * (1 + DEFAULT_TAG_INTEREST_COURSE_ALPHA * 0));
    const ranking = ['1', '2', '3', '4'].sort((x, y) => candidateScore(y) - candidateScore(x));
    assert.equal(ranking[0], '1', '被選標籤的課名次第一');
  });

  test('SPL4 方案分：只有「有證據」的課進入平均；沒證據的課只算進覆蓋率', () => {
    const { coursesBySectionId } = contextFor({
      interestSelections: [selection('outside', mainId, [tagA.id])],
    });
    const plan = scorePlanTagInterest({
      freeChoiceCourses: [{ sectionId: 1 }, { sectionId: 2 }],
      coursesBySectionId,
      preferenceScore: 0.5,
    });
    assert.equal(plan.planTagScore, 1);
    assert.equal(plan.evidenceCourseCount, 1);
    assert.equal(plan.tagInterestCoverage, 0.5);
    assert.ok(plan.combinedPlanScore > 0.5, '方案分被標籤興趣放大');

    const noSelection = scorePlanTagInterest({
      freeChoiceCourses: [{ sectionId: 1 }, { sectionId: 2 }],
      coursesBySectionId: contextFor({}).coursesBySectionId,
      preferenceScore: 0.5,
    });
    assert.equal(noSelection.planTagScore, null);
    assert.equal(noSelection.combinedPlanScore, 0.5, '沒選時方案分完全不變');
  });

  test('SPL5 負向證據案例：先前表示過不感興趣的標籤，即使選了，單課分與候選分也低於「純先驗」', () => {
    const prefs = { interestSelections: [selection('outside', mainId, [tagA.id])] };
    const pure = contextFor(prefs).coursesBySectionId['1'];
    const afterNegative = contextFor(prefs, [negativeEventOn(tagA)]).coursesBySectionId['1'];

    assert.equal(pure.score, 1);
    assert.ok(afterNegative.score < 1, `有負向證據時分數應低於 1，實得 ${afterNegative.score}`);
    assert.ok(afterNegative.score < pure.score);

    const candidateScore = score => scoreCandidateWithTagInterest({
      poolBaseScore: 100, courseTagScore: score,
    }).candidateScore;
    assert.ok(candidateScore(afterNegative.score) < candidateScore(pure.score));
  });

  test('SPL6 只選類別（沒追問、略過或失敗）：排課沒有任何變化', () => {
    const categoryOnly = contextFor({
      interestSelections: [selection('outside', mainId, [])],
    }).coursesBySectionId;
    assert.deepEqual(categoryOnly, contextFor({}).coursesBySectionId,
      '類別本身不展開成標籤，所以沒有任何課的分數會因此改變');
  });

  test('SPL7 跨組：同一個標籤在兩組都選到，取消其中一組後分數仍在；兩組都取消才回到沒選', () => {
    const both = [
      selection('generalEducation', mainId, [tagA.id]),
      selection('outside', mainId, [tagA.id]),
    ];
    const scoreOf = selections => contextFor({ interestSelections: selections }).coursesBySectionId['1'].score;

    assert.equal(scoreOf(both), 1);
    assert.equal(scoreOf([both[1]]), 1, '取消通識那組：系外那組仍撐著');
    assert.equal(scoreOf([both[0]]), 1, '取消系外那組：通識那組仍撐著');
    assert.equal(scoreOf([]), 0, '兩組都取消：回到沒選');
  });

  test('SPL8 無效的標籤 ID 不會影響任何課，也不會讓管線出錯', () => {
    const context = contextFor({
      interestSelections: [selection('outside', mainId, ['tag_不存在', tagZ.id])],
    }).coursesBySectionId;
    // tagZ 不屬於 mainId 這個大類別：被擋下，所以含 Z 的課 3 沒有訊號。
    assert.equal(context['3'].reason, 'no_user_signal');
    assert.equal(context['1'].reason, 'no_user_signal');
  });
});
