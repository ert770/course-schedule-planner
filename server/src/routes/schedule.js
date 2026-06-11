import { Router } from 'express';
import { generateSchedule, validateSchedule } from '../skills/scheduler.js';
import { searchCourses } from '../skills/courseQuery.js';
import { getUserPreferences, saveSchedule, getSavedSchedules } from '../services/memoryService.js';
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

    const blockedPeriods = [...(constraints.blockedPeriods || prefs.blockedPeriods || [])];
    if (constraints.mondayFree || prefs.mondayFree) {
      for (let period = 1; period <= 14; period++) {
        if (!blockedPeriods.some(item => item.day === 1 && item.period === period)) {
          blockedPeriods.push({ day: 1, period });
        }
      }
    }

    const mergedConstraints = {
      maxCredits: constraints.maxCredits || prefs.targetCreditsMax || 22,
      minCredits: constraints.minCredits || prefs.targetCreditsMin || 15,
      blockedPeriods,
      noMorningClasses: constraints.noMorningClasses ?? prefs.noMorningClasses ?? false,
      noEveningClasses: constraints.noEveningClasses ?? prefs.noEveningClasses ?? false,
      mustTakeCourseIds: constraints.mustTakeCourseIds || prefs.mustTakeCourses || [],
      preferCompact: constraints.preferCompact ?? prefs.preferCompact ?? false,
      maxCoursesPerDay: constraints.maxCoursesPerDay || 4,
      noMidterm: constraints.noMidterm ?? prefs.noMidterm ?? false,
      noGroupReport: constraints.noGroupReport ?? prefs.noGroupReport ?? false,
      discussion: constraints.discussion ?? prefs.preferDiscussion ?? false,
      learnMore: constraints.learnMore ?? prefs.learnMore ?? false,
      weightDaily: constraints.weightDaily ?? prefs.weightDaily ?? false,
      hideConflict: constraints.hideConflict ?? prefs.hideConflict ?? false,
      practicalExam: constraints.practicalExam ?? prefs.practicalExam ?? false,
      finalReport: constraints.finalReport ?? prefs.finalReport ?? false,
      englishTaught: constraints.englishTaught ?? prefs.englishTaught ?? false,
      lunchBreakFree: constraints.lunchBreakFree ?? prefs.lunchBreakFree ?? false,
      completedCourseIds: constraints.completedCourseIds || prefs.completedCourseIds || [],
      selectedCourseIds: constraints.selectedCourseIds || [],
      watchingCourseIds: constraints.watchingCourseIds || [],
      courseStates: constraints.courseStates || {},
      retakeCourseIds: constraints.retakeCourseIds
        || constraints.failedRequiredCourseIds
        || prefs.retakeCourseIds
        || prefs.failedRequiredCourseIds
        || [],
      preferredTrack: constraints.preferredTrack || prefs.preferredTrack || null,
      digitalCreditsNeeded: constraints.digitalCreditsNeeded ?? prefs.digitalCreditsNeeded ?? false,
    };

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
