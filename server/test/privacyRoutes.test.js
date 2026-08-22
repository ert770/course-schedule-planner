import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app } from '../src/app.js';
import { resetPrivacyMemoryStoreForTests } from '../src/services/privacyService.js';

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

after(() => new Promise((resolve, reject) => server.close(err => (err ? reject(err) : resolve()))));

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
