import { getAll } from '../db/database.js';
import {
  getReviewWeight,
  getTotalReviewCount,
  weightedAverageScore,
  roundScore,
  countBySentiment,
  calculateEasinessFromAverages,
  summarizeReviews,
  shrinkEasiness,
} from './reviewStats.js';
import { buildReviewIndex, buildReviewPrior } from './courseReviewStats.js';

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

// 抽成純函式，不做 I/O：讓排名邏輯可以用合成資料直接測試，也讓「涼課排行」
// 與排課引擎（`scheduler.js` 經 `courseReviewStats.js`）用同一份索引／母體
// 先驗／m-estimate 收縮邏輯，不會各自算出不同答案——這正是本次要修的問題：
// 未收縮排序下，一門「4 則評論、四維全 5 分」的課會排第一，即使排課引擎
// （收縮後）認為一門「8 則評論、平均 4.5 分」的課更可信。
//
// `easiness`（未收縮，向後相容既有欄位定義）與 `adjustedEasiness`（收縮後，
// 與排課引擎採用同一個數字）兩者並存，不是互相取代——排序改用後者。
export function rankEasyCourses(courses, reviews, limit = 10) {
  const index = buildReviewIndex(reviews);
  const prior = buildReviewPrior(index);

  const courseStats = courses.map(course => {
    const courseReviews = index.get(String(course.id)) ?? [];
    const stats = summarizeReviews(courseReviews);
    if (stats.reviewCount === 0) {
      return { ...course, easiness: null, adjustedEasiness: null, reviewCount: 0 };
    }

    const rawEasiness = calculateEasinessFromAverages(stats);
    const adjustedEasiness = shrinkEasiness(rawEasiness, stats.reviewCount, prior?.easiness);

    return {
      ...course,
      ...stats,
      easiness: roundScore(rawEasiness, 2),
      adjustedEasiness: roundScore(adjustedEasiness, 2),
      positiveRatio: Math.round((stats.positiveCount / stats.reviewCount) * 100),
    };
  });

  return courseStats
    .filter(course => course.reviewCount > 0)
    .sort((a, b) => b.adjustedEasiness - a.adjustedEasiness)
    .slice(0, Number(limit) || 10);
}

export async function getEasyCourses(limit = 10) {
  const [courses, reviews] = await Promise.all([getAll('courses'), getAll('reviews')]);
  return rankEasyCourses(courses, reviews, limit);
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

export default { getReviewsByCourse, searchReviews, rankEasyCourses, getEasyCourses, getSentimentSummary };
