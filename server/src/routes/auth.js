import { Router } from 'express';
import { clearCollection, getAll, insert } from '../db/database.js';
import { requireIdentity } from '../middleware/requireIdentity.js';
import { requireServiceConsent } from '../middleware/requireConsent.js';
import { buildClearSessionCookie, buildSessionCookie } from '../services/sessionService.js';
import { identityMatchesUser, resolveIdentityFrom } from '../services/identityService.js';
import { getUserPreferences } from '../services/memoryService.js';
import { logger } from '../utils/logger.js';

const router = Router();

// 2026-09-10：顯示名稱的權威來源改成 `User_Profiles.name`，`users.json.name`
// 已刪除。login／me 過去直接回傳 `users.json` 那一列，name 因此原樣跟著消失；
// 這裡補接 Profile 的 displayName 進去，行為對使用者才不會變。
//
// **刻意 try/catch 吞掉失敗**：`user_preferences` 屬於 `MYSQL_ONLY_COLLECTIONS`，
// 本機沒設定 MySQL 時原本就能單靠 users.json 完成登入（見 AGENTS.md 的「沒有
// .env 時後端會自動退回 JSON 檔案」）。硬接這個查詢若不做防護，會讓「登入」
// 這個最基本的功能反過來變成需要資料庫才能用，屬於本末倒置。查不到就照舊用
// users.json 剩下的資料回應，只是沒有 name。
async function withProfileDisplayName(userProfile, users, identityRawId) {
  try {
    const identity = resolveIdentityFrom(users, identityRawId);
    if (!identity.found) return userProfile;
    const prefs = await getUserPreferences(identity);
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

router.post('/login', async (req, res) => {
  try {
    const { studentId, password } = req.body;

    if (!studentId || !password) {
      return res.status(400).json({ error: '請輸入學號與密碼' });
    }

    const users = await getAll('users');
    const user = users.find(item => String(item.studentId) === String(studentId));

    if (!user || user.password !== password) {
      return res.status(401).json({ error: '學號或密碼錯誤' });
    }

    const { password: _, ...userProfile } = user;
    res.setHeader('Set-Cookie', buildSessionCookie(user.studentId));
    res.json({ success: true, user: await withProfileDisplayName(userProfile, users, user.studentId) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/logout', (req, res) => {
  res.setHeader('Set-Cookie', buildClearSessionCookie());
  res.json({ success: true });
});

router.get('/me', requireIdentity, async (req, res) => {
  try {
    const users = await getAll('users');
    const user = users.find(item => identityMatchesUser(item, req.identity));

    if (!user) {
      return res.status(404).json({ error: '找不到使用者' });
    }

    const { password: _, ...userProfile } = user;
    res.json(await withProfileDisplayName(userProfile, users, req.identity.canonicalId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/update-watchlist', requireIdentity, requireServiceConsent, async (req, res) => {
  try {
    const { watchlist } = req.body;
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
