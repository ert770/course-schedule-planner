import { Router } from 'express';
import { getUserPreferences, updateUserPreferences } from '../services/memoryService.js';
import { isDepartmentInput } from '../utils/text.js';

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

    // 型別錯誤的 department 必須在邊界擋下，不能靠正規化「救回來」。
    // 物件、陣列、數字經字串轉換後會變成看起來正常的值寫進資料庫，
    // 之後所有系所比對都會失敗且無從察覺。
    if (updates.department !== undefined && !isDepartmentInput(updates.department)) {
      return res.status(400).json({ error: 'department 必須是非空字串' });
    }

    const updated = await updateUserPreferences(userId, updates);
    res.json({ success: true, preferences: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
