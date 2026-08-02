import { Router } from 'express';
import { searchCourses, getCourseDetail, getDepartments, getInstructors } from '../skills/courseQuery.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const filters = {};
    if (req.query.keyword) filters.keyword = req.query.keyword;
    if (req.query.department) filters.department = req.query.department;
    if (req.query.category) filters.category = req.query.category;
    if (req.query.credits) filters.credits = Number(req.query.credits);
    if (req.query.instructor) filters.instructor = req.query.instructor;
    if (req.query.code) filters.code = req.query.code;
    if (req.query.language) filters.language = req.query.language;

    // 💡 刻意把 dayOfWeek 和 period 從 filters 拿掉！
    // 讓底層先把符合其他條件的課全部找出來，我們再來手動精準過濾。
    let courses = await searchCourses(filters);

    // 🌟 手動過濾 1：星期 (確保型別一致)
    if (req.query.dayOfWeek) {
      const targetDay = Number(req.query.dayOfWeek);
      courses = courses.filter(c => Number(c.dayOfWeek) === targetDay);
    }

    // 🌟 手動過濾 2：節次區間 (確保字串不會干擾比對)
    if (req.query.period) {
      const targetPeriod = Number(req.query.period);
      courses = courses.filter(course => {
        const start = Number(course.startPeriod);
        const end = Number(course.endPeriod);
        // 判斷是否落在區間內
        return targetPeriod >= start && targetPeriod <= end;
      });
    }

    res.json({ courses, total: courses.length });
  } catch (err) {
    console.error('Courses error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/departments', async (req, res) => {
  try {
    res.json({ departments: await getDepartments() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/instructors', async (req, res) => {
  try {
    res.json({ instructors: await getInstructors() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const detail = await getCourseDetail(req.params.id);
    if (!detail) return res.status(404).json({ error: '課程不存在' });
    res.json(detail);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
