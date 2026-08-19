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

// m-estimate 收縮權重。實測 `Course_Reviews.review_count` 落在 4–8，取中位 5：
// 評論數等於典型值時，課程自己的資料與母體先驗各佔約一半。
export const SHRINKAGE_PRIOR_WEIGHT = 5;

// 把單一課程的原始 easiness（可能只有 4-8 則評論撐起來）往母體先驗收縮，
// 避免小樣本極端值（例如剛好 4 則全 5 分）壓過樣本數更多、更可信的課程。
//
// n=0（完全沒有評論）時代入公式就是 prior 本身，不需要另外處理「沒有證據」
// 的特例——這正是呼叫端拿它當「無證據課程的中性分數」的原因。
export function shrinkEasiness(rawEasiness, reviewCount, priorEasiness, m = SHRINKAGE_PRIOR_WEIGHT) {
  if (!Number.isFinite(rawEasiness)) {
    return null;
  }
  if (!Number.isFinite(priorEasiness) || m <= 0) {
    return rawEasiness;
  }
  const n = Number.isFinite(reviewCount) && reviewCount > 0 ? reviewCount : 0;
  return (n * rawEasiness + m * priorEasiness) / (n + m);
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
  SHRINKAGE_PRIOR_WEIGHT,
  shrinkEasiness,
};
