// Roadmap #10 任務 3A：`POST /api/profile` 的輸入驗證。
//
// 這個檔案刻意**不碰資料庫**：驗證失敗的請求在寫入之前就回 400，所以拿掉 DB 環境變數
// 之後仍然測得到（對照 `accountIsolation.test.js` 的做法）。會真的寫入的情境由
// 一次性腳本對 demo 帳號手動驗證，紀錄在變更報告裡——`user_preferences` 是
// MySQL-only collection，沒有 JSON fallback 可以拿來寫自動化的寫入測試。

const DB_ENV_KEYS = ['DB_HOST', 'DB_USER', 'DB_NAME', 'DB_PASSWORD', 'DB_SSL_CA_PATH'];
for (const key of DB_ENV_KEYS) delete process.env[key];
process.env.NODE_ENV = 'test';
process.env.PRIVACY_STORE = 'memory';
process.env.PRIVACY_ENFORCEMENT_ENABLED = 'true';
process.env.ANALYTICS_ID_SECRET = 'profile-route-test-secret-32-characters!!';
process.env.PRIVACY_DATA_KEY_V1 = Buffer.alloc(32, 5).toString('base64');
delete process.env.OPENAI_API_KEY;

const { after, before, describe, test } = await import('node:test');
const assert = (await import('node:assert/strict')).default;
const fs = (await import('node:fs')).default;
const path = (await import('node:path')).default;
const { fileURLToPath } = await import('node:url');

const { app } = await import('../src/app.js');
const { resetPrivacyMemoryStoreForTests, recordConsentChoices } =
  await import('../src/services/privacyService.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const demo = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'data', 'users.json'), 'utf8'))[0];

let server;
let baseUrl;
let cookie;

before(async () => {
  resetPrivacyMemoryStoreForTests();
  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
  const login = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentId: demo.studentId, password: demo.password }),
  });
  cookie = login.headers.get('set-cookie').split(';')[0];
  await recordConsentChoices({ canonicalId: demo.studentId }, {
    service_processing: true,
    personalization_learning: true,
  });
});

after(async () => {
  await new Promise((resolve, reject) => server.close(err => (err ? reject(err) : resolve())));
});

const post = body => fetch(`${baseUrl}/profile`, {
  method: 'POST',
  headers: { Cookie: cookie, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

describe('#10 任務 3A POST /api/profile 的輸入驗證', () => {
  test('useLearnedPreference 只接受布林值', async () => {
    for (const value of ['false', 'true', 0, 1, null, {}]) {
      const response = await post({ useLearnedPreference: value });
      assert.equal(response.status, 400, `${JSON.stringify(value)} 應該被拒絕`);
      assert.match((await response.json()).error, /useLearnedPreference 必須是布林值/u);
    }
  });

  // 先前的漏洞：頂層 `useLearnedPreference` 有布林檢查，但整包 `preferencesJson`
  // 照收，送 `{ values: { useLearnedPreference: "false" } }` 就能把不合法的字串
  // 存進去，讀取時再靜默退回 true——型別檢查等於白做。
  test('preferencesJson 不可直接更新，字串不能從這條路徑繞過布林檢查', async () => {
    const response = await post({
      preferencesJson: { schemaVersion: 1, values: { useLearnedPreference: 'false' } },
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /preferencesJson 不可直接更新/u);
  });

  test('preferencesJson 即使形狀完全合法也一樣拒絕（避免整包覆寫洗掉其他鍵）', async () => {
    const response = await post({
      preferencesJson: { schemaVersion: 1, values: { useLearnedPreference: false } },
    });
    assert.equal(response.status, 400);
  });

  test('既有的陣列與字串欄位驗證維持不變', async () => {
    assert.equal((await post({ interests: 'AI' })).status, 400);
    assert.equal((await post({ preferredTrack: 42 })).status, 400);
    assert.equal((await post({ department: '' })).status, 400);
  });
});
