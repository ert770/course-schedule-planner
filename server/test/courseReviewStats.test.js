// 課程 ↔ 評價對應、母體先驗、m-estimate 收縮與尺度映射的純函式測試。
// 數學本身（加權平均、easiness 公式、shrinkEasiness）已由 reviewStats.test.js
// 釘住，這裡只測課程對應與排課專屬的派生邏輯。

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildReviewIndex,
  getCourseReviewStats,
  buildReviewPrior,
  easinessToScore,
  getNeutralEasyScore,
  deriveReviewEvidence,
} from '../src/skills/courseReviewStats.js';
import { makeReview } from './fixtures.js';

describe('V6-V15 課程評價派生', () => {
  test('V6 courseId 與 course.id 型別不一致時 index 仍對得上', () => {
    const indexNumeric = buildReviewIndex([makeReview({ courseId: 1 })]);
    assert.ok(getCourseReviewStats(indexNumeric, { id: '1' }));

    const indexString = buildReviewIndex([makeReview({ courseId: '2' })]);
    assert.ok(getCourseReviewStats(indexString, { id: 2 }));
  });

  test('V7 courseId 為 null 的評價列被丟棄，不會聚成同一鍵', () => {
    const reviews = [
      makeReview({ courseId: null }),
      makeReview({ courseId: undefined }),
      makeReview({ courseId: 1 }),
    ];
    const index = buildReviewIndex(reviews);

    assert.equal(index.has('null'), false);
    assert.equal(index.has('undefined'), false);
    let totalEntries = 0;
    for (const rows of index.values()) totalEntries += rows.length;
    assert.equal(totalEntries, 1);
  });

  test('V8 課程沒有任何評價時回傳 null，不是 0 也不是空物件', () => {
    const index = buildReviewIndex([makeReview({ courseId: 1 })]);
    assert.equal(getCourseReviewStats(index, { id: 999 }), null);
  });

  test('V9 評價列存在但四個涼度維度全缺時仍回傳 null', () => {
    const reviews = [makeReview({
      courseId: 1, coolness: null, sweetness: null, workload: null, overall: null,
    })];
    const index = buildReviewIndex(reviews);

    assert.equal(getCourseReviewStats(index, { id: 1 }), null);
  });

  test('V10 easinessToScore：1-5 映射到 0-100，超界 clamp', () => {
    assert.equal(easinessToScore(1), 0);
    assert.equal(easinessToScore(3), 50);
    assert.equal(easinessToScore(5), 100);
    assert.equal(easinessToScore(0.5), 0);
    assert.equal(easinessToScore(6), 100);
    assert.equal(easinessToScore(null), null);
  });

  test('V11 一列 reviewCount:8 與八列 reviewCount:1 得到相同統計，證明重用 weightedAverageScore', () => {
    const oneRow = [
      makeReview({
        courseId: 1, reviewCount: 8, overall: 4, coolness: 4, sweetness: 4, workload: 2,
      }),
    ];
    const eightRows = Array.from({ length: 8 }, (_, i) => makeReview({
      id: i + 1, courseId: 2, reviewCount: 1, overall: 4, coolness: 4, sweetness: 4, workload: 2,
    }));

    const index = buildReviewIndex([...oneRow, ...eightRows]);
    const statsOne = getCourseReviewStats(index, { id: 1 });
    const statsEight = getCourseReviewStats(index, { id: 2 });

    assert.equal(statsOne.reviewCount, statsEight.reviewCount);
    assert.equal(statsOne.rawEasiness, statsEight.rawEasiness);
  });

  test('V12 buildReviewPrior 只由有評價的課計算，與之後查詢哪門課無關', () => {
    const reviews = [
      makeReview({
        courseId: 1, overall: 5, coolness: 5, sweetness: 5, workload: 1,
      }),
      makeReview({
        courseId: 2, overall: 3, coolness: 3, sweetness: 3, workload: 3,
      }),
    ];
    const index = buildReviewIndex(reviews);
    const prior = buildReviewPrior(index);

    assert.equal(prior.courseCount, 2);
    // course1 easiness = mean([5,5,5,5]) = 5；course2 = mean([3,3,3,3]) = 3
    assert.equal(prior.easiness, 4);

    // 之後只查其中一門課的統計，不會改變已經算好的先驗。
    const statsForCourse1 = getCourseReviewStats(index, { id: 1 });
    assert.equal(statsForCourse1.rawEasiness, 5);
    assert.equal(prior.easiness, 4);
  });

  test('V12b 沒有任何課程有評價時 prior.easiness 為 null', () => {
    const prior = buildReviewPrior(new Map());
    assert.equal(prior.easiness, null);
    assert.equal(prior.courseCount, 0);
  });

  test('V13 getNeutralEasyScore 等於先驗換算後的分數，先驗缺失時退回 50', () => {
    assert.equal(getNeutralEasyScore({ easiness: 4 }), 75); // (4-1)/4*100
    assert.equal(getNeutralEasyScore({ easiness: null }), 50);
    assert.equal(getNeutralEasyScore(undefined), 50);
  });

  test('V14 deriveReviewEvidence 同時回傳未收縮與收縮後的分數', () => {
    const reviews = [makeReview({
      courseId: 1, overall: 5, coolness: 5, sweetness: 5, workload: 1, reviewCount: 4,
    })];
    const index = buildReviewIndex(reviews);
    const prior = { easiness: 3.5, courseCount: 10, reviewCount: 50 };

    const evidence = deriveReviewEvidence(index, prior, { id: 1 });

    assert.ok(evidence);
    assert.equal(evidence.reviewCount, 4);
    assert.equal(evidence.easiness, 5); // 未收縮：mean([5,5,5,5])
    assert.notEqual(evidence.adjustedEasiness, evidence.easiness); // 收縮後應往先驗靠攏
    assert.ok(evidence.easyScore >= 0 && evidence.easyScore <= 100);
    assert.equal(evidence.source, 'Course_Reviews');
  });

  test('V15 deriveReviewEvidence 對沒有評價的課回傳 null', () => {
    const index = buildReviewIndex([makeReview({ courseId: 1 })]);
    const evidence = deriveReviewEvidence(index, { easiness: 3.5 }, { id: 999 });

    assert.equal(evidence, null);
  });
});
