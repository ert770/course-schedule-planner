// 課程層的評價派生：把 `Course_Reviews` 的原始列對應到課程、算出可比較的涼度，
// 並且**把「沒有評價」與「評價顯示這門課很硬」分成兩件事**。
//
// 數學全部來自 `reviewStats.js`（加權平均、easiness 1-5 公式、m-estimate 收縮、
// rounding），本檔不重造；本檔只負責課程對應（index）、母體先驗、
// 1-5 → 0-100 的排課專屬尺度映射，以及「沒有證據」的表示法。
//
// 放在 `skills/` 而不是 `data/`：現行 `server/src/data/*.js` 只 import
// `utils/` 與 `data/`（單向 `skills → data`）。本檔要 import `skills/reviewStats.js`，
// 放進 `data/` 會開出一條 `data → skills` 的反向邊。`scheduler.js` 對 `skills/`
// 與 `data/` 皆可 import（`courseHistory.js` 只禁止 import `services/`），
// 放哪裡都不違反那條規則，決定因素是相依方向。

import {
  summarizeReviews,
  calculateEasinessFromAverages,
  roundScore,
  shrinkEasiness,
  SHRINKAGE_PRIOR_WEIGHT,
} from './reviewStats.js';

export const EASINESS_MIN = 1;
export const EASINESS_MAX = 5;
// 與 scheduler 的 MAX_EASY_COURSE_SCORE 同尺度，讓 `scoreCourse()` 不需要另外換算。
export const EASY_SCORE_MAX = 100;

// review.courseId 是 join 後的 `Course_Sections.section_id`，等同 `course.id`；
// 兩側型別不保證一致（DB 給 number、明確指定路徑可能給 string），因此統一用
// String 當鍵。courseId 為 null（LEFT JOIN 沒對到 section）的列直接丟棄——
// 那種列無法歸屬到任何課程，硬湊進某個鍵只會做出錯誤的對應。
export function buildReviewIndex(reviews = []) {
  const index = new Map();
  for (const review of reviews) {
    if (review?.courseId === null || review?.courseId === undefined) continue;
    const key = String(review.courseId);
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(review);
  }
  return index;
}

// 單一課程的統計摘要。沒有評價、或評價列存在但四個涼度維度全缺 →
// 回傳 null（不是 0、不是空物件），呼叫端自己決定要不要給中性值。
export function getCourseReviewStats(index, course) {
  const reviews = index.get(String(course?.id)) ?? [];
  if (reviews.length === 0) return null;

  const stats = summarizeReviews(reviews);
  if (stats.reviewCount === 0) return null;

  const rawEasiness = calculateEasinessFromAverages(stats);
  if (rawEasiness === null) return null;

  return { ...stats, rawEasiness };
}

// 母體先驗：只由**有評價的課**計算，每門課貢獻一次（不以評論數加權）——
// 「沒有評價的課」不參與，把它們當成 0 分正是本次改動要消滅的錯誤。
// 由呼叫端傳進來的**全部評價**算，不是候選池，否則同一門課在不同搜尋條件下
// 會得到不同的收縮後涼度，那就是漂移。
export function buildReviewPrior(index) {
  const easinessValues = [];
  let reviewCount = 0;

  for (const reviews of index.values()) {
    const stats = summarizeReviews(reviews);
    if (stats.reviewCount === 0) continue;
    const rawEasiness = calculateEasinessFromAverages(stats);
    if (rawEasiness === null) continue;
    easinessValues.push(rawEasiness);
    reviewCount += stats.reviewCount;
  }

  if (easinessValues.length === 0) {
    return { easiness: null, courseCount: 0, reviewCount: 0 };
  }

  const easiness = easinessValues.reduce((sum, value) => sum + value, 0) / easinessValues.length;
  return { easiness, courseCount: easinessValues.length, reviewCount };
}

// 1-5 → 0-100，超界 clamp。維持 0-100 是刻意的：`scoreCourse` 其他項是
// 「類別優先度 × 120」「學分 × 12」，換尺度會連帶改變 easy 相對於這些項目的權重，
// 那是另一個改動，不在本次範圍。
export function easinessToScore(easiness) {
  if (!Number.isFinite(easiness)) return null;
  const clamped = Math.min(EASINESS_MAX, Math.max(EASINESS_MIN, easiness));
  return ((clamped - EASINESS_MIN) / (EASINESS_MAX - EASINESS_MIN)) * EASY_SCORE_MAX;
}

// 無證據課程的中性分數 = m-estimate 在 n=0 的極限，也就是母體先驗本身。
// 沒有證據時，最誠實的猜法是「用母體平均」，不是「給 0 分」——給 0 分等於
// 斷言這門課是全校最硬的課之一。整批都沒有評價（prior 為 null）時退回尺度正中央。
export function getNeutralEasyScore(prior) {
  const neutral = easinessToScore(prior?.easiness);
  return neutral ?? EASY_SCORE_MAX / 2;
}

// 課程 → 回傳給排課引擎、前端與 Agent 的完整證據物件。無證據回 null。
//
// 同時保留未收縮的 `easiness` 與收縮後的 `adjustedEasiness`：前者與
// `/api/reviews/easy` 的定義一致，後者是排課引擎實際採用的分數，兩者並存
// 才能讓「涼課排行第一名沒被排進涼課方案」這種情況有跡可循。
export function deriveReviewEvidence(index, prior, course) {
  const stats = getCourseReviewStats(index, course);
  if (!stats) return null;

  const adjustedEasiness = shrinkEasiness(stats.rawEasiness, stats.reviewCount, prior?.easiness);

  return {
    reviewCount: stats.reviewCount,
    avgSweetness: stats.avgSweetness,
    avgCoolness: stats.avgCoolness,
    avgWorkload: stats.avgWorkload,
    avgOverall: stats.avgOverall,
    avgDifficulty: stats.avgDifficulty,
    avgRecommend: stats.avgRecommend,
    positiveCount: stats.positiveCount,
    negativeCount: stats.negativeCount,
    neutralCount: stats.neutralCount,
    easiness: roundScore(stats.rawEasiness, 2),
    adjustedEasiness: roundScore(adjustedEasiness, 2),
    easyScore: Math.round(easinessToScore(adjustedEasiness)),
    priorEasiness: roundScore(prior?.easiness, 2),
    shrinkagePriorWeight: Number.isFinite(prior?.easiness) ? SHRINKAGE_PRIOR_WEIGHT : null,
    source: 'Course_Reviews',
  };
}

export default {
  EASINESS_MIN,
  EASINESS_MAX,
  EASY_SCORE_MAX,
  buildReviewIndex,
  getCourseReviewStats,
  buildReviewPrior,
  easinessToScore,
  getNeutralEasyScore,
  deriveReviewEvidence,
};
