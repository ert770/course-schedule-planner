import { Router } from 'express';
import { requireIdentity } from '../middleware/requireIdentity.js';
import { requireServiceConsent } from '../middleware/requireConsent.js';
import { getHistoryFeedbackCourses } from '../services/historyFeedbackService.js';

const router = Router();

// 協同過濾與 User Embedding 構想階段 5：歷史修課回饋視窗的課程清單（唯讀）。
// 回答由 POST /api/interactions 以 history_course_feedback 事件寫入，伺服器另驗證課號。
router.get('/', requireIdentity, requireServiceConsent, async (req, res) => {
  try {
    res.json(await getHistoryFeedbackCourses(req.identity));
  } catch (err) {
    if (!err.status) console.error('History feedback error:', err);
    res.status(err.status || 500).json({ error: err.message || '暫時無法讀取修課紀錄' });
  }
});

export default router;
