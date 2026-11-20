import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { interestTagCatalog } from '../src/data/interestTagCatalog.js';
import { isSelectableInterestTag } from '../src/data/interestTagEligibility.js';
import {
  SELECTION_WARNING,
  sanitizeInterestSelectionsForSave,
} from '../src/services/interestSelectionService.js';

// 保存前的驗證（Step D）：標籤必須屬於「這一組、這個分類」在這位學生的候選池裡的可選標籤。
// 候選池用注入的假選單，不連資料庫。

const selectable = interestTagCatalog.canonicalTags.filter(isSelectableInterestTag);
const byMain = new Map();
const bySub = new Map();
for (const tag of selectable) {
  for (const a of tag.categoryAssignments) {
    if (!byMain.has(a.mainCategoryId)) byMain.set(a.mainCategoryId, new Map());
    byMain.get(a.mainCategoryId).set(tag.id, tag);
    if (!bySub.has(a.subcategoryId)) bySub.set(a.subcategoryId, new Map());
    bySub.get(a.subcategoryId).set(tag.id, tag);
  }
}
const mainsBySize = [...byMain].sort((a, b) => b[1].size - a[1].size);
const [mainId, mainTags] = mainsBySize[0];
const [tagA, tagB, tagC] = [...mainTags.values()];
const [subId, subTags] = [...bySub].find(([, map]) => map.size >= 2);
const [subTagA] = [...subTags.values()];

let sequence = 0;
const courseWith = tag => {
  sequence += 1;
  return { catalogCourseCode: `S${sequence}`, courseId: `S${sequence}-1`, name: `課${sequence}`, ragTag: [tag.name] };
};
const menuOf = grouped => async () => ({
  scopeReady: true, grouped: { department: [], generalEducation: [], outside: [], ...grouped },
});
const FILTERS = { department: '資訊工程學系', gradeLevel: 3, className: '資訊三甲' };
const sel = (group, categoryId, tagIds, extra = {}) => ({
  group, categoryId, level: categoryId.startsWith('sub_') ? 'sub' : 'main', mode: 'followup', tagIds, ...extra,
});
const sanitize = (selections, previous, getMenu) => sanitizeInterestSelectionsForSave(
  { selections, previousSelections: previous, filters: FILTERS }, { getMenu },
);

describe('Step D：保存前的選擇驗證 sanitizeInterestSelectionsForSave', () => {
  test('測試前提：抽樣用的標籤與分類', () => {
    assert.ok(tagA && tagB && tagC && subTagA);
  });

  test('SS1 合格的選擇原樣保留，狀態 verified', async () => {
    const result = await sanitize(
      [sel('outside', mainId, [tagA.id, tagB.id])], [],
      menuOf({ outside: [courseWith(tagA), courseWith(tagB)] }),
    );
    assert.equal(result.status, 'verified');
    assert.deepEqual(result.selections[0].tagIds, [tagA.id, tagB.id]);
    assert.deepEqual(result.warnings, []);
  });

  test('SS2 標籤不在這位學生的候選池內：丟掉並回報，同一筆其他合格的標籤保留', async () => {
    // 池裡只有 A；B 在目錄裡存在、可選、也屬於這個分類，但這位學生的候選池沒有任何課帶它。
    const result = await sanitize(
      [sel('outside', mainId, [tagA.id, tagB.id])], [], menuOf({ outside: [courseWith(tagA)] }),
    );
    assert.deepEqual(result.selections[0].tagIds, [tagA.id]);
    assert.deepEqual(result.warnings, [{
      group: 'outside', categoryId: mainId, tagId: tagB.id, reason: SELECTION_WARNING.TAG_NOT_IN_POOL,
    }]);
  });

  test('SS3 未知的分類 ID 整筆丟掉；組別與層級不符（本系要子類別、系外要大類別）也丟掉', async () => {
    const getMenu = menuOf({ outside: [courseWith(tagA)], department: [courseWith(subTagA)] });
    const result = await sanitize([
      sel('outside', 'main_不存在', [tagA.id]),
      sel('department', mainId, [tagA.id]), // 本系卻給大類別
      sel('outside', subId, [subTagA.id]), // 系外卻給子類別
    ], [], getMenu);
    assert.deepEqual(result.selections, []);
    assert.deepEqual(
      result.warnings.map(item => item.reason),
      [SELECTION_WARNING.UNKNOWN_CATEGORY, SELECTION_WARNING.WRONG_LEVEL, SELECTION_WARNING.WRONG_LEVEL],
    );
  });

  test('SS4 分類本身不在這一組的候選池：整筆丟掉', async () => {
    const result = await sanitize([sel('outside', mainId, [tagA.id])], [], menuOf({ outside: [] }));
    assert.deepEqual(result.selections, []);
    assert.equal(result.warnings[0].reason, SELECTION_WARNING.CATEGORY_NOT_IN_POOL);
  });

  test('SS5 跨組隔離：標籤只在系外池有課，選在通識組就被擋下，選在系外組則保留', async () => {
    const getMenu = menuOf({ outside: [courseWith(tagA)], generalEducation: [courseWith(tagB)] });
    const result = await sanitize([
      sel('generalEducation', mainId, [tagA.id]), // A 只在系外池
      sel('outside', mainId, [tagA.id]),
    ], [], getMenu);
    const byGroup = Object.fromEntries(result.selections.map(item => [item.group, item.tagIds]));
    assert.deepEqual(byGroup.outside, [tagA.id]);
    assert.deepEqual(byGroup.generalEducation, [], '通識組的候選池沒有 A，這筆的標籤被丟掉，分類仍保留');
  });

  test('SS6 沒變的選擇原樣保留、完全不載入候選池——即使新學期的候選池已經對不上舊答案', async () => {
    let loaded = 0;
    const previous = [sel('outside', mainId, [tagA.id])];
    const result = await sanitize([sel('outside', mainId, [tagA.id])], previous, async () => {
      loaded += 1;
      return { scopeReady: true, grouped: { department: [], generalEducation: [], outside: [] } };
    });
    assert.equal(loaded, 0);
    assert.equal(result.status, 'unchanged');
    assert.deepEqual(result.selections[0].tagIds, [tagA.id]);
  });

  test('SS7 變動與新增的才驗證，沒變的保留（標籤順序不同視為沒變）', async () => {
    const previous = [sel('outside', mainId, [tagA.id, tagB.id])];
    const result = await sanitize([
      sel('outside', mainId, [tagB.id, tagA.id]), // 同一組標籤、不同順序：沒變
      sel('generalEducation', mainId, [tagC.id]), // 新增，但池內沒有 C
    ], previous, menuOf({ generalEducation: [courseWith(tagA)] }));

    assert.equal(result.status, 'verified');
    const outside = result.selections.find(item => item.group === 'outside');
    assert.deepEqual([...outside.tagIds].sort(), [tagA.id, tagB.id].sort());
    assert.deepEqual(result.selections.find(item => item.group === 'generalEducation').tagIds, []);
  });

  test('SS8 候選池載入失敗：不接受新的標籤。變動的選擇保留已保存的標籤，新增的只記類別，沒變的保留', async () => {
    const previous = [sel('outside', mainId, [tagA.id]), sel('generalEducation', mainId, [tagB.id])];
    const result = await sanitize([
      sel('outside', mainId, [tagA.id, tagC.id]), // 變動：新增 C
      sel('generalEducation', mainId, [tagB.id]), // 沒變
      sel('department', subId, [subTagA.id]), // 新增
      sel('outside', 'main_不存在', [tagA.id]), // 目錄裡沒有的分類
    ], previous, async () => { throw new Error('資料庫暫時失敗'); });

    assert.equal(result.status, 'unverified');
    const byKey = Object.fromEntries(result.selections.map(item => [`${item.group}:${item.categoryId}`, item.tagIds]));
    assert.deepEqual(byKey[`outside:${mainId}`], [tagA.id], '變動的選擇退回已保存的標籤，C 不被接受');
    assert.deepEqual(byKey[`generalEducation:${mainId}`], [tagB.id]);
    assert.deepEqual(byKey[`department:${subId}`], [], '新增的選擇只記類別，標籤無法驗證所以不收');
    assert.ok(!('outside:main_不存在' in byKey), '目錄裡沒有的分類仍然丟掉');
    assert.ok(result.warnings.every(item => item.reason === SELECTION_WARNING.VERIFICATION_UNAVAILABLE));
  });

  test('SS9 學生範圍不完整（缺班別，scopeReady 為 false）時同樣視為無法驗證', async () => {
    const result = await sanitize([sel('outside', mainId, [tagA.id])], [], async () => ({ scopeReady: false }));
    assert.equal(result.status, 'unverified');
    assert.deepEqual(result.selections[0].tagIds, []);
  });

  test('SS10 清空：送空陣列代表清除所有選擇，不需要載入候選池', async () => {
    let loaded = 0;
    const result = await sanitize([], [sel('outside', mainId, [tagA.id])], async () => { loaded += 1; return {}; });
    assert.deepEqual(result.selections, []);
    assert.equal(loaded, 0);
  });

  test('SS11 重複與壞形狀的項目先被正規化掉；同一個 (組別, 分類) 以最後一筆為準', async () => {
    const result = await sanitize([
      sel('outside', mainId, [tagA.id]),
      { group: '不存在的組別', categoryId: mainId, tagIds: [tagA.id] },
      null,
      sel('outside', mainId, [tagB.id]),
    ], [], menuOf({ outside: [courseWith(tagA), courseWith(tagB)] }));
    assert.equal(result.selections.length, 1);
    assert.deepEqual(result.selections[0].tagIds, [tagB.id]);
  });

  test('SS12 子類別選擇（本系組）：標籤以該子類別在本系候選池裡的標籤為準', async () => {
    const ok = await sanitize([sel('department', subId, [subTagA.id], { mode: 'direct' })], [],
      menuOf({ department: [courseWith(subTagA)] }));
    assert.deepEqual(ok.selections[0].tagIds, [subTagA.id]);
    assert.equal(ok.selections[0].mode, 'direct');

    const missing = await sanitize([sel('department', subId, [subTagA.id])], [], menuOf({ department: [] }));
    assert.deepEqual(missing.selections, []);
  });
});
