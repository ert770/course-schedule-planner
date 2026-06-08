// Skill 2: 評價與涼度檢索
import { getAll } from '../db/database.js';

/**
 * 取得某門課的所有評價
 */
export function getReviewsByCourse(courseId) {
  return getAll('reviews').filter(r => r.courseId === courseId);
}

/**
 * 搜尋包含關鍵字的評價
 */
export function searchReviews(keyword) {
  const kw = keyword.toLowerCase();
  return getAll('reviews').filter(r =>
    r.summary.toLowerCase().includes(kw) ||
    (r.keywords && r.keywords.some(k => k.toLowerCase().includes(kw)))
  );
}

/**
 * 取得「涼度排名」— 推薦分數最高 & 難度最低
 */
export function getEasyCourses(limit = 10) {
  const courses = getAll('courses');
  const reviews = getAll('reviews');

  const courseStats = courses.map(course => {
    const courseReviews = reviews.filter(r => r.courseId === course.id);
    if (courseReviews.length === 0) return { ...course, easiness: 0, reviewCount: 0 };

    const avgDifficulty = courseReviews.reduce((s, r) => s + r.difficultyRating, 0) / courseReviews.length;
    const avgRecommend = courseReviews.reduce((s, r) => s + r.recommendScore, 0) / courseReviews.length;
    // 涼度公式: (5 - difficulty) * 0.4 + recommend * 0.6
    const easiness = (5 - avgDifficulty) * 0.4 + avgRecommend * 0.6;

    return {
      ...course,
      easiness: Math.round(easiness * 100) / 100,
      avgDifficulty: Math.round(avgDifficulty * 10) / 10,
      avgRecommend: Math.round(avgRecommend * 10) / 10,
      reviewCount: courseReviews.length,
      positiveRatio: Math.round(courseReviews.filter(r => r.sentiment === 'positive').length / courseReviews.length * 100),
    };
  });

  return courseStats
    .filter(c => c.reviewCount > 0)
    .sort((a, b) => b.easiness - a.easiness)
    .slice(0, limit);
}

/**
 * 計算某門課的情緒摘要
 */
export function getSentimentSummary(courseId) {
  const reviews = getAll('reviews').filter(r => r.courseId === courseId);
  if (reviews.length === 0) return { courseId, summary: '尚無評價', sentiment: 'neutral', count: 0 };

  const positive = reviews.filter(r => r.sentiment === 'positive').length;
  const negative = reviews.filter(r => r.sentiment === 'negative').length;
  const total = reviews.length;

  // Collect all keywords
  const allKeywords = reviews.flatMap(r => r.keywords || []);
  const keywordCounts = {};
  allKeywords.forEach(k => { keywordCounts[k] = (keywordCounts[k] || 0) + 1; });
  const topKeywords = Object.entries(keywordCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([kw]) => kw);

  const overallSentiment = positive > negative ? 'positive' : negative > positive ? 'negative' : 'neutral';
  const sentimentLabel = overallSentiment === 'positive' ? '正面' : overallSentiment === 'negative' ? '負面' : '中性';

  return {
    courseId,
    count: total,
    sentiment: overallSentiment,
    summary: `共 ${total} 則評價，整體${sentimentLabel}（${positive} 好評 / ${negative} 負評）。常見關鍵字：${topKeywords.join('、')}`,
    positiveRatio: Math.round(positive / total * 100),
    topKeywords,
    avgDifficulty: Math.round(reviews.reduce((s, r) => s + r.difficultyRating, 0) / total * 10) / 10,
    avgRecommend: Math.round(reviews.reduce((s, r) => s + r.recommendScore, 0) / total * 10) / 10,
  };
}

export default { getReviewsByCourse, searchReviews, getEasyCourses, getSentimentSummary };
