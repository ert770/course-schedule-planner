import { Router } from 'express';
import { generateSchedule, validateSchedule } from '../skills/scheduler.js';
import { searchCoursesForSchedule } from '../skills/courseQuery.js';
import { getUserPreferences, saveSchedule, getSavedSchedules } from '../services/memoryService.js';
import { buildScheduleConstraints } from '../services/constraintService.js';
import { getAll } from '../db/database.js';
import { buildStudentScope } from '../skills/courseScope.js';

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

    const mergedConstraints = buildScheduleConstraints(
      {
        ...constraints,
        explicitCourseIds: [...(constraints.explicitCourseIds || []), ...courseIds],
      },
      prefs
    );

    let candidates;
    if (courseIds.length > 0) {
      const courseIdSet = new Set(courseIds.map(String));
      const allCourses = await getAll('courses');
      candidates = allCourses.filter(course => courseIdSet.has(String(course.id)));
    } else {
      candidates = await searchCoursesForSchedule(filters, buildStudentScope(mergedConstraints));
    }

    if (candidates.length === 0) {
      return res.json({
        success: false,
        schedule: [],
        totalCredits: 0,
        message: '找不到符合條件的課程，請調整篩選條件。',
      });
    }

    // `courseIds` 是使用者在課程瀏覽器手動勾選的課。它決定候選池，但不會進入
    // `selectedCourseIds`，因此必須另外告訴排課引擎「這些是使用者指定的」，
    // 否則不符合系外選修認列條件的課會被當成系統自撿的候選而靜默剔除。
    const result = generateSchedule(candidates, mergedConstraints);
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
