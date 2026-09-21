import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CHOICE_PERCEPTRON_VERSION,
  CHOICE_SKIP_REASONS,
  CHOICE_WEIGHT_LIMIT,
  EVIDENCE_TRAIL_LIMIT,
  learnChoicePerceptronWeights,
} from '../src/skills/preferenceLearning.js';

// Roadmap #10 任務 3A：Choice Perceptron（Dragone et al., AAAI 2018）的純函式引擎。
// 這裡釘住的是「公式對不對」與「缺值／舊資料怎麼處理」，不是排課行為——這個引擎
// 目前只跑 shadow，不影響任何推薦結果。

const FEATURE_VERSION = 'plan-feature-v1';

function feature(planId, { interest = 0, compact = 0, easy = 0 } = {}) {
  return { planId, variantId: `v-${planId}`, interest, compact, easy };
}

function exposure(requestId, features, { timestamp = '2026-09-01T00:00:00.000Z', version = FEATURE_VERSION, term } = {}) {
  return {
    eventType: 'recommendation_exposed',
    eventId: `exposure-${requestId}`,
    requestId,
    timestamp,
    term,
    exposureContext: {
      planFeatureVersion: version,
      displayedPlanIds: features.map(item => item.planId),
      planFeatures: features,
    },
  };
}

function chosen(requestId, planId, { timestamp = '2026-09-01T01:00:00.000Z', term } = {}) {
  return {
    eventType: 'plan_chosen',
    eventId: `chosen-${requestId}`,
    requestId,
    timestamp,
    term,
    plan: { planId, variantId: `v-${planId}` },
  };
}

// 一次 choice：選中 A（興趣高、不集中），未選 B、C。
function threeWayEvents() {
  const features = [
    feature('a', { interest: 1, compact: 0, easy: 0.6 }),
    feature('b', { interest: 0.4, compact: 1, easy: 0.4 }),
    feature('c', { interest: 0.1, compact: 0.5, easy: 0.2 }),
  ];
  return [exposure('r1', features), chosen('r1', 'a')];
}

describe('CP1-CP3 公式本身', () => {
  test('CP3 query size 2：Δ = φ(選中) − φ(未選)', () => {
    const features = [
      feature('a', { interest: 1, compact: 0, easy: 0.5 }),
      feature('b', { interest: 0, compact: 1, easy: 0.5 }),
    ];
    const result = learnChoicePerceptronWeights([exposure('r1', features), chosen('r1', 'a')]);
    assert.deepEqual(result.weights, { interest: 1, compact: -1, easy: 0 });
    assert.equal(result.modelVersion, CHOICE_PERCEPTRON_VERSION);
  });

  test('CP3 query size 3：分母是 k−1（未選方案數），不是 k', () => {
    const result = learnChoicePerceptronWeights(threeWayEvents());
    // interest：1 − (0.4 + 0.1)/2 = 0.75
    // compact ：0 − (1 + 0.5)/2   = −0.75
    // easy    ：0.6 − (0.4 + 0.2)/2 = 0.3
    assert.deepEqual(result.weights, { interest: 0.75, compact: -0.75, easy: 0.3 });
  });

  test('CP3 query size 4：手算對照', () => {
    const features = [
      feature('a', { interest: 0.8, compact: 0.2, easy: 0.4 }),
      feature('b', { interest: 0.2, compact: 0.4, easy: 0.4 }),
      feature('c', { interest: 0.2, compact: 0.6, easy: 0.4 }),
      feature('d', { interest: 0.2, compact: 0.8, easy: 0.4 }),
    ];
    const result = learnChoicePerceptronWeights([exposure('r1', features), chosen('r1', 'a')]);
    // interest：0.8 − 0.2 = 0.6；compact：0.2 − 0.6 = −0.4；easy：0.4 − 0.4 = 0
    assert.deepEqual(result.weights, { interest: 0.6, compact: -0.4, easy: 0 });
  });

  test('CP3 η 線性縮放更新量', () => {
    const base = learnChoicePerceptronWeights(threeWayEvents(), { learningRate: 1 });
    const scaled = learnChoicePerceptronWeights(threeWayEvents(), { learningRate: 0.2 });
    // 0.75 × 0.2 在浮點下是 0.15000000000000002，比較的是四捨五入到 3 位之後的值。
    assert.equal(scaled.weights.interest, 0.15);
    assert.ok(Math.abs(scaled.weights.compact) < Math.abs(base.weights.compact));
    assert.equal(scaled.learningRate, 0.2);
  });

  test('CP4 平移不變：所有方案的特徵同加一個常數，Δ 不變', () => {
    const base = [
      feature('a', { interest: 0.9, compact: 0, easy: 0.6 }),
      feature('b', { interest: 0.4, compact: 0.9, easy: 0.4 }),
      feature('c', { interest: 0.1, compact: 0.5, easy: 0.2 }),
    ];
    const shifted = base.map(item => ({
      ...item,
      interest: item.interest + 0.1, compact: item.compact + 0.1, easy: item.easy + 0.1,
    }));
    const before = learnChoicePerceptronWeights([exposure('r1', base), chosen('r1', 'a')]);
    const after = learnChoicePerceptronWeights([exposure('r1', shifted), chosen('r1', 'a')]);
    assert.deepEqual(after.weights, before.weights);
  });

  test('CP5 排列不變：planFeatures 的順序不影響結果', () => {
    const [exposureEvent, choiceEvent] = threeWayEvents();
    const reordered = {
      ...exposureEvent,
      exposureContext: {
        ...exposureEvent.exposureContext,
        planFeatures: [...exposureEvent.exposureContext.planFeatures].reverse(),
        displayedPlanIds: [...exposureEvent.exposureContext.displayedPlanIds].reverse(),
      },
    };
    assert.deepEqual(
      learnChoicePerceptronWeights([reordered, choiceEvent]).weights,
      learnChoicePerceptronWeights([exposureEvent, choiceEvent]).weights
    );
  });
});

describe('CP1-CP2 可重播與時鐘純度', () => {
  test('CP1 同一批事件跑兩次逐位元相同；打亂輸入順序也相同', () => {
    const events = threeWayEvents();
    const options = { now: Date.parse('2026-09-20T00:00:00.000Z'), activeTerm: { academicYear: 114, semester: '下學期' } };
    const first = learnChoicePerceptronWeights(events, options);
    const second = learnChoicePerceptronWeights([...events].reverse(), options);
    assert.equal(JSON.stringify(first), JSON.stringify(second));
  });

  test('CP2 省略 now 時不衰減，且 decay.appliedAt 為 null', () => {
    const events = threeWayEvents();
    const undecayed = learnChoicePerceptronWeights(events);
    assert.equal(undecayed.decay.appliedAt, null);

    const decayed = learnChoicePerceptronWeights(events, {
      now: Date.parse('2027-01-01T00:00:00.000Z'),
    });
    assert.ok(Math.abs(decayed.weights.interest) < Math.abs(undecayed.weights.interest));
  });

  test('CP2 未來時間戳不得讓衰減係數大於 1', () => {
    const events = threeWayEvents();
    const future = learnChoicePerceptronWeights(events, { now: Date.parse('2026-08-01T00:00:00.000Z') });
    assert.equal(future.weights.interest, learnChoicePerceptronWeights(events).weights.interest);
  });

  test('CP2 更新只依事件時間戳，與事件在陣列中的位置無關；但換掉時間戳會改變結果', () => {
    // 我方採「全部累加完才投影一次」，加法可交換，所以**同一組時間戳**下順序不影響
    // 結果——這與逐步投影的 perceptron 不同，是刻意的設計取捨，用測試記錄下來。
    const early = { timestamp: '2026-01-01T00:00:00.000Z' };
    const late = { timestamp: '2026-09-01T00:00:00.000Z' };
    const featuresA = [feature('a', { interest: 1 }), feature('b', { interest: 0 })];
    const featuresB = [feature('c', { compact: 1 }), feature('d', { compact: 0 })];
    const now = Date.parse('2026-09-20T00:00:00.000Z');

    const interestEarly = [
      exposure('r1', featuresA, early), chosen('r1', 'a', early),
      exposure('r2', featuresB, late), chosen('r2', 'c', late),
    ];
    const interestLate = [
      exposure('r1', featuresA, late), chosen('r1', 'a', late),
      exposure('r2', featuresB, early), chosen('r2', 'c', early),
    ];
    const first = learnChoicePerceptronWeights(interestEarly, { now });
    const second = learnChoicePerceptronWeights(interestLate, { now });
    assert.notEqual(first.weights.interest, second.weights.interest);
    // 比較新的那一次權重比較大——衰減確實有作用在 Δ 上。
    assert.ok(second.weights.interest > first.weights.interest);
  });
});

describe('CP6-CP7 缺值遮罩與不可用資料', () => {
  test('CP6 任一方案該軸為 null 時，該軸整輪不更新，其他軸照常', () => {
    const features = [
      feature('a', { interest: 1, compact: 0, easy: 0.6 }),
      { ...feature('b', { interest: 0, compact: 1 }), easy: null },
    ];
    const result = learnChoicePerceptronWeights([exposure('r1', features), chosen('r1', 'a')]);
    assert.equal(result.weights.easy, 0);
    assert.equal(result.sufficiency.choiceCountByAxis.easy, 0);
    assert.equal(result.weights.interest, 1);
    assert.equal(result.sufficiency.choiceCountByAxis.interest, 1);
  });

  test('CP6 被選方案該軸為 null 時同樣不更新該軸', () => {
    const features = [
      { ...feature('a', { interest: 1, compact: 0 }), easy: null },
      feature('b', { interest: 0, compact: 1, easy: 0.4 }),
    ];
    const result = learnChoicePerceptronWeights([exposure('r1', features), chosen('r1', 'a')]);
    assert.equal(result.weights.easy, 0);
    assert.equal(result.sufficiency.choiceCountByAxis.easy, 0);
  });

  test('CP7 舊事件沒有 planFeatureVersion 時整筆跳過並記錄原因', () => {
    const features = [feature('a', { interest: 1 }), feature('b', { interest: 0 })];
    const result = learnChoicePerceptronWeights([
      exposure('r1', features, { version: null }), chosen('r1', 'a'),
    ]);
    assert.equal(result.sufficiency.choiceCount, 0);
    assert.deepEqual(result.weights, { interest: 0, compact: 0, easy: 0 });
    assert.equal(result.skipped[0].reason, CHOICE_SKIP_REASONS.UNSUPPORTED_FEATURE_VERSION);
  });

  test('CP7 未知的 planFeatureVersion 整筆跳過（不同 φ 定義不得混進同一個模型）', () => {
    const features = [feature('a', { interest: 1 }), feature('b', { interest: 0 })];
    const result = learnChoicePerceptronWeights([
      exposure('r1', features, { version: 'plan-feature-v999' }), chosen('r1', 'a'),
    ]);
    assert.equal(result.sufficiency.choiceCount, 0);
    assert.deepEqual(result.weights, { interest: 0, compact: 0, easy: 0 });
    assert.equal(result.skipped[0].reason, CHOICE_SKIP_REASONS.UNSUPPORTED_FEATURE_VERSION);
  });

  test('CP7 特徵沒有覆蓋整組方案時跳過（公式需要其餘方案的平均）', () => {
    const features = [feature('a', { interest: 1 }), feature('b', { interest: 0 })];
    const partial = exposure('r1', features);
    partial.exposureContext.displayedPlanIds = ['a', 'b', 'c'];
    const result = learnChoicePerceptronWeights([partial, chosen('r1', 'a')]);
    assert.equal(result.sufficiency.choiceCount, 0);
    assert.equal(result.skipped[0].reason, CHOICE_SKIP_REASONS.INCOMPLETE_FEATURES);
  });

  test('CP11 query set 只有一個方案時不更新', () => {
    const result = learnChoicePerceptronWeights([
      exposure('r1', [feature('a', { interest: 1 })]), chosen('r1', 'a'),
    ]);
    assert.equal(result.sufficiency.choiceCount, 0);
    assert.equal(result.skipped[0].reason, CHOICE_SKIP_REASONS.SINGLE_PLAN);
  });

  test('CP7 沒有對應曝光時跳過', () => {
    const result = learnChoicePerceptronWeights([chosen('r1', 'a')]);
    assert.equal(result.skipped[0].reason, CHOICE_SKIP_REASONS.NO_EXPOSURE);
  });

  test('CP7 選了沒顯示過的方案時跳過', () => {
    const features = [feature('a', { interest: 1 }), feature('b', { interest: 0 })];
    const result = learnChoicePerceptronWeights([exposure('r1', features), chosen('r1', 'ghost')]);
    assert.equal(result.skipped[0].reason, CHOICE_SKIP_REASONS.CHOSEN_NOT_DISPLAYED);
  });
});

describe('CP8-CP12 值域、行為與軌跡', () => {
  function repeatedChoices(count, features, chosenPlanId) {
    const events = [];
    for (let i = 0; i < count; i += 1) {
      const requestId = `r${i}`;
      events.push(exposure(requestId, features), chosen(requestId, chosenPlanId));
    }
    return events;
  }

  test('CP8 連續 1000 次同向選擇後仍夾在 ±2，且寫得進 DECIMAL(4,3)', () => {
    const features = [feature('a', { interest: 1, compact: 0 }), feature('b', { interest: 0, compact: 1 })];
    const result = learnChoicePerceptronWeights(repeatedChoices(1000, features, 'a'));
    assert.equal(result.weights.interest, CHOICE_WEIGHT_LIMIT);
    assert.equal(result.weights.compact, -CHOICE_WEIGHT_LIMIT);
    for (const value of Object.values(result.weights)) {
      assert.ok(Math.abs(value) <= CHOICE_WEIGHT_LIMIT);
      assert.ok(Math.abs(value) < 10 && Number(value.toFixed(3)) === value);
    }
    // 未投影的累加值必須另外保留，否則無法分辨「剛好到 2」與「早就衝破 2」。
    assert.ok(result.rawWeights.interest > CHOICE_WEIGHT_LIMIT);
  });

  test('CP9 顯式勾了集中排課、卻一直選分散的方案 → w.compact 由 1 轉負', () => {
    const features = [
      feature('spread', { compact: 0.1, interest: 0.5 }),
      feature('tight', { compact: 0.9, interest: 0.5 }),
    ];
    const result = learnChoicePerceptronWeights(repeatedChoices(3, features, 'spread'), {
      explicitProfile: { compact: 1 },
    });
    assert.equal(result.initialWeights.compact, 1);
    assert.ok(result.weights.compact < 0, `compact 應轉負，實際為 ${result.weights.compact}`);
  });

  test('CP9 沒有任何 choice 時權重逐位元等於初始值（顯式只當起點）', () => {
    const result = learnChoicePerceptronWeights([], { explicitProfile: { compact: 1, easy: -1 } });
    assert.deepEqual(result.weights, result.initialWeights);
    assert.equal(result.weights.compact, 1);
    assert.equal(result.weights.easy, -1);
    // interest 是 request scoped，沒有長期顯式基準可以當起點。
    assert.equal(result.weights.interest, 0);
  });

  test('CP12 evidence 每軸至多 20 筆，保留最近的更新', () => {
    const features = [feature('a', { interest: 1 }), feature('b', { interest: 0 })];
    const result = learnChoicePerceptronWeights(repeatedChoices(30, features, 'a'));
    assert.equal(result.evidence.interest.length, EVIDENCE_TRAIL_LIMIT);
    assert.equal(result.evidence.interest.at(-1).requestId, 'r9');
    assert.equal(result.sufficiency.choiceCountByAxis.interest, 30);
    // 軌跡記的是未投影值；最終投影後的值只有一份。
    assert.ok('rawWeightAfter' in result.evidence.interest[0]);
    assert.deepEqual(result.storedWeightAfterProjection, result.weights);
  });

  test('CP12 sufficiency 標明門檻尚未校準', () => {
    const result = learnChoicePerceptronWeights([]);
    assert.equal(result.sufficiency.calibrated, false);
    assert.equal(result.sufficiency.status, 'insufficient');
  });
});
