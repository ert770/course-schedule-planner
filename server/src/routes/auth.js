import { Router } from 'express';
import { clearCollection, getAll, insert } from '../db/database.js';
import { requireIdentity } from '../middleware/requireIdentity.js';
import { requireServiceConsent } from '../middleware/requireConsent.js';
import { buildClearSessionCookie, buildSessionCookie } from '../services/sessionService.js';
import { identityMatchesUser } from '../services/identityService.js';

const router = Router();

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
    res.json({ success: true, user: userProfile });
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
    res.json(userProfile);
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
