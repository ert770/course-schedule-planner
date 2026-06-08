import { Router } from 'express';
import { getEasyCourses, getSentimentSummary, getReviewsByCourse } from '../skills/reviewSearch.js';

const router = Router();

// GET /api/reviews/easy — 涼課排名
router.get('/easy', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const courses = getEasyCourses(limit);
    res.json({ courses });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/reviews/:courseId — 取得某課程的評價
router.get('/:courseId', (req, res) => {
  try {
    const courseId = parseInt(req.params.courseId);
    const reviews = getReviewsByCourse(courseId);
    const sentiment = getSentimentSummary(courseId);
    res.json({ reviews, sentiment });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
