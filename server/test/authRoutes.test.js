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

let server;
let baseUrl;

before(async () => {
  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close(err => (err ? reject(err) : resolve())));
  await closePool();
});

describe('#18 authenticated identity routes', () => {
  test('未登入不能讀取個人 Profile', async () => {
    const response = await fetch(`${baseUrl}/profile`);
    assert.equal(response.status, 401);
  });

  test('登入 cookie 可讀取 /auth/me，但冒用另一身分會被拒絕', async () => {
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

    const profile = await fetch(`${baseUrl}/profile`, { headers: { Cookie: cookie } });
    assert.equal(profile.status, 200);
    assert.equal((await profile.json()).schemaVersion, 1);

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
