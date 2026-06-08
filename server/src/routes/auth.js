import { Router } from 'express';
import { getAll } from '../db/database.js';

const router = Router();

// POST /api/auth/login — 登入驗證
router.post('/login', (req, res) => {
  try {
    const { studentId, password } = req.body;

    if (!studentId || !password) {
      return res.status(400).json({ error: '請輸入學號與密碼' });
    }

    const users = getAll('users');
    const user = users.find(u => u.studentId === studentId);

    if (!user || user.password !== password) {
      return res.status(401).json({ error: '學號或密碼錯誤' });
    }

    // Return user profile (excluding password)
    const { password: _, ...userProfile } = user;
    res.json({ success: true, user: userProfile });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/auth/me — 取得使用者資訊
router.get('/me', (req, res) => {
  try {
    const studentId = req.query.studentId;
    if (!studentId) {
      return res.status(400).json({ error: '未提供學號' });
    }

    const users = getAll('users');
    const user = users.find(u => u.studentId === studentId);

    if (!user) {
      return res.status(404).json({ error: '找不到使用者' });
    }

    const { password: _, ...userProfile } = user;
    res.json(userProfile);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/update-watchlist — 更新口袋名單
router.post('/update-watchlist', (req, res) => {
  try {
    const { studentId, watchlist } = req.body;
    const users = getAll('users');
    const userIndex = users.findIndex(u => u.studentId === studentId);

    if (userIndex === -1) {
      return res.status(404).json({ error: '找不到使用者' });
    }

    users[userIndex].watchlist = watchlist;

    // Write back
    import('../db/database.js').then(db => {
      db.clearCollection('users');
      users.forEach(u => db.insert('users', u));
      res.json({ success: true, watchlist: users[userIndex].watchlist });
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
