import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { interestTagCatalog } from '../src/data/interestTagCatalog.js';
import { isSelectableInterestTag } from '../src/data/interestTagEligibility.js';
import {
  SELECTION_IGNORE_REASON,
  lookupInterestCategory,
  resolveInterestSelections,
} from '../src/data/interestSelections.js';
import {
  buildExplicitTagInterest,
  buildTagInterestSnapshot,
  computeTagInterestProfile,
} from '../src/skills/tagInterestLearning.js';
import { priorSignature } from '../src/services/tagInterestService.js';

// 測試資料一律從真實標籤目錄抽樣，不寫死標籤名稱：目錄更版時，測試要的是「某個大類別底下
// 有幾個可選標籤」這種結構，而不是某個特定的標籤。
const selectable = interestTagCatalog.canonicalTags.filter(isSelectableInterestTag);

function groupSelectableBy(keyOf) {
  const map = new Map();
  for (const tag of selectable) {
    for (const assignment of tag.categoryAssignments) {
      const key = keyOf(assignment);
      if (!key) continue;
      if (!map.has(key)) map.set(key, new Map());
      map.get(key).set(tag.id, tag);
    }
  }
  return map;
}

const byMain = groupSelectableBy(a => a.mainCategoryId);
const bySub = groupSelectableBy(a => a.subcategoryId);

// 可選標籤最多的大類別，和第二多的（用來證明「跨分類」的隔離）。
const mainsBySize = [...byMain].sort((a, b) => b[1].size - a[1].size);
const [mainId, mainTagMap] = mainsBySize[0];
const [otherMainId, otherMainTagMap] = mainsBySize.find(([id, map]) => (
  id !== mainId && [...map.keys()].some(tagId => !mainTagMap.has(tagId))
));
const [tagA, tagB, tagC] = [...mainTagMap.values()];
const [subId, subTagMap] = [...bySub].find(([, map]) => map.size >= 2);
const [subTagA, subTagB] = [...subTagMap.values()];

const singleCourseTag = interestTagCatalog.canonicalTags.find(tag => (
  tag.eligibility?.exclusionReason === 'single_course'
  && tag.categoryAssignments.some(a => a.mainCategoryId === mainId)
));
const tooCommonTag = interestTagCatalog.canonicalTags.find(tag => (
  tag.eligibility?.exclusionReason === 'too_common'
));
const foreignTag = [...otherMainTagMap.values()].find(tag => !mainTagMap.has(tag.id));

const selection = (group, categoryId, tagIds = [], extra = {}) => ({
  group,
  categoryId,
  level: categoryId.startsWith('sub_') ? 'sub' : 'main',
  mode: 'followup',
  tagIds,
  ...extra,
});

describe('Step B：目錄感知的選擇解析（interestSelections.js）', () => {
  test('測試前提：目錄裡有足夠的可選標籤可抽樣', () => {
    assert.ok(tagA && tagB && tagC, '最大的大類別至少要有 3 個可選標籤');
    assert.ok(subTagA && subTagB, '至少要有一個子類別有 2 個可選標籤');
    assert.ok(singleCourseTag, '該大類別下要有單課標籤，才能測「可學習但不可跨課」');
    assert.ok(tooCommonTag && foreignTag);
  });

  test('SP1 分類 ID 對照：大類別、子類別、未知與空值', () => {
    assert.deepEqual(
      lookupInterestCategory(mainId),
      { type: 'main', mainCategoryId: mainId, subcategoryId: null, name: lookupInterestCategory(mainId).name }
    );
    const sub = lookupInterestCategory(subId);
    assert.equal(sub.type, 'subcategory');
    assert.equal(sub.subcategoryId, subId);
    assert.ok(sub.mainCategoryId.startsWith('main_'));
    for (const bad of ['main_不存在', '', null, undefined, '資訊安全與隱私']) {
      assert.equal(lookupInterestCategory(bad), null, '名稱不是 ID，不得被當成分類');
    }
  });

  test('SP2 合格的選擇：分類與標籤都留下，標籤記錄來自哪一組', () => {
    const result = resolveInterestSelections([
      selection('outside', mainId, [tagA.id, tagB.id]),
    ]);
    assert.equal(result.categories.length, 1);
    assert.deepEqual(result.tags.map(item => item.tag.id), [tagA.id, tagB.id]);
    assert.deepEqual(result.tags[0].from, [{ group: 'outside', categoryId: mainId }]);
    assert.deepEqual(result.ignored, []);
  });

  test('SP3 同一個標籤從兩組選到只留一份，但兩個來源都記錄', () => {
    const result = resolveInterestSelections([
      selection('generalEducation', mainId, [tagA.id]),
      selection('outside', mainId, [tagA.id, tagB.id]),
    ]);
    assert.deepEqual(result.tags.map(item => item.tag.id), [tagA.id, tagB.id]);
    assert.deepEqual(
      result.tags.find(item => item.tag.id === tagA.id).from.map(source => source.group),
      ['generalEducation', 'outside']
    );
    assert.equal(result.categories.length, 1, '同一個分類只留一份');
  });

  test('SP4 只選類別、沒有標籤：分類保留，沒有任何標籤', () => {
    const result = resolveInterestSelections([selection('outside', mainId, [])]);
    assert.equal(result.categories.length, 1);
    assert.deepEqual(result.tags, []);
    assert.deepEqual(result.ignored, []);
  });

  test('SP5 不合格的項目被忽略並附原因，其餘合格的照常保留', () => {
    const result = resolveInterestSelections([
      selection('outside', 'main_不存在', [tagA.id]),
      selection('outside', mainId, [
        tagA.id,
        'tag_不存在',
        singleCourseTag.id,
        tooCommonTag.id,
        foreignTag.id,
      ]),
    ]);

    assert.deepEqual(result.tags.map(item => item.tag.id), [tagA.id], '只有合格的標籤留下');
    const reasonOf = tagId => result.ignored.find(item => item.tagId === tagId)?.reason;
    assert.equal(reasonOf('tag_不存在'), SELECTION_IGNORE_REASON.UNKNOWN_TAG);
    assert.equal(reasonOf(singleCourseTag.id), SELECTION_IGNORE_REASON.TAG_NOT_SELECTABLE,
      '單課標籤可學習但不可跨課，存進先驗也不會影響別的課');
    assert.equal(reasonOf(tooCommonTag.id), SELECTION_IGNORE_REASON.TAG_NOT_SELECTABLE);
    assert.equal(reasonOf(foreignTag.id), SELECTION_IGNORE_REASON.TAG_NOT_IN_CATEGORY,
      '標籤存在也可選，但不屬於使用者當時選的分類');
    assert.ok(result.ignored.some(item => item.reason === SELECTION_IGNORE_REASON.UNKNOWN_CATEGORY));
  });

  test('SP6 子類別的選擇：標籤以該子類別為準，不是大類別', () => {
    const ok = resolveInterestSelections([selection('department', subId, [subTagA.id])]);
    assert.deepEqual(ok.tags.map(item => item.tag.id), [subTagA.id]);
    assert.equal(ok.categories[0].type, 'subcategory');
  });

  test('SP7 輸入不是陣列或含空項目時不丟例外', () => {
    for (const bad of [undefined, null, 'x', {}, [null], [undefined]]) {
      const result = resolveInterestSelections(bad);
      assert.deepEqual(result.tags, []);
    }
  });
});

describe('Step B：buildExplicitTagInterest 讀 interestSelections', () => {
  test('SP8 標籤得到 p0 = 1 並標記來源；分類只進 categoryInterests，不展開成底下的標籤', () => {
    const priors = buildExplicitTagInterest({
      interestSelections: [selection('outside', mainId, [tagA.id])],
    });

    assert.deepEqual(priors.tagPriors.map(tag => tag.canonicalTagId), [tagA.id]);
    assert.equal(priors.tagPriors[0].prior, 1);
    assert.equal(priors.tagPriors[0].source, 'selection');
    assert.equal(priors.categoryInterests.length, 1);
    assert.equal(priors.categoryInterests[0].mainCategoryId, mainId);
    assert.ok(mainTagMap.size > 1, '前提：這個大類別底下不只一個可選標籤');
    assert.equal(priors.tagPriors.length, 1, '類別底下其他可選標籤不得因此得到先驗');
  });

  test('SP9 只選類別（沒追問、略過、失敗）：有類別意圖，沒有任何標籤先驗', () => {
    const priors = buildExplicitTagInterest({
      interestSelections: [selection('outside', mainId, [])],
    });
    assert.equal(priors.categoryInterests.length, 1);
    assert.deepEqual(priors.tagPriors, []);
  });

  test('SP10 子類別選擇的分類型別是 subcategory，一樣不展開', () => {
    const priors = buildExplicitTagInterest({
      interestSelections: [selection('department', subId, [subTagA.id])],
    });
    assert.equal(priors.categoryInterests[0].type, 'subcategory');
    assert.equal(priors.categoryInterests[0].subcategoryId, subId);
    assert.deepEqual(priors.tagPriors.map(tag => tag.canonicalTagId), [subTagA.id]);
    assert.ok(subTagMap.size >= 2 && priors.tagPriors.length === 1);
  });

  test('SP11 名稱路徑不變；名稱與 ID 選到同一個標籤時只有一筆先驗', () => {
    const byNameOnly = buildExplicitTagInterest({ interests: [tagA.name] });
    assert.deepEqual(byNameOnly.tagPriors.map(tag => tag.canonicalTagId), [tagA.id]);
    assert.equal(byNameOnly.tagPriors[0].source, undefined, '名稱路徑沒有 source 欄位（維持原樣）');

    const both = buildExplicitTagInterest({
      interests: [tagA.name],
      interestSelections: [selection('outside', mainId, [tagA.id, tagB.id])],
    });
    assert.deepEqual(both.tagPriors.map(tag => tag.canonicalTagId).sort(), [tagA.id, tagB.id].sort());
  });

  test('SP12 同一個標籤從兩組選到只有一筆先驗，取消其中一組仍保留，取消兩組才消失', () => {
    const twoGroups = [
      selection('generalEducation', mainId, [tagA.id]),
      selection('outside', mainId, [tagA.id, tagB.id]),
    ];
    const ids = prefs => buildExplicitTagInterest(prefs).tagPriors.map(tag => tag.canonicalTagId).sort();

    assert.deepEqual(ids({ interestSelections: twoGroups }), [tagA.id, tagB.id].sort());
    assert.deepEqual(ids({ interestSelections: [twoGroups[1]] }), [tagA.id, tagB.id].sort(),
      '取消通識那組：標籤 A 還有系外那組撐著');
    assert.deepEqual(ids({ interestSelections: [twoGroups[0]] }), [tagA.id],
      '取消系外那組：B 只屬於系外，一起消失，A 由通識保留');
    assert.deepEqual(ids({ interestSelections: [] }), []);
  });

  test('SP13 不合格的標籤不進先驗，並出現在 ignoredSelections', () => {
    const priors = buildExplicitTagInterest({
      interestSelections: [selection('outside', mainId, [tagA.id, singleCourseTag.id, 'tag_不存在'])],
    });
    assert.deepEqual(priors.tagPriors.map(tag => tag.canonicalTagId), [tagA.id]);
    assert.equal(priors.ignoredSelections.length, 2);
  });

  test('SP14 沒有任何選擇時，輸出與只用名稱路徑時一樣（ignoredSelections 為空）', () => {
    const priors = buildExplicitTagInterest({ interests: [tagA.name] });
    assert.deepEqual(priors.ignoredSelections, []);
    assert.deepEqual(priors.categoryInterests, []);
  });
});

describe('Step B：先驗進入標籤分與快取簽章', () => {
  const NOW = '2026-10-09T00:00:00.000Z';
  const TERM = { academicYear: 115, semester: 'first' };

  function courseOf(tags) {
    return {
      sectionId: 101, catalogCourseCode: 'TEST1001', category: '選修', department: '資訊一甲',
      ragTag: tags.map(tag => tag.name),
    };
  }

  function negativeEventOn(tag) {
    const event = {
      eventId: 'neg-1',
      eventType: 'interest_exploration_feedback',
      timestamp: NOW,
      course: { catalogCourseCode: 'TEST1001', sectionId: 101 },
      term: TERM,
      source: 'exploration',
      interestFeedback: { response: 'not_interested', canonicalTagIds: [tag.id] },
    };
    return { ...event, tagInterestSnapshot: buildTagInterestSnapshot(event, courseOf([tag]), { resolved: true }) };
  }

  test('SP15 沒有行為證據時，選到的標籤分數是 1、沒有證據；只選類別則沒有任何標籤分', () => {
    const profile = computeTagInterestProfile([], {
      interestSelections: [selection('outside', mainId, [tagA.id])],
    }, { now: NOW, activeTerm: TERM });
    const interest = profile.tagInterests.find(tag => tag.canonicalTagId === tagA.id);
    assert.equal(interest.prior, 1);
    assert.equal(interest.score, 1);
    assert.equal(interest.hasEvidence, false);
    assert.equal(profile.tagInterests.length, 1);
    assert.equal(profile.categoryInterests.length, 1);

    const categoryOnly = computeTagInterestProfile([], {
      interestSelections: [selection('outside', mainId, [])],
    }, { now: NOW, activeTerm: TERM });
    assert.deepEqual(categoryOnly.tagInterests, []);
  });

  test('SP16 有舊的負向證據時，p0 = 1 不代表分數是 1：分數被證據拉低', () => {
    const profile = computeTagInterestProfile([negativeEventOn(tagA)], {
      interestSelections: [selection('outside', mainId, [tagA.id])],
    }, { now: NOW, activeTerm: TERM });
    const interest = profile.tagInterests.find(tag => tag.canonicalTagId === tagA.id);
    assert.equal(interest.prior, 1);
    assert.ok(interest.negativeEvidence > 0);
    assert.ok(interest.score < 1, `分數應低於 1，實得 ${interest.score}`);
    // (κ×p0 + P − N) ÷ (κ + P + N)，κ = 2、N = 1 → 1/3
    assert.ok(Math.abs(interest.score - 1 / 3) < 0.01, `預期約 0.333，實得 ${interest.score}`);
  });

  test('SP17 priorSignature：選擇改變才變，內容相同則不變，順序不影響', () => {
    const sign = selections => priorSignature(computeTagInterestProfile([], {
      interestSelections: selections,
    }, { now: NOW, activeTerm: TERM }));

    const none = sign([]);
    const withA = sign([selection('outside', mainId, [tagA.id])]);
    const withAB = sign([selection('outside', mainId, [tagA.id, tagB.id])]);
    const withBA = sign([selection('outside', mainId, [tagB.id, tagA.id])]);
    const categoryOnly = sign([selection('outside', mainId, [])]);

    assert.notEqual(withA, none, '選了標籤，簽章要變，快取才會重算');
    assert.notEqual(withAB, withA);
    assert.equal(withAB, withBA, '同一組標籤、不同順序，簽章相同');
    assert.notEqual(categoryOnly, none, '只選類別也改變 categoryInterests，簽章要變');
    assert.equal(sign([selection('outside', mainId, [tagA.id])]), withA, '重複計算結果相同');
  });
});
