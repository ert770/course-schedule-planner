import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { interestTagCatalog } from '../src/data/interestTagCatalog.js';
import { isSelectableInterestTag } from '../src/data/interestTagEligibility.js';
import { COLLEGE_DEPARTMENTS } from '../src/data/classKindCatalog.js';
import { getAbbreviations } from '../src/data/departmentMapping.js';
import {
  POOL_CACHE_MAX_ENTRIES,
  POOL_CACHE_TTL_MS,
  STEM_COLLEGES,
  STEM_EXTRA_UNITS,
} from '../src/data/interestMenuConfig.js';
import { buildStudentScope } from '../src/skills/courseScope.js';
import {
  classifyCoursesForInterestMenu,
  getInterestTopicGroups,
  isStemOpeningUnit,
  loadInterestMenuPool,
  resetInterestMenuCacheForTests,
} from '../src/services/interestMenuService.js';

// 選單的資料來源（Step C）。候選池一律用假的、注入的 `searchCourses`，不連資料庫；
// 分組用的是排課器真正的畢業分類桶，所以這裡的課程只要有 category 與班級名稱就能走真實邏輯。

const FILTERS = { department: '資訊工程學系', gradeLevel: 3, className: '資訊三甲' };
const scope = buildStudentScope(FILTERS);
const mainIdsOf = tag => new Set(tag.categoryAssignments.map(a => a.mainCategoryId));
const selectable = interestTagCatalog.canonicalTags.filter(isSelectableInterestTag);
const tagT = selectable[0];
// 只出現在理工系外課的標籤：它的大類別必須與 T 完全不重疊，才能證明「理工課沒有被列進選單」。
const tagV = selectable.find(tag => [...mainIdsOf(tag)].every(id => !mainIdsOf(tagT).has(id)));
const abbrOf = department => getAbbreviations(department)[0];
const classOf = department => `${abbrOf(department)}三甲`;

let sequence = 0;
function pooled(category, department, tags = [tagT]) {
  sequence += 1;
  return {
    catalogCourseCode: `P${sequence}`, courseId: `P${sequence}-0001`, name: `池內課${sequence}`,
    category, department, ragTag: tags.map(tag => tag.name),
  };
}

describe('Step C：isStemOpeningUnit 理工類開課單位判定', () => {
  test('測試前提：抽樣用的標籤與系所縮寫可用', () => {
    assert.ok(tagT && tagV);
    assert.ok(abbrOf('電機工程學系') && abbrOf('企業管理學系'));
  });

  test('SV1 資電、工程與科學、建設三個學院底下的系所都判為理工', () => {
    for (const college of STEM_COLLEGES) {
      for (const department of COLLEGE_DEPARTMENTS[college]) {
        if (!abbrOf(department)) continue;
        assert.equal(isStemOpeningUnit({ department: classOf(department) }), true,
          `${college} / ${department} 應判為理工`);
      }
    }
  });

  test('SV2 商學院、金融學院、人文社會學院的系所不是理工', () => {
    for (const college of ['商學院', '金融學院', '人文社會學院']) {
      for (const department of COLLEGE_DEPARTMENTS[college]) {
        if (STEM_COLLEGES.some(stem => COLLEGE_DEPARTMENTS[stem].includes(department))) continue;
        if (!abbrOf(department)) continue;
        assert.equal(isStemOpeningUnit({ department: classOf(department) }), false,
          `${college} / ${department} 不應判為理工`);
      }
    }
  });

  test('SV3 學院對照表沒有、但設定檔明列的單位也判為理工（含使用者決定排除的兩個）', () => {
    for (const unit of STEM_EXTRA_UNITS) {
      const asClass = abbrOf(unit) ? classOf(unit) : unit;
      assert.equal(isStemOpeningUnit({ department: asClass }), true, `${unit} 應判為理工`);
    }
    assert.ok(STEM_EXTRA_UNITS.includes('應用數學系') && STEM_EXTRA_UNITS.includes('創能學院綜合班'));
  });

  test('SV4 學院綜合班用班級名稱的學院判定；其他學院與亂填的值不是理工', () => {
    assert.equal(isStemOpeningUnit({ department: '資電學院綜合班' }), true);
    assert.equal(isStemOpeningUnit({ department: '社會創新學院綜合班' }), false);
    for (const value of [undefined, null, '', '不存在的班級']) {
      assert.equal(isStemOpeningUnit({ department: value }), false);
    }
    assert.equal(isStemOpeningUnit(null), false);
  });
});

describe('Step C：classifyCoursesForInterestMenu 依畢業分類桶分組', () => {
  test('SV5 本系選修、通識、系外各歸各組；必修與「其他」桶不列入；系外排除理工', () => {
    const { grouped, counts } = classifyCoursesForInterestMenu([
      pooled('必修', '資訊三甲'),
      pooled('選修', '資訊三甲'),
      pooled('通識', '世界格局與歷史地理視野'),
      pooled('系外選修', classOf('企業管理學系')),
      pooled('系外選修', classOf('電機工程學系')),
      pooled('選修', '應用外語選修'),
    ], scope);

    assert.equal(grouped.department.length, 1);
    assert.equal(grouped.generalEducation.length, 1);
    assert.equal(grouped.outside.length, 1, '企管留下，電機被排除');
    assert.equal(counts.stemExcluded, 1);
    assert.equal(counts.required, 1);
    assert.equal(counts.other, 1, '應用外語選修屬「其他」桶：S_tag 不作用，所以不列入選單');
  });

  test('SV6 學生範圍沒解析完成（缺系所）時一律不分組，不去猜', () => {
    const unresolved = buildStudentScope({ gradeLevel: 3, className: '資訊三甲' });
    const { grouped } = classifyCoursesForInterestMenu([pooled('選修', '資訊三甲')], unresolved);
    assert.deepEqual(grouped, { department: [], generalEducation: [], outside: [] });
    assert.deepEqual(classifyCoursesForInterestMenu([pooled('選修', '資訊三甲')], null).grouped.department, []);
  });
});

describe('Step C：候選池快取', () => {
  let cacheStore;
  let calls;
  let clock;
  const deps = overrides => ({
    cacheStore,
    now: () => clock,
    searchCourses: async () => { calls.push(1); return [pooled('選修', '資訊三甲')]; },
    ...overrides,
  });

  beforeEach(() => {
    resetInterestMenuCacheForTests();
    cacheStore = new Map();
    calls = [];
    clock = 0;
  });

  test('SV7 同一位學生的範圍在 TTL 內只查一次資料庫，並共用同一份結果', async () => {
    const first = await loadInterestMenuPool(FILTERS, deps());
    const second = await loadInterestMenuPool(FILTERS, deps());
    assert.equal(calls.length, 1);
    assert.equal(first.courses, second.courses);
  });

  test('SV8 同時發生的兩個呼叫也只查一次（不重複打資料庫）', async () => {
    await Promise.all([loadInterestMenuPool(FILTERS, deps()), loadInterestMenuPool(FILTERS, deps())]);
    assert.equal(calls.length, 1);
  });

  test('SV9 不同班別、不同年級各自一份快取', async () => {
    await loadInterestMenuPool(FILTERS, deps());
    await loadInterestMenuPool({ ...FILTERS, className: '資訊三乙' }, deps());
    await loadInterestMenuPool({ ...FILTERS, gradeLevel: 2, className: '資訊二甲' }, deps());
    assert.equal(calls.length, 3);
  });

  test('SV10 超過 TTL 才重新查詢；TTL 內不查', async () => {
    await loadInterestMenuPool(FILTERS, deps());
    clock = POOL_CACHE_TTL_MS - 1;
    await loadInterestMenuPool(FILTERS, deps());
    assert.equal(calls.length, 1);
    clock = POOL_CACHE_TTL_MS + 1;
    await loadInterestMenuPool(FILTERS, deps());
    assert.equal(calls.length, 2);
  });

  test('SV11 查詢失敗不快取：下一次呼叫會重試，不會一直回同一個錯誤', async () => {
    let attempt = 0;
    const flaky = deps({
      searchCourses: async () => {
        attempt += 1;
        if (attempt === 1) throw new Error('資料庫暫時失敗');
        return [pooled('選修', '資訊三甲')];
      },
    });
    await assert.rejects(() => loadInterestMenuPool(FILTERS, flaky), /資料庫暫時失敗/u);
    const retried = await loadInterestMenuPool(FILTERS, flaky);
    assert.equal(retried.courses.length, 1);
    assert.equal(attempt, 2);
  });

  test('SV12 班別沒選好時不查資料庫，ready 為 false（不猜測候選課程）', async () => {
    const result = await loadInterestMenuPool({ department: '資訊工程學系', gradeLevel: 3 }, deps());
    assert.deepEqual(result.courses, []);
    assert.equal(result.ready, false);
    assert.equal(calls.length, 0);
  });

  test('SV13 快取有數量上限：鍵空間（系所×年級×班別）不會無限成長', async () => {
    const noop = deps({ searchCourses: async () => [] });
    for (let index = 0; index <= POOL_CACHE_MAX_ENTRIES + 5; index += 1) {
      await loadInterestMenuPool({ ...FILTERS, className: `資訊三${index}` }, noop);
    }
    assert.ok(cacheStore.size <= POOL_CACHE_MAX_ENTRIES);
  });
});

describe('Step C：getInterestTopicGroups 端到端（假候選池）', () => {
  beforeEach(() => resetInterestMenuCacheForTests());

  test('SV14 三組選單成形；理工系外課的標籤不會讓系外組長出選項', async () => {
    const pool = [
      pooled('選修', '資訊三甲', [tagT]),
      pooled('通識', '世界格局與歷史地理視野', [tagT]),
      pooled('系外選修', classOf('企業管理學系'), [tagT]),
      // 只有理工系外課帶標籤 V（V 的大類別與 T 完全不重疊）：它不該讓系外組多出任何類別。
      pooled('系外選修', classOf('電機工程學系'), [tagV]),
      pooled('必修', '資訊三甲', [tagV]),
      pooled('選修', '應用外語選修', [tagV]),
    ];
    const menu = await getInterestTopicGroups(FILTERS, {
      cacheStore: new Map(), searchCourses: async () => pool,
    });

    assert.equal(menu.scopeReady, true);
    assert.equal(menu.candidateCourseCount, pool.length);
    assert.deepEqual(menu.topicGroups.map(group => group.key),
      ['department', 'generalEducation', 'outside']);
    assert.deepEqual(menu.groupCourseCounts, {
      department: 1, generalEducation: 1, outside: 1, required: 1, other: 1, stemExcluded: 1,
    });

    const vMainIds = mainIdsOf(tagV);
    const outside = menu.topicGroups.find(group => group.key === 'outside');
    assert.ok(outside.options.every(option => !vMainIds.has(option.id)),
      '標籤 V 只出現在理工系外課、必修與「其他」桶，三者都不該產生系外選項');
  });

  test('SV15 班別沒選好時回傳空選單，scopeReady 為 false', async () => {
    const menu = await getInterestTopicGroups({ department: '資訊工程學系', gradeLevel: 3 }, {
      cacheStore: new Map(), searchCourses: async () => { throw new Error('不該被呼叫'); },
    });
    assert.deepEqual(menu.topicGroups, []);
    assert.equal(menu.scopeReady, false);
    assert.equal(menu.candidateCourseCount, 0);
  });
});
