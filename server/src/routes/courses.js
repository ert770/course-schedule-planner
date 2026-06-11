import { Router } from 'express';
import { searchCourses, getCourseDetail, getDepartments, getInstructors } from '../skills/courseQuery.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const filters = {};
    if (req.query.keyword) filters.keyword = req.query.keyword;
    if (req.query.department) filters.department = req.query.department;
    if (req.query.category) filters.category = req.query.category;
    if (req.query.dayOfWeek) filters.dayOfWeek = Number(req.query.dayOfWeek);
    if (req.query.credits) filters.credits = Number(req.query.credits);
    if (req.query.instructor) filters.instructor = req.query.instructor;
    if (req.query.code) filters.code = req.query.code;
    if (req.query.period) filters.period = Number(req.query.period);
    if (req.query.language) filters.language = req.query.language;

    const courses = await searchCourses(filters);
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
