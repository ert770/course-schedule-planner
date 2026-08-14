import { Router } from 'express';
import { handleChat } from '../services/agentService.js';
import { resolveIdentity, identityErrorResponse } from '../services/identityService.js';

const router = Router();

// POST /api/chat — 處理對話
router.post('/', async (req, res) => {
  try {
    const { userId, message } = req.body;
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({ error: '請輸入訊息' });
    }

    // 聊天記憶與偏好更新都會寫進這位使用者，身分不可 fallback。
    const identity = await resolveIdentity(userId);
    if (!identity.found) {
      const { status, error } = identityErrorResponse(identity);
      return res.status(status).json({ error });
    }

    const result = await handleChat(identity, message.trim());
    res.json(result);
  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({ error: '處理訊息時發生錯誤', details: err.message });
  }
});

export default router;
