import { Router } from 'express';
import {
  searchCourses,
  getCourseDetail,
  getDepartments,
  getInstructors,
  getClassNames,
} from '../skills/courseQuery.js';

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

// 某系所某年級的班別清單（必修不得換班，學生需指定自己的班別）。
// 必須放在 `/:id` 之前，否則會被當成課程 id。
router.get('/classes', async (req, res) => {
  try {
    const { department, grade } = req.query;
    if (!department) {
      return res.status(400).json({ error: 'department 為必填' });
    }
    res.json({ classes: await getClassNames(department, grade) });
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
