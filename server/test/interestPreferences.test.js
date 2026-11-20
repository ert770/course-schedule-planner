import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  mergeInterestPreferences,
  normalizeInterestList,
  normalizeInterestSelections,
  readInterestPreferences,
} from '../src/data/interestPreferences.js';
import { hasExplicitPreferences } from '../src/services/preferenceLearningService.js';
import { isSelectableInterestTag } from '../src/data/interestTagEligibility.js';
import { interestTagCatalog } from '../src/data/interestTagCatalog.js';

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
      interestSelections: [],
    });
  });
});

describe('課程主題選擇結果 interestSelections（Step A：資料模型）', () => {
  const selection = (group, categoryId, tagIds, extra = {}) => ({
    group, categoryId, level: categoryId.startsWith('sub_') ? 'sub' : 'main',
    mode: 'followup', tagIds, ...extra,
  });

  test('IS1 形狀正規化：未知組別、空 categoryId、非物件項目被丟掉，tagIds 去空白去重', () => {
    const normalized = normalizeInterestSelections([
      { group: 'outside', categoryId: ' main_a ', tagIds: [' t1 ', 't1', '', 't2'] },
      { group: '不存在的組別', categoryId: 'main_b', tagIds: ['t9'] },
      { group: 'outside', categoryId: '   ', tagIds: ['t9'] },
      null,
      'main_c',
      ['main_d'],
    ]);

    assert.equal(normalized.length, 1);
    assert.deepEqual(normalized[0], {
      group: 'outside', categoryId: 'main_a', level: 'main', mode: 'followup', tagIds: ['t1', 't2'],
    });
  });

  test('IS2 同一個 (group, categoryId) 以最後一筆為準；不同組別的同名分類互不影響', () => {
    const normalized = normalizeInterestSelections([
      selection('generalEducation', 'main_lang', ['jp', 'kr']),
      selection('outside', 'main_lang', ['es']),
      selection('generalEducation', 'main_lang', ['jp']),
    ]);

    assert.equal(normalized.length, 2);
    const byGroup = Object.fromEntries(normalized.map(item => [item.group, item.tagIds]));
    assert.deepEqual(byGroup, { generalEducation: ['jp'], outside: ['es'] });
  });

  test('IS3 level 缺漏時由 categoryId 前綴推得；mode 只接受 direct，其餘一律視為 followup', () => {
    const [sub, main, odd] = normalizeInterestSelections([
      { group: 'department', categoryId: 'sub_x', mode: 'direct' },
      { group: 'outside', categoryId: 'main_y' },
      { group: 'outside', categoryId: 'main_z', level: 'weird', mode: 'whatever' },
    ]);
    assert.equal(sub.level, 'sub');
    assert.equal(sub.mode, 'direct');
    assert.equal(main.level, 'main');
    assert.equal(odd.level, 'main');
    assert.equal(odd.mode, 'followup');
  });

  test('IS4 不是陣列的輸入一律得到空陣列（不丟例外）', () => {
    for (const bad of [undefined, null, 'x', 5, {}, { group: 'outside' }]) {
      assert.deepEqual(normalizeInterestSelections(bad), []);
    }
  });

  test('IS5 寫入時只動 interestSelections，保留 interests、學習權重與其他鍵', () => {
    const merged = mergeInterestPreferences({
      schemaVersion: 1,
      values: { interests: ['資安'], learnedWeights: { interest: 1.4 }, untouched: true },
    }, {
      interestSelections: [selection('outside', 'main_lang', ['jp'])],
    });

    assert.deepEqual(merged.values.interests, ['資安']);
    assert.deepEqual(merged.values.learnedWeights, { interest: 1.4 });
    assert.equal(merged.values.untouched, true);
    assert.deepEqual(merged.values.interestSelections.map(item => item.categoryId), ['main_lang']);
  });

  test('IS6 更新其他興趣欄位時，不會洗掉已存的 interestSelections', () => {
    const stored = mergeInterestPreferences(null, {
      interestSelections: [selection('outside', 'main_lang', ['jp'])],
    });
    const after = mergeInterestPreferences(stored, { interests: ['雲端'] });

    assert.deepEqual(after.values.interests, ['雲端']);
    assert.equal(after.values.interestSelections.length, 1);
    assert.deepEqual(after.values.interestSelections[0].tagIds, ['jp']);
  });

  test('IS7 傳入空陣列代表使用者清空所有選擇', () => {
    const stored = mergeInterestPreferences(null, {
      interestSelections: [selection('outside', 'main_lang', ['jp'])],
    });
    const cleared = mergeInterestPreferences(stored, { interestSelections: [] });
    assert.deepEqual(cleared.values.interestSelections, []);
  });

  test('IS8 讀取：頂層欄位優先於 preferences_json，並且重複正規化結果不變（冪等）', () => {
    const fromJson = readInterestPreferences({
      preferencesJson: {
        schemaVersion: 1,
        values: { interestSelections: [selection('department', 'sub_sec', ['t1'], { mode: 'direct' })] },
      },
    });
    assert.equal(fromJson.interestSelections[0].mode, 'direct');

    const overridden = readInterestPreferences({
      interestSelections: [selection('outside', 'main_a', ['t2'])],
      preferencesJson: {
        schemaVersion: 1,
        values: { interestSelections: [selection('department', 'sub_sec', ['t1'])] },
      },
    });
    assert.deepEqual(overridden.interestSelections.map(item => item.group), ['outside']);

    const twice = readInterestPreferences(overridden);
    assert.deepEqual(twice.interestSelections, overridden.interestSelections);
  });
});

describe('isSelectableInterestTag：選單、追問、保存、先驗共用的資格判定（Step A）', () => {
  const byReason = reason => interestTagCatalog.canonicalTags
    .find(tag => tag.eligibility?.exclusionReason === reason);

  test('IS9 同時可學習且可跨課配對才算；單課標籤、too_common 都不算', () => {
    const eligible = interestTagCatalog.canonicalTags
      .find(tag => tag.eligibility?.exclusionReason === null);
    assert.ok(eligible, '目錄應至少有一個可選標籤');
    assert.equal(isSelectableInterestTag(eligible), true);

    const singleCourse = byReason('single_course');
    assert.ok(singleCourse, '目錄應有單課標籤');
    assert.equal(singleCourse.eligibility.interestLearningEligible, true, '單課標籤可學習…');
    assert.equal(isSelectableInterestTag(singleCourse), false, '…但不可跨課配對，所以不可選');

    const tooCommon = byReason('too_common');
    assert.ok(tooCommon, '目錄應有 too_common 標籤');
    assert.equal(isSelectableInterestTag(tooCommon), false);
  });

  test('IS10 缺資料或非物件一律視為不可選，不丟例外', () => {
    for (const bad of [undefined, null, {}, { eligibility: {} }, { eligibility: { interestLearningEligible: true } }]) {
      assert.equal(isSelectableInterestTag(bad), false);
    }
  });

  test('IS11 也接受 resolveInterestTags 解析後、附 eligibility 的標籤形狀', () => {
    assert.equal(isSelectableInterestTag({
      eligibility: { interestLearningEligible: true, crossCourseMatchEligible: true },
    }), true);
  });
});

describe('Step A：只選了課程主題的使用者也算「有表達偏好」', () => {
  test('IS12 只有 interestSelections 時 hasExplicitPreferences 為 true；空陣列為 false', () => {
    assert.equal(hasExplicitPreferences({
      interestSelections: [{ group: 'outside', categoryId: 'main_x', tagIds: [] }],
    }), true);
    assert.equal(hasExplicitPreferences({ interestSelections: [] }), false);
    assert.equal(hasExplicitPreferences({}), false);
  });
});
