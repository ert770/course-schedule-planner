import { Router } from 'express';
import { generateSchedule, validateSchedule } from '../skills/scheduler.js';
import { searchCourses } from '../skills/courseQuery.js';
import { getUserPreferences } from '../services/memoryService.js';
import { saveSchedule, getSavedSchedules } from '../services/memoryService.js';
import { getAll } from '../db/database.js';

const router = Router();

// POST /api/schedule/generate — 自動產生課表
router.post('/generate', (req, res) => {
  try {
    const {
      userId = 'default',
      courseIds = [],
      filters = {},
      constraints = {}
    } = req.body;

    // Get user preferences
    const prefs = getUserPreferences(userId);

    // Get candidate courses
    let candidates;
    if (courseIds.length > 0) {
      const allCourses = getAll('courses');
      candidates = allCourses.filter(c => courseIds.includes(c.id));
    } else {
      candidates = searchCourses(filters);
    }

    if (candidates.length === 0) {
      return res.json({
        success: false,
        schedule: [],
        totalCredits: 0,
        message: '沒有找到候選課程，請調整搜尋條件。'
      });
    }

    // Merge constraints with user preferences
    const blockedPeriods = constraints.blockedPeriods || prefs.blockedPeriods || [];
    if (constraints.mondayFree || prefs.mondayFree) {
      for (let p = 1; p <= 14; p++) {
        if (!blockedPeriods.some(bp => bp.day === 1 && bp.period === p)) {
          blockedPeriods.push({ day: 1, period: p });
        }
      }
    }

    const mergedConstraints = {
      maxCredits: constraints.maxCredits || prefs.targetCreditsMax || 22,
      minCredits: constraints.minCredits || prefs.targetCreditsMin || 15,
      blockedPeriods: blockedPeriods,
      noMorningClasses: constraints.noMorningClasses ?? prefs.noMorningClasses ?? false,
      noEveningClasses: constraints.noEveningClasses ?? prefs.noEveningClasses ?? false,
      mustTakeCourseIds: constraints.mustTakeCourseIds || prefs.mustTakeCourses || [],
      preferCompact: constraints.preferCompact ?? prefs.preferCompact ?? false,
      maxCoursesPerDay: constraints.maxCoursesPerDay || 4,
      // New constraints
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

// POST /api/schedule/validate — 檢查課表衝突
router.post('/validate', (req, res) => {
  try {
    const { courses } = req.body;
    const result = validateSchedule(courses);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/schedule/save — 儲存課表
router.post('/save', (req, res) => {
  try {
    const { userId = 'default', name = '我的課表', schedule, totalCredits } = req.body;
    const saved = saveSchedule(userId, name, schedule, totalCredits);
    res.json({ success: true, schedule: saved });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/schedule/saved — 取得已儲存課表
router.get('/saved', (req, res) => {
  try {
    const userId = req.query.userId || 'default';
    const schedules = getSavedSchedules(userId);
    res.json({ schedules });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
