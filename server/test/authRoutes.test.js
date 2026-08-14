import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app } from '../src/app.js';
import { closePool } from '../src/db/mysql.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const users = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'data', 'users.json'), 'utf8'));
const demo = users[0];
const DB_ENV_KEYS = ['DB_HOST', 'DB_USER', 'DB_NAME', 'DB_PASSWORD', 'DB_SSL_CA_PATH'];
const originalDbEnv = Object.fromEntries(DB_ENV_KEYS.map(key => [key, process.env[key]]));

let server;
let baseUrl;

before(async () => {
  // 這組測試只驗證 session identity 邊界，必須在 GitHub Actions 沒有 MySQL
  // secrets 的環境也能重現。成功讀取 Profile 的 MySQL 整合另由具 DB 的驗收負責。
  for (const key of DB_ENV_KEYS) delete process.env[key];
  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close(err => (err ? reject(err) : resolve())));
  await closePool();
  for (const key of DB_ENV_KEYS) {
    if (originalDbEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalDbEnv[key];
  }
});

describe('#18 authenticated identity routes', () => {
  test('未登入不能讀取個人 Profile', async () => {
    const response = await fetch(`${baseUrl}/profile`);
    assert.equal(response.status, 401);
  });

  test('登入 cookie 可讀取 /auth/me，冒用另一身分會在資料存取前被拒絕', async () => {
    const login = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId: demo.studentId, password: demo.password }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0];

    const me = await fetch(`${baseUrl}/auth/me`, { headers: { Cookie: cookie } });
    assert.equal(me.status, 200);
    assert.equal((await me.json()).studentId, demo.studentId);

    const spoofed = await fetch(`${baseUrl}/profile?userId=NOT_THE_SESSION_USER`, {
      headers: { Cookie: cookie },
    });
    assert.equal(spoofed.status, 403);

    const logout = await fetch(`${baseUrl}/auth/logout`, {
      method: 'POST',
      headers: { Cookie: cookie },
    });
    assert.equal(logout.status, 200);
    assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
  });
});
