// Course_Reviews 的一列代表彙總後的多則評價，`review_count` 才是實際評論數。
// 曾發生 reviewSearch.js 已加權而 courseQuery.js 仍用資料列數，
// 導致同一門課在兩個 API 回報不同的評論數與平均分。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  getReviewWeight,
  getTotalReviewCount,
  weightedAverageScore,
  countBySentiment,
  summarizeReviews,
  calculateEasinessFromAverages,
  roundScore,
  shrinkEasiness,
} from '../src/skills/reviewStats.js';
import { makeReview } from './fixtures.js';

describe('評價加權', () => {
  test('評論數以 reviewCount 加總，而非資料列數', () => {
    const reviews = [
      makeReview({ id: 1, reviewCount: 6 }),
      makeReview({ id: 2, reviewCount: 5 }),
    ];

    assert.equal(getTotalReviewCount(reviews), 11);
    assert.notEqual(getTotalReviewCount(reviews), reviews.length);
  });

  test('缺少或無效的 reviewCount 視為 1', () => {
    assert.equal(getReviewWeight({ reviewCount: undefined }), 1);
    assert.equal(getReviewWeight({ reviewCount: 0 }), 1);
    assert.equal(getReviewWeight({ reviewCount: -3 }), 1);
    assert.equal(getReviewWeight({ reviewCount: 6 }), 6);
  });

  test('平均分以 reviewCount 加權', () => {
    const reviews = [
      makeReview({ id: 1, overall: 5, reviewCount: 9 }),
      makeReview({ id: 2, overall: 1, reviewCount: 1 }),
    ];

    // 未加權平均為 3，加權後為 (5*9 + 1*1) / 10 = 4.6
    assert.equal(weightedAverageScore(reviews, 'overall'), 4.6);
  });

  test('情緒統計以 reviewCount 加權', () => {
    const reviews = [
      makeReview({ id: 1, sentiment: 'positive', reviewCount: 8 }),
      makeReview({ id: 2, sentiment: 'negative', reviewCount: 2 }),
    ];

    assert.equal(countBySentiment(reviews, 'positive'), 8);
    assert.equal(countBySentiment(reviews, 'negative'), 2);
  });

  test('欄位缺值時回傳 null 而非 0，避免拉低平均', () => {
    const reviews = [makeReview({ coolness: null }), makeReview({ coolness: undefined })];

    assert.equal(weightedAverageScore(reviews, 'coolness'), null);
  });
});

describe('summarizeReviews 供兩個 API 共用', () => {
  test('回傳的評論數與情緒統計皆已加權', () => {
    const reviews = [
      makeReview({ id: 1, sentiment: 'positive', reviewCount: 6, overall: 5, workload: 2 }),
      makeReview({ id: 2, sentiment: 'neutral', reviewCount: 4, overall: 3, workload: 4 }),
    ];

    const stats = summarizeReviews(reviews);

    assert.equal(stats.reviewCount, 10);
    assert.equal(stats.positiveCount, 6);
    assert.equal(stats.neutralCount, 4);
    assert.equal(stats.negativeCount, 0);
    // (5*6 + 3*4) / 10 = 4.2
    assert.equal(stats.avgOverall, 4.2);
    // (2*6 + 4*4) / 10 = 2.8
    assert.equal(stats.avgWorkload, 2.8);
  });

  test('沒有評價時所有平均為 null、評論數為 0', () => {
    const stats = summarizeReviews([]);

    assert.equal(stats.reviewCount, 0);
    assert.equal(stats.avgOverall, null);
    assert.equal(stats.avgCoolness, null);
    assert.equal(stats.positiveCount, 0);
  });
});

describe('calculateEasinessFromAverages', () => {
  test('四個維度皆有值時取平均，workload 反轉（6 - x）', () => {
    // components = [4, 5, 6-2=4, 3]，平均 = 16/4 = 4
    const easiness = calculateEasinessFromAverages({
      avgCoolness: 4,
      avgSweetness: 5,
      avgWorkload: 2,
      avgOverall: 3,
    });

    assert.equal(easiness, 4);
  });

  test('workload 為 null 時不參與平均，而不是當成 0', () => {
    // components = [4, 5, 3]，平均 = 12/3 = 4
    const easiness = calculateEasinessFromAverages({
      avgCoolness: 4,
      avgSweetness: 5,
      avgWorkload: null,
      avgOverall: 3,
    });

    assert.equal(easiness, 4);
  });

  test('四個維度全缺時回傳 null', () => {
    const easiness = calculateEasinessFromAverages({
      avgCoolness: null,
      avgSweetness: null,
      avgWorkload: null,
      avgOverall: null,
    });

    assert.equal(easiness, null);
  });
});

describe('roundScore', () => {
  test('四捨五入到指定小數位', () => {
    assert.equal(roundScore(4.567, 2), 4.57);
    assert.equal(roundScore(4, 1), 4);
  });

  test('非有限數回傳 null', () => {
    assert.equal(roundScore(NaN), null);
    assert.equal(roundScore(undefined), null);
    assert.equal(roundScore(null), null);
  });
});

describe('V1-V5 shrinkEasiness：m-estimate 收縮', () => {
  test('V1 人工算好的 m-estimate 值', () => {
    // (4*5 + 5*3.5) / (4+5) = 37.5/9 = 4.1666...
    const result = shrinkEasiness(5, 4, 3.5, 5);
    assert.ok(Math.abs(result - 37.5 / 9) < 1e-9);
  });

  test('V2 n 增大時單調趨近 rawEasiness', () => {
    const small = shrinkEasiness(5, 4, 3.5, 5);
    const large = shrinkEasiness(5, 50, 3.5, 5);

    assert.ok(small < 5);
    assert.ok(large < 5);
    assert.ok(5 - large < 5 - small, '樣本數更多時應更接近原始分數');
  });

  test('V3 priorEasiness 為 null 或非有限數時原樣回傳 rawEasiness', () => {
    assert.equal(shrinkEasiness(5, 4, null, 5), 5);
    assert.equal(shrinkEasiness(5, 4, NaN, 5), 5);
    assert.equal(shrinkEasiness(5, 4, undefined, 5), 5);
  });

  test('V4 rawEasiness 為 null 時回傳 null，缺證據不可能收縮出分數', () => {
    assert.equal(shrinkEasiness(null, 4, 3.5, 5), null);
  });

  test('V5 m<=0 時原樣回傳 rawEasiness（收縮關閉）', () => {
    assert.equal(shrinkEasiness(5, 4, 3.5, 0), 5);
    assert.equal(shrinkEasiness(5, 4, 3.5, -1), 5);
  });

  test('n=0（無評論）時退化為 prior 本身，這是「無證據給中性分」機制的數學基礎', () => {
    assert.equal(shrinkEasiness(5, 0, 3.5, 5), 3.5);
  });
});
