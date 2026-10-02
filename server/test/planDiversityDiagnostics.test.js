import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { generateSchedule } from '../src/skills/scheduler.js';
import { makeCourse } from './fixtures.js';

function diagnosticCandidates() {
  return [
    makeCourse(1, { catalogCourseCode: 'D1', dayOfWeek: 1 }),
    makeCourse(2, { catalogCourseCode: 'D2', dayOfWeek: 2 }),
    makeCourse(3, { catalogCourseCode: 'D3', dayOfWeek: 3 }),
    makeCourse(4, { catalogCourseCode: 'D4', dayOfWeek: 4 }),
  ];
}

describe('Roadmap #10 方案塌縮診斷', () => {
  test('保留去重前每個策略的完整課程集合與重複對象', () => {
    const result = generateSchedule(diagnosticCandidates(), {
      minCredits: 0,
      maxCredits: 6,
    }, { includePlanDiagnostics: true });

    assert.equal(result.plans.length, 1);
    assert.equal(result.generationDiagnostics.variants.length, 1);
    assert.deepEqual(
      result.generationDiagnostics.variants.map(item => item.variantId),
      ['personalized']
    );
    assert.equal(result.generationDiagnostics.variants[0].courseSet.all.length, 2);
  });

  test('每個決策點記錄前四名的總分與同一份分數組成', () => {
    const result = generateSchedule(diagnosticCandidates(), {
      minCredits: 0,
      maxCredits: 6,
    }, { includePlanDiagnostics: true });
    const [firstStep] = result.generationDiagnostics.variants[0].decisionSteps;

    assert.equal(firstStep.rankedCandidates.length, 4);
    for (const candidate of firstStep.rankedCandidates) {
      const componentTotal = Object.values(candidate.scoreComponents)
        .reduce((sum, value) => sum + value, 0);
      assert.equal(candidate.totalScore, componentTotal);
    }
    assert.equal(firstStep.outcome, 'selected');
  });

  test('每門未入選候選都有結構化原因', () => {
    const result = generateSchedule(diagnosticCandidates(), {
      minCredits: 0,
      maxCredits: 6,
    }, { includePlanDiagnostics: true });

    for (const variant of result.generationDiagnostics.variants) {
      assert.equal(variant.unselectedCourses.length, 2);
      assert.ok(variant.unselectedCourses.every(item => item.reasons.length > 0));
      assert.ok(variant.unselectedCourses.every(item => (
        item.reasons.every(reason => reason.constraintId === 'CREDIT_CEILING')
      )));
    }
  });

  test('衝堂候選保留 TIME_CONFLICT 與衝突課程', () => {
    const result = generateSchedule([
      makeCourse(1, { catalogCourseCode: 'C1', dayOfWeek: 1 }),
      makeCourse(2, { catalogCourseCode: 'C2', dayOfWeek: 1 }),
    ], {
      minCredits: 0,
      maxCredits: 6,
    }, { includePlanDiagnostics: true });
    const rejected = result.generationDiagnostics.variants[0].unselectedCourses
      .find(item => item.course.sectionId === 2);

    assert.equal(rejected.reasons[0].constraintId, 'TIME_CONFLICT');
    assert.equal(rejected.reasons[0].conflictingCourse.sectionId, 1);
  });

  test('未啟用診斷時不增加正式排課回應欄位', () => {
    const constraints = {
      minCredits: 0,
      maxCredits: 6,
    };
    const result = generateSchedule(diagnosticCandidates(), constraints);
    const diagnosticResult = generateSchedule(
      diagnosticCandidates(), constraints, { includePlanDiagnostics: true }
    );

    assert.equal(Object.hasOwn(result, 'generationDiagnostics'), false);
    assert.deepEqual(
      result.plans.map(plan => plan.schedule.map(course => course.id)),
      diagnosticResult.plans.map(plan => plan.schedule.map(course => course.id))
    );
  });
});
