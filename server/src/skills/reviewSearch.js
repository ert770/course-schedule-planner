import { getAll } from '../db/database.js';

function averageScore(reviews, field) {
  const values = reviews
    .map(review => Number(review[field]))
    .filter(value => Number.isFinite(value));

  if (values.length === 0) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function roundScore(value, digits = 1) {
  if (!Number.isFinite(value)) {
    return null;
  }
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function calculateEasiness(reviews) {
  const avgCoolness = averageScore(reviews, 'coolness');
  const avgSweetness = averageScore(reviews, 'sweetness');
  const avgWorkload = averageScore(reviews, 'workload');
  const avgOverall = averageScore(reviews, 'overall');

  const components = [
    avgCoolness,
    avgSweetness,
    avgWorkload === null ? null : 6 - avgWorkload,
    avgOverall,
  ].filter(value => Number.isFinite(value));

  if (components.length === 0) {
    return null;
  }

  return components.reduce((sum, value) => sum + value, 0) / components.length;
}

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

    const avgDifficulty = averageScore(courseReviews, 'difficultyRating');
    const avgRecommend = averageScore(courseReviews, 'recommendScore');
    const avgCoolness = averageScore(courseReviews, 'coolness');
    const avgSweetness = averageScore(courseReviews, 'sweetness');
    const avgWorkload = averageScore(courseReviews, 'workload');
    const avgOverall = averageScore(courseReviews, 'overall');
    const easiness = calculateEasiness(courseReviews);

    return {
      ...course,
      easiness: roundScore(easiness, 2) || 0,
      avgDifficulty: roundScore(avgDifficulty),
      avgRecommend: roundScore(avgRecommend),
      avgCoolness: roundScore(avgCoolness),
      avgSweetness: roundScore(avgSweetness),
      avgWorkload: roundScore(avgWorkload),
      avgOverall: roundScore(avgOverall),
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
    ? '正面'
    : overallSentiment === 'negative' ? '負面' : '中性';

  const avgDifficulty = averageScore(reviews, 'difficultyRating');
  const avgRecommend = averageScore(reviews, 'recommendScore');
  const avgCoolness = averageScore(reviews, 'coolness');
  const avgSweetness = averageScore(reviews, 'sweetness');
  const avgWorkload = averageScore(reviews, 'workload');
  const avgOverall = averageScore(reviews, 'overall');

  return {
    courseId,
    count: total,
    sentiment: overallSentiment,
    summary: `共 ${total} 則評價，整體偏 ${sentimentLabel}，正向 ${positive} 則，負向 ${negative} 則。`,
    positiveRatio: Math.round((positive / total) * 100),
    topKeywords,
    avgDifficulty: roundScore(avgDifficulty),
    avgRecommend: roundScore(avgRecommend),
    avgCoolness: roundScore(avgCoolness),
    avgSweetness: roundScore(avgSweetness),
    avgWorkload: roundScore(avgWorkload),
    avgOverall: roundScore(avgOverall),
  };
}

export default { getReviewsByCourse, searchReviews, getEasyCourses, getSentimentSummary };
