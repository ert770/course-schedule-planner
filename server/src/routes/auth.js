import { Router } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSession } from '../services/sessionService.js';
import { closeOwned } from '../services/controlledBrowserService.js';
import { closeLocalMyFcuOwned } from '../services/localMyFcuPreview.js';
import { clearCollection, getAll, insert } from '../db/database.js';
import { requireIdentity } from '../middleware/requireIdentity.js';
import { requireServiceConsent } from '../middleware/requireConsent.js';
import { buildClearSessionCookie, buildSessionCookie } from '../services/sessionService.js';
import { identityMatchesUser, resolveIdentityFrom, legacyAuthEnabled } from '../services/identityService.js';
import { isMysqlConfigured, queryRows } from '../db/mysql.js';
import { isIsolatedHistoryMysqlE2E } from '../services/isolatedHistoryE2E.js';
import { registerStudent, findMysqlAccount, verifyPassword } from '../services/accountService.js';
import { DEPARTMENT_TO_ABBREVIATIONS } from '../data/departmentMapping.js';
import { getUserPreferences } from '../services/memoryService.js';
import { isProfileSetupComplete } from '../data/profileSchema.js';
import { logger } from '../utils/logger.js';

const router = Router();

const mockFixtureDirectory = fileURLToPath(new URL('../../test/fixtures/account-isolation/', import.meta.url));
export function isControlledBrowserMockUser(user, req) {
  const mock = process.env.CONTROLLED_BROWSER_MOCK === 'true';
  const real = process.env.CONTROLLED_BROWSER_REAL_TEST === 'true';
  if (process.env.NODE_ENV !== 'test' || mock === real || (isMysqlConfigured() && !isIsolatedHistoryMysqlE2E())) return false;
  if (real && process.env.PRIVACY_ENFORCEMENT_ENABLED !== 'true') return false;
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req?.socket?.remoteAddress)) return false;
  if (!process.env.DATA_DIR || path.resolve(process.env.DATA_DIR) !== path.resolve(mockFixtureDirectory)) return false;
  return (user?.studentId === 'AC-FIXTURE-A' && Number(user.id) === 1)
    || (user?.studentId === 'AC-FIXTURE-B' && Number(user.id) === 2);
}

function withMockSetupFlag(profile, user, req) {
  return isControlledBrowserMockUser(user, req) ? { ...profile, controlledBrowserMock: true } : profile;
}

// 2026-09-10：顯示名稱的權威來源改成 `User_Profiles.name`，`users.json.name`
// 已刪除。login／me 過去直接回傳 `users.json` 那一列，name 因此原樣跟著消失；
// 這裡補接 Profile 的 displayName 進去，行為對使用者才不會變。
//
// **刻意 try/catch 吞掉失敗**：`user_preferences` 屬於 `MYSQL_ONLY_COLLECTIONS`，
// 本機沒設定 MySQL 時原本就能單靠 users.json 完成登入（見 AGENTS.md 的「沒有
// .env 時後端會自動退回 JSON 檔案」）。硬接這個查詢若不做防護，會讓「登入」
// 這個最基本的功能反過來變成需要資料庫才能用，屬於本末倒置。查不到就照舊用
// users.json 剩下的資料回應，只是沒有 name。
//
// 2026-10-16：同一份 Profile 另外回傳 `setupComplete`（系所與年級都有值），讓前端不必只靠
// 瀏覽器裡的 `setupDone` 標記判斷要不要走引導流程——那個標記登出就被清掉、換裝置也沒有，
// 已設定過的使用者因此每次登入都要重走同意頁與設定頁。查詢失敗時不帶這個欄位，前端退回舊標記。
async function withProfileDisplayName(userProfile, users, identityRawId) {
  try {
    const identity = typeof identityRawId === 'object' ? identityRawId : resolveIdentityFrom(users, identityRawId);
    if (!identity.found) return userProfile;
    const prefs = await getUserPreferences(identity);
    userProfile = { ...userProfile, setupComplete: isProfileSetupComplete(prefs) };
    // `getUserPreferences()` 在 `User_Profiles.name` 還沒有值時，會退回
    // `User ${user_id}` 這種合成佔位字串（給排課引擎內部用，不是拿來顯示的）。
    // 這裡要嚴格排除合成值——顯示出「User 1」比什麼都不顯示、讓前端退回
    // 「同學」更奇怪。只有真的存了 name 才覆蓋。
    const isSynthesizedPlaceholder = prefs?.displayName === `User ${prefs?.mysqlUserId}`;
    return prefs?.displayName && !isSynthesizedPlaceholder
      ? { ...userProfile, name: prefs.displayName }
      : userProfile;
  } catch (err) {
    logger.warn(`無法從 Profile 取得顯示名稱，回應將不含 name：${err.message}`, { label: 'Auth' });
    return userProfile;
  }
}

const attempts = new Map();
function registrationLimit(req, res, next) {
  const now = Date.now();
  for (const [key, entry] of attempts) if (now >= entry.reset) attempts.delete(key);
  const key = req.ip;
  if (!attempts.has(key) && attempts.size >= 10000) return res.status(503).json({ error: '服務繁忙，請稍後再試' });
  const entry = attempts.get(key) ?? { count: 0, reset: now + 15 * 60 * 1000 };
  entry.count += 1; attempts.set(key, entry);
  if (entry.count > 10) return res.status(429).json({ error: '註冊嘗試次數過多，請稍後再試' });
  next();
}
router.post('/register', registrationLimit, async (req, res) => {
  try { const result = await registerStudent(req.body); if (result.error) return res.status(result.status).json({ error: result.error }); return res.status(201).json({ success: true }); }
  catch { return res.status(503).json({ error: '目前無法完成註冊，請稍後再試' }); }
});
router.get('/register-options', async (req, res) => {
  try {
    const departments = [...DEPARTMENT_TO_ABBREVIATIONS.keys()].sort();
    const abbreviations = Object.fromEntries(DEPARTMENT_TO_ABBREVIATIONS);
    return res.json({ departments, abbreviations });
  } catch { return res.status(503).json({ error: '無法載入選項，請稍後再試' }); }
});
router.post('/login', async (req, res) => {
  try {
    const { studentId, password } = req.body ?? {};
    if (typeof studentId !== 'string' || typeof password !== 'string' || !studentId || !password || password.length > 1024) return res.status(400).json({ error: '請輸入學號與密碼' });
    const account = isMysqlConfigured() ? await findMysqlAccount(studentId) : null;
    // MySQL 帳號沒有密碼雜湊（demo、Persona）時，非 production 退回 users.json 核對；
    // 有雜湊的帳號（註冊流程建立）只驗雜湊，不退回。
    const legacyFallback = account && !account.password_hash && legacyAuthEnabled();
    if (account && !legacyFallback) {
      if (!await verifyPassword(account.password_hash, password)) return res.status(401).json({ error: '學號或密碼錯誤' });
      const identity = { found: true, canonicalId: account.student_id, studentId: account.student_id, numericId: String(account.user_id), canWriteMysqlProfile: true, source: 'mysql' };
      const profile = await withProfileDisplayName({ id: account.user_id, studentId: account.student_id, name: account.name, watchlist: account.watchlist ?? [] }, [], identity);
      res.setHeader('Set-Cookie', buildSessionCookie(account.student_id));
      return res.json({ success: true, user: withMockSetupFlag(profile, {id:account.user_id,studentId:account.student_id}, req) });
    }
    if (!legacyAuthEnabled()) return res.status(401).json({ error: '學號或密碼錯誤' });
    const users = await getAll('users'); const user = users.find(item => String(item.studentId) === studentId);
    if (!user || user.password !== password) return res.status(401).json({ error: '學號或密碼錯誤' });
    const { password: _, ...userProfile } = user;
    res.setHeader('Set-Cookie', buildSessionCookie(user.studentId));
    return res.json({ success: true, user: withMockSetupFlag(await withProfileDisplayName(userProfile, users, user.studentId), user, req) });
  } catch { return res.status(503).json({ error: '目前無法登入，請稍後再試' }); }
});

router.post('/logout', async (req, res) => {
  try {
    const session = readSession(req.headers.cookie);
    if (session) { await closeOwned({ canonicalId: session.studentId }, req.headers.cookie); closeLocalMyFcuOwned({ canonicalId: session.studentId }, req.headers.cookie); }
  } catch { /* Clear a malformed cookie without exposing its contents. */ }
  res.setHeader('Set-Cookie', buildClearSessionCookie());
  res.json({ success: true });
});

router.get('/me', requireIdentity, async (req, res) => {
  try {
    if (req.identity.source === 'mysql') {
      const account = await findMysqlAccount(req.identity.studentId);
      if (!account) return res.status(404).json({ error: '找不到使用者' });
      return res.json(withMockSetupFlag(await withProfileDisplayName({ id: account.user_id, studentId: account.student_id, name: account.name, watchlist: account.watchlist ?? [] }, [], req.identity), {id:account.user_id,studentId:account.student_id}, req));
    }
    const users = await getAll('users');
    const user = users.find(item => identityMatchesUser(item, req.identity));

    if (!user) {
      return res.status(404).json({ error: '找不到使用者' });
    }

    const { password: _, ...userProfile } = user;
    res.json(withMockSetupFlag(await withProfileDisplayName(userProfile, users, req.identity.canonicalId), user, req));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/update-watchlist', requireIdentity, requireServiceConsent, async (req, res) => {
  try {
    const { watchlist } = req.body;
    if (req.identity.source === 'mysql') {
      if (!Array.isArray(req.body.watchlist) || req.body.watchlist.length > 1000) return res.status(400).json({ error: '關注清單格式錯誤' });
      await queryRows('UPDATE User_Profiles SET watchlist = ? WHERE user_id = ? AND student_id = ?', [JSON.stringify(req.body.watchlist), req.identity.numericId, req.identity.studentId]);
      return res.json({ success: true, watchlist: req.body.watchlist });
    }
    const users = await getAll('users');
    const userIndex = users.findIndex(item => identityMatchesUser(item, req.identity));

    if (userIndex === -1) {
      return res.status(404).json({ error: '找不到使用者' });
    }

    users[userIndex].watchlist = watchlist;

    await clearCollection('users');
    for (const user of users) {
      await insert('users', user);
    }

    res.json({ success: true, watchlist: users[userIndex].watchlist });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
