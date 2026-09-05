// Codex adversarial review（2026-08-17）發現：評價資料查詢原本沒有獨立容錯，
// 一旦 `getAll('reviews')` reject（資料庫暫時性錯誤、schema 不同步、逾時），
// 整個排課請求會直接以 500 失敗——即使 scheduler.js 明確支援評價資料缺席
// （`reviewDataLoaded: false` + 中性分計分）。同時發現找不到候選課的早退路徑
// 遺漏了 `reviewDataLoaded` 欄位，違反「成功與失敗回應都帶這個欄位」的既有契約。
//
// `generateForUser()` 本身是重度 I/O 的整合函式（`getUserPreferences`、
// `getAll('courses')`、`searchCoursesForSchedule` 皆需要 DB 或完整 identity/prefs
// 情境），因此把「評價查詢失敗容錯」與「無候選回應形狀」各自抽成可獨立測試的
// 純函式／小函式，不必連真實資料庫或建置完整排課情境就能釘住這兩個修復。

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  loadCourseReviewsSafely, loadLearnedPreferenceSafely, buildNoCandidatesResult, buildExposureDraft,
} from '../src/services/scheduleService.js';

describe('loadCourseReviewsSafely：評價查詢失敗不得讓排課請求整體失敗', () => {
  test('loader 成功時回傳其解析結果', async () => {
    const reviews = [{ id: 1 }];
    const result = await loadCourseReviewsSafely(async () => reviews);

    assert.equal(result, reviews);
  });

  test('loader reject 時回傳空陣列，不向外拋出例外', async () => {
    const result = await loadCourseReviewsSafely(async () => {
      throw new Error('DB timeout');
    });

    assert.deepEqual(result, []);
  });

  test('loader 同步拋出例外時同樣回傳空陣列', async () => {
    const result = await loadCourseReviewsSafely(() => {
      throw new Error('schema mismatch');
    });

    assert.deepEqual(result, []);
  });
});

// roadmap #5B：學到的偏好權重跟評價資料同一個原則——它是加分項，讀取失敗
// 不得讓排課請求整體失敗，退回今天的顯式 0/1 行為即可。
describe('loadLearnedPreferenceSafely：學習權重讀取失敗不得讓排課請求整體失敗', () => {
  const ABSENT = {
    applied: false, reason: 'unavailable', boosts: null, modelVersion: null, computedAt: null, sufficiency: null,
  };

  test('loader 成功時回傳其解析結果', async () => {
    const applied = { applied: true, reason: 'applied', boosts: { interest: 0, compact: 0, easy: 0.5 } };
    const result = await loadLearnedPreferenceSafely(async () => applied);
    assert.equal(result, applied);
  });

  test('loader reject 時回傳 applied:false/unavailable，不向外拋出例外', async () => {
    const result = await loadLearnedPreferenceSafely(async () => {
      throw new Error('DB timeout');
    });
    assert.deepEqual(result, ABSENT);
  });

  test('loader 同步拋出例外時同樣回傳 applied:false/unavailable', async () => {
    const result = await loadLearnedPreferenceSafely(() => {
      throw new Error('subject id derivation failed');
    });
    assert.deepEqual(result, ABSENT);
  });
});

describe('buildNoCandidatesResult：無候選課的回應必須帶 reviewDataLoaded', () => {
  test('reviewDataLoaded 為 true 時如實回傳', () => {
    const result = buildNoCandidatesResult(true);

    assert.equal(result.reviewDataLoaded, true);
    assert.equal(result.success, false);
    assert.deepEqual(result.schedule, []);
  });

  test('reviewDataLoaded 為 false 時如實回傳，而不是缺少這個欄位', () => {
    const result = buildNoCandidatesResult(false);

    assert.equal(result.reviewDataLoaded, false);
    assert.ok('reviewDataLoaded' in result, '欄位必須存在，呼叫端才能分辨 false 與欄位不存在');
  });

  test('Roadmap #22：標記 data-insufficient 並提供可直接交給 Chat 的澄清問題', () => {
    const result = buildNoCandidatesResult(false);

    assert.equal(result.solver.status, 'data-insufficient');
    assert.equal(result.solver.repairAttempted, false);
    assert.deepEqual(result.draftSchedule, []);
    assert.equal(result.isDraft, false);
    assert.equal(result.clarification.required, true);
    assert.equal(result.clarification.reason, 'data-insufficient');
    assert.ok(result.clarification.questions.some(question => question.type === 'schedule-goal'));
  });
});

describe('buildExposureDraft：roadmap #27 之後 displayedSet／displayedPlanIds 要涵蓋全部方案', () => {
  // 實測瀏覽器時發現的真實 bug：切到方案切換列的第二個方案再按「符合」被
  // 拒絕，因為這裡原本只用 `result.schedule`（等於 plans[0] 的副本）組
  // `displayedSet`，且完全沒有記錄「這次曝光顯示過哪些方案」。使用者能
  // 切換到的每個方案都要算「顯示過」，不能只認主推那一個。
  const courseA = { id: 1, catalogCourseCode: 'IECS3002', sectionId: 1 };
  const courseB = { id: 2, catalogCourseCode: 'IECS3059', sectionId: 2 };
  const courseC = { id: 3, catalogCourseCode: 'IECS3099', sectionId: 3 };
  const policy = {
    version: 'personalized-scoring-v1',
    weights: { interest: 1, compact: 0, easy: -1.4 },
    categoryCoefficient: 0.35,
    creditCoefficient: 1,
    source: { learnedApplied: true, reason: 'applied', modelVersion: 'preference-learning-v2' },
  };

  function makeResult() {
    return {
      schedule: [courseA],
      excludedCourses: [],
      // 真實流程裡 `variantId` 由 `annotateScheduleIdentifiers()` 在
      // `buildExposureDraft()` 執行前就已經設好（`= plan.id`），這裡照樣附上。
      plans: [
        { id: 'personalized', variantId: 'personalized', planId: 'req-1:personalized',
          schedule: [courseA], generationPolicy: policy, stopWhen: 'no-credit-progress' },
        { id: 'personalized_interest', variantId: 'personalized_interest',
          planId: 'req-1:personalized_interest', schedule: [courseB],
          generationPolicy: { ...policy, weights: { ...policy.weights, interest: 1.5 } },
          stopWhen: 'no-credit-progress' },
        { id: 'personalized_credits', variantId: 'personalized_credits',
          planId: 'req-1:personalized_credits', schedule: [courseC],
          generationPolicy: { ...policy, creditCoefficient: 3 }, stopWhen: 'candidate-exhausted' },
      ],
    };
  }

  test('displayedSet 是全部方案課程的聯集，不是只有主推方案', () => {
    const draft = buildExposureDraft(makeResult(), 'req-1', { surface: 'dashboard', trigger: 'initial_load' });
    const sectionIds = draft.exposureContext.displayedSet.map(c => c.sectionId).sort();
    assert.deepEqual(sectionIds, [1, 2, 3]);
  });

  test('displayedPlanIds 列出這次曝光顯示過的每一個 planId', () => {
    const draft = buildExposureDraft(makeResult(), 'req-1', { surface: 'dashboard', trigger: 'initial_load' });
    assert.deepEqual(draft.exposureContext.displayedPlanIds, [
      'req-1:personalized', 'req-1:personalized_interest', 'req-1:personalized_credits',
    ]);
  });

  test('#7 曝光事件保存每個方案的權重、版本、來源與停止條件', () => {
    const draft = buildExposureDraft(makeResult(), 'req-1', {
      surface: 'dashboard', trigger: 'initial_load',
    });

    assert.equal(draft.exposureContext.planPolicies.length, 3);
    assert.deepEqual(draft.exposureContext.planPolicies[0], {
      planId: 'req-1:personalized', variantId: 'personalized',
      ...policy, stopWhen: 'no-credit-progress',
    });
    assert.equal(draft.exposureContext.planPolicies[2].creditCoefficient, 3);
  });

  test('plan／position 仍指向主推方案（plans[0]），不因為改記全部方案而跟著變', () => {
    const draft = buildExposureDraft(makeResult(), 'req-1', { surface: 'dashboard', trigger: 'initial_load' });
    assert.deepEqual(draft.plan, { planId: 'req-1:personalized', variantId: 'personalized' });
    assert.equal(draft.position.planRank, 1);
  });

  test('同一門課出現在多個方案裡只列一次，不重複', () => {
    const result = makeResult();
    result.plans[1].schedule = [courseA, courseB]; // courseA 同時在 required_first 與 easy_score
    const draft = buildExposureDraft(result, 'req-1', { surface: 'dashboard', trigger: 'initial_load' });
    const sectionIds = draft.exposureContext.displayedSet.map(c => c.sectionId).sort();
    assert.deepEqual(sectionIds, [1, 2, 3]);
  });
});
