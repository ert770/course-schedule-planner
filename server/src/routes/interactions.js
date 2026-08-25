import { Router } from 'express';
import { requireIdentity } from '../middleware/requireIdentity.js';
import { PrivacyError } from '../services/privacyService.js';
import { recordInteractionEvents } from '../services/interactionEventService.js';

const router = Router();

const MAX_EVENTS_PER_REQUEST = 50;

// POST /api/interactions — 批次上報互動事件（roadmap #2）
//
// **刻意不掛 `requireConsent(PERSONALIZATION_LEARNING)`。** 那個中介層回
// `428 CONSENT_REQUIRED`，語意是「使用者必須先去處理才能繼續」——對必要的
// `service_processing` 正確，但 `personalization_learning` 是**可選**用途，
// 預設關閉是完全合法的狀態，不該把使用者推到同意牆前面。
//
// 因此未同意時回 `200 { recorded: false, reason: 'CONSENT_NOT_GRANTED' }`：
// 一列都沒有寫入（#33 驗收標準「使用者未 consent 時不產生可用於學習的
// interaction events」成立），同時前端不需要處理任何錯誤路徑。
router.post('/', requireIdentity, async (req, res) => {
  try {
    const events = req.body?.events;
    if (!Array.isArray(events)) {
      return res.status(400).json({ error: 'events 必須是陣列', code: 'INVALID_EVENTS' });
    }
    if (events.length > MAX_EVENTS_PER_REQUEST) {
      return res.status(400).json({
        error: `單次最多上報 ${MAX_EVENTS_PER_REQUEST} 筆事件`,
        code: 'TOO_MANY_EVENTS',
      });
    }

    res.json(await recordInteractionEvents(req.identity, events));
  } catch (err) {
    if (err instanceof PrivacyError) {
      return res.status(err.status).json({ error: err.message, code: err.code });
    }
    console.error('Interaction log error:', err.message);
    res.status(500).json({ error: '互動記錄暫時無法使用', code: 'INTERACTION_STORE_UNAVAILABLE' });
  }
});

export default router;
