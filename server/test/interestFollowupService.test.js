import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { interestTagCatalog } from '../src/data/interestTagCatalog.js';
import { isSelectableInterestTag } from '../src/data/interestTagEligibility.js';
import {
  FOLLOWUP_CACHE_TTL_MS,
  FOLLOWUP_CANDIDATE_LIMIT,
  FOLLOWUP_DISPLAY_LIMIT,
  FOLLOWUP_MAX_CATEGORIES,
  FOLLOWUP_QUESTION_MAX_LENGTH,
} from '../src/data/interestMenuConfig.js';
import { buildInterestTopicGroups } from '../src/data/interestTopicGroups.js';
import {
  FOLLOWUP_INSTRUCTIONS,
  fixedQuestion,
  getInterestFollowups,
  normalizeGptFollowups,
  resetFollowupCacheForTests,
  resolveFollowupMode,
  validateFollowupRequest,
} from '../src/services/interestFollowupService.js';

// 追問服務（Step D）。OpenAI 一律用注入的假 client，不打真的 API；候選池用注入的假選單，不連資料庫。
// 標籤取自真實標籤目錄：測試要的是結構（某個大類別底下有幾個可選標籤），不是某個特定標籤。

const selectable = interestTagCatalog.canonicalTags.filter(isSelectableInterestTag);
const byMain = new Map();
for (const tag of selectable) {
  for (const assignment of tag.categoryAssignments) {
    if (!byMain.has(assignment.mainCategoryId)) byMain.set(assignment.mainCategoryId, new Map());
    byMain.get(assignment.mainCategoryId).set(tag.id, tag);
  }
}
const [mainId, mainTagMap] = [...byMain].sort((a, b) => b[1].size - a[1].size)[0];
const tags = [...mainTagMap.values()].slice(0, FOLLOWUP_CANDIDATE_LIMIT);

// 第 i 個標籤出現在 (N − i) 門課：排序（課程數由多到少）因此是確定的，tags[0] 最前面。
let sequence = 0;
function coursesFor(tagList) {
  const out = [];
  tagList.forEach((tag, index) => {
    for (let n = 0; n < tagList.length - index; n += 1) {
      sequence += 1;
      out.push({ catalogCourseCode: `F${sequence}`, courseId: `F${sequence}-1`, name: `課${sequence}`, ragTag: [tag.name] });
    }
  });
  return out;
}

function fakeMenu(grouped, extra = {}) {
  const full = { department: [], generalEducation: [], outside: [], ...grouped };
  return async () => ({
    scopeReady: true, grouped: full, topicGroups: buildInterestTopicGroups(full), ...extra,
  });
}

function fakeClient(handler) {
  const calls = [];
  return {
    calls,
    responses: { create: async (params, options) => { calls.push({ params, options }); return handler(params, options, calls.length); } },
  };
}
const reply = categories => ({ output_text: JSON.stringify({ categories }) });
const SELECTION = [{ group: 'outside', categoryId: mainId }];
const FILTERS = { department: '資訊工程學系', gradeLevel: 3, className: '資訊三甲' };

describe('Step D：追問服務 getInterestFollowups', () => {
  let getMenu;
  beforeEach(() => {
    resetFollowupCacheForTests();
    getMenu = fakeMenu({ outside: coursesFor(tags) });
  });
  const run = (overrides = {}, deps = {}) => getInterestFollowups(
    { filters: FILTERS, selections: SELECTION, ...overrides },
    { getMenu, mode: 'gpt', now: 1_000, ...deps },
  );

  test('測試前提：有一個大類別提供足夠的可選標籤', () => {
    assert.ok(tags.length >= FOLLOWUP_DISPLAY_LIMIT + 3, '要有比顯示上限更多的標籤才能測上限');
  });

  test('FU1 GPT 正常：用 GPT 的題目與排序，選項只來自後端清單，並受顯示上限控制', async () => {
    const client = fakeClient(() => reply([{
      categoryRef: 1, question: '你想接觸這個類別的哪些主題？',
      orderedTagRefs: tags.map((_, i) => tags.length - i), // 反過來排
    }]));
    const result = await run({}, { getClient: () => client, getModel: () => 'test-model' });

    assert.equal(client.calls.length, 1);
    assert.equal(client.calls[0].params.model, 'test-model');
    assert.equal(result.mode, 'gpt');
    const [followup] = result.followups;
    assert.equal(followup.source, 'gpt');
    assert.equal(followup.question, '你想接觸這個類別的哪些主題？');
    assert.equal(followup.options.length, FOLLOWUP_DISPLAY_LIMIT);
    assert.equal(followup.options[0].tagId, tags.at(-1).id, '依 GPT 的排序（反過來），不是依課程數');
    const poolIds = new Set(tags.map(tag => tag.id));
    assert.ok(followup.options.every(option => poolIds.has(option.tagId)), '選項全部來自後端清單');
    assert.equal(followup.totalTagCount, tags.length);
  });

  test('FU2 GPT 的編號都要驗證：超出範圍、重複、非整數的丟掉，漏掉的依原順序補在後面', async () => {
    const client = fakeClient(() => reply([{
      categoryRef: 1, question: '想了解哪些？', orderedTagRefs: [3, 3, 999, 1, -1, 0, 2.5],
    }]));
    const [followup] = (await run({}, { getClient: () => client })).followups;
    const ids = followup.options.map(option => option.tagId);
    assert.deepEqual(ids.slice(0, 4), [tags[2].id, tags[0].id, tags[1].id, tags[3].id],
      '先是有效的 3、1，其餘依原本順序補上');
    assert.equal(new Set(ids).size, ids.length, '沒有重複');
  });

  test('FU3 GPT 失敗、逾時、格式錯誤時改用固定問句，選項仍來自後端清單', async () => {
    const cases = [
      ['gpt_error', () => { throw new Error('boom'); }],
      ['gpt_timeout', () => { throw Object.assign(new Error('Request timed out.'), { name: 'APIConnectionTimeoutError' }); }],
      ['gpt_error', () => ({ output_text: '不是 JSON' })],
      ['gpt_error', () => ({ output_text: '' })],
    ];
    for (const [reason, handler] of cases) {
      resetFollowupCacheForTests();
      const client = fakeClient(handler);
      const result = await run({}, { getClient: () => client });
      const [followup] = result.followups;
      assert.equal(followup.source, 'fixed');
      assert.equal(result.fallbackReason, reason);
      assert.equal(followup.question, fixedQuestion(followup.categoryName));
      assert.ok(followup.options.length > 0, '失敗時仍要有選項，保存流程不能被擋住');
      assert.equal(followup.options[0].tagId, tags[0].id, '固定問句依課程數排序');
    }
  });

  test('FU4 mode 為 fixed 或沒有 API key 時完全不呼叫 OpenAI', async () => {
    const client = fakeClient(() => reply([]));
    const fixed = await run({}, { mode: 'fixed', getClient: () => client });
    assert.equal(client.calls.length, 0);
    assert.equal(fixed.fallbackReason, 'mode_fixed');
    assert.equal(fixed.followups[0].source, 'fixed');

    const noKey = await run({}, { mode: 'gpt', getClient: () => null });
    assert.equal(noKey.fallbackReason, 'no_api_key');
    assert.equal(noKey.followups[0].source, 'fixed');
  });

  test('FU5 隱私：送給 OpenAI 的只有類別名稱、標籤名稱與課程數，沒有系所、班別或任何使用者資料', async () => {
    const client = fakeClient(() => reply([{ categoryRef: 1, question: '問題', orderedTagRefs: [1] }]));
    await run({
      filters: { department: '資訊工程學系', gradeLevel: 3, className: '資訊三甲' },
      previousSelections: [{ group: 'outside', categoryId: mainId, tagIds: [tags[0].id] }],
    }, { getClient: () => client });

    const sent = JSON.stringify(client.calls[0].params);
    for (const secret of ['資訊工程學系', '資訊三甲', 'userId', 'canonicalId', 'D1249697', tags[0].id, mainId]) {
      assert.ok(!sent.includes(secret), `不該送出：${secret}`);
    }
    const input = JSON.parse(client.calls[0].params.input);
    assert.deepEqual(Object.keys(input), ['categories']);
    assert.deepEqual(Object.keys(input.categories[0]), ['categoryRef', 'name', 'tags']);
    assert.deepEqual(Object.keys(input.categories[0].tags[0]), ['ref', 'name', 'courseCount']);
    assert.equal(client.calls[0].params.text.format.strict, true);
    assert.equal(client.calls[0].options.timeout, 12_000, '逾時 12 秒，不重試');
  });

  test('FU6 學生以前選過、仍然有效的標籤一律重新顯示，不受顯示上限與排序影響；無效的不顯示', async () => {
    const lowRanked = tags.at(-1); // 排在最後面，超出顯示上限
    const client = fakeClient(() => reply([{
      categoryRef: 1, question: '問題', orderedTagRefs: tags.map((_, i) => i + 1),
    }]));
    const [followup] = (await run({
      previousSelections: [{
        group: 'outside', categoryId: mainId, tagIds: [lowRanked.id, 'tag_不在候選池內'],
      }],
    }, { getClient: () => client })).followups;

    const ids = followup.options.map(option => option.tagId);
    assert.equal(ids.length, FOLLOWUP_DISPLAY_LIMIT + 1, '前 N 個，再補上以前選過的');
    assert.equal(ids.at(-1), lowRanked.id);
    assert.equal(followup.options.at(-1).previouslySelected, true);
    assert.ok(!ids.includes('tag_不在候選池內'));
    assert.equal(followup.options.filter(option => option.previouslySelected).length, 1);
  });

  test('FU7 題目依「類別＋候選標籤」快取：同一份清單不重複呼叫，清單變了才重新呼叫，失敗不快取', async () => {
    const client = fakeClient(() => reply([{ categoryRef: 1, question: '問題', orderedTagRefs: [1, 2] }]));
    const deps = { getClient: () => client };
    await run({}, deps);
    await run({}, deps);
    assert.equal(client.calls.length, 1, '同一份清單只呼叫一次');

    getMenu = fakeMenu({ outside: coursesFor(tags.slice(0, tags.length - 1)) });
    await run({}, deps);
    assert.equal(client.calls.length, 2, '候選標籤變了要重新出題');

    await run({}, { ...deps, now: 1_000 + FOLLOWUP_CACHE_TTL_MS + 1 });
    assert.equal(client.calls.length, 3, '超過 TTL 重新出題');

    resetFollowupCacheForTests();
    let attempt = 0;
    const flaky = fakeClient(() => {
      attempt += 1;
      if (attempt === 1) throw new Error('暫時失敗');
      return reply([{ categoryRef: 1, question: '好的問題', orderedTagRefs: [1] }]);
    });
    const first = await run({}, { getClient: () => flaky });
    const second = await run({}, { getClient: () => flaky });
    assert.equal(first.followups[0].source, 'fixed');
    assert.equal(second.followups[0].source, 'gpt', '失敗沒有被快取，下一次重試成功');
  });

  test('FU8 分類不在這位學生的候選池時，該筆回 unavailable，其餘照常', async () => {
    const client = fakeClient(() => reply([{ categoryRef: 1, question: '問題', orderedTagRefs: [1] }]));
    const result = await run({
      selections: [{ group: 'outside', categoryId: 'main_不存在' }, ...SELECTION],
    }, { getClient: () => client });
    const unavailable = result.followups.find(item => item.unavailable);
    assert.deepEqual(unavailable, {
      group: 'outside', categoryId: 'main_不存在', unavailable: true, reason: 'category_not_in_pool',
    });
    assert.equal(result.followups.filter(item => !item.unavailable).length, 1);
  });

  test('FU9 學生範圍不完整（缺班別）時不猜測，回空清單', async () => {
    const result = await run({}, { getMenu: async () => ({ scopeReady: false }) });
    assert.deepEqual(result.followups, []);
    assert.equal(result.scopeReady, false);
  });

  test('FU10 A：每個選項都附代表課程與課程數，供前端顯示「會加分給 N 門課」', async () => {
    const [followup] = (await run({}, { mode: 'fixed' })).followups;
    for (const option of followup.options) {
      assert.ok(option.courseCount >= 1);
      assert.ok(option.sampleCourses.length >= 1 && option.sampleCourses.length <= 3);
    }
    assert.equal(followup.options[0].courseCount, tags.length, '課程數最多的標籤排最前面');
  });

  test('FU11 D：提示詞明確要求工具名稱、泛用詞、附帶主題排在最後，並禁止新增或改名標籤', () => {
    for (const phrase of ['PowerPoint', 'Chat GPT', '泛用詞', '排在最後面', '不可新增、改名或翻譯標籤', '沒有任何個人資料']) {
      assert.ok(FOLLOWUP_INSTRUCTIONS.includes(phrase), `提示詞應包含「${phrase}」`);
    }
  });

  test('FU12 一次請求有多個分類時只呼叫一次 GPT，各自對回自己的清單', async () => {
    const [second] = [...byMain].filter(([id]) => id !== mainId).sort((a, b) => b[1].size - a[1].size);
    const otherTags = [...second[1].values()].filter(tag => !mainTagMap.has(tag.id)).slice(0, 6);
    getMenu = fakeMenu({ outside: coursesFor(tags), generalEducation: coursesFor(otherTags) });
    const client = fakeClient(() => reply([
      { categoryRef: 1, question: '第一題', orderedTagRefs: [1] },
      { categoryRef: 2, question: '第二題', orderedTagRefs: [1] },
    ]));
    const result = await run({
      selections: [...SELECTION, { group: 'generalEducation', categoryId: second[0] }],
    }, { getClient: () => client });

    assert.equal(client.calls.length, 1);
    assert.deepEqual(result.followups.map(item => item.question), ['第一題', '第二題']);
    const geOptions = result.followups[1].options.map(option => option.tagId);
    assert.ok(geOptions.every(id => otherTags.some(tag => tag.id === id)), '第二題的選項只來自它自己的清單');
  });

  test('FU13 併過的本系選項：用選單上顯示的內容名稱出題，別名 ID 也找得到', async () => {
    const blobTag = selectable.find(tag => {
      const keys = tag.categoryAssignments.length;
      return keys >= 3 && tag.categoryAssignments.every(a => a.subcategoryId);
    });
    const grouped = { department: coursesFor([blobTag]) };
    const menu = await fakeMenu(grouped)();
    const option = menu.topicGroups[0].options.find(item => item.aliasIds.length > 0);
    assert.ok(option, '前提：有一個併過的選項');

    const result = await getInterestFollowups({
      filters: FILTERS, selections: [{ group: 'department', categoryId: option.aliasIds[0] }],
    }, { getMenu: fakeMenu(grouped), mode: 'fixed' });
    assert.equal(result.followups[0].categoryName, option.name);
    assert.equal(result.followups[0].question, fixedQuestion(option.name));
  });
});

describe('Step D：GPT 輸出驗證與請求驗證（純函式）', () => {
  const entries = [{ candidates: [{ tagId: 'a' }, { tagId: 'b' }, { tagId: 'c' }] }];

  test('FU14 問題只當一行純文字：控制字元與換行壓成空白；太長、含網址、空白一律不可用', () => {
    const ok = normalizeGptFollowups({ categories: [{ categoryRef: 1, question: '想\n學\t哪些？', orderedTagRefs: [1] }] }, entries);
    assert.equal(ok.get(0).question, '想 學 哪些？');

    for (const question of ['', '   ', 'x'.repeat(FOLLOWUP_QUESTION_MAX_LENGTH + 1), '看 https://evil.example', '看 www.evil.example']) {
      const bad = normalizeGptFollowups({ categories: [{ categoryRef: 1, question, orderedTagRefs: [1] }] }, entries);
      assert.equal(bad.size, 0, `不可用的問題應回 null：${question.slice(0, 20)}`);
    }
  });

  test('FU15 沒有任何有效編號、categoryRef 不存在或重複，該類別一律不採用 GPT 的輸出', () => {
    const none = normalizeGptFollowups({ categories: [
      { categoryRef: 1, question: '問題', orderedTagRefs: [99, -1] },
      { categoryRef: 7, question: '問題', orderedTagRefs: [1] },
    ] }, entries);
    assert.equal(none.size, 0);

    const dup = normalizeGptFollowups({ categories: [
      { categoryRef: 1, question: '第一次', orderedTagRefs: [2] },
      { categoryRef: 1, question: '第二次', orderedTagRefs: [3] },
    ] }, entries);
    assert.equal(dup.get(0).question, '第一次');
    assert.deepEqual(dup.get(0).orderedIndexes, [1, 0, 2]);

    for (const bad of [null, undefined, {}, { categories: 'x' }, { categories: [null] }]) {
      assert.equal(normalizeGptFollowups(bad, entries).size, 0);
    }
  });

  test('FU16 請求本文驗證：缺欄位、型別錯誤、未知組別、超過上限，重複的分類只留一筆', () => {
    const good = { department: '資訊工程學系', gradeLevel: 3, className: '資訊三甲',
      selections: [{ group: 'outside', categoryId: 'main_a' }, { group: 'outside', categoryId: 'main_a' }] };
    assert.deepEqual(validateFollowupRequest(good).value.selections, [{ group: 'outside', categoryId: 'main_a' }]);
    assert.deepEqual(validateFollowupRequest(good).value.filters, { department: '資訊工程學系', gradeLevel: 3, className: '資訊三甲' });

    const errorOf = patch => validateFollowupRequest({ ...good, ...patch }).error;
    assert.match(errorOf({ department: '' }), /department/u);
    assert.match(errorOf({ className: undefined }), /className/u);
    assert.match(errorOf({ gradeLevel: '3' }), /gradeLevel/u);
    assert.match(errorOf({ gradeLevel: 0 }), /gradeLevel/u);
    assert.match(errorOf({ selections: [] }), /非空陣列/u);
    assert.match(errorOf({ selections: 'x' }), /非空陣列/u);
    assert.match(errorOf({ selections: [null] }), /必須是物件/u);
    assert.match(errorOf({ selections: [{ group: 'x', categoryId: 'main_a' }] }), /selections\.group/u);
    assert.match(errorOf({ selections: [{ group: 'outside', categoryId: '' }] }), /categoryId/u);
    const many = Array.from({ length: FOLLOWUP_MAX_CATEGORIES + 1 }, (_, i) => ({ group: 'outside', categoryId: `main_${i}` }));
    assert.match(errorOf({ selections: many }), new RegExp(`最多 ${FOLLOWUP_MAX_CATEGORIES} 筆`, 'u'));
  });

  test('FU17 INTEREST_FOLLOWUP_MODE：只有 fixed（不分大小寫）才是 fixed，其餘一律 gpt', () => {
    assert.equal(resolveFollowupMode('fixed'), 'fixed');
    assert.equal(resolveFollowupMode(' FIXED '), 'fixed');
    for (const value of ['gpt', 'GPT', '', undefined, null, 'off', 'x']) {
      assert.equal(resolveFollowupMode(value), 'gpt');
    }
  });
});
