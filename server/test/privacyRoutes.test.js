import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app } from '../src/app.js';
import { resetPrivacyMemoryStoreForTests } from '../src/services/privacyService.js';
import { closePool } from '../src/db/mysql.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const demo = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'data', 'users.json'), 'utf8'))[0];
let server;
let baseUrl;
let cookie;

before(async () => {
  process.env.NODE_ENV = 'test';
  process.env.PRIVACY_STORE = 'memory';
  process.env.PRIVACY_ENFORCEMENT_ENABLED = 'true';
  process.env.ANALYTICS_ID_SECRET = 'route-test-analytics-secret-32-characters';
  process.env.PRIVACY_DATA_KEY_V1 = Buffer.alloc(32, 9).toString('base64');
  delete process.env.GEMINI_API_KEY;
  // Chat 必須維持停用狀態才驗得到 consent gate；有 key 就會真的打 OpenAI。
  delete process.env.OPENAI_API_KEY;
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
  // 這個檔案不刪 DB 環境變數（`GET /privacy/export` 要走真實 MySQL 讀
  // Profile），所以跟 `authRoutes.test.js` 一樣要主動關閉連線池——不關的話
  // 這支測試單獨跑（`node --test test/privacyRoutes.test.js`）會因為池子還有
  // 存活連線而不結束行程，即使所有測試都已經通過。
  await closePool();
});

test('#33 personal route is blocked before current service consent and allowed after opt-in', async () => {
  const before = await fetch(`${baseUrl}/chat`, {
    method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: '測試' }),
  });
  assert.equal(before.status, 428);
  assert.equal((await before.json()).code, 'CONSENT_REQUIRED');

  const update = await fetch(`${baseUrl}/privacy/consents`, {
    method: 'PUT', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ consents: {
      service_processing: true,
      personalization_learning: false,
      aggregate_research: false,
    } }),
  });
  assert.equal(update.status, 200);
  const status = await update.json();
  assert.equal(status.requiresAction, false);
  assert.equal(status.consents.personalization_learning.granted, false);

  const afterConsent = await fetch(`${baseUrl}/chat`, {
    method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: '測試' }),
  });
  assert.equal(afterConsent.status, 200);
  assert.equal((await afterConsent.json()).intent, 'error');
});

// roadmap #30 的「export 帶 learnedPreferenceWeights 欄位」原本在這裡用真的
// `GET /api/privacy/export` 測——但那條路由本來就需要真實 MySQL 讀 Profile
// （與這次改動無關的既有限制），CI 刻意不設定 DB secret（見 `.github/workflows/ci.yml`
// 的註解），這裡的 fetch 因此會踩到 `getUserPreferences()` 拋出的 503／500，
// 不是我改的程式碼有問題。這個檔案先前只測 `/chat`、`/consents`，沒有任何案例
// 走到過 MySQL，所以這個既有限制沒被發現過。改成在
// `preferenceLearningService.test.js` 的 PL7 用完全不連 MySQL 的方式驗證同一件
// 事（consent 閘門、寫入、讀回、刪除），`routes/privacy.js` 這裡的 export 欄位
// 只是把 `getStoredLearnedWeights()` 的結果接上去，屬於一行接線，不再另外測。
