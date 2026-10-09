import { Router } from 'express';
import { requireIdentity } from '../middleware/requireIdentity.js';
import { requireServiceConsent } from '../middleware/requireConsent.js';
import { exploreForUser } from '../services/explorationService.js';

const router = Router();

// Roadmap #10 任務 4：系外與通識探索清單。唯讀——不寫互動事件，也不影響自動排課。
router.get('/', requireIdentity, requireServiceConsent, async (req, res) => {
  try {
    const favoriteCourseCode = typeof req.query.favoriteCourseCode === 'string'
      ? req.query.favoriteCourseCode
      : undefined;
    res.json(await exploreForUser(req.identity, { favoriteCourseCode }));
  } catch (err) {
    if (!err.status) console.error('Exploration error:', err);
    res.status(err.status || 500).json({ error: err.message, ...(err.code ? { code: err.code } : {}) });
  }
});

export default router;
