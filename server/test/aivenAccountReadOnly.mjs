// Read-only acceptance checks for the explicitly authorised test account.
// Run from server: node test/aivenAccountReadOnly.mjs
// For optional HTTP checks, pipe the test-account password to stdin and add --http.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.resolve(serverDir, '..', '.env'), quiet: true });
const studentId = 'D8800000';
const numericId = 5;
const runHttp = process.argv.includes('--http');
const password = runHttp ? fs.readFileSync(0, 'utf8').replace(/\r?\n$/, '') : null;
let failed = false;
function result(name, status, detail = '') {
  if (status === 'FAIL') failed = true;
  console.log(`${status} ${name}${detail ? `: ${detail}` : ''}`);
}
async function run() {
  if (process.env.DB_NAME !== 'defaultdb') throw new Error('Unexpected database; refusing to run');
  if (!process.env.DB_HOST || !process.env.DB_USER || !process.env.DB_PASSWORD) throw new Error('Missing database configuration');
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
    ssl: { ca: fs.readFileSync(path.join(serverDir, 'ca.pem')) }, connectTimeout: 10000,
  });
  try {
    const query = async (sql, args = []) => (await connection.execute(sql, args))[0];
    const profiles = await query(`SELECT COUNT(*) AS matches,
      SUM(student_id = ?) AS matching_student,
      SUM(LEFT(password_hash, 10) = '$argon2id$') AS argon2id,
      SUM(name IS NOT NULL AND TRIM(name) <> '' AND department IS NOT NULL AND TRIM(department) <> ''
          AND grade_level IS NOT NULL AND class_name IS NOT NULL AND TRIM(class_name) <> '') AS complete_profile
      FROM User_Profiles WHERE user_id = ?`, [studentId, numericId]);
    const p = profiles[0];
    const validIdentity = Number(p.matches) === 1 && Number(p.matching_student) === 1;
    result('Profile and numeric identity', validIdentity ? 'PASS' : 'FAIL');
    if (!validIdentity) { result('Remaining checks', 'BLOCKED', 'test identity did not match'); return; }
    result('Basic profile fields', Number(p.complete_profile) === 1 ? 'PASS' : 'FAIL');
    result('Argon2id hash format prefix', Number(p.argon2id) === 1 ? 'PASS' : 'FAIL');
    const index = await query(`SELECT INDEX_NAME FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'User_Profiles' AND COLUMN_NAME = 'student_id' AND NON_UNIQUE = 0
      GROUP BY INDEX_NAME HAVING COUNT(*) = 1`);
    // Confirm the unique index has exactly one column, not merely a unique composite index.
    const unique = await query(`SELECT COUNT(*) AS n FROM (SELECT INDEX_NAME FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'User_Profiles' AND NON_UNIQUE = 0
      GROUP BY INDEX_NAME HAVING COUNT(*) = 1 AND MAX(COLUMN_NAME = 'student_id') = 1) AS indexes_found`);
    result('Unique student ID index', index.length && Number(unique[0].n) > 0 ? 'PASS' : 'FAIL');
    for (const [label, table] of [['Saved schedules', 'Saved_Schedules'], ['Course history', 'User_Course_History']]) {
      const rows = await query(`SELECT COUNT(*) AS n FROM \`${table}\` WHERE user_id = ?`, [numericId]);
      result(label + ' owned rows', 'PASS', `count=${Number(rows[0].n)}; no content displayed`);
    }
    const columns = await query(`SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'User_Profiles' AND COLUMN_NAME IN ('preference_tags','avoid_time','preferences_json')`);
    for (const { COLUMN_NAME: column } of columns) {
      const rows = await query(`SELECT COUNT(*) AS invalid_count FROM User_Profiles
        WHERE user_id = ? AND \`${column}\` IS NOT NULL AND JSON_VALID(\`${column}\`) = 0`, [numericId]);
      result(`Preference ${column} JSON`, Number(rows[0].invalid_count) === 0 ? 'PASS' : 'FAIL');
    }
    if (!columns.length) result('Preference JSON columns', 'BLOCKED', 'columns unavailable');
    if (runHttp && password) {
      const same = await query('SELECT COUNT(*) AS n FROM User_Profiles WHERE user_id = ? AND password_hash = ?', [numericId, password]);
      result('Hash differs from supplied password', Number(same[0].n) === 0 ? 'PASS' : 'FAIL');
    } else result('Plaintext comparison', 'BLOCKED', 'password not supplied');
  } finally { await connection.end(); }
  if (!runHttp || !password) { result('HTTP login and session checks', 'BLOCKED', 'password not supplied'); return; }
  const base = 'http://127.0.0.1:3001/api';
  async function request(route, opts = {}, cookie = '') {
    const response = await fetch(base + route, { ...opts, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, signal: AbortSignal.timeout(15000) });
    return { status: response.status, cookie: response.headers.get('set-cookie')?.split(';')[0], body: await response.json().catch(() => ({})) };
  }
  const wrong = await request('/auth/login', { method: 'POST', body: JSON.stringify({ studentId, password: password + '!invalid!' }) });
  result('Incorrect password rejected', wrong.status === 401 ? 'PASS' : 'FAIL', `HTTP ${wrong.status}`);
  const login = await request('/auth/login', { method: 'POST', body: JSON.stringify({ studentId, password }) });
  result('Test account login', login.status === 200 && Boolean(login.cookie) ? 'PASS' : 'FAIL', `HTTP ${login.status}`);
  if (login.status !== 200 || !login.cookie) return;
  const cookie = login.cookie;
  const me = await request('/auth/me', {}, cookie);
  result('Session identity', me.status === 200 && me.body.studentId === studentId && String(me.body.id) === String(numericId) ? 'PASS' : 'FAIL', `HTTP ${me.status}`);
  const profile = await request('/profile', {}, cookie);
  result('Profile and history read', profile.status === 200 && String(profile.body.mysqlUserId) === String(numericId) && Array.isArray(profile.body.courseHistory) ? 'PASS' : 'FAIL', `HTTP ${profile.status}`);
  const saved = await request('/schedule/saved', {}, cookie);
  result('Saved schedules read', saved.status === 200 && Array.isArray(saved.body.schedules) && saved.body.schedules.every(row => row.userId === studentId) ? 'PASS' : 'FAIL', `HTTP ${saved.status}`);
  for (const route of ['/profile?userId=NOT_A_TEST_USER', '/schedule/saved?userId=NOT_A_TEST_USER']) {
    const rejected = await request(route, {}, cookie);
    result('Cross-identity read rejected', rejected.status === 403 ? 'PASS' : 'FAIL', `HTTP ${rejected.status}`);
  }
  const logout = await request('/auth/logout', { method: 'POST' }, cookie);
  result('Logout response', logout.status === 200 ? 'PASS' : 'FAIL', `HTTP ${logout.status}`);
  // The server uses stateless tokens: logout clears the browser cookie, not stolen copies.
  result('Server-side revocation of copied cookie', 'BLOCKED', 'not supported by current stateless session design');
}
run().catch(error => { result('Execution', 'BLOCKED', error.code || 'connection or request failed'); process.exitCode = 1; })
  .finally(() => { if (failed) process.exitCode = 1; });
