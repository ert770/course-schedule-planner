import { Router } from 'express';
import { validateSchedule } from '../skills/scheduler.js';
import { saveSchedule, getSavedSchedules } from '../services/memoryService.js';
import { generateForUser } from '../services/scheduleService.js';
import { resolveIdentity, identityErrorResponse } from '../services/identityService.js';

const router = Router();

router.post('/generate', async (req, res) => {
  try {
    const { userId, courseIds = [], filters = {}, constraints = {} } = req.body;

    // 排課讀的是這位學生的偏好與修課歷史，身分錯了整份結果都不可信。
    const identity = await resolveIdentity(userId);
    if (!identity.found) {
      const { status, error } = identityErrorResponse(identity);
      return res.status(status).json({ error });
    }

    // 排課流程只有一份實作，與 AI Agent 的 `run_csp_scheduler` 共用
    // （見 `services/scheduleService.js`），避免兩條路徑各自漂移。
    const result = await generateForUser(identity, { courseIds, filters, constraints });
    res.json(result);
  } catch (err) {
    if (!err.status) console.error('Schedule error:', err);
    res.status(err.status || 500).json({ error: err.message, ...(err.code ? { code: err.code } : {}) });
  }
});

router.post('/validate', (req, res) => {
  try {
    const { courses } = req.body;
    const result = validateSchedule(courses);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/save', async (req, res) => {
  try {
    const { userId, name = '我的課表', schedule, totalCredits } = req.body;

    const identity = await resolveIdentity(userId);
    if (!identity.found) {
      const { status, error } = identityErrorResponse(identity);
      return res.status(status).json({ error });
    }

    const saved = await saveSchedule(identity.canonicalId, name, schedule, totalCredits);
    res.json({ success: true, schedule: saved });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/saved', async (req, res) => {
  try {
    const identity = await resolveIdentity(req.query.userId);
    if (!identity.found) {
      const { status, error } = identityErrorResponse(identity);
      return res.status(status).json({ error });
    }

    const schedules = await getSavedSchedules(identity.canonicalId);
    res.json({ schedules });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
