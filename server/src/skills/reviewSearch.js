import { getAll } from '../db/database.js';
import {
  getReviewWeight,
  getTotalReviewCount,
  weightedAverageScore,
  roundScore,
  countBySentiment,
  calculateEasinessFromAverages,
} from './reviewStats.js';

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
    const reviewCount = getTotalReviewCount(courseReviews);
    if (reviewCount === 0) {
      return { ...course, easiness: 0, reviewCount: 0 };
    }

    const avgDifficulty = weightedAverageScore(courseReviews, 'difficultyRating');
    const avgRecommend = weightedAverageScore(courseReviews, 'recommendScore');
    const avgCoolness = weightedAverageScore(courseReviews, 'coolness');
    const avgSweetness = weightedAverageScore(courseReviews, 'sweetness');
    const avgWorkload = weightedAverageScore(courseReviews, 'workload');
    const avgOverall = weightedAverageScore(courseReviews, 'overall');
    const easiness = calculateEasinessFromAverages({
      avgCoolness,
      avgSweetness,
      avgWorkload,
      avgOverall,
    });
    const positive = countBySentiment(courseReviews, 'positive');

    return {
      ...course,
      easiness: roundScore(easiness, 2) || 0,
      avgDifficulty: roundScore(avgDifficulty),
      avgRecommend: roundScore(avgRecommend),
      avgCoolness: roundScore(avgCoolness),
      avgSweetness: roundScore(avgSweetness),
      avgWorkload: roundScore(avgWorkload),
      avgOverall: roundScore(avgOverall),
      reviewCount,
      positiveRatio: Math.round((positive / reviewCount) * 100),
    };
  });

  return courseStats
    .filter(course => course.reviewCount > 0)
    .sort((a, b) => b.easiness - a.easiness)
    .slice(0, Number(limit) || 10);
}

export async function getSentimentSummary(courseId) {
  const reviews = (await getAll('reviews')).filter(review => String(review.courseId) === String(courseId));
  const total = getTotalReviewCount(reviews);
  if (total === 0) {
    return { courseId, summary: '目前沒有課程評價', sentiment: 'neutral', count: 0 };
  }

  const positive = countBySentiment(reviews, 'positive');
  const negative = countBySentiment(reviews, 'negative');
  const keywordCounts = {};

  reviews.forEach(review => {
    const weight = getReviewWeight(review);
    (review.keywords || []).forEach(keyword => {
      keywordCounts[keyword] = (keywordCounts[keyword] || 0) + weight;
    });
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

  const avgDifficulty = weightedAverageScore(reviews, 'difficultyRating');
  const avgRecommend = weightedAverageScore(reviews, 'recommendScore');
  const avgCoolness = weightedAverageScore(reviews, 'coolness');
  const avgSweetness = weightedAverageScore(reviews, 'sweetness');
  const avgWorkload = weightedAverageScore(reviews, 'workload');
  const avgOverall = weightedAverageScore(reviews, 'overall');

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
