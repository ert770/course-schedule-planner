import { Router } from 'express';
import { getUserPreferences, updateUserPreferences } from '../services/memoryService.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const userId = req.query.userId || 'default';
    const prefs = await getUserPreferences(userId);
    res.json(prefs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { userId = 'default', ...updates } = req.body;
    const updated = await updateUserPreferences(userId, updates);
    res.json({ success: true, preferences: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
