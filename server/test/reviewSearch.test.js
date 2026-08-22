// `rankEasyCourses()` 是本次要修的「涼課排行不一致」的直接迴歸測試：
// 舊版用未收縮的原始加權平均排序，小樣本極端值會穩定壓過樣本數更多、
// 更可信的課程；新版改用 m-estimate 收縮後的分數排序，且與排課引擎
// （`courseReviewStats.js`）共用同一份索引與母體先驗。
//
// `reviewSearch.js` 之前完全沒有測試檔案，藉由抽出純函式順便補上。

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { rankEasyCourses } from '../src/skills/reviewSearch.js';
import { buildReviewIndex, buildReviewPrior } from '../src/skills/courseReviewStats.js';
import { shrinkEasiness } from '../src/skills/reviewStats.js';
import { makeCourse, makeReview } from './fixtures.js';

// 課 A：4 則評論，raw easiness = mean([5,5, 6-1=5, 5]) = 5。
// 課 B：8 則評論，raw easiness = mean([4,5, 6-2=4, 5]) = 4.5。
// 三門背景課（不進入排行候選，只用來把母體先驗拉低）：raw easiness = 2 各一則。
function buildFixture() {
  const courseA = makeCourse(1, { name: '課A' });
  const courseB = makeCourse(2, { name: '課B' });

  const reviews = [
    makeReview({
      id: 1, courseId: 1, reviewCount: 4, sweetness: 5, coolness: 5, workload: 1, overall: 5,
    }),
    makeReview({
      id: 2, courseId: 2, reviewCount: 8, sweetness: 4, coolness: 5, workload: 2, overall: 5,
    }),
    makeReview({
      id: 3, courseId: 90, reviewCount: 5, sweetness: 2, coolness: 2, workload: 4, overall: 2,
    }),
    makeReview({
      id: 4, courseId: 91, reviewCount: 5, sweetness: 2, coolness: 2, workload: 4, overall: 2,
    }),
    makeReview({
      id: 5, courseId: 92, reviewCount: 5, sweetness: 2, coolness: 2, workload: 4, overall: 2,
    }),
  ];

  return { courseA, courseB, reviews };
}

describe('V16-V19 rankEasyCourses：涼課排行與排課引擎一致', () => {
  test('V16 小樣本高原始分的課，收縮後排序不再機械地排第一', () => {
    const { courseA, courseB, reviews } = buildFixture();

    const ranked = rankEasyCourses([courseA, courseB], reviews, 10);

    // 未收縮：A(5) > B(4.5)。母體先驗被三門背景硬課拉低到 3.1 後，
    // 樣本數少的 A 被收縮得更多，B（樣本數是 A 的兩倍）反而反超。
    const a = ranked.find(course => course.id === 1);
    const b = ranked.find(course => course.id === 2);
    assert.ok(a.easiness > b.easiness, '未收縮分數應維持 A > B，否則測試案例沒有代表性');
    assert.ok(b.adjustedEasiness > a.adjustedEasiness, '收縮後應反轉為 B > A');
    assert.equal(ranked[0].id, 2, '排行第一名應改為 B，不再是未收縮分數較高的 A');
  });

  test('V17 排行結果同時帶未收縮與收縮後分數，對低樣本課程兩者不相等', () => {
    const { courseA, courseB, reviews } = buildFixture();
    const ranked = rankEasyCourses([courseA, courseB], reviews, 10);

    for (const course of ranked) {
      assert.ok('easiness' in course);
      assert.ok('adjustedEasiness' in course);
    }
    const a = ranked.find(course => course.id === 1);
    assert.notEqual(a.easiness, a.adjustedEasiness);
  });

  test('V18 reviewCount 為 0 的課程被排除，不出現在結果中', () => {
    const { courseA, courseB, reviews } = buildFixture();
    const courseC = makeCourse(3, { name: '沒有評價的課' });

    const ranked = rankEasyCourses([courseA, courseB, courseC], reviews, 10);

    assert.equal(ranked.some(course => course.id === 3), false);
    assert.equal(ranked.length, 2);
  });

  test('V19 母體先驗與 courseReviewStats.buildReviewPrior 算出的一致，證明不一致已解除', () => {
    const { courseA, reviews } = buildFixture();

    const expectedIndex = buildReviewIndex(reviews);
    const expectedPrior = buildReviewPrior(expectedIndex);
    const expectedAdjustedA = shrinkEasiness(5, 4, expectedPrior.easiness);

    const ranked = rankEasyCourses([courseA], reviews, 10);
    const a = ranked.find(course => course.id === 1);

    assert.equal(a.adjustedEasiness, Math.round(expectedAdjustedA * 100) / 100);
  });
});
