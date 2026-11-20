import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { interestTagCatalog } from '../src/data/interestTagCatalog.js';
import { isSelectableInterestTag } from '../src/data/interestTagEligibility.js';
import {
  EXCLUDED_MAIN_CATEGORY_NAMES,
  HIDDEN_SUBCATEGORIES,
} from '../src/data/interestMenuConfig.js';
import {
  aggregateInterestCategories,
  buildInterestTopicGroups,
  getInterestCategoryCandidates,
} from '../src/data/interestTopicGroups.js';

// 合成課程一律用真實標籤目錄裡的標籤，不寫死標籤名稱以外的假設：目錄更版時，測試要的是結構，
// 例如「某個子類別在池裡命中哪些標籤」，不是某個特定的標籤。

const mainName = new Map(interestTagCatalog.mainCategories.map(item => [item.id, item.name]));
const subInfo = new Map(interestTagCatalog.subcategories.map(item => [
  item.id, { name: item.name, mainName: mainName.get(item.mainCategoryId) },
]));
const tagByName = name => interestTagCatalog.canonicalTags.find(tag => tag.name === name);
const selectable = interestTagCatalog.canonicalTags.filter(isSelectableInterestTag);
const subKeysOf = tag => tag.categoryAssignments
  .map(a => `${subInfo.get(a.subcategoryId)?.mainName}/${subInfo.get(a.subcategoryId)?.name}`);

let sequence = 0;
function course(tags, extra = {}) {
  sequence += 1;
  const code = extra.catalogCourseCode ?? `T${sequence}`;
  return {
    catalogCourseCode: code,
    courseId: `${code}-0001`,
    name: extra.name ?? `測試課${code}`,
    ragTag: tags.map(tag => tag.name),
    ...extra,
  };
}

// 找一個同時屬於「程式」「資料與資訊系統」「AI」這三個（盤點中標籤清單完全相同的）子類別的標籤。
const blobTag = selectable.find(tag => {
  const keys = subKeysOf(tag);
  return ['資訊與計算/程式', '資訊與計算/資料與資訊系統', '資訊與計算/AI'].every(key => keys.includes(key));
});
// 資訊安全與隱私底下可選的標籤（盤點：資訊安全、數據保護…）。
const securityTags = selectable.filter(tag => subKeysOf(tag).includes('資訊與計算/資訊安全與隱私'));
const securityPair = securityTags.slice(0, 2);
// 不屬於資訊安全與隱私、但屬於那組重複子類別的標籤，用來讓兩組的標籤集合不同。
const blobOnlyTag = selectable.find(tag => (
  subKeysOf(tag).includes('資訊與計算/程式') && !securityTags.some(other => other.id === tag.id)
));

describe('Step C：課程主題選單的分組與統計（interestTopicGroups.js）', () => {
  test('測試前提：目錄裡找得到抽樣用的標籤', () => {
    assert.ok(blobTag, '需要一個同時屬於 程式／資料與資訊系統／AI 的可選標籤');
    assert.ok(securityPair.length === 2, '資訊安全與隱私至少要有 2 個可選標籤');
    assert.ok(blobOnlyTag);
  });

  test('TG1 只有可選標籤算數：單課標籤與 too_common 標籤不產生任何類別', () => {
    const singleCourse = interestTagCatalog.canonicalTags
      .find(tag => tag.eligibility?.exclusionReason === 'single_course');
    const tooCommon = interestTagCatalog.canonicalTags
      .find(tag => tag.eligibility?.exclusionReason === 'too_common');
    const groups = buildInterestTopicGroups({
      outside: [course([singleCourse, tooCommon])],
    });
    assert.deepEqual(groups, [], '沒有可選標籤，就不該出現「點進去卻沒有可計分標籤」的類別');
  });

  test('TG2 本系用子類別、通識與系外用大類別；沒有任何選項的組不回傳', () => {
    const groups = buildInterestTopicGroups({
      department: [course([blobTag])],
      generalEducation: [course([blobTag])],
    });
    assert.deepEqual(groups.map(group => group.key), ['department', 'generalEducation']);
    assert.ok(groups[0].options.every(option => option.level === 'sub' && option.id.startsWith('sub_')));
    assert.ok(groups[1].options.every(option => option.level === 'main' && option.id.startsWith('main_')));
    assert.ok(groups.every(group => group.options.length > 0));
  });

  test('TG3 同一門課開多個班只算一次', () => {
    const sections = [
      course([blobTag], { catalogCourseCode: 'SAME1', courseId: 'SAME1-0001' }),
      course([blobTag], { catalogCourseCode: 'SAME1', courseId: 'SAME1-0002' }),
      course([blobTag], { catalogCourseCode: 'SAME1', courseId: 'SAME1-0003' }),
      course([blobTag], { catalogCourseCode: 'OTHER1' }),
    ];
    const [group] = buildInterestTopicGroups({ outside: sections });
    assert.ok(group.options.every(option => option.courseCount === 2),
      '4 個班次、2 門課：課程數是 2，不是 4');
  });

  test('TG4 「學習階段」「課程活動」兩個大類別不當選項', () => {
    const withExcluded = selectable.find(tag => tag.categoryAssignments
      .some(a => EXCLUDED_MAIN_CATEGORY_NAMES.includes(mainName.get(a.mainCategoryId))));
    assert.ok(withExcluded, '前提：有可選標籤同時屬於被排除的大類別');
    const categories = aggregateInterestCategories([course([withExcluded])], 'main');
    assert.ok(categories.length > 0 || withExcluded.categoryAssignments.every(a => (
      EXCLUDED_MAIN_CATEGORY_NAMES.includes(mainName.get(a.mainCategoryId))
    )));
    assert.ok(categories.every(item => !EXCLUDED_MAIN_CATEGORY_NAMES.includes(item.name)));
  });

  test('TG5 標籤集合相同的重複子類別併成一個選項、記下其他 ID，並用內容命名（大類別：標籤），不用目錄的子類別名稱', () => {
    const [group] = buildInterestTopicGroups({ department: [course([blobTag])] });

    // 這個標籤只有一種「池內標籤集合」，所以它所屬的所有子類別併成一個選項。
    assert.equal(group.options.length, 1);
    const [option] = group.options;
    assert.ok(option.aliasIds.length >= 2, '程式／資料與資訊系統／AI 至少有兩個別名 ID 被併進來');

    assert.equal(option.nameSource, 'content');
    assert.equal(option.name, `${option.mainCategories.join('、')}：${blobTag.name}`, '只有 1 個標籤時不加「等」');
    assert.ok(option.catalogNames.length >= 3, '保留被併進來的目錄名稱，方便追查');
    assert.ok(!option.catalogNames.includes(option.name), '名稱不是目錄裡任何一個子類別的名字');

    // 代表者與別名合起來，正好是這個標籤所屬的全部子類別。
    const allIds = [option.id, ...option.aliasIds].sort();
    const expected = blobTag.categoryAssignments.map(a => a.subcategoryId).sort();
    assert.deepEqual(allIds, [...new Set(expected)].sort());
  });

  test('TG5b 代表者的選法可重現：同一份輸入每次得到同一個名稱與 ID', () => {
    const first = buildInterestTopicGroups({ department: [course([blobTag])] }).at(0).options[0];
    const second = buildInterestTopicGroups({ department: [course([blobTag])] }).at(0).options[0];
    assert.equal(first.id, second.id);
    assert.equal(first.name, second.name);
  });

  test('TG6 direct 只給白名單、只在本系組；其餘一律追問，且追問選項不帶 tags', () => {
    const courses = [course([securityPair[0], securityPair[1]]), course([blobOnlyTag])];
    const [department] = buildInterestTopicGroups({ department: courses });

    const security = department.options.find(option => option.name === '資訊安全與隱私');
    assert.ok(security, '資訊安全與隱私應該是一個選項');
    assert.equal(security.mode, 'direct');
    assert.deepEqual(
      security.tags.map(tag => tag.tagId).sort(),
      securityPair.map(tag => tag.id).sort(),
      '展開的是池內實際命中的標籤，不是子類別底下全部的標籤'
    );
    assert.ok(security.tags.every(tag => tag.sampleCourses.length > 0), '附代表課程給學生確認');

    const others = department.options.filter(option => option.id !== security.id);
    assert.ok(others.length > 0);
    assert.ok(others.every(option => option.mode === 'followup' && !('tags' in option)));

    // 同一批課放在通識組：用大類別，一律追問，不會因為子類別在白名單就 direct。
    const [ge] = buildInterestTopicGroups({ generalEducation: courses });
    assert.ok(ge.options.every(option => option.mode === 'followup'));
  });

  test('TG7 選項依課程數由多到少排序，並受上限控制', () => {
    const [group] = buildInterestTopicGroups({
      outside: [
        course([blobTag], { catalogCourseCode: 'A1' }),
        course([blobTag], { catalogCourseCode: 'A2' }),
        course([securityPair[0]], { catalogCourseCode: 'B1' }),
      ],
    }, { limit: 1 });
    assert.equal(group.options.length, 1);

    const [full] = buildInterestTopicGroups({
      outside: [
        course([blobTag], { catalogCourseCode: 'A1' }),
        course([blobTag], { catalogCourseCode: 'A2' }),
        course([securityPair[0]], { catalogCourseCode: 'B1' }),
      ],
    });
    const counts = full.options.map(option => option.courseCount);
    assert.deepEqual(counts, [...counts].sort((a, b) => b - a));
  });

  test('TG8 追問候選：重複子類別的任何一個 ID 都找得到，依課程數排序並受上限控制', () => {
    const courses = [
      course([securityPair[0], securityPair[1]], { catalogCourseCode: 'S1' }),
      course([securityPair[0]], { catalogCourseCode: 'S2' }),
    ];
    const securitySubId = interestTagCatalog.subcategories
      .find(sub => sub.name === '資訊安全與隱私').id;

    const found = getInterestCategoryCandidates(courses, 'sub', securitySubId);
    assert.equal(found.category.name, '資訊安全與隱私');
    assert.equal(found.totalTagCount, 2);
    assert.equal(found.tags[0].tagId, securityPair[0].id, '出現在較多門課的標籤排前面');
    assert.equal(found.tags[0].courseCount, 2);

    assert.equal(getInterestCategoryCandidates(courses, 'sub', securitySubId, { limit: 1 }).tags.length, 1);
    assert.equal(getInterestCategoryCandidates(courses, 'sub', 'sub_不存在').category, null);
    assert.deepEqual(getInterestCategoryCandidates(courses, 'sub', 'sub_不存在').tags, []);

    // 用併進來的別名 ID 也要找得到（保存驗證時使用者可能選的是任何一個）。
    const [option] = buildInterestTopicGroups({ department: [course([blobTag])] }).at(0).options;
    const viaAlias = getInterestCategoryCandidates([course([blobTag])], 'sub', option.aliasIds[0]);
    assert.ok(viaAlias.category, '別名 ID 要能對到分類');
    assert.deepEqual(viaAlias.tags.map(tag => tag.tagId), [blobTag.id]);
  });

  test('TG9 rag_tag 是 JSON 字串或逗號字串時一樣能統計', () => {
    const asJson = { catalogCourseCode: 'J1', name: 'J', ragTag: JSON.stringify([blobTag.name]) };
    const asComma = { catalogCourseCode: 'C1', name: 'C', ragTag: `${blobTag.name}、不存在的標籤` };
    const [group] = buildInterestTopicGroups({ outside: [asJson, asComma] });
    assert.ok(group.options.every(option => option.courseCount === 2));
  });

  test('TG10 空輸入、沒有 rag_tag、非陣列都不丟例外', () => {
    assert.deepEqual(buildInterestTopicGroups({}), []);
    assert.deepEqual(buildInterestTopicGroups(), []);
    assert.deepEqual(buildInterestTopicGroups({ outside: [{ name: '無標籤' }, null, {}] }), []);
    assert.deepEqual(aggregateInterestCategories('不是陣列', 'main'), []);
  });
});

describe('Step C：本系選單的隱藏清單', () => {
  const CS = '資訊工程學系';
  const hidden = new Set(HIDDEN_SUBCATEGORIES[CS]);
  const keysOf = tag => [...new Set(subKeysOf(tag))];

  // 只屬於隱藏清單內子類別的標籤（整組成員都在清單內）；以及同時屬於隱藏與非隱藏子類別的標籤。
  const fullyHiddenTag = selectable.find(tag => keysOf(tag).length > 0 && keysOf(tag).every(key => hidden.has(key)));
  const mixedTag = selectable.find(tag => keysOf(tag).some(key => hidden.has(key))
    && keysOf(tag).some(key => !hidden.has(key)));

  test('測試前提：目錄裡找得到隱藏清單的抽樣標籤', () => {
    assert.ok(fullyHiddenTag, '需要一個只屬於隱藏清單內子類別的標籤');
    assert.ok(mixedTag, '需要一個同時屬於隱藏與非隱藏子類別的標籤');
  });

  test('TG12 隱藏清單裡的每個鍵都對得到目錄裡真實存在的子類別（防止打錯字而靜默失效）', () => {
    const real = new Set([...subInfo.values()].map(info => `${info.mainName}/${info.name}`));
    for (const [department, keys] of Object.entries(HIDDEN_SUBCATEGORIES)) {
      for (const key of keys) assert.ok(real.has(key), `${department} 的隱藏清單有不存在的子類別：${key}`);
    }
  });

  test('TG13 整組成員都在隱藏清單內時，該系所的本系選單不列出，也不佔用前 N 名的名額', () => {
    const courses = [course([fullyHiddenTag])];
    const hiddenForCs = buildInterestTopicGroups({ department: courses }, { department: CS });
    assert.deepEqual(hiddenForCs, [], '只有被隱藏的選項時，這一組整個不回傳');

    const withOther = buildInterestTopicGroups({
      department: [course([fullyHiddenTag]), course([blobTag])],
    }, { department: CS, limit: 1 });
    assert.equal(withOther[0].options.length, 1);
    assert.ok(!withOther[0].options.some(option => [option.id, ...option.aliasIds]
      .some(id => fullyHiddenTag.categoryAssignments.some(a => a.subcategoryId === id))),
    '被隱藏的選項不會擠掉真正的選項');
  });

  test('TG14 隱藏清單只適用指定的系所：其他系所同樣的課照常列出', () => {
    const courses = [course([fullyHiddenTag])];
    assert.ok(buildInterestTopicGroups({ department: courses }, { department: '企業管理學系' }).length > 0);
    assert.ok(buildInterestTopicGroups({ department: courses }, { department: null }).length > 0);
  });

  test('TG15 只要有一個成員不在隱藏清單內，就不隱藏（標籤集合同時屬於正常的子類別）', () => {
    const groups = buildInterestTopicGroups({ department: [course([mixedTag])] }, { department: CS });
    assert.ok(groups.length > 0 && groups[0].options.length > 0, '混合成員的選項必須保留');
  });

  test('TG16 隱藏只影響選單，不影響追問候選與保存驗證用的查找', () => {
    const hiddenSubId = fullyHiddenTag.categoryAssignments
      .find(a => hidden.has(`${subInfo.get(a.subcategoryId).mainName}/${subInfo.get(a.subcategoryId).name}`)).subcategoryId;
    const found = getInterestCategoryCandidates([course([fullyHiddenTag])], 'sub', hiddenSubId);
    assert.ok(found.category, '隱藏的選項不出現在選單，但分類本身仍查得到');
    assert.equal(found.tags[0].tagId, fullyHiddenTag.id);
  });
});

describe('Step C：併在一起的選項用內容命名', () => {
  // 找一組「完全相同的子類別集合」且至少 4 個標籤的標籤，才能測「最常出現的 3 個＋等」。
  const bySignature = new Map();
  for (const tag of selectable) {
    const signature = [...new Set(tag.categoryAssignments.map(a => a.subcategoryId))].sort().join('|');
    if (!bySignature.has(signature)) bySignature.set(signature, []);
    bySignature.get(signature).push(tag);
  }
  const sameSubsTags = [...bySignature.entries()]
    .find(([signature, tags]) => signature.split('|').length >= 2 && tags.length >= 4)?.[1];

  test('測試前提：有一組標籤同時屬於同一批（至少 2 個）子類別，且至少 4 個標籤', () => {
    assert.ok(sameSubsTags, '目錄裡找不到符合的標籤組');
  });

  test('TG17 名稱是「大類別：最常出現的 3 個標籤 等」，標籤依課程數排序、同數量依名稱', () => {
    const [a, b, c, d] = sameSubsTags;
    const courses = [
      course([a], { catalogCourseCode: 'N1' }), course([a], { catalogCourseCode: 'N2' }),
      course([a], { catalogCourseCode: 'N3' }), course([b], { catalogCourseCode: 'N4' }),
      course([b], { catalogCourseCode: 'N5' }), course([c], { catalogCourseCode: 'N6' }),
      course([d], { catalogCourseCode: 'N7' }),
    ];
    const [group] = buildInterestTopicGroups({ department: courses });
    const option = group.options.find(item => item.aliasIds.length > 0);
    assert.ok(option, '應該有一個併過的選項');
    assert.equal(option.nameSource, 'content');
    const rest = [c, d].sort((x, y) => x.name.localeCompare(y.name, 'zh-Hant'));
    assert.equal(option.name, `${option.mainCategories.join('、')}：${a.name}、${b.name}、${rest[0].name} 等`,
      '依課程數 3、2、1 排序；課程數相同的標籤依名稱排序；超過 3 個標籤加「 等」');
  });

  test('TG18 沒被併過的選項、白名單內的選項用目錄原名', () => {
    const courses = [course([securityPair[0], securityPair[1]]), course([blobOnlyTag])];
    const [department] = buildInterestTopicGroups({ department: courses });
    const security = department.options.find(option => option.name === '資訊安全與隱私');
    assert.ok(security, '資訊安全與隱私仍然用目錄原名');
    assert.equal(security.nameSource, 'catalog');
    assert.equal(security.catalogNames, undefined, '沒被併過就沒有 catalogNames');
    // 其餘併過的選項一律是內容命名。
    for (const option of department.options.filter(item => item.aliasIds.length > 0 && item.id !== security.id)) {
      assert.equal(option.nameSource, 'content');
    }
  });

  test('TG19 內容命名的選項不會再出現誤導的子類別名稱（例如把系統設計叫「建築與空間美學」）', () => {
    const [option] = buildInterestTopicGroups({
      department: [course([sameSubsTags[0]]), course([sameSubsTags[1]])],
    }).at(0).options;
    assert.equal(option.nameSource, 'content');
    for (const catalogName of option.catalogNames) {
      assert.ok(!option.name.includes(`：${catalogName}`), `名稱不該直接是目錄子類別「${catalogName}」`);
    }
  });

  test('TG20 通識與系外用大類別，名稱本身就是大類別，不經過內容命名', () => {
    const [group] = buildInterestTopicGroups({ outside: [course([blobTag])] });
    assert.ok(group.options.every(option => option.nameSource === 'catalog' && !option.name.includes('：')));
  });
});
