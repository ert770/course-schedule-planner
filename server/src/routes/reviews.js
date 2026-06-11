import { Router } from 'express';
import { getEasyCourses, getSentimentSummary, getReviewsByCourse } from '../skills/reviewSearch.js';

const router = Router();

router.get('/easy', async (req, res) => {
  try {
    const limit = Number(req.query.limit) || 10;
    const courses = await getEasyCourses(limit);
    res.json({ courses });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:courseId', async (req, res) => {
  try {
    const courseId = req.params.courseId;
    const reviews = await getReviewsByCourse(courseId);
    const sentiment = await getSentimentSummary(courseId);
    res.json({ reviews, sentiment });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
