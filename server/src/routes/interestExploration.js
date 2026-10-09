import { Router } from 'express';
import { requireIdentity } from '../middleware/requireIdentity.js';
import { requireServiceConsent } from '../middleware/requireConsent.js';
import { getInterestExplorationCards } from '../services/interestExplorationService.js';

const router = Router();

router.get('/cards', requireIdentity, requireServiceConsent, async (req, res) => {
  try {
    res.json(await getInterestExplorationCards(req.identity));
  } catch (err) {
    if (!err.status) console.error('Interest exploration error:', err);
    res.status(err.status || 500).json({
      error: err.message,
      ...(err.code ? { code: err.code } : {}),
    });
  }
});

export default router;
