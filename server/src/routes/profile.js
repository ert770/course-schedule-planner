import { Router } from 'express';
import { getUserPreferences, updateUserPreferences } from '../services/memoryService.js';
import { isDepartmentInput } from '../utils/text.js';
import { buildCourseSearchScope } from '../skills/courseScope.js';
import { PREFERENCE_TAG_GROUPS } from '../data/preferenceTags.js';
import { requireIdentity } from '../middleware/requireIdentity.js';
import { requireServiceConsent } from '../middleware/requireConsent.js';

const router = Router();

// 偏好標籤的定義清單。
//
// **為什麼要開一支 API**：這份清單原本在前端寫死兩份（`SetupPage.jsx` 與
// `DashboardPage.jsx`），加上後端一份共三份各自維護。實測時 Dashboard 那份
// 已經漏掉 `#不點名`，而且用的是舊的布林 key 而非標籤——人工對照多份清單
// 必然漂移，只是遲早的問題。
//
// 這裡不需要身分驗證：回傳的是標籤目錄本身，不是任何使用者的資料。
router.get('/preference-tags', (req, res) => {
  res.json({ groups: PREFERENCE_TAG_GROUPS });
});

router.get('/', requireIdentity, requireServiceConsent, async (req, res) => {
  try {
    const prefs = await getUserPreferences(req.identity);
    res.json({
      ...prefs,
      courseSearchScope: buildCourseSearchScope(prefs),
    });
  } catch (err) {
    res.status(err.status || 500).json({
      error: err.message,
      ...(err.code ? { code: err.code } : {}),
    });
  }
});

router.post('/', requireIdentity, requireServiceConsent, async (req, res) => {
  try {
    const { userId, ...updates } = req.body;

    // 型別錯誤的 department 必須在邊界擋下，不能靠正規化「救回來」。
    // 物件、陣列、數字經字串轉換後會變成看起來正常的值寫進資料庫，
    // 之後所有系所比對都會失敗且無從察覺。
    if (updates.department !== undefined && !isDepartmentInput(updates.department)) {
      return res.status(400).json({ error: 'department 必須是非空字串' });
    }

    // 避開時段接受第 1～14 節。先前這裡會在含第 1 節時回 400，要求改用
    // 「#不排早八」標籤（舊決策 C）——但那兩者不是同一件事：標籤是「每天的
    // 第一節都不要」，避開時段是「這個星期幾的這一節不要」。擋掉第 1 節等於
    // 讓使用者無法只避開某一天的早八。兩者可重疊，排課時取聯集。
    const updated = await updateUserPreferences(req.identity, updates);
    res.json({ success: true, preferences: updated });
  } catch (err) {
    res.status(err.status || 500).json({
      error: err.message,
      ...(err.code ? { code: err.code } : {}),
    });
  }
});

export default router;
