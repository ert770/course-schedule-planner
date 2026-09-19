import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  collectCompetitiveCourseCodes,
  evaluatePlanDiversityAcceptance,
  jaccardSimilarity,
  median,
} from '../src/skills/planDiversityAcceptance.js';

function course(code, {
  sectionId = code,
  selectedBecause = 'PREFERENCE_MATCH',
  formallyRequired = false,
} = {}) {
  return {
    id: sectionId,
    sectionId,
    catalogCourseCode: code,
    formallyRequired,
    recommendationReason: {
      selectedBecause,
      requiredRules: { formallyRequired },
    },
  };
}

function plan(id, codes) {
  return { id, schedule: codes.map(code => course(code)), unscheduledCourses: [] };
}

function result(plans, { requestedVariants = plans.length, hasPreference = true } = {}) {
  return {
    plans,
    hasExpressedPreference: hasPreference,
    planDiversity: { requestedVariants, distinctPlans: plans.length },
  };
}

describe('Roadmap #10 方案多樣性驗收', () => {
  test('4 個策略保留 3 個實際不同方案時達到 75% 門檻', () => {
    const evaluated = evaluatePlanDiversityAcceptance(result([
      plan('a', ['A', 'B']),
      plan('b', ['A', 'C']),
      plan('c', ['B', 'C']),
    ], { requestedVariants: 4 }));

    assert.equal(evaluated.retentionRate, 0.75);
    assert.equal(evaluated.requiredByRetention, 3);
    assert.equal(evaluated.pass, true);
  });

  test('4 個策略只剩 2 個方案時保留率不通過', () => {
    const evaluated = evaluatePlanDiversityAcceptance(result([
      plan('a', ['A']),
      plan('b', ['B']),
    ], { requestedVariants: 4 }));

    assert.equal(evaluated.retentionRate, 0.5);
    assert.equal(evaluated.criteria.retentionRate, false);
    assert.equal(evaluated.pass, false);
  });

  test('無偏好 persona 只要求綜合與較多學分兩個方案', () => {
    const evaluated = evaluatePlanDiversityAcceptance(result([
      plan('general', ['A']),
      plan('credits', ['B']),
    ], { requestedVariants: 2, hasPreference: false }));

    assert.equal(evaluated.requiredDistinctPlans, 2);
    assert.equal(evaluated.criteria.enoughDistinctPlans, true);
    assert.equal(evaluated.pass, true);
  });

  test('必修、重補修與指定課程不列入競爭課程', () => {
    const competitive = collectCompetitiveCourseCodes({
      schedule: [
        course('REQ', { selectedBecause: 'REQUIRED_COURSE', formallyRequired: true }),
        course('RETAKE', { selectedBecause: 'RETAKE_REQUIRED' }),
        course('PINNED', { selectedBecause: 'USER_SPECIFIED' }),
        course('OPTIONAL'),
      ],
    });

    assert.deepEqual([...competitive], ['OPTIONAL']);
  });

  test('Jaccard similarity 使用交集除以聯集', () => {
    assert.equal(jaccardSimilarity(['資安', '人工智慧', '雲端'], [
      '資安', '人工智慧', '資料庫',
    ]), 0.5);
    assert.equal(jaccardSimilarity([], []), 1);
  });

  test('偶數筆相似度取中間兩筆平均作為中位數', () => {
    assert.equal(median([0.9, 0.5, 0.8, 0.6]), 0.7);
    assert.equal(median([]), null);
  });

  test('中位相似度超過 0.75 時不通過', () => {
    const evaluated = evaluatePlanDiversityAcceptance(result([
      plan('a', ['A', 'B', 'C', 'D', 'E']),
      plan('b', ['A', 'B', 'C', 'D', 'F']),
      plan('c', ['A', 'B', 'C', 'D', 'G']),
    ]));

    assert.equal(evaluated.medianJaccardSimilarity, 0.6667);
    assert.equal(evaluated.criteria.medianSimilarity, true);

    const tooSimilar = evaluatePlanDiversityAcceptance(result([
      plan('a', ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I']),
      plan('b', ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J']),
      plan('c', ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'K']),
    ]));
    assert.equal(tooSimilar.medianJaccardSimilarity, 0.8);
    assert.equal(tooSimilar.criteria.medianSimilarity, false);
    assert.equal(tooSimilar.pass, false);
  });

  test('同課號只換 section 不算真正不同的競爭課程', () => {
    const evaluated = evaluatePlanDiversityAcceptance(result([
      { id: 'a', schedule: [course('IECS1001', { sectionId: 1 })] },
      { id: 'b', schedule: [course('IECS1001', { sectionId: 2 })] },
    ], { requestedVariants: 2, hasPreference: false }));

    assert.equal(evaluated.reportedDistinctPlans, 2);
    assert.equal(evaluated.meaningfulDistinctPlans, 1);
    assert.equal(evaluated.criteria.actualCourseDifference, false);
    assert.equal(evaluated.pass, false);
  });
});
