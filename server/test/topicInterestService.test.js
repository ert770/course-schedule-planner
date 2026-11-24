// ADR-037：Agent 讀寫課程主題偏好。候選池、寫入與事件都用注入，不連資料庫。
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { interestTagCatalog } from '../src/data/interestTagCatalog.js';
import {
  buildTagInterestSnapshot,
  computeTagInterestProfile,
  scoreCourseTagInterest,
} from '../src/skills/tagInterestLearning.js';
import {
  collectPoolTags,
  findTopicTags,
  locateTagCategory,
  updateTopicInterests,
} from '../src/services/topicInterestService.js';

const tagByName = name => interestTagCatalog.canonicalTags.find(tag => tag.name === name);
const BLOCKCHAIN = tagByName('區塊鏈');
const SECURITY = tagByName('資訊安全');
const WEB_DESIGN = tagByName('網頁設計');
const WEB_DEV = tagByName('網頁開發');
const GENAI = tagByName('生成式AI');

const course = (id, code, tags, extra = {}) => ({
  id, sectionId: id, catalogCourseCode: code, name: `課程${id}`, category: '選修', ragTag: tags, ...extra,
});
const POOL = [
  course(1, 'IECS1001', ['區塊鏈', '資訊安全']),
  course(2, 'IECS1002', ['網頁設計', 'Python']),
  course(3, 'IECS1003', ['網頁開發', '生成式AI']),
  course(4, 'IECS0001', ['生成式AI'], { category: '必修' }),
  course(5, 'GE0005', ['生成式AI']),
];
const menu = { scopeReady: true, courses: POOL, grouped: { department: POOL, generalEducation: [], outside: POOL } };
const PREFS = () => ({ department: '資訊工程學系', gradeLevel: 4, className: '資訊四合', interestSelections: [] });
const identity = { canonicalId: 'D0000001' };

function harness({ consent = true } = {}) {
  const calls = { writes: [], events: [], sanitize: 0 };
  return {
    calls,
    deps: {
      getMenu: async () => menu,
      updatePreferences: async (_id, payload) => { calls.writes.push(payload.interestSelections); },
      recordEvents: async (_id, drafts) => {
        calls.events.push(...drafts);
        if (!consent) return { recorded: false, reason: 'CONSENT_NOT_GRANTED', results: [] };
        return { recorded: drafts.length, results: drafts.map(draft => ({ actionId: draft.actionId, status: 'append' })) };
      },
    },
  };
}

describe('TI1 把使用者的話對到候選課程裡的主題', () => {
  const pool = collectPoolTags(POOL);

  test('完全相同與別名直接命中，部分相符列出候選', () => {
    assert.equal(findTopicTags('區塊鏈', pool).exact.tagId, BLOCKCHAIN.id);
    assert.equal(findTopicTags('資安', pool).exact.tagId, SECURITY.id);
    const web = findTopicTags('網頁', pool);
    assert.equal(web.exact, null);
    assert.deepEqual(web.matches.map(item => item.tagId).sort(), [WEB_DESIGN.id, WEB_DEV.id].sort());
  });

  test('英文整字比對，太常見的主題另外列出', () => {
    assert.ok(findTopicTags('AI', pool).matches.some(item => item.tagId === GENAI.id));
    assert.equal(findTopicTags('AI', pool).matches.some(item => item.tagId === BLOCKCHAIN.id), false);
    assert.deepEqual(findTopicTags('Python', pool).tooCommon, ['Python']);
  });

  test('找得到保存驗證會接受的方向', () => {
    const place = locateTagCategory(BLOCKCHAIN.id, menu);
    assert.ok(['department', 'outside'].includes(place.group));
    assert.equal(place.level, place.group === 'department' ? 'sub' : 'main');
  });
});

describe('TI2 加入與移除主題（直接寫入）', () => {
  test('加入：寫回整份勾選，記憶體中的 prefs 同步', async () => {
    const { calls, deps } = harness();
    const prefs = PREFS();
    const result = await updateTopicInterests(identity, prefs, { addTerms: ['區塊鏈'] }, deps);
    assert.equal(result.success, true);
    assert.deepEqual(result.added, ['區塊鏈']);
    assert.equal(calls.writes.length, 1);
    assert.ok(calls.writes[0].some(item => item.tagIds.includes(BLOCKCHAIN.id) && item.mode === 'direct'));
    assert.ok(prefs.interestSelections.some(item => item.tagIds.includes(BLOCKCHAIN.id)));
    assert.equal(calls.events.length, 0, '加入不寫事件');
  });

  test('對不到唯一主題時完全不寫入，回 needsChoice', async () => {
    const { calls, deps } = harness();
    const result = await updateTopicInterests(identity, PREFS(), { addTerms: ['區塊鏈', '網頁'] }, deps);
    assert.equal(result.needsChoice[0].term, '網頁');
    assert.equal(result.success, undefined);
    assert.equal(calls.writes.length, 0, '其中一個詞要選時，連區塊鏈也不寫');
  });

  test('只說太常見的主題時不寫入、不算失敗', async () => {
    const { calls, deps } = harness();
    const pool = [course(9, 'X1', ['Python'])];
    const result = await updateTopicInterests(identity, PREFS(), { addTerms: ['Python'] }, {
      ...deps, getMenu: async () => ({ ...menu, courses: pool, grouped: { department: pool, generalEducation: [], outside: [] } }),
    });
    assert.deepEqual(result.tooCommon, [{ term: 'Python', topics: ['Python'] }]);
    assert.equal(result.noChange, true);
    assert.equal(calls.writes.length, 0);
  });

  test('移除：不經保存驗證，方向空了就刪掉；預設記一筆沒興趣、掛在帶該主題的非必修課', async () => {
    const { calls, deps } = harness();
    const prefs = {
      ...PREFS(),
      interestSelections: [
        { group: 'outside', categoryId: 'main_a', level: 'main', mode: 'direct', tagIds: [GENAI.id] },
        { group: 'outside', categoryId: 'main_b', level: 'main', mode: 'direct', tagIds: [SECURITY.id, GENAI.id] },
      ],
    };
    const result = await updateTopicInterests(identity, prefs, { removeTerms: ['生成式AI'] }, {
      ...deps,
      sanitize: () => { throw new Error('移除不該經過保存驗證'); },
    });
    assert.deepEqual(result.removed, ['生成式AI']);
    assert.deepEqual(calls.writes[0], [
      { group: 'outside', categoryId: 'main_b', level: 'main', mode: 'direct', tagIds: [SECURITY.id] },
    ]);
    assert.equal(calls.events.length, 1);
    const [event] = calls.events;
    assert.equal(event.eventType, 'interest_exploration_feedback');
    assert.deepEqual(event.interestFeedback, { response: 'not_interested', canonicalTagIds: [GENAI.id] });
    assert.equal(event.source, 'exploration');
    // 課號最小、不是必修、帶有該主題：IECS0001 是必修，排除；GE0005 < IECS1003。
    assert.equal(event.course.catalogCourseCode, 'GE0005');
    assert.deepEqual(result.notInterestedRecorded, [{ topic: '生成式AI', viaCourse: '課程5' }]);

    // 同一位使用者、同一主題、同一學期的 actionId 固定，重試不會重複計數。
    const again = harness();
    await updateTopicInterests(identity, { ...PREFS(), interestSelections: [] }, { removeTagIds: [GENAI.id] }, again.deps);
    assert.equal(again.calls.events[0].actionId, event.actionId);
  });

  test('移除時保留原本就只選方向、沒勾主題的項目', async () => {
    const { calls, deps } = harness();
    const directionOnly = { group: 'generalEducation', categoryId: 'main_c', level: 'main', mode: 'direct', tagIds: [] };
    const prefs = { ...PREFS(), interestSelections: [
      directionOnly,
      { group: 'outside', categoryId: 'main_a', level: 'main', mode: 'direct', tagIds: [BLOCKCHAIN.id] },
    ] };
    await updateTopicInterests(identity, prefs, { removeTerms: ['區塊鏈'], recordNotInterested: false }, deps);
    assert.deepEqual(calls.writes[0], [directionOnly]);
  });

  test('只拿掉勾選時不記事件；沒同意個人化時照實回報', async () => {
    const prefs = () => ({ ...PREFS(), interestSelections: [
      { group: 'outside', categoryId: 'main_a', level: 'main', mode: 'direct', tagIds: [GENAI.id] },
    ] });
    const plain = harness();
    await updateTopicInterests(identity, prefs(), { removeTerms: ['生成式AI'], recordNotInterested: false }, plain.deps);
    assert.equal(plain.calls.events.length, 0);

    const noConsent = harness({ consent: false });
    const result = await updateTopicInterests(identity, prefs(), { removeTerms: ['生成式AI'] }, noConsent.deps);
    assert.deepEqual(result.removed, ['生成式AI']);
    assert.deepEqual(result.notInterestedRecorded, []);
    assert.match(result.notInterestedSkipped[0].reason, /沒有同意個人化/u);
  });

  test('候選課程沒有可掛的課時，只拿掉勾選並說明', async () => {
    const { calls, deps } = harness();
    const prefs = { ...PREFS(), interestSelections: [
      { group: 'outside', categoryId: 'main_a', level: 'main', mode: 'direct', tagIds: [BLOCKCHAIN.id] },
    ] };
    const result = await updateTopicInterests(identity, prefs, { removeTerms: ['區塊鏈'] }, {
      ...deps, getMenu: async () => ({ ...menu, courses: [] }),
    });
    assert.deepEqual(result.removed, ['區塊鏈']);
    assert.equal(calls.events.length, 0);
    assert.match(result.notInterestedSkipped[0].reason, /沒有可以記錄/u);
  });
});

describe('TI3 對 s_tag 的實際影響', () => {
  const target = course(10, 'T001', ['區塊鏈']);

  test('加入後先驗為 1，單純移除回到 0，移除＋沒興趣變成負的', () => {
    // 方向要是目錄裡真的分類，否則先驗會被忽略。
    const place = locateTagCategory(BLOCKCHAIN.id, menu);
    const selected = { interestSelections: [{ group: place.group, categoryId: place.categoryId, tagIds: [BLOCKCHAIN.id] }] };
    assert.equal(scoreCourseTagInterest(computeTagInterestProfile([], selected), target.ragTag).score, 1);
    assert.equal(scoreCourseTagInterest(computeTagInterestProfile([], {}), target.ragTag).score, 0);

    const event = {
      eventId: 'e1',
      eventType: 'interest_exploration_feedback',
      timestamp: '2026-11-24T00:00:00.000Z',
      course: { catalogCourseCode: 'T001', sectionId: 10 },
      term: { academicYear: 114, semester: '下學期' },
      source: 'exploration',
      interestFeedback: { response: 'not_interested', canonicalTagIds: [BLOCKCHAIN.id] },
    };
    const withSnapshot = { ...event, tagInterestSnapshot: buildTagInterestSnapshot(event, target, { resolved: true }) };
    const profile = computeTagInterestProfile([withSnapshot], {}, { now: event.timestamp, activeTerm: event.term });
    assert.ok(scoreCourseTagInterest(profile, target.ragTag).score < 0);
  });
});
