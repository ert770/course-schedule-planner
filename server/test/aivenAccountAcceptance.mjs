// Aiven acceptance for the authorised test identity only. Defaults to read-only.
// Optional --write-test changes only user_id=5 max_credits, then restores it.
// Password is read from stdin, never a command-line argument or log entry.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.resolve(serverDir, '..', '.env'), quiet: true });
const writeTest = process.argv.includes('--write-test');
const pw = fs.readFileSync(0, 'utf8').replace(/\r?\n$/, '');
const userId = 5, studentId = 'D8800000';
let failed = false, restoration = 'NOT_NEEDED', conn;
const report = (name, status, detail = '') => {
  console.log(`${status} ${name}${detail ? ` — ${detail}` : ''}`);
  if (status === 'FAIL') failed = true;
};
const q = async (sql, params = []) => (await conn.execute(sql, params))[0];
const sortObject = x => Array.isArray(x) ? x.map(sortObject) : x && typeof x === 'object'
  ? Object.fromEntries(Object.keys(x).sort().map(k => [k, sortObject(x[k])])) : x;
const same = (a, b) => JSON.stringify(sortObject(a)) === JSON.stringify(sortObject(b));
const json = x => typeof x === 'string' ? JSON.parse(x) : x;
async function http(route, method = 'GET', body, cookie = '') {
  const response = await fetch(`http://127.0.0.1:3001/api${route}`, {
    method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000),
  });
  return { status: response.status, body: await response.json().catch(() => ({})), cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
async function profileSnapshot(target = false) {
  const columns = await q("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'User_Profiles' ORDER BY ORDINAL_POSITION");
  if (!columns.length) throw new Error('profile schema unavailable');
  const expressions = columns.map(({ COLUMN_NAME: c }) => {
    const safe = c.replaceAll('`', '``');
    return `\`${safe}\``;
  });
  // Data is hashed in MySQL. Only opaque digests enter process memory, never output.
  const joined = expressions.map((v, i) => `'c${i}', ${v}`).join(', ');
  const hashes = await q(`SELECT SHA2(CAST(JSON_OBJECT(${joined}) AS CHAR), 256) AS digest FROM User_Profiles WHERE user_id ${target ? '=' : '<>'} ? ORDER BY user_id`, [userId]);
  return createHash('sha256').update(hashes.map(r => r.digest).join('')).digest('hex');
}
async function profileState() {
  const rows = await q('SELECT COUNT(*) AS total, SUM(user_id = ?) AS target FROM User_Profiles', [userId]);
  const target = await q(`SELECT max_credits, student_id = ? AS identity_ok,
    SHA2(CAST(JSON_OBJECT('student_id', student_id, 'name', name, 'department', department,
      'grade_level', grade_level, 'class_name', class_name, 'password_hash', password_hash) AS CHAR), 256) AS immutable_digest
    FROM User_Profiles WHERE user_id = ?`, [studentId, userId]);
  return { total: Number(rows[0].total), target: Number(rows[0].target), item: target[0] };
}
async function readSchedule() {
  return q('SELECT schedule_id, schedule_json FROM Saved_Schedules WHERE user_id = ? ORDER BY schedule_id', [userId]);
}
async function main() {
  if (!pw) { report('驗收', 'BLOCKED', '未提供測試帳號密碼'); return; }
  if (process.env.DB_NAME !== 'defaultdb' || !process.env.DB_HOST || !process.env.DB_USER || !process.env.DB_PASSWORD) throw new Error('database configuration unavailable');
  conn = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
    ssl: { ca: fs.readFileSync(path.join(serverDir, 'ca.pem')) }, connectTimeout: 10000 });
  const before = await profileState();
  if (before.target !== 1 || Number(before.item.identity_ok) !== 1) throw new Error('test identity mismatch');
  const othersBefore = await profileSnapshot();
  const targetBefore = await profileSnapshot(true);
  const schedulesBefore = await readSchedule();
  console.log(`INFO 測試前 Profile 總數=${before.total}；測試帳號已存課表數=${schedulesBefore.length}`);
  const login = await http('/auth/login', 'POST', { studentId, password: pw });
  if (login.status !== 200 || !login.cookie || login.body.user?.studentId !== studentId || String(login.body.user?.id) !== String(userId)) {
    report('測試帳號登入與身分', 'FAIL', `HTTP ${login.status}`); return;
  }
  report('測試帳號登入與身分', 'PASS');
  const cookie = login.cookie;
  const anonymous = await http('/profile');
  report('未帶 Cookie 拒絕', anonymous.status === 401 ? 'PASS' : 'FAIL', `HTTP ${anonymous.status}`);
  const saved = await http('/schedule/saved', 'GET', undefined, cookie);
  const mapped = new Map(schedulesBefore.map(row => { const data = json(row.schedule_json); return [String(row.schedule_id), Array.isArray(data) ? data : data?.courses ?? []]; }));
  const schedulesOk = saved.status === 200 && Array.isArray(saved.body.schedules) && saved.body.schedules.length === mapped.size && saved.body.schedules.every(row => row.userId === studentId && mapped.has(String(row.id)) && same(row.scheduleData, mapped.get(String(row.id))));
  report('本人課表 API 與 MySQL 一致', schedulesOk ? 'PASS' : 'FAIL');
  for (const route of ['/profile?userId=NOT_A_TEST_USER', '/schedule/saved?userId=NOT_A_TEST_USER']) {
    const r = await http(route, 'GET', undefined, cookie);
    report('跨身分讀取遭拒', r.status === 403 ? 'PASS' : 'FAIL', `HTTP ${r.status}`);
  }
  report('重複註冊', 'BLOCKED', '該流程可能推進 ID 配發器；不符合僅允許偏好寫入的限制');
  if (writeTest) {
    const original = before.item.max_credits;
    const testValue = Number(original) === 18 ? 19 : 18;
    let attempted = false, requestSettled = false;
    try {
      const current = await profileState();
      if (current.item.max_credits !== original || current.item.immutable_digest !== before.item.immutable_digest) throw new Error('target changed before test');
      attempted = true;
      const update = await http('/profile', 'POST', { targetCreditsMax: testValue }, cookie);
      requestSettled = true;
      const afterWrite = await profileState();
      const reread = await http('/profile', 'GET', undefined, cookie);
      report('偏好 API 寫入與 MySQL 重讀', update.status === 200 && Number(afterWrite.item.max_credits) === testValue && reread.status === 200 && Number(reread.body.targetCreditsMax) === testValue ? 'PASS' : 'FAIL');
      // Only a fictitious subject is used; this may at most alter the authorised test profile if isolation fails.
      requestSettled = false;
      const spoof = await http('/profile', 'POST', { userId: 'NOT_A_TEST_USER', targetCreditsMax: testValue }, cookie);
      requestSettled = true;
      report('跨身分修改遭拒', spoof.status === 403 ? 'PASS' : 'FAIL', `HTTP ${spoof.status}`);
    } catch { report('偏好寫入測試', 'FAIL', '請求或驗證失敗'); }
    finally {
      if (attempted) {
        try {
          const now = await profileState();
          if (now.item.max_credits === original) restoration = requestSettled ? 'CONFIRMED' : 'UNCONFIRMED';
          else if (Number(now.item.max_credits) === testValue && Number(now.item.identity_ok) === 1 && now.item.immutable_digest === before.item.immutable_digest) {
            const [result] = await conn.execute('UPDATE User_Profiles SET max_credits = ? WHERE user_id = ? AND student_id = ? AND max_credits = ?', [original, userId, studentId, testValue]);
            const restored = await profileState();
            restoration = requestSettled && result.affectedRows === 1 && restored.item.max_credits === original ? 'CONFIRMED' : 'UNCONFIRMED';
          } else restoration = 'UNCONFIRMED';
        } catch { restoration = 'UNCONFIRMED'; }
        report('偏好原值還原', restoration === 'CONFIRMED' ? 'PASS' : 'FAIL', restoration === 'CONFIRMED' ? '已重新查詢' : '無法確認；請人工檢查測試帳號');
      }
    }
  } else {
    report('偏好寫入與還原', 'BLOCKED', '預設唯讀；使用 --write-test 啟用');
    report('跨身分修改', 'BLOCKED', '需要 --write-test');
  }
  const logout = await http('/auth/logout', 'POST', undefined, cookie);
  const afterLogout = await http('/profile');
  report('登出後未帶 Cookie 拒絕', logout.status === 200 && afterLogout.status === 401 ? 'PASS' : 'FAIL');
  const after = await profileState(), othersAfter = await profileSnapshot(), targetAfter = await profileSnapshot(true), schedulesAfter = await readSchedule();
  console.log(`INFO 測試後 Profile 總數=${after.total}；測試帳號已存課表數=${schedulesAfter.length}`);
  report('Profile 筆數與測試帳號資料完整', before.total === after.total && before.item.immutable_digest === after.item.immutable_digest && before.item.max_credits === after.item.max_credits && targetBefore === targetAfter ? 'PASS' : 'FAIL');
  report('其他 Profile 無變動', othersBefore === othersAfter ? 'PASS' : 'FAIL');
  report('本人已存課表無變動', same(schedulesBefore, schedulesAfter) ? 'PASS' : 'FAIL');
  console.log(`INFO 還原狀態=${restoration}`);
}
main().catch(e => { report('執行', 'BLOCKED', e.code || '連線或驗證中止；未輸出錯誤內容'); if (writeTest && restoration === 'NOT_NEEDED') console.log('INFO 還原狀態=NOT_STARTED_OR_UNCONFIRMED'); process.exitCode = 1; })
  .finally(async () => { if (conn) await conn.end(); if (failed) process.exitCode = 1; });
