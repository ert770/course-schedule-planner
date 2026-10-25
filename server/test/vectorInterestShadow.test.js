// 協同過濾與 User Embedding 構想階段 6：s_vec shadow 與 α 總和檢查。
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  INTEREST_ALPHA_SUM_CAP,
  assertInterestConfig,
  resolveInterestAlphas,
  resolveVectorInterestMode,
} from '../src/skills/interestAlphas.js';
import {
  buildVectorInterestContext,
  createVectorInterestShadowStats,
  pearsonCorrelation,
  recordVectorShadowPoolRanking,
  scorePlanVectorInterest,
} from '../src/skills/vectorInterestShadow.js';
import { generateScheduleWithTagInterestContext, loadVectorInterestContext } from '../src/services/scheduleService.js';
import { loadExternalInterestReservation } from '../src/services/externalInterestReservationService.js';
import { generateSchedule } from '../src/skills/scheduler.js';
import { makeCourse } from './fixtures.js';

describe('VA：興趣模型 α 與 VECTOR_INTEREST_MODE', () => {
  test('VA-1 預設 α_tag 0.6、α_vec 0.2、α_cf 0.1，總和剛好等於上限 0.9', () => {
    const alphas = resolveInterestAlphas({});
    assert.deepEqual(alphas, { tag: 0.6, vec: 0.2, cf: 0.1 });
    assert.ok(Math.abs(alphas.tag + alphas.vec + alphas.cf - INTEREST_ALPHA_SUM_CAP) < 1e-9);
  });

  test('VA-2 總和超過 0.9 拒絕，不靜默截斷；調低其中一項可以', () => {
    assert.throws(() => resolveInterestAlphas({ VECTOR_INTEREST_ALPHA: '0.25' }), /超過上限 0.9/);
    assert.throws(() => assertInterestConfig({ CF_INTEREST_ALPHA: '0.2' }), /超過上限/);
    assert.deepEqual(resolveInterestAlphas({ VECTOR_INTEREST_ALPHA: '0.25', CF_INTEREST_ALPHA: '0.05' }),
      { tag: 0.6, vec: 0.25, cf: 0.05 });
  });

  test('VA-3 α 必須是 0～1 的數字', () => {
    for (const value of ['abc', '-0.1', '1.5']) {
      assert.throws(() => resolveInterestAlphas({ VECTOR_INTEREST_ALPHA: value }), /0～1/, value);
    }
  });

  test('VA-4 模式接受 off／shadow／active，預設 active（2026-10-14 使用者決定）；其他值拒絕啟動', () => {
    assert.equal(resolveVectorInterestMode(undefined), 'active');
    assert.equal(resolveVectorInterestMode(' OFF '), 'off');
    assert.equal(resolveVectorInterestMode('shadow'), 'shadow');
    assert.equal(resolveVectorInterestMode('active'), 'active');
    assert.throws(() => resolveVectorInterestMode('on'), /只接受 off、shadow 或 active/);
    assert.throws(() => assertInterestConfig({ VECTOR_INTEREST_MODE: 'on' }), /只接受/);
  });
});

describe('VS：s_vec shadow 統計', () => {
  const candidates = [
    { id: 1, catalogCourseCode: 'a1' },
    { id: 2, catalogCourseCode: 'A2' },
    { id: 3, catalogCourseCode: 'A3' },
  ];
  const scores = new Map([['A1', { score: 0.5 }], ['A2', { score: null }]]);

  test('VS-1 context 以班次為鍵；沒有相似度、未同意各有原因', () => {
    const context = buildVectorInterestContext({ mode: 'shadow', source: 's_vec', alpha: 0.2, candidates, scores });
    assert.deepEqual(context.coursesBySectionId, {
      1: { score: 0.5, reason: 'scored' },
      2: { score: null, reason: 'no_similarity' },
      3: { score: null, reason: 'no_similarity' },
    });
    const noConsent = buildVectorInterestContext({ mode: 'shadow', source: 'no-consent', candidates, scores });
    assert.deepEqual(noConsent.coursesBySectionId[1], { score: null, reason: 'no-consent' });
    assert.deepEqual(buildVectorInterestContext({ mode: 'off', source: 's_vec', candidates, scores }).coursesBySectionId, {});
  });

  test('VS-2 候選分布與 s_tag 相關係數只計入兩邊都有分數（s_tag 需有證據）的課', () => {
    const vector = {
      mode: 'shadow', source: 's_vec', alpha: 0.2,
      coursesBySectionId: {
        1: { score: 0.9 }, 2: { score: 0.5 }, 3: { score: -0.4 }, 4: { score: 0 }, 5: { score: null },
      },
    };
    const tag = {
      coursesBySectionId: {
        1: { score: 0.8, evidenceTagCount: 2 }, 2: { score: 0.3, evidenceTagCount: 1 },
        3: { score: -0.5, evidenceTagCount: 1 }, 4: { score: 0.2, evidenceTagCount: 0 },
      },
    };
    const stats = createVectorInterestShadowStats(vector, tag);
    assert.deepEqual(stats.candidates, { positive: 2, neutral: 1, negative: 1, noScore: 1 });
    assert.equal(stats.correlation.pairs, 3);
    assert.ok(stats.correlation.pearson > 0.95);
    assert.equal(createVectorInterestShadowStats({ ...vector, mode: 'off' }, tag), null);
  });

  test('VS-3 pearsonCorrelation：少於 3 對或沒有變異時無法計算', () => {
    assert.equal(pearsonCorrelation([1, 2], [1, 2]), null);
    assert.equal(pearsonCorrelation([1, 1, 1], [1, 2, 3]), null);
    assert.ok(Math.abs(pearsonCorrelation([1, 2, 3], [3, 2, 1]) + 1) < 1e-9);
  });

  test('VS-4 決策點比較：第一名改變與順序改變分開計數', () => {
    const stats = createVectorInterestShadowStats({ mode: 'shadow', coursesBySectionId: {} });
    const pool = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const actual = course => ({ 1: 300, 2: 200, 3: 100 })[course.id];
    recordVectorShadowPoolRanking(stats, pool, actual, course => (course.id === 3 ? 150 : 0));
    recordVectorShadowPoolRanking(stats, pool, actual, course => (course.id === 2 ? 150 : 0));
    recordVectorShadowPoolRanking(stats, [{ id: 1 }], actual, () => 999);
    assert.equal(stats.poolComparisons, 2);
    assert.equal(stats.changedPoolComparisons, 2);
    assert.equal(stats.changedTopChoices, 1);
    assert.equal(stats.comparedCandidates, 6);
  });

  test('VS-5 方案平均 s_vec 只計入有分數的課，涵蓋率分開', () => {
    const context = { coursesBySectionId: { 1: { score: 0.6 }, 2: { score: null }, 3: { score: -0.2 } } };
    const metrics = scorePlanVectorInterest([{ id: 1 }, { id: 2 }, { sectionId: 3 }, { id: 4 }], context);
    assert.ok(Math.abs(metrics.planVecScore - 0.2) < 1e-9);
    assert.equal(metrics.vectorInterestCoverage, 0.5);
    assert.deepEqual(scorePlanVectorInterest([], context), { planVecScore: null, vectorInterestCoverage: null });
  });
});

describe('VI：shadow 接進排課', () => {
  const candidates = [
    makeCourse(86101, { department: '資訊三合', category: '選修', dayOfWeek: 1 }),
    makeCourse(86102, { department: '資訊三合', category: '選修', dayOfWeek: 2 }),
  ];
  const constraints = {
    department: '資訊工程學系', gradeLevel: 3, className: '資訊三甲',
    minCredits: 0, maxCredits: 3, planSet: 'primary-only',
  };
  const vectorContext = {
    mode: 'shadow', source: 's_vec', alpha: 0.2,
    coursesBySectionId: { 86101: { score: -0.8, reason: 'scored' }, 86102: { score: 0.8, reason: 'scored' } },
  };

  test('VI-1 shadow 不改變課表，但記錄「啟用的話第一名會不同」', () => {
    const baseline = generateSchedule(candidates, constraints);
    const shadow = generateScheduleWithTagInterestContext(
      candidates, constraints, null, generateSchedule, null, vectorContext
    );
    assert.equal(baseline.schedule[0].id, 86101);
    assert.deepEqual(shadow.schedule.map(course => course.id), baseline.schedule.map(course => course.id));
    assert.deepEqual(shadow.plans.map(plan => plan.id), baseline.plans.map(plan => plan.id));
    const stats = shadow.vectorInterestShadowStats;
    assert.ok(stats.poolComparisons > 0);
    assert.ok(stats.changedTopChoices > 0);
    assert.equal(stats.plans.compared, shadow.plans.length);
    assert.equal(Object.keys(shadow).includes('vectorInterestShadowStats'), false);
    assert.equal(Object.hasOwn(shadow.plans[0], 'planVecScore'), false);
  });

  test('VI-2 必修課不套用 s_vec：分數再高也不列入比較差異', () => {
    const required = [
      makeCourse(86111, { department: '資訊三甲', category: '必修', dayOfWeek: 1 }),
      makeCourse(86112, { department: '資訊三甲', category: '必修', dayOfWeek: 2 }),
    ];
    const context = {
      ...vectorContext,
      coursesBySectionId: { 86111: { score: -1, reason: 'scored' }, 86112: { score: 1, reason: 'scored' } },
    };
    const shadow = generateScheduleWithTagInterestContext(
      required, { ...constraints, maxCredits: 25 }, null, generateSchedule, null, context
    );
    assert.equal(shadow.vectorInterestShadowStats.changedTopChoices, 0);
    assert.equal(shadow.vectorInterestShadowStats.changedPoolComparisons, 0);
  });

  test('VI-3 off 或沒有 context 時 scheduler 的呼叫方式不變', () => {
    let args = null;
    const capture = (...received) => { args = received; return null; };
    generateScheduleWithTagInterestContext(candidates, constraints, null, capture, null, { ...vectorContext, mode: 'off' });
    assert.deepEqual(args, [candidates, constraints]);
    generateScheduleWithTagInterestContext(candidates, constraints, null, capture, null, vectorContext);
    assert.deepEqual(args[2], { vectorInterestContext: vectorContext });
  });

  test('VI-4 系外保留名額沿用同一次算好的 s_vec，不再重算', async () => {
    const precomputed = { source: 's_vec', scores: new Map() };
    let loads = 0;
    const result = await loadExternalInterestReservation({}, {}, candidates, {
      mode: 'vector', precomputed, loadCourses: async () => { loads += 1; return []; },
    });
    assert.equal(result, precomputed);
    assert.equal(loads, 0);
    assert.equal(await loadExternalInterestReservation({}, {}, candidates, { mode: 'keyword', precomputed }), null);
  });

  test('VI-6 active：s_vec 依 α_vec × 基礎分 × s_vec 改變選課，分數明細列出 vectorInterest', () => {
    const active = { ...vectorContext, mode: 'active' };
    const baseline = generateSchedule(candidates, constraints);
    const result = generateScheduleWithTagInterestContext(candidates, constraints, null, generateSchedule, null, active);
    assert.equal(baseline.schedule[0].id, 86101);
    assert.equal(result.schedule[0].id, 86102);
    const breakdown = result.schedule[0].recommendationReason.scoreBreakdown;
    assert.deepEqual(breakdown.find(item => item.component === 'vectorInterest'), { component: 'vectorInterest', value: 0.2 * 1000 * 0.8 });
    assert.equal(result.vectorInterestShadowStats, undefined);
    const plan = result.plans[0];
    assert.equal(plan.vectorInterestPlanScore, 0.8);
    assert.ok(Math.abs(plan.combinedPlanScore - plan.preferenceScore * (1 + 0.2 * 0.8)) < 1e-9);
  });

  test('VI-7 active 不套用到必修', () => {
    const required = [
      makeCourse(86121, { department: '資訊三甲', category: '必修', dayOfWeek: 1 }),
      makeCourse(86122, { department: '資訊三甲', category: '必修', dayOfWeek: 2 }),
    ];
    const active = { ...vectorContext, mode: 'active', coursesBySectionId: { 86121: { score: -1 }, 86122: { score: 1 } } };
    const result = generateScheduleWithTagInterestContext(
      required, { ...constraints, maxCredits: 25 }, null, generateSchedule, null, active
    );
    for (const course of result.schedule) {
      assert.equal(course.recommendationReason.scoreBreakdown.some(item => item.component === 'vectorInterest'), false);
    }
  });

  test('VI-5 shadow context 沿用系外保留已算的 s_vec；沒有才自己算；off 不算', async () => {
    let loads = 0;
    const loadScores = async () => { loads += 1; return { source: 's_vec', scores: new Map([['X', { score: 0.4 }]]) }; };
    const reservation = { source: 's_vec', modelVersion: 'v', scores: new Map() };
    const reused = await loadVectorInterestContext({}, {}, candidates, { mode: 'shadow', externalInterestReservation: reservation, loadScores });
    assert.equal(loads, 0);
    assert.equal(reused.modelVersion, 'v');
    assert.equal(reused.alpha, 0.2);
    await loadVectorInterestContext({}, {}, candidates, { mode: 'shadow', externalInterestReservation: { source: 'unavailable' }, loadScores });
    assert.equal(loads, 1);
    assert.equal(await loadVectorInterestContext({}, {}, candidates, { mode: 'off', loadScores }), null);
    assert.equal(loads, 1);
  });
});
