import { Router } from 'express';
import { clearCollection, getAll, insert } from '../db/database.js';

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
    res.json({ success: true, user: userProfile });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/me', async (req, res) => {
  try {
    const studentId = req.query.studentId;
    if (!studentId) {
      return res.status(400).json({ error: '未提供學號' });
    }

    const users = await getAll('users');
    const user = users.find(item => String(item.studentId) === String(studentId));

    if (!user) {
      return res.status(404).json({ error: '找不到使用者' });
    }

    const { password: _, ...userProfile } = user;
    res.json(userProfile);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/update-watchlist', async (req, res) => {
  try {
    const { studentId, watchlist } = req.body;
    const users = await getAll('users');
    const userIndex = users.findIndex(item => String(item.studentId) === String(studentId));

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
