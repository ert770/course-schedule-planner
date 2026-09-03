// Roadmap #28：兩個真的能登入的帳號，經 HTTP + cookie 驗證資料不交叉。
//
// 既有的隔離測試（IL-9、privacy service 的 chat 隔離、I1/I2）大多用手工捏的
// identity 物件在 service 層測——那證明的是「函式收到不同 subject 會分開
// 處理」，不是「兩個真人輪流登入後資料不會混」。這裡改用會登入的固定帳號，
// 走真正的 `/api/auth/login` → cookie → 後續請求，比對的是實際的 HTTP 邊界。
//
// `DATA_DIR` 指向獨立的 fixture（`test/fixtures/account-isolation/`），
// 不碰真正的 `server/data/`；`PRIVACY_STORE=memory` 且刪除 DB_* 環境變數，
// 不需要連真實 MySQL，比照 `authRoutes.test.js` 的做法。

import { after, afterEach, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.resolve(__dirname, 'fixtures', 'account-isolation');
const SAVED_SCHEDULES_PATH = path.join(FIXTURE_DIR, 'saved_schedules.json');

process.env.DATA_DIR = FIXTURE_DIR;
process.env.NODE_ENV = 'test';
process.env.PRIVACY_STORE = 'memory';
process.env.PRIVACY_ENFORCEMENT_ENABLED = 'true';
process.env.ANALYTICS_ID_SECRET = 'test-only-analytics-secret-32-characters';
process.env.PRIVACY_DATA_KEY_V1 = Buffer.alloc(32, 7).toString('base64');

const DB_ENV_KEYS = ['DB_HOST', 'DB_USER', 'DB_NAME', 'DB_PASSWORD', 'DB_SSL_CA_PATH'];
const originalDbEnv = Object.fromEntries(DB_ENV_KEYS.map(key => [key, process.env[key]]));
for (const key of DB_ENV_KEYS) delete process.env[key];

// 必須用動態 import：`DATA_DIR` 是 `database.js` 頂層常數，靜態 import 會在
// 上面這幾行執行之前就先跑掉，讀到還沒被覆寫的值。
const { app } = await import('../src/app.js');
const { closePool } = await import('../src/db/mysql.js');
const { recordConsentChoices, resetPrivacyMemoryStoreForTests } = await import('../src/services/privacyService.js');

const ACCOUNT_A = { studentId: 'AC-FIXTURE-A', password: 'fixture-a-pass' };
const ACCOUNT_B = { studentId: 'AC-FIXTURE-B', password: 'fixture-b-pass' };
const CONSENT_ALL_ON = {
  service_processing: true,
  personalization_learning: false,
  aggregate_research: false,
};

let server;
let baseUrl;

function removeSavedSchedulesFixture() {
  if (fs.existsSync(SAVED_SCHEDULES_PATH)) fs.rmSync(SAVED_SCHEDULES_PATH);
}

before(async () => {
  resetPrivacyMemoryStoreForTests();
  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close(err => (err ? reject(err) : resolve())));
  await closePool();
  removeSavedSchedulesFixture();
  for (const key of DB_ENV_KEYS) {
    if (originalDbEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalDbEnv[key];
  }
});

afterEach(() => {
  removeSavedSchedulesFixture();
});

async function loginAs(account) {
  const response = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(account),
  });
  assert.equal(response.status, 200, `登入 ${account.studentId} 應該成功`);
  const cookie = response.headers.get('set-cookie').split(';')[0];
  await recordConsentChoices({ canonicalId: account.studentId }, CONSENT_ALL_ON);
  return cookie;
}

describe('AC 帳號隔離：兩個真帳號經 HTTP + cookie', () => {
  test('AC1 已存課表互不可見——A 存的課表不會出現在 B 的清單裡', async () => {
    const cookieA = await loginAs(ACCOUNT_A);
    const saveResponse = await fetch(`${baseUrl}/schedule/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieA },
      body: JSON.stringify({
        name: 'A 的課表',
        schedule: [{ id: 1, sectionId: 1, credits: 3 }],
        totalCredits: 3,
      }),
    });
    assert.equal(saveResponse.status, 200);

    const cookieB = await loginAs(ACCOUNT_B);
    const savedForB = await fetch(`${baseUrl}/schedule/saved`, { headers: { Cookie: cookieB } });
    assert.equal(savedForB.status, 200);
    const bodyB = await savedForB.json();
    assert.deepEqual(bodyB.schedules, [], 'B 一筆都不該看到 A 存的課表');

    const savedForA = await fetch(`${baseUrl}/schedule/saved`, { headers: { Cookie: cookieA } });
    const bodyA = await savedForA.json();
    assert.equal(bodyA.schedules.length, 1);
    assert.equal(bodyA.schedules[0].name, 'A 的課表');
  });

  test('AC2 存課表時冒充另一個學號會被 403 擋下，不會寫到任一方', async () => {
    const cookieA = await loginAs(ACCOUNT_A);
    const response = await fetch(`${baseUrl}/schedule/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieA },
      body: JSON.stringify({
        userId: ACCOUNT_B.studentId,
        name: '冒充 B 存的課表',
        schedule: [{ id: 2, sectionId: 2, credits: 3 }],
        totalCredits: 3,
      }),
    });
    assert.equal(response.status, 403);

    const savedForA = await fetch(`${baseUrl}/schedule/saved`, { headers: { Cookie: cookieA } });
    const bodyA = await savedForA.json();
    assert.deepEqual(bodyA.schedules, [], 'A 自己的清單也不該多出這筆被擋下的請求');
  });

  test('AC3 更新關注清單時冒充另一個學號會被 403 擋下，對方的關注清單不受影響', async () => {
    const cookieA = await loginAs(ACCOUNT_A);
    const response = await fetch(`${baseUrl}/auth/update-watchlist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieA },
      body: JSON.stringify({ studentId: ACCOUNT_B.studentId, watchlist: [999] }),
    });
    assert.equal(response.status, 403);

    const users = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, 'users.json'), 'utf8'));
    const b = users.find(u => u.studentId === ACCOUNT_B.studentId);
    assert.deepEqual(b.watchlist, [], 'B 的關注清單不該被 A 的請求動到');
  });

  test('AC4 查詢畢業進度時冒充另一個學號會被 403 擋下', async () => {
    const cookieA = await loginAs(ACCOUNT_A);
    const response = await fetch(`${baseUrl}/graduation/${ACCOUNT_B.studentId}`, {
      headers: { Cookie: cookieA },
    });
    assert.equal(response.status, 403);
  });

  test('AC5 聊天時冒充另一個學號（query string）會被 403 擋下', async () => {
    const cookieA = await loginAs(ACCOUNT_A);
    const response = await fetch(`${baseUrl}/chat?studentId=${ACCOUNT_B.studentId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieA },
      body: JSON.stringify({ message: '測試訊息' }),
    });
    assert.equal(response.status, 403);
  });

  test('AC6 未登入時，所有 user-scoped route 一律 401，不會落到某個使用者', async () => {
    const routes = [
      ['GET', '/schedule/saved'],
      ['POST', '/schedule/save'],
      ['POST', '/auth/update-watchlist'],
      ['POST', '/chat'],
      ['GET', '/graduation/me'],
      ['GET', `/graduation/${ACCOUNT_A.studentId}`],
      ['GET', '/profile'],
    ];
    for (const [method, urlPath] of routes) {
      const response = await fetch(`${baseUrl}${urlPath}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: method === 'GET' ? undefined : JSON.stringify({}),
      });
      assert.equal(response.status, 401, `${method} ${urlPath} 未登入應該回 401`);
    }
  });
});
