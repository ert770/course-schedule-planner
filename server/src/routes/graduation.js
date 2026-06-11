import { Router } from 'express';
import { getAll } from '../db/database.js';

const router = Router();

function getDefaultRequiredCredits() {
  return {
    required: 60,
    elective: 40,
    general: 20,
    external: 8,
  };
}

function getDefaultEarnedCredits(user) {
  return user.earnedCredits || {
    required: 0,
    elective: 0,
    general: 0,
    external: 0,
  };
}

router.get('/:studentId', async (req, res) => {
  try {
    const { studentId } = req.params;
    const users = await getAll('users');
    const userProfiles = await getAll('user_preferences');
    const user = users.find(item => String(item.studentId) === String(studentId))
      || userProfiles.find(item => String(item.userId) === String(studentId));

    if (!user) {
      return res.status(404).json({ error: '找不到使用者' });
    }

    const required = user.requiredCredits || getDefaultRequiredCredits();
    const earned = getDefaultEarnedCredits(user);
    const totalRequired = user.totalRequired || 128;
    const totalEarned = Number(user.completedCredits || 0);
    const gaps = Object.fromEntries(
      Object.entries(required).map(([key, value]) => [
        key,
        Math.max(0, Number(value || 0) - Number(earned[key] || 0)),
      ])
    );
    const courses = await getAll('courses');
    const completedCourseIds = new Set((user.completedCourseIds || []).map(String));
    const recommendations = [];

    const departmentCourses = courses.filter(course =>
      course.department === user.department && !completedCourseIds.has(String(course.id))
    );

    if (departmentCourses.length > 0) {
      recommendations.push({
        type: 'suggestion',
        title: '建議補足系上課程',
        message: `可優先查看 ${departmentCourses[0].name}。`,
        course: departmentCourses[0],
      });
    }

    res.json({
      totalRequired,
      totalEarned,
      required,
      earned,
      gaps,
      recommendations,
      watchlist: user.watchlist || [],
      skillTree: user.skillTree || [],
      overallScore: user.overallScore || 0,
      overallScoreMax: user.overallScoreMax || 100,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
