// 課程主題選擇的三個路由：`GET /api/courses/interest-options`、`POST /api/profile/interest-followups`、
// `POST /api/profile` 的課程主題保存回應。
//
// 兩層測法：
//   1. 處理函式（路由抽出來的）注入假的候選池、偏好與追問服務，測回應形狀與狀態碼，不連資料庫、不呼叫 OpenAI。
//   2. 真的 app（不連資料庫，隱私資料用記憶體）測 middleware 閘門：未登入、未同意、格式錯誤、限流、缺班別。
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { app } from '../src/app.js';
import { buildInterestOptionsResponse } from '../src/routes/courses.js';
import {
  applyInterestSelectionValidation,
  buildProfileSaveResponse,
  handleInterestFollowupsRequest,
} from '../src/routes/profile.js';
import { resetPrivacyMemoryStoreForTests } from '../src/services/privacyService.js';
import { FOLLOWUP_REQUESTS_PER_MINUTE } from '../src/data/interestMenuConfig.js';
import { closePool } from '../src/db/mysql.js';

const IDENTITY = { canonicalId: 'TEST0001' };

describe('GET /interest-options：buildInterestOptionsResponse', () => {
  const fakeMenu = calls => async filters => {
    calls.push(filters);
    return { topicGroups: [{ key: 'department', options: [{ id: 'x' }] }], scopeReady: true, candidateCourseCount: 42 };
  };

  test('缺系所或年級不是整數：400，不查候選池', async () => {
    const calls = [];
    for (const query of [{ gradeLevel: '3' }, { department: ' ', gradeLevel: '3' }, { department: '資訊工程學系', gradeLevel: '三' }]) {
      const { status, body } = await buildInterestOptionsResponse(query, { getMenu: fakeMenu(calls) });
      assert.equal(status, 400);
      assert.ok(body.error);
    }
    assert.equal(calls.length, 0);
  });

  test('沒有班別：回修課路徑，但不查候選池、不猜課程主題', async () => {
    const calls = [];
    const { status, body } = await buildInterestOptionsResponse(
      { department: '資訊工程學系', gradeLevel: '3' }, { getMenu: fakeMenu(calls) },
    );
    assert.equal(status, 200);
    assert.equal(calls.length, 0);
    assert.equal(body.tracks.length, 3);
    assert.deepEqual(body.topicGroups, []);
    assert.equal(body.scopeReady, false);
    assert.equal(body.candidateCourseCount, 0);
  });

  test('有班別：用去頭尾空白後的範圍查候選池，回 topicGroups，不再回舊的 topics', async () => {
    const calls = [];
    const { status, body } = await buildInterestOptionsResponse(
      { department: ' 資訊工程學系 ', gradeLevel: '3', className: ' 資訊三甲 ' }, { getMenu: fakeMenu(calls) },
    );
    assert.equal(status, 200);
    assert.deepEqual(calls, [{ department: '資訊工程學系', gradeLevel: 3, className: '資訊三甲' }]);
    assert.equal(body.topicGroups[0].key, 'department');
    assert.equal(body.scopeReady, true);
    assert.equal(body.candidateCourseCount, 42);
    assert.ok(!('topics' in body) && !('topicCourseCount' in body));
  });

  test('修課路徑只給資工系：其他系所是空陣列', async () => {
    const { body } = await buildInterestOptionsResponse(
      { department: '企業管理學系', gradeLevel: '3' }, { getMenu: fakeMenu([]) },
    );
    assert.deepEqual(body.tracks, []);
  });
});

describe('POST /interest-followups：handleInterestFollowupsRequest', () => {
  const VALID = {
    department: '資訊工程學系', gradeLevel: 3, className: '資訊三甲',
    selections: [{ group: 'outside', categoryId: 'main_aa3c5e78f9a2b33887a9' }],
  };
  const deps = (overrides = {}) => {
    const log = { limitKeys: [], followupCalls: [] };
    return {
      log,
      checkLimit: key => { log.limitKeys.push(key); return true; },
      loadPrefs: async () => ({ interestSelections: [{ group: 'outside', categoryId: 'main_aa3c5e78f9a2b33887a9', tagIds: ['tag_a'] }] }),
      getFollowups: async request => { log.followupCalls.push(request); return { followups: [{ source: 'fixed' }] }; },
      ...overrides,
    };
  };

  test('超過限流：429 RATE_LIMITED，不驗格式、不呼叫追問服務', async () => {
    const d = deps({ checkLimit: () => false });
    const { status, body } = await handleInterestFollowupsRequest({ identity: IDENTITY, body: VALID }, d);
    assert.equal(status, 429);
    assert.equal(body.code, 'RATE_LIMITED');
    assert.equal(d.log.followupCalls.length, 0);
  });

  test('限流以使用者為單位', async () => {
    const d = deps();
    await handleInterestFollowupsRequest({ identity: IDENTITY, body: VALID }, d);
    assert.deepEqual(d.log.limitKeys, ['interest-followups:TEST0001']);
  });

  test('格式錯誤：400，不呼叫追問服務', async () => {
    const d = deps();
    for (const body of [{}, { ...VALID, className: '' }, { ...VALID, selections: [] }]) {
      const result = await handleInterestFollowupsRequest({ identity: IDENTITY, body }, d);
      assert.equal(result.status, 400);
      assert.ok(result.body.error);
    }
    assert.equal(d.log.followupCalls.length, 0);
  });

  test('成功：把已保存的選擇當 previousSelections 交給追問服務，原樣回傳結果', async () => {
    const d = deps();
    const { status, body } = await handleInterestFollowupsRequest({ identity: IDENTITY, body: VALID }, d);
    assert.equal(status, 200);
    assert.deepEqual(body, { followups: [{ source: 'fixed' }] });
    const [request] = d.log.followupCalls;
    assert.deepEqual(request.filters, { department: '資訊工程學系', gradeLevel: 3, className: '資訊三甲' });
    assert.deepEqual(request.previousSelections[0].tagIds, ['tag_a']);
  });

  test('請求本文只帶分類與班級範圍：送給追問服務的內容沒有使用者 ID 或 Profile', async () => {
    const d = deps();
    await handleInterestFollowupsRequest({ identity: IDENTITY, body: { ...VALID, userId: 'X', courseHistory: [1] } }, d);
    const sent = JSON.stringify(d.log.followupCalls[0]);
    assert.ok(!sent.includes('TEST0001') && !sent.includes('courseHistory'));
  });
});

describe('POST /api/profile 的課程主題保存：applyInterestSelectionValidation／buildProfileSaveResponse', () => {
  const current = { department: '資訊工程學系', gradeLevel: 3, className: '資訊三甲', interestSelections: [{ group: 'outside', categoryId: 'm', tagIds: ['old'] }] };

  test('沒送 interestSelections：不驗證，回應不帶狀態欄位', async () => {
    let called = false;
    const updates = { mbti: 'INTJ' };
    const result = await applyInterestSelectionValidation(updates, IDENTITY, {
      loadPrefs: async () => current, sanitize: async () => { called = true; return {}; },
    });
    assert.equal(result, null);
    assert.equal(called, false);
    const response = buildProfileSaveResponse({ mbti: 'INTJ' }, result);
    assert.deepEqual(Object.keys(response).sort(), ['preferences', 'success']);
  });

  test('有送：用驗證後的結果取代送來的選擇，回應附狀態與警告', async () => {
    const updates = { interestSelections: [{ group: 'outside', categoryId: 'm', tagIds: ['old', 'bad'] }] };
    const sanitized = {
      status: 'verified',
      warnings: [{ group: 'outside', categoryId: 'm', tagId: 'bad', reason: 'tag_not_in_pool' }],
      selections: [{ group: 'outside', categoryId: 'm', tagIds: ['old'] }],
    };
    let input = null;
    const result = await applyInterestSelectionValidation(updates, IDENTITY, {
      loadPrefs: async () => current, sanitize: async received => { input = received; return sanitized; },
    });
    assert.deepEqual(updates.interestSelections, sanitized.selections, '存進資料庫的是驗證後的選擇');
    assert.deepEqual(input.previousSelections, current.interestSelections);
    const response = buildProfileSaveResponse({}, result);
    assert.equal(response.interestSelectionsStatus, 'verified');
    assert.equal(response.interestSelectionWarnings[0].reason, 'tag_not_in_pool');
  });

  test('學生範圍：這次送的欄位優先，沒送才用已保存的', async () => {
    let filters = null;
    await applyInterestSelectionValidation({ className: '資訊三乙', interestSelections: [] }, IDENTITY, {
      loadPrefs: async () => current,
      sanitize: async received => { filters = received.filters; return { status: 'unchanged', warnings: [], selections: [] }; },
    });
    assert.deepEqual(filters, { department: '資訊工程學系', gradeLevel: 3, className: '資訊三乙' });
  });

  test('unverified 照樣回傳給前端（前端據此顯示提示，不擋保存）', async () => {
    const result = await applyInterestSelectionValidation({ interestSelections: [] }, IDENTITY, {
      loadPrefs: async () => current,
      sanitize: async () => ({ status: 'unverified', warnings: [{ reason: 'verification_unavailable' }], selections: [] }),
    });
    assert.equal(buildProfileSaveResponse({}, result).interestSelectionsStatus, 'unverified');
  });
});

describe('HTTP 閘門（真的 app，不連資料庫）', () => {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const demo = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'data', 'users.json'), 'utf8'))[0];
  let server;
  let baseUrl;
  let cookie;

  before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.PRIVACY_STORE = 'memory';
    process.env.PRIVACY_ENFORCEMENT_ENABLED = 'true';
    // app.js 載入 server/.env；這裡用記憶體隱私資料，不連共用 DB、不呼叫 OpenAI。
    for (const key of ['DB_HOST', 'DB_USER', 'DB_NAME', 'DB_PASSWORD', 'DB_PORT', 'OPENAI_API_KEY', 'GEMINI_API_KEY']) {
      delete process.env[key];
    }
    process.env.ANALYTICS_ID_SECRET = 'route-test-analytics-secret-32-characters';
    process.env.PRIVACY_DATA_KEY_V1 = Buffer.alloc(32, 9).toString('base64');
    resetPrivacyMemoryStoreForTests();
    server = app.listen(0);
    await new Promise(resolve => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}/api`;
    const login = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId: demo.studentId, password: demo.password }),
    });
    cookie = login.headers.get('set-cookie').split(';')[0];
  });

  after(async () => {
    await new Promise((resolve, reject) => server.close(err => (err ? reject(err) : resolve())));
    await closePool();
  });

  const postFollowups = (body, headers = {}) => fetch(`${baseUrl}/profile/interest-followups`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  });

  test('interest-options 缺班別：200、回資工修課路徑、topicGroups 為空、沒有 topics', async () => {
    const response = await fetch(`${baseUrl}/courses/interest-options?department=${encodeURIComponent('資訊工程學系')}&gradeLevel=3`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.tracks.length, 3);
    assert.deepEqual(body.topicGroups, []);
    assert.equal(body.scopeReady, false);
    assert.ok(!('topics' in body));
  });

  test('interest-options 缺系所：400', async () => {
    const response = await fetch(`${baseUrl}/courses/interest-options?gradeLevel=3`);
    assert.equal(response.status, 400);
  });

  test('interest-followups 未登入：401', async () => {
    const response = await postFollowups({});
    assert.equal(response.status, 401);
  });

  test('interest-followups 已登入但未同意服務處理：428 CONSENT_REQUIRED', async () => {
    const response = await postFollowups({}, { Cookie: cookie });
    assert.equal(response.status, 428);
    assert.equal((await response.json()).code, 'CONSENT_REQUIRED');
  });

  test('同意後：格式錯誤 400；同一分鐘超過上限 429 RATE_LIMITED', async () => {
    const consent = await fetch(`${baseUrl}/privacy/consents`, {
      method: 'PUT', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ consents: { service_processing: true, personalization_learning: false, aggregate_research: false } }),
    });
    assert.equal(consent.status, 200);

    const statuses = [];
    for (let index = 0; index <= FOLLOWUP_REQUESTS_PER_MINUTE; index += 1) {
      statuses.push((await postFollowups({ department: '資訊工程學系' }, { Cookie: cookie })).status);
    }
    assert.deepEqual(statuses.slice(0, FOLLOWUP_REQUESTS_PER_MINUTE), Array(FOLLOWUP_REQUESTS_PER_MINUTE).fill(400));
    assert.equal(statuses.at(-1), 429);
  });
});
