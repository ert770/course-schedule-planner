import { Router } from 'express';
import { requireIdentity } from '../middleware/requireIdentity.js';
import { requireServiceConsent } from '../middleware/requireConsent.js';
import { exploreByProfile, exploreForUser } from '../services/explorationService.js';

const router = Router();

// Roadmap #10 任務 4：系外與通識探索清單。唯讀——不寫互動事件，也不影響自動排課。
router.get('/', requireIdentity, requireServiceConsent, async (req, res) => {
  try {
    // mode=profile：依標籤空間使用者向量探索（需 personalization_learning 同意）；其餘值或省略為原本的「從一門課出發」。
    if (req.query.mode === 'profile') {
      res.json(await exploreByProfile(req.identity));
      return;
    }
    const favoriteCourseCode = typeof req.query.favoriteCourseCode === 'string'
      ? req.query.favoriteCourseCode
      : undefined;
    const representation = req.query.representation ?? 'tfidf';
    res.json(await exploreForUser(req.identity, { favoriteCourseCode, representation }));
  } catch (err) {
    if (!err.status) console.error('Exploration error:', err);
    res.status(err.status || 500).json({ error: err.message, ...(err.code ? { code: err.code } : {}) });
  }
});

export default router;
