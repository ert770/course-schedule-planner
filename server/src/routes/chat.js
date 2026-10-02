import { Router } from 'express';
import { handleChat } from '../services/agentService.js';
import { requireIdentity } from '../middleware/requireIdentity.js';
import { requireServiceConsent } from '../middleware/requireConsent.js';
import { validatePlanningContext } from '../data/planningContextSchema.js';
import { PLANNING_CONTEXT_STATUS } from '../services/planningContextService.js';
import { logger } from '../utils/logger.js';

const router = Router();

// POST /api/chat — 處理對話
router.post('/', requireIdentity, requireServiceConsent, async (req, res) => {
  try {
    const { message, planningContext } = req.body;
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({ error: '請輸入訊息' });
    }

    // 規劃狀態不合法**不會**讓整次對話失敗。
    //
    // 它住在瀏覽器的 sessionStorage，會因為部署升版、開著沒關的舊分頁、瀏覽器
    // 資料損壞而變成舊格式。若回 400，使用者的**每一則訊息**都會失敗，直到他
    // 自己想到要去清 storage——為了一份附帶資料弄壞主要功能，不成比例。
    //
    // 丟棄就是整包丟棄：未通過驗證的內容一律不得用來組 prompt 或當成排課限制，
    // 不做「這幾筆看起來還行」的部分採用。
    const validation = validatePlanningContext(planningContext);
    if (validation.error) {
      // 只記原因，不記內容——`#33` 明訂 log 只留 metadata。
      logger.warn(`規劃狀態格式不合法，本回合忽略：${validation.error}`, { label: 'Chat' });
      const result = await handleChat(req.identity, message.trim(), null);
      return res.json({ ...result, planningContextStatus: PLANNING_CONTEXT_STATUS.REJECTED_INVALID });
    }

    const result = await handleChat(req.identity, message.trim(), validation.value);
    res.json(result);
  } catch (err) {
    console.error('Chat error:', err.message);
    res.status(err.status || 500).json({ error: err.status ? err.message : '處理訊息時發生錯誤', ...(err.code ? { code: err.code } : {}) });
  }
});

export default router;
