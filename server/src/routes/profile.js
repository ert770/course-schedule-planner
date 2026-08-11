import { Router } from 'express';
import { getUserPreferences, updateUserPreferences } from '../services/memoryService.js';
import { isDepartmentInput } from '../utils/text.js';
import { buildCourseSearchScope } from '../skills/courseScope.js';
import { resolveIdentity, identityErrorResponse } from '../services/identityService.js';
import { findMorningPeriodEntries, MORNING_PERIOD } from '../utils/periods.js';
import { PREFERENCE_TAG_GROUPS } from '../data/preferenceTags.js';

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

router.get('/', async (req, res) => {
  try {
    // 不再有 `|| 'default'`。沒帶身分或查無此人一律拒絕，
    // 否則未登入的請求會落到一個共用假使用者身上並讀寫它的偏好。
    const identity = await resolveIdentity(req.query.userId);
    if (!identity.found) {
      const { status, error } = identityErrorResponse(identity);
      return res.status(status).json({ error });
    }

    const prefs = await getUserPreferences(identity);
    res.json({
      ...prefs,
      courseSearchScope: buildCourseSearchScope(prefs),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { userId, ...updates } = req.body;

    const identity = await resolveIdentity(userId);
    if (!identity.found) {
      const { status, error } = identityErrorResponse(identity);
      return res.status(status).json({ error });
    }

    // 型別錯誤的 department 必須在邊界擋下，不能靠正規化「救回來」。
    // 物件、陣列、數字經字串轉換後會變成看起來正常的值寫進資料庫，
    // 之後所有系所比對都會失敗且無從察覺。
    if (updates.department !== undefined && !isDepartmentInput(updates.department)) {
      return res.status(400).json({ error: 'department 必須是非空字串' });
    }

    // 決策 C：第 1 節（早八）由 `#不排早八` 標籤表達，`avoid_time` 只管第 2～14 節。
    // 同一個限制存在兩處必然漂移，因此在邊界明確拒絕而非靜默剝除——
    // 靜默剝除會讓使用者以為存好了，實際上設定沒有生效。
    const blocked = updates.blockedPeriods ?? updates.avoidTime;
    if (blocked !== undefined) {
      const morning = findMorningPeriodEntries(blocked);
      if (morning.length > 0) {
        return res.status(400).json({
          error: `避開時段不得包含第 ${MORNING_PERIOD} 節（早八）。`
            + '早八請改用「#不排早八」偏好標籤設定。',
        });
      }
    }

    const updated = await updateUserPreferences(identity, updates);
    res.json({ success: true, preferences: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
