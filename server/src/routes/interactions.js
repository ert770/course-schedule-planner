import { Router } from 'express';
import { requireIdentity } from '../middleware/requireIdentity.js';
import { deriveSubjectId, PrivacyError } from '../services/privacyService.js';
import { recordInteractionEvents, wouldExceedDailyQuota } from '../services/interactionEventService.js';
import { checkRateLimit } from '../utils/rateLimiter.js';

const router = Router();

const MAX_EVENTS_PER_REQUEST = 50;
// 對抗式審查發現：50 筆／請求只是批次上限，不是節流——同一個帳號可以無限次
// 呼叫。這兩個數字都刻意寬鬆（正常使用一個 session 頂多幾十筆），目的是擋掉
// 「無限灌」而不是妨礙真實操作。
const REQUESTS_PER_MINUTE = 20;
const EVENTS_PER_DAY = 2000;

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
//
// **推薦來源的信任邊界不在這裡。** `recommendation_exposed` 只能由伺服器在
// 產生推薦時自己寫入，`recommendation_accepted`／來源為 `system_recommendation`
// 的 `course_withdrawn` 必須對得上真的寫過的曝光紀錄——這些驗證固定在
// `interactionEventService.recordInteractionEvents()` 裡，這支路由不重複做，
// 也不需要知道細節，任何呼叫端（含這支路由本身）都繞不過去。
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

    const subjectId = deriveSubjectId(req.identity.canonicalId);
    if (!checkRateLimit(subjectId, REQUESTS_PER_MINUTE)) {
      return res.status(429).json({
        error: `請求過於頻繁，每分鐘最多 ${REQUESTS_PER_MINUTE} 次`,
        code: 'RATE_LIMITED',
      });
    }

    if (await wouldExceedDailyQuota(req.identity, events.length, EVENTS_PER_DAY)) {
      return res.status(429).json({
        error: `已達每日互動事件上限（${EVENTS_PER_DAY} 筆），請稍後再試`,
        code: 'DAILY_QUOTA_EXCEEDED',
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
