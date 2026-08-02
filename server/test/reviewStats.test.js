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
