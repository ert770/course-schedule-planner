import { getAll } from '../db/database.js';

export async function getReviewsByCourse(courseId) {
  const reviews = await getAll('reviews');
  return reviews.filter(review => String(review.courseId) === String(courseId));
}

export async function searchReviews(keyword) {
  const normalizedKeyword = String(keyword || '').toLowerCase();
  const reviews = await getAll('reviews');

  return reviews.filter(review =>
    String(review.summary || '').toLowerCase().includes(normalizedKeyword)
    || (review.keywords || []).some(item =>
      String(item || '').toLowerCase().includes(normalizedKeyword)
    )
  );
}

export async function getEasyCourses(limit = 10) {
  const courses = await getAll('courses');
  const reviews = await getAll('reviews');

  const courseStats = courses.map(course => {
    const courseReviews = reviews.filter(review => String(review.courseId) === String(course.id));
    if (courseReviews.length === 0) {
      return { ...course, easiness: 0, reviewCount: 0 };
    }

    const avgDifficulty = courseReviews.reduce(
      (sum, review) => sum + Number(review.difficultyRating || 0),
      0
    ) / courseReviews.length;
    const avgRecommend = courseReviews.reduce(
      (sum, review) => sum + Number(review.recommendScore || 0),
      0
    ) / courseReviews.length;
    const easiness = (5 - avgDifficulty) * 0.4 + avgRecommend * 0.6;

    return {
      ...course,
      easiness: Math.round(easiness * 100) / 100,
      avgDifficulty: Math.round(avgDifficulty * 10) / 10,
      avgRecommend: Math.round(avgRecommend * 10) / 10,
      reviewCount: courseReviews.length,
      positiveRatio: Math.round(
        courseReviews.filter(review => review.sentiment === 'positive').length
        / courseReviews.length
        * 100
      ),
    };
  });

  return courseStats
    .filter(course => course.reviewCount > 0)
    .sort((a, b) => b.easiness - a.easiness)
    .slice(0, Number(limit) || 10);
}

export async function getSentimentSummary(courseId) {
  const reviews = (await getAll('reviews')).filter(review => String(review.courseId) === String(courseId));
  if (reviews.length === 0) {
    return { courseId, summary: '目前沒有課程評價', sentiment: 'neutral', count: 0 };
  }

  const positive = reviews.filter(review => review.sentiment === 'positive').length;
  const negative = reviews.filter(review => review.sentiment === 'negative').length;
  const total = reviews.length;
  const allKeywords = reviews.flatMap(review => review.keywords || []);
  const keywordCounts = {};

  allKeywords.forEach(keyword => {
    keywordCounts[keyword] = (keywordCounts[keyword] || 0) + 1;
  });

  const topKeywords = Object.entries(keywordCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([keyword]) => keyword);

  const overallSentiment = positive > negative
    ? 'positive'
    : negative > positive ? 'negative' : 'neutral';
  const sentimentLabel = overallSentiment === 'positive'
    ? '正向'
    : overallSentiment === 'negative' ? '負向' : '中立';

  return {
    courseId,
    count: total,
    sentiment: overallSentiment,
    summary: `共 ${total} 則評價，整體偏 ${sentimentLabel}，正向 ${positive} 則，負向 ${negative} 則。`,
    positiveRatio: Math.round((positive / total) * 100),
    topKeywords,
    avgDifficulty: Math.round(
      reviews.reduce((sum, review) => sum + Number(review.difficultyRating || 0), 0)
      / total
      * 10
    ) / 10,
    avgRecommend: Math.round(
      reviews.reduce((sum, review) => sum + Number(review.recommendScore || 0), 0)
      / total
      * 10
    ) / 10,
  };
}

export default { getReviewsByCourse, searchReviews, getEasyCourses, getSentimentSummary };
