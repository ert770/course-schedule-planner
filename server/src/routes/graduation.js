import { Router } from 'express';
import { getAll } from '../db/database.js';

const router = Router();

// GET /api/graduation/:studentId — 取得畢業學分總覽
router.get('/:studentId', (req, res) => {
  try {
    const { studentId } = req.params;
    const users = getAll('users');
    const user = users.find(u => u.studentId === studentId);

    if (!user) {
      return res.status(404).json({ error: '找不到使用者' });
    }

    const required = user.requiredCredits || { '必修': 60, '系內選修': 40, '通識': 20, '系外選修': 8 };
    const earned = user.earnedCredits || { '必修': 0, '系內選修': 0, '通識': 0, '系外選修': 0 };

    const totalRequired = user.totalRequired || 128;
    const totalEarned = user.completedCredits || 0;

    const gaps = {
      '必修': Math.max(0, required['必修'] - earned['必修']),
      '系內選修': Math.max(0, required['系內選修'] - earned['系內選修']),
      '通識': Math.max(0, required['通識'] - earned['通識']),
      '系外選修': Math.max(0, required['系外選修'] - earned['系外選修']),
    };

    // AI recommendations
    const courses = getAll('courses');
    const recommendations = [];

    // 必修警告
    if (gaps['必修'] > 0) {
      const unfinished = courses.filter(c =>
        c.category === '必修' &&
        c.department === user.department &&
        !user.completedCourseIds.includes(c.id)
      );
      if (unfinished.length > 0) {
        recommendations.push({
          type: 'warning',
          title: '必修警告',
          message: `偵測到您尚未修畢大三必修【${unfinished[0].name}】，建議本學期優先排入以防延畢。`,
          course: unfinished[0],
        });
      }
    }

    // 通識推薦
    if (gaps['通識'] > 0) {
      const generalCourses = courses.filter(c =>
        c.category === '通識' &&
        !user.completedCourseIds.includes(c.id)
      );
      if (generalCourses.length > 0) {
        const recommended = generalCourses[0];
        recommendations.push({
          type: 'suggestion',
          title: '通識推薦',
          message: `您的通識尚缺 ${gaps['通識']} 學分，AI 根據您先前勾選的涼課條件，為您推薦【${recommended.name}】。該課平常簡單自由簽到，老師確幸至10次，而且期末考不恐怖，若還有剩餘讀書時間可以拿到分數，達成您的篩選條件。`,
          course: recommended,
        });
      }
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
