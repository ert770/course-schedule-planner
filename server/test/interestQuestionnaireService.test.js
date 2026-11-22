import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { interestTagCatalog } from '../src/data/interestTagCatalog.js';
import { isSelectableInterestTag } from '../src/data/interestTagEligibility.js';
import { getCuratedInterestOption } from '../src/data/curatedInterestOptions.js';
import { buildInterestTopicGroups } from '../src/data/interestTopicGroups.js';
import {
  QUESTIONNAIRE_BATCH_SIZE,
  QUESTIONNAIRE_TOPICS_SHOWN_PER_DIRECTION,
  QUESTIONNAIRE_MAX_LIST_LENGTH,
  QUESTIONNAIRE_REQUESTS_PER_MINUTE,
} from '../src/data/interestMenuConfig.js';
import { DEFAULT_DIRECTION_COPY, DETAIL_QUESTION, GROUP_QUESTIONS } from '../src/data/interestQuestionnaireCopy.js';
import { clusterKey, setInterestTagClustersForTests } from '../src/data/interestTagClusters.js';
import {
  DETAIL_FLAT_MAX,
  DETAIL_POPULAR_COUNT,
  QUESTIONNAIRE_INSTRUCTIONS,
  detailCandidatesFor,
  getInterestQuestion,
  normalizeQuestionOutput,
  resetQuestionnaireCacheForTests,
  validateQuestionRequest,
} from '../src/services/interestQuestionnaireService.js';
import { handleInterestQuestionRequest } from '../src/routes/profile.js';

// 課程主題問答 v1（ADR-027）。語言模型一律用注入的假 client，候選池用注入的假選單，不連資料庫、不打 API。
// 標籤取自真實標籤目錄；為了讓每個大類別的課程數可預期，只用「所有分類路徑都在同一個大類別底下」的標籤。

const mainByName = new Map(interestTagCatalog.mainCategories.map(item => [item.name, item]));
const tagByIdMap = new Map(interestTagCatalog.canonicalTags.map(tag => [tag.id, tag]));

function exclusiveTags(mainName, count) {
  const mainId = mainByName.get(mainName).id;
  return interestTagCatalog.canonicalTags
    .filter(tag => isSelectableInterestTag(tag)
      && tag.categoryAssignments.length > 0
      && tag.categoryAssignments.every(assignment => assignment.mainCategoryId === mainId))
    .slice(0, count);
}

// 第 i 個標籤出現在 (base + N − i) 門課，排序可預期。
let sequence = 0;
function coursesFor(tagList, base = 0) {
  const out = [];
  tagList.forEach((tag, index) => {
    for (let n = 0; n < base + tagList.length - index; n += 1) {
      sequence += 1;
      out.push({ catalogCourseCode: `Q${sequence}`, courseId: `Q${sequence}-1`, name: `課${sequence}`, ragTag: [tag.name] });
    }
  });
  return out;
}

function fakeMenu(grouped, { department = null, scopeReady = true } = {}) {
  const full = { department: [], generalEducation: [], outside: [], ...grouped };
  return async () => ({ scopeReady, grouped: full, topicGroups: buildInterestTopicGroups(full, { department }) });
}

function fakeClient(handler) {
  const calls = [];
  return {
    calls,
    responses: { create: async (params, options) => { calls.push({ params, options }); return handler(params, options, calls.length); } },
  };
}
const reply = body => ({ output_text: JSON.stringify(body) });
const FILTERS = { department: '資訊工程學系', gradeLevel: 3, className: '資訊三甲' };

// 系外：三個有預設文案的大類別 + 兩個沒有的（課程數較多，原本會排在前面）。
const LANG = exclusiveTags('語言、文學與溝通', 4);
const BIZ = exclusiveTags('商業與管理', 4);
const ART = exclusiveTags('藝術、設計與媒體', 4);
const ECON = exclusiveTags('經濟與金融', 4);
const HEALTH = exclusiveTags('醫療、健康與運動', 4);
const outsideCourses = [
  ...coursesFor(LANG), ...coursesFor(BIZ), ...coursesFor(ART),
  ...coursesFor(ECON, 20), ...coursesFor(HEALTH, 20),
];

describe('課程主題問答：請求驗證', () => {
  const base = { department: '資訊工程學系', gradeLevel: 3, className: '資訊三甲' };

  test('QN1 學生範圍與 stage 必填', () => {
    assert.match(validateQuestionRequest({ ...base, department: '' }).error, /department/u);
    assert.match(validateQuestionRequest({ ...base, className: ' ' }).error, /className/u);
    assert.match(validateQuestionRequest({ ...base, gradeLevel: '3' }).error, /gradeLevel/u);
    assert.match(validateQuestionRequest({ ...base, stage: 'other' }).error, /stage/u);
  });

  test('QN2 group 需要有效組別，seenOptionIds 必須是字串陣列且有上限', () => {
    assert.match(validateQuestionRequest({ ...base, stage: 'group', group: 'x' }).error, /group/u);
    assert.match(validateQuestionRequest({ ...base, stage: 'group', group: 'outside', seenOptionIds: [1] }).error, /seenOptionIds/u);
    const tooMany = Array.from({ length: QUESTIONNAIRE_MAX_LIST_LENGTH + 1 }, (_, i) => `id${i}`);
    assert.match(validateQuestionRequest({ ...base, stage: 'group', group: 'outside', seenOptionIds: tooMany }).error, /最多/u);
    const ok = validateQuestionRequest({ ...base, stage: 'group', group: 'outside', seenOptionIds: [' a ', 'a'] });
    assert.deepEqual(ok.value.seenOptionIds, ['a']);
  });

  test('QN3 detail 的方向去重並保留順序；summary 的 tagIds 必須是字串陣列', () => {
    const detail = validateQuestionRequest({
      ...base,
      stage: 'detail',
      directions: [
        { group: 'outside', categoryId: 'b' },
        { group: 'outside', categoryId: 'a' },
        { group: 'outside', categoryId: 'b' },
      ],
    });
    assert.deepEqual(detail.value.directions.map(item => item.categoryId), ['b', 'a']);
    assert.match(validateQuestionRequest({
      ...base, stage: 'summary', selections: [{ group: 'outside', categoryId: 'a', tagIds: [1] }],
    }).error, /tagIds/u);
  });
});

describe('課程主題問答：stage=group', () => {
  let getMenu;
  beforeEach(() => {
    resetQuestionnaireCacheForTests();
    getMenu = fakeMenu({ outside: outsideCourses });
  });
  const ask = (overrides = {}, deps = {}) => getInterestQuestion(
    { stage: 'group', filters: FILTERS, group: 'outside', seenOptionIds: [], ...overrides },
    { getMenu, mode: 'gpt', now: 1_000, ...deps },
  );

  test('QN4 有預設文案的方向排在首批，直接用規格文案、不呼叫語言模型', async () => {
    const client = fakeClient(() => { throw new Error('不應呼叫'); });
    const result = await ask({}, { getClient: () => client });
    assert.equal(result.question, GROUP_QUESTIONS.outside);
    assert.equal(result.options.length, QUESTIONNAIRE_BATCH_SIZE);
    assert.deepEqual(result.options.map(option => option.title), DEFAULT_DIRECTION_COPY.outside.map(item => item.title));
    assert.deepEqual(result.options.map(option => option.categoryLabel), DEFAULT_DIRECTION_COPY.outside.map(item => item.name));
    assert.equal(result.options[0].categoryId, mainByName.get('語言、文學與溝通').id);
    assert.equal(result.source, 'default');
    assert.equal(result.hasMore, true);
    assert.equal(client.calls.length, 0);
    // 每個方向底下列出代表主題（依課程數），只是說明，不是預先選好的答案。
    assert.deepEqual(result.options[0].topics, LANG.map(tag => tag.name));
    assert.equal(result.options[0].topicCount, LANG.length);
  });

  test('QN4b 代表主題最多列 6 個', async () => {
    const many = exclusiveTags('語言、文學與溝通', 10);
    const menu = fakeMenu({ outside: coursesFor(many) });
    const result = await getInterestQuestion(
      { stage: 'group', filters: FILTERS, group: 'outside', seenOptionIds: [] },
      { getMenu: menu, mode: 'fixed' },
    );
    assert.equal(QUESTIONNAIRE_TOPICS_SHOWN_PER_DIRECTION, 6);
    assert.deepEqual(result.options[0].topics, many.slice(0, 6).map(tag => tag.name));
    assert.equal(result.options[0].topicCount, many.length);
  });

  test('QN5 換一組：排除看過的方向，最後一批有幾個回幾個；只有沒有預設文案的才交給語言模型', async () => {
    const first = await ask({}, { mode: 'fixed' });
    const client = fakeClient((params) => {
      const input = JSON.parse(params.input);
      return reply({
        question: input.questionTemplate,
        options: input.options.map(option => ({ optionRef: option.optionRef, title: `改寫${option.optionRef}`, description: '一句說明。' })),
      });
    });
    const second = await ask({ seenOptionIds: first.options.map(option => option.categoryId) }, { getClient: () => client });
    assert.equal(second.options.length, 2);
    assert.equal(second.hasMore, false);
    assert.deepEqual(second.options.map(option => option.title), ['改寫o1', '改寫o2']);
    assert.equal(second.source, 'gpt');
    assert.equal(client.calls.length, 1);
    const input = JSON.parse(client.calls[0].params.input);
    assert.equal(input.options.length, 2);
    assert.equal(client.calls[0].params.instructions, QUESTIONNAIRE_INSTRUCTIONS);

    const third = await ask({ seenOptionIds: [...first.options, ...second.options].map(option => option.categoryId) });
    assert.equal(third.question, null);
    assert.deepEqual(third.options, []);
  });

  test('QN6 送給語言模型的只有分類與標籤名稱，沒有 ID 與學生資料', async () => {
    const client = fakeClient(() => reply({ question: 'q', options: [] }));
    const first = await ask({}, { mode: 'fixed' });
    await ask({ seenOptionIds: first.options.map(option => option.categoryId) }, { getClient: () => client });
    const sent = client.calls[0].params.input;
    assert.doesNotMatch(sent, /main_|sub_|tag_|資訊工程學系|資訊三甲/u);
    const input = JSON.parse(sent);
    assert.deepEqual(Object.keys(input.options[0]).sort(), ['categoryLabel', 'optionRef', 'topicLabels']);
  });

  test('QN7 語言模型回傳缺項、多項、順序錯或文字過長，整批退回目錄名稱與代表課', async () => {
    const first = await ask({}, { mode: 'fixed' });
    const seenOptionIds = first.options.map(option => option.categoryId);
    const badOutputs = [
      { question: 'q', options: [{ optionRef: 'o1', title: 't', description: 'd' }] },
      { question: 'q', options: [{ optionRef: 'o2', title: 't', description: 'd' }, { optionRef: 'o1', title: 't', description: 'd' }] },
      { question: 'q', options: [{ optionRef: 'o1', title: 'x'.repeat(200), description: 'd' }, { optionRef: 'o2', title: 't', description: 'd' }] },
    ];
    for (const body of badOutputs) {
      resetQuestionnaireCacheForTests();
      const result = await ask({ seenOptionIds }, { getClient: () => fakeClient(() => reply(body)) });
      assert.equal(result.source, 'fixed');
      assert.equal(result.fallbackReason, 'invalid_gpt_output');
      assert.deepEqual(result.options.map(option => option.title), ['經濟與金融', '醫療、健康與運動']);
      assert.match(result.options[0].description, /^代表課：/u);
    }
  });

  test('QN8 語言模型逾時、錯誤、固定模式、沒有金鑰時都能作答', async () => {
    const first = await ask({}, { mode: 'fixed' });
    const seenOptionIds = first.options.map(option => option.categoryId);
    const timeout = Object.assign(new Error('Request timed out.'), { name: 'APIConnectionTimeoutError' });
    const cases = [
      [{ getClient: () => fakeClient(() => { throw timeout; }) }, 'gpt_timeout'],
      [{ getClient: () => fakeClient(() => { throw new Error('boom'); }) }, 'gpt_error'],
      [{ mode: 'fixed' }, 'mode_fixed'],
      [{ getClient: () => null }, 'no_api_key'],
    ];
    for (const [deps, reason] of cases) {
      const result = await ask({ seenOptionIds }, deps);
      assert.equal(result.fallbackReason, reason);
      assert.equal(result.options.length, 2);
      assert.equal(result.source, 'fixed');
    }
  });

  test('QN9 同一批文案在伺服器快取，第二次不再呼叫語言模型', async () => {
    const first = await ask({}, { mode: 'fixed' });
    const seenOptionIds = first.options.map(option => option.categoryId);
    const client = fakeClient((params) => {
      const input = JSON.parse(params.input);
      return reply({ question: 'q', options: input.options.map(option => ({ optionRef: option.optionRef, title: 't', description: 'd' })) });
    });
    await ask({ seenOptionIds }, { getClient: () => client });
    await ask({ seenOptionIds }, { getClient: () => client });
    assert.equal(client.calls.length, 1);
  });

  test('QN10 候選池還不能建立時不出題', async () => {
    const result = await getInterestQuestion(
      { stage: 'group', filters: FILTERS, group: 'outside', seenOptionIds: [] },
      { getMenu: fakeMenu({}, { scopeReady: false }), mode: 'fixed' },
    );
    assert.equal(result.scopeReady, false);
    assert.equal(result.question, null);
  });
});

describe('課程主題問答：stage=detail（細項頁，三層沙漏的中、小層）', () => {
  const langId = mainByName.get('語言、文學與溝通').id;
  const bizId = mainByName.get('商業與管理').id;
  const ecoId = mainByName.get('經濟與金融').id;
  const ECO = exclusiveTags('經濟與金融', DETAIL_FLAT_MAX + 3);
  const menu = fakeMenu({ outside: [...outsideCourses, ...coursesFor(ECO, 30)] });
  let built;
  beforeEach(async () => { built = await menu(); });
  afterEach(() => setInterestTagClustersForTests({ entries: {} }));
  const ask = directions => getInterestQuestion({ stage: 'detail', filters: FILTERS, directions }, { getMenu: menu });

  // 依真實的 detailCandidatesFor 結果建一份預算分群（不呼叫模型）。
  function storeClusters(categoryId, split) {
    const tags = detailCandidatesFor(built, 'outside', categoryId);
    const ids = tags.map(tag => tag.tagId);
    const clusters = [
      { clusterId: 'c1', label: '投資理財', tagIds: ids.slice(0, split) },
      { clusterId: 'c2', label: '會計稅務', tagIds: ids.slice(split) },
    ];
    setInterestTagClustersForTests({ entries: { [clusterKey(categoryId, ids)]: { clusters } } });
    return { tags, clusters };
  }

  test('QN11 一次回傳這組所有已選方向，依被選順序；題幹是共用題幹', async () => {
    const result = await ask([{ group: 'outside', categoryId: bizId }, { group: 'outside', categoryId: langId }]);
    assert.equal(result.question, DETAIL_QUESTION);
    assert.deepEqual(result.directions.map(item => item.categoryId), [bizId, langId]);
    assert.equal(result.directions[1].title, '學外語或了解不同文化');
    assert.equal(result.directions[1].categoryLabel, '語言、文學與溝通');
  });

  test('QN12 12 個以下的標籤直接列出全部（依課程數）', async () => {
    const result = await ask([{ group: 'outside', categoryId: langId }]);
    const block = result.directions[0];
    assert.equal(block.mode, 'flat');
    assert.deepEqual(block.tags.map(tag => tag.tagId), LANG.map(tag => tag.id));
    assert.equal('clusters' in block, false);
  });

  test('QN13 13 個以上且有預算分群：群卡（只帶 ID）＋最熱門的標籤＋供搜尋的完整清單', async () => {
    const { tags } = storeClusters(ecoId, 5);
    const result = await ask([{ group: 'outside', categoryId: ecoId }]);
    const block = result.directions[0];
    assert.equal(block.mode, 'clusters');
    assert.equal(block.tagCount, ECO.length);
    assert.deepEqual(block.popular.map(tag => tag.tagId), tags.slice(0, DETAIL_POPULAR_COUNT).map(tag => tag.tagId));
    assert.deepEqual(block.clusters.map(cluster => [cluster.label, cluster.tagIds.length]), [['投資理財', 5], ['會計稅務', ECO.length - 5]]);
    assert.equal(block.tags.length, ECO.length);
  });

  test('QN14 13 個以上但沒有預算分群（或候選池變了對不上）：退回完整清單，不猜', async () => {
    const noStore = await ask([{ group: 'outside', categoryId: ecoId }]);
    assert.equal(noStore.directions[0].mode, 'flat');
    assert.equal(noStore.directions[0].tags.length, ECO.length);

    const ids = detailCandidatesFor(built, 'outside', ecoId).map(tag => tag.tagId);
    setInterestTagClustersForTests({ entries: { [clusterKey(ecoId, ids.slice(1))]: { clusters: [
      { clusterId: 'c1', label: 'a', tagIds: ids.slice(1, 6) },
      { clusterId: 'c2', label: 'b', tagIds: ids.slice(6) },
    ] } } });
    const stale = await ask([{ group: 'outside', categoryId: ecoId }]);
    assert.equal(stale.directions[0].mode, 'flat');
  });

  test('QN15 人工智慧（策畫選項）列自己的標籤清單；選方向不會自動帶入標籤', async () => {
    const curated = getCuratedInterestOption('curated_ai');
    const aiTags = curated.tagIds.map(id => tagByIdMap.get(id)).filter(Boolean).slice(0, 3);
    const aiMenu = fakeMenu({ department: coursesFor(aiTags) }, { department: '資訊工程學系' });
    const group = await getInterestQuestion(
      { stage: 'group', filters: FILTERS, group: 'department', seenOptionIds: [] },
      { getMenu: aiMenu, mode: 'fixed' },
    );
    assert.equal(group.options[0].categoryId, 'curated_ai');
    assert.equal('tags' in group.options[0], false);
    const detail = await getInterestQuestion(
      { stage: 'detail', filters: FILTERS, directions: [{ group: 'department', categoryId: 'curated_ai' }] },
      { getMenu: aiMenu },
    );
    assert.deepEqual(new Set(detail.directions[0].tags.map(tag => tag.tagId)), new Set(aiTags.map(tag => tag.id)));
  });

  test('QN15b 方向不在候選池時略過；全部都不在時不出題', async () => {
    const result = await ask([{ group: 'outside', categoryId: 'main_unknown' }, { group: 'outside', categoryId: langId }]);
    assert.deepEqual(result.directions.map(item => item.categoryId), [langId]);
    const none = await ask([{ group: 'outside', categoryId: 'main_unknown' }]);
    assert.equal(none.question, null);
    assert.deepEqual(none.directions, []);
  });
});

describe('課程主題問答：stage=summary 與輸出驗證', () => {
  test('QN16 摘要把已存的方向與標籤換成名稱；同一標籤從兩個方向選到只算一次', async () => {
    const langId = mainByName.get('語言、文學與溝通').id;
    const result = await getInterestQuestion({
      stage: 'summary',
      filters: FILTERS,
      selections: [
        { group: 'outside', categoryId: langId, tagIds: [LANG[0].id] },
        { group: 'generalEducation', categoryId: langId, tagIds: [LANG[0].id] },
        { group: 'outside', categoryId: 'main_unknown', tagIds: [] },
      ],
    }, { getMenu: fakeMenu({ outside: outsideCourses }) });
    assert.equal(result.directions[0].title, '學外語或了解不同文化');
    assert.equal(result.directions[0].available, true);
    assert.equal(result.directions[1].available, false);
    assert.equal(result.directions[2].title, 'main_unknown');
    assert.deepEqual(result.topics.map(topic => [topic.name, topic.duplicate]), [[LANG[0].name, false], [LANG[0].name, true]]);
  });

  test('QN17 normalizeQuestionOutput：題幹不可用時回 null 讓呼叫端用固定題幹，選項仍可用', () => {
    const value = normalizeQuestionOutput({
      question: 'https://example.com',
      options: [{ optionRef: 'o1', title: ' 標題 ', description: '說明\n第二行' }],
    }, 1);
    assert.equal(value.question, null);
    assert.deepEqual(value.copies, [{ title: '標題', description: '說明 第二行' }]);
    assert.equal(normalizeQuestionOutput({ question: 'q', options: [] }, 1), null);
    assert.equal(normalizeQuestionOutput(null, 1), null);
  });
});

describe('課程主題問答：路由處理', () => {
  const identity = { canonicalId: 'D0000001' };
  const body = { department: '資訊工程學系', gradeLevel: 3, className: '資訊三甲', stage: 'group', group: 'outside' };

  test('QN18 限流 429、格式錯誤 400、成功時把驗證後的請求交給出題服務', async () => {
    const limited = await handleInterestQuestionRequest({ identity, body }, { checkLimit: () => false });
    assert.equal(limited.status, 429);

    const bad = await handleInterestQuestionRequest({ identity, body: { ...body, stage: 'x' } }, { checkLimit: () => true });
    assert.equal(bad.status, 400);

    let received = null;
    let limitKey = null;
    const ok = await handleInterestQuestionRequest({ identity, body }, {
      checkLimit: (key, limit) => { limitKey = [key, limit]; return true; },
      getQuestion: async request => { received = request; return { question: 'q' }; },
    });
    assert.equal(ok.status, 200);
    assert.deepEqual(limitKey, ['interest-questions:D0000001', QUESTIONNAIRE_REQUESTS_PER_MINUTE]);
    assert.equal(received.stage, 'group');
    assert.equal(received.group, 'outside');
    assert.equal('canonicalId' in received, false);
  });
});
