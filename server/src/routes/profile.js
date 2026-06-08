import { Router } from 'express';
import { getUserPreferences, updateUserPreferences } from '../services/memoryService.js';

const router = Router();

// GET /api/profile — 取得使用者偏好
router.get('/', (req, res) => {
  try {
    const userId = req.query.userId || 'default';
    const prefs = getUserPreferences(userId);
    res.json(prefs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/profile — 更新使用者偏好
router.post('/', (req, res) => {
  try {
    const { userId = 'default', ...updates } = req.body;
    const updated = updateUserPreferences(userId, updates);
    res.json({ success: true, preferences: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
