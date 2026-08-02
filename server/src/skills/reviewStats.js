// 評價統計的共用邏輯。
//
// `Course_Reviews` 的一列代表「彙總後的多則評價」，其 `review_count` 才是實際評論數。
// 因此評論數必須加總 `reviewCount`，平均分必須以 `reviewCount` 加權，情緒統計也一樣。
// 這些函式原本是 reviewSearch.js 的私有實作，導致 courseQuery.js 沿用未加權的
// 資料列筆數，同一門課在不同 API 會回報不同的評論數與平均分。抽成共用模組以免再次漂移。

export function getReviewWeight(review) {
  const weight = Number(review?.reviewCount);
  return Number.isFinite(weight) && weight > 0 ? weight : 1;
}

export function getTotalReviewCount(reviews = []) {
  return reviews.reduce((sum, review) => sum + getReviewWeight(review), 0);
}

export function weightedAverageScore(reviews = [], field) {
  const weighted = reviews
    .map(review => {
      const raw = review[field];
      // Number(null) 是 0 且為有限數，若不先擋掉，缺值的評分會被當成「0 分」拉低平均。
      if (raw === null || raw === undefined || raw === '') {
        return null;
      }
      const value = Number(raw);
      if (!Number.isFinite(value)) {
        return null;
      }
      return { value, weight: getReviewWeight(review) };
    })
    .filter(Boolean);

  const totalWeight = weighted.reduce((sum, item) => sum + item.weight, 0);
  if (totalWeight === 0) {
    return null;
  }

  return weighted.reduce((sum, item) => sum + item.value * item.weight, 0) / totalWeight;
}

export function roundScore(value, digits = 1) {
  if (!Number.isFinite(value)) {
    return null;
  }
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

export function countBySentiment(reviews = [], sentiment) {
  return reviews
    .filter(review => review.sentiment === sentiment)
    .reduce((sum, review) => sum + getReviewWeight(review), 0);
}

export function calculateEasinessFromAverages({ avgCoolness, avgSweetness, avgWorkload, avgOverall }) {
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

// 供 /api/courses/:id 與 /api/reviews/:courseId 共用，確保兩者數字一致。
export function summarizeReviews(reviews = []) {
  const reviewCount = getTotalReviewCount(reviews);

  return {
    reviewCount,
    avgDifficulty: roundScore(weightedAverageScore(reviews, 'difficultyRating')),
    avgRecommend: roundScore(weightedAverageScore(reviews, 'recommendScore')),
    avgCoolness: roundScore(weightedAverageScore(reviews, 'coolness')),
    avgSweetness: roundScore(weightedAverageScore(reviews, 'sweetness')),
    avgWorkload: roundScore(weightedAverageScore(reviews, 'workload')),
    avgOverall: roundScore(weightedAverageScore(reviews, 'overall')),
    positiveCount: countBySentiment(reviews, 'positive'),
    negativeCount: countBySentiment(reviews, 'negative'),
    neutralCount: countBySentiment(reviews, 'neutral'),
  };
}

export default {
  getReviewWeight,
  getTotalReviewCount,
  weightedAverageScore,
  roundScore,
  countBySentiment,
  calculateEasinessFromAverages,
  summarizeReviews,
};
