import { Router } from 'express';
import { generateSchedule, validateSchedule } from '../skills/scheduler.js';
import { searchCourses } from '../skills/courseQuery.js';
import { getUserPreferences, saveSchedule, getSavedSchedules } from '../services/memoryService.js';
import { buildScheduleConstraints } from '../services/constraintService.js';
import { getAll } from '../db/database.js';

const router = Router();

router.post('/generate', async (req, res) => {
  try {
    const {
      userId = 'default',
      courseIds = [],
      filters = {},
      constraints = {},
    } = req.body;

    const prefs = await getUserPreferences(userId);

    let candidates;
    if (courseIds.length > 0) {
      const courseIdSet = new Set(courseIds.map(String));
      const allCourses = await getAll('courses');
      candidates = allCourses.filter(course => courseIdSet.has(String(course.id)));
    } else {
      candidates = await searchCourses(filters);
    }

    if (candidates.length === 0) {
      return res.json({
        success: false,
        schedule: [],
        totalCredits: 0,
        message: '找不到符合條件的課程，請調整篩選條件。',
      });
    }

    const mergedConstraints = buildScheduleConstraints(constraints, prefs);

    const result = generateSchedule(candidates, mergedConstraints);
    res.json(result);
  } catch (err) {
    console.error('Schedule error:', err);
    res.status(500).json({ error: err.message });
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
    const { userId = 'default', name = '我的課表', schedule, totalCredits } = req.body;
    const saved = await saveSchedule(userId, name, schedule, totalCredits);
    res.json({ success: true, schedule: saved });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/saved', async (req, res) => {
  try {
    const userId = req.query.userId || 'default';
    const schedules = await getSavedSchedules(userId);
    res.json({ schedules });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
