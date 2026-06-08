import { Router } from 'express';
import { handleChat } from '../services/agentService.js';

const router = Router();

// POST /api/chat — 處理對話
router.post('/', async (req, res) => {
  try {
    const { userId = 'default', message } = req.body;
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({ error: '請輸入訊息' });
    }

    const result = await handleChat(userId, message.trim());
    res.json(result);
  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({ error: '處理訊息時發生錯誤', details: err.message });
  }
});

export default router;
