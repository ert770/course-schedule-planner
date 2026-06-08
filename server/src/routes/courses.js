import { Router } from 'express';
import { searchCourses, getCourseDetail, getDepartments, getInstructors } from '../skills/courseQuery.js';

const router = Router();

// GET /api/courses — 搜尋課程
router.get('/', (req, res) => {
  try {
    const filters = {};
    if (req.query.keyword) filters.keyword = req.query.keyword;
    if (req.query.department) filters.department = req.query.department;
    if (req.query.category) filters.category = req.query.category;
    if (req.query.dayOfWeek) filters.dayOfWeek = parseInt(req.query.dayOfWeek);
    if (req.query.credits) filters.credits = parseInt(req.query.credits);
    if (req.query.instructor) filters.instructor = req.query.instructor;
    if (req.query.code) filters.code = req.query.code;
    if (req.query.period) filters.period = parseInt(req.query.period);
    if (req.query.language) filters.language = req.query.language;

    const courses = searchCourses(filters);
    res.json({ courses, total: courses.length });
  } catch (err) {
    console.error('Courses error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/courses/departments — 取得所有系所
router.get('/departments', (req, res) => {
  res.json({ departments: getDepartments() });
});

// GET /api/courses/instructors — 取得所有教師
router.get('/instructors', (req, res) => {
  res.json({ instructors: getInstructors() });
});

// GET /api/courses/:id — 課程詳情
router.get('/:id', (req, res) => {
  const detail = getCourseDetail(parseInt(req.params.id));
  if (!detail) return res.status(404).json({ error: '課程不存在' });
  res.json(detail);
});

export default router;
