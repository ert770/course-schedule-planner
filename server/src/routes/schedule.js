import { Router } from 'express';
import { validateSchedule } from '../skills/scheduler.js';
import { validateScheduleAgainstConstraints } from '../skills/scheduleValidator.js';
import { saveSchedule, getSavedSchedules } from '../services/memoryService.js';
import { generateForUser } from '../services/scheduleService.js';
import { requireIdentity } from '../middleware/requireIdentity.js';

const router = Router();

router.post('/generate', requireIdentity, async (req, res) => {
  try {
    const { userId, courseIds = [], filters = {}, constraints = {} } = req.body;

    // 排課流程只有一份實作，與 AI Agent 的 `run_csp_scheduler` 共用
    // （見 `services/scheduleService.js`），避免兩條路徑各自漂移。
    const result = await generateForUser(req.identity, { courseIds, filters, constraints });
    res.json(result);
  } catch (err) {
    if (!err.status) console.error('Schedule error:', err);
    res.status(err.status || 500).json({ error: err.message, ...(err.code ? { code: err.code } : {}) });
  }
});

router.post('/validate', (req, res) => {
  try {
    const { courses, constraints = {} } = req.body;
    const result = validateSchedule(courses);

    // roadmap #21：只在請求帶有非空 constraints 時才額外檢查完整硬性限制
    // 範圍，附加於既有欄位之外，不取代它們。省略 constraints（現行唯一的
    // 實際呼叫模式——`client/src` 目前完全沒有呼叫這支端點）時回應與改動前
    // 逐欄位相同。
    if (constraints && Object.keys(constraints).length > 0) {
      const extended = validateScheduleAgainstConstraints(courses, constraints);
      result.violations = extended.violations;
      result.unchecked = extended.unchecked;
      result.hardConstraintsValid = extended.valid;
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/save', requireIdentity, async (req, res) => {
  try {
    const { userId, name = '我的課表', schedule, totalCredits } = req.body;
    const saved = await saveSchedule(req.identity.canonicalId, name, schedule, totalCredits);
    res.json({ success: true, schedule: saved });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/saved', requireIdentity, async (req, res) => {
  try {
    const schedules = await getSavedSchedules(req.identity.canonicalId);
    res.json({ schedules });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
