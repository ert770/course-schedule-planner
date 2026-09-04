// Roadmap #30：per-user preference update pipeline 的純函式測試。
//
// 這裡釘住的核心跟 #26 一樣是**誠實邊界**：資料不夠就不套用，弱訊號再多也
// 翻不了盤，顯式設定不會被行為推翻，而且每個非零權重都能追溯到是哪些事件、
// 依哪條規則算出來的。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  PREFERENCE_LEARNING_MODEL_VERSION,
  REQUIRED_USABLE_EVENT_COUNT,
  SUFFICIENCY_STATUS,
  learnPreferenceWeights,
} from '../src/skills/preferenceLearning.js';

let seq = 0;
function nextId(prefix) {
  seq += 1;
  return `${prefix}-${seq}`;
}

function withdrawnEvent({ code = 'IECS0001', reason, t }) {
  return {
    eventId: nextId('evt'),
    eventType: 'course_withdrawn',
    feedbackReason: reason,
    timestamp: t,
    course: { catalogCourseCode: code, sectionId: null },
  };
}

function viewedEvent({ code = 'IECS0001', t }) {
  return {
    eventId: nextId('evt'),
    eventType: 'course_viewed',
    timestamp: t,
    course: { catalogCourseCode: code, sectionId: null },
  };
}

function exposedEvent({ requestId, displayedPlanIds, t }) {
  return {
    eventId: nextId('evt'),
    eventType: 'recommendation_exposed',
    requestId,
    timestamp: t,
    exposureContext: { displayedPlanIds },
  };
}

function acceptedEvent({ requestId, variantId, t }) {
  return {
    eventId: nextId('evt'),
    eventType: 'recommendation_accepted',
    requestId,
    plan: { planId: `${requestId}:${variantId}`, variantId },
    timestamp: t,
  };
}

// 產生足夠份量的 padding，讓整體事件量跨過門檻，才能在「已套用」狀態下
// 比較某一軸本身的行為——`REQUIRED_USABLE_EVENT_COUNT` 內部值不對外承諾，
// 這裡直接用匯出的常數，門檻改了測試不必跟著猜。
function paddingEvents(count, { axis = 'compact', reasonMap = { compact: 'time', easy: 'workload', interest: 'content' } }) {
  return Array.from({ length: count }, (_, i) => withdrawnEvent({
    code: `PAD${axis}${i}`,
    reason: reasonMap[axis],
    t: `2020-01-01T00:${String(i % 60).padStart(2, '0')}:00.000Z`,
  }));
}

describe('PL1 可重播', () => {
  test('同一批事件跑兩次，結果逐位元相同', () => {
    const events = [
      withdrawnEvent({ reason: 'time', t: '2026-01-01T00:00:00.000Z' }),
      viewedEvent({ code: 'IECS0002', t: '2026-01-01T00:01:00.000Z' }),
      ...paddingEvents(48, { axis: 'compact' }),
    ];
    const a = learnPreferenceWeights(events, { explicitProfile: { compact: 1 } });
    const b = learnPreferenceWeights(events, { explicitProfile: { compact: 1 } });
    assert.deepEqual(a, b);
  });

  test('打亂輸入順序，結果不變——內部自己排序，不依賴輸入順序', () => {
    const events = [
      withdrawnEvent({ reason: 'time', t: '2026-01-01T00:00:05.000Z' }),
      withdrawnEvent({ reason: 'time', t: '2026-01-01T00:00:01.000Z' }),
      withdrawnEvent({ reason: 'time', t: '2026-01-01T00:00:03.000Z' }),
      ...paddingEvents(47, { axis: 'compact' }),
    ];
    const forward = learnPreferenceWeights(events, { explicitProfile: {} });
    const shuffled = learnPreferenceWeights([...events].reverse(), { explicitProfile: {} });
    assert.deepEqual(forward, shuffled);
  });
});

describe('PL2 兩位互動不同的學生排名分化', () => {
  test('顯式設定相同，一位常以 time 退課、一位常以 workload 退課，學到的軸不同', () => {
    const explicitProfile = { interest: 0, compact: 0, easy: 0 };

    const studentA = paddingEvents(50, { axis: 'compact' });
    const studentB = paddingEvents(50, { axis: 'easy' });

    const resultA = learnPreferenceWeights(studentA, { explicitProfile });
    const resultB = learnPreferenceWeights(studentB, { explicitProfile });

    assert.equal(resultA.sufficiency.status, SUFFICIENCY_STATUS.SUFFICIENT);
    assert.equal(resultB.sufficiency.status, SUFFICIENCY_STATUS.SUFFICIENT);
    assert.ok(resultA.weights.compact > resultA.weights.easy, 'A 應該在 compact 軸學到更高權重');
    assert.ok(resultB.weights.easy > resultB.weights.compact, 'B 應該在 easy 軸學到更高權重');
  });

  test('接受方案（有對照組）同樣能讓兩位學生分化', () => {
    const explicitProfile = { interest: 0, compact: 0, easy: 0 };

    const acceptMany = (variantId, otherVariant, n) => Array.from({ length: n }, (_, i) => {
      const requestId = `req-${variantId}-${i}`;
      return [
        exposedEvent({ requestId, displayedPlanIds: [`${requestId}:required_first`, `${requestId}:${otherVariant}`], t: `2026-01-01T00:${String(i).padStart(2, '0')}:00.000Z` }),
        acceptedEvent({ requestId, variantId, t: `2026-01-01T00:${String(i).padStart(2, '0')}:30.000Z` }),
      ];
    }).flat();

    const studentA = acceptMany('compact', 'compact', 50);
    const studentB = acceptMany('easy_score', 'easy_score', 50);

    const resultA = learnPreferenceWeights(studentA, { explicitProfile });
    const resultB = learnPreferenceWeights(studentB, { explicitProfile });

    assert.equal(resultA.sufficiency.status, SUFFICIENCY_STATUS.SUFFICIENT);
    assert.equal(resultB.sufficiency.status, SUFFICIENCY_STATUS.SUFFICIENT);
    assert.ok(resultA.weights.compact > resultA.weights.easy);
    assert.ok(resultB.weights.easy > resultB.weights.compact);
  });
});

describe('PL3 單次誤點不翻盤', () => {
  test('一長串一致行為後插入一次相反的單一事件，主要偏好方向不變', () => {
    const consistent = Array.from({ length: 20 }, (_, i) => withdrawnEvent({
      code: `C${i}`, reason: 'time', t: `2026-01-01T01:${String(i).padStart(2, '0')}:00.000Z`,
    }));
    const withOneOutlier = [
      ...consistent,
      withdrawnEvent({ code: 'OUT', reason: 'workload', t: '2026-01-01T02:00:00.000Z' }),
      ...paddingEvents(30, { axis: 'interest' }),
    ];
    const baseline = learnPreferenceWeights([...consistent, ...paddingEvents(30, { axis: 'interest' })], { explicitProfile: {} });
    const withOutlier = learnPreferenceWeights(withOneOutlier, { explicitProfile: {} });

    assert.ok(withOutlier.weights.compact > 0.5, 'compact 仍應是主要偏好');
    // 單一相反事件只應小幅移動 easy 軸，不應讓它超過 compact。
    assert.ok(withOutlier.weights.easy < withOutlier.weights.compact);
    assert.ok(Math.abs(withOutlier.weights.compact - baseline.weights.compact) < 0.05);
  });
});

describe('PL4 顯式優先', () => {
  test('使用者顯式設定的軸，學到的權重不得低於顯式基準', () => {
    // 行為證據完全指向相反方向（多次以 content 退課，代表對 interest 反感的訊號
    // 其實不存在——這裡刻意不給 interest 任何正向訊號，只給其他軸），
    // 但使用者顯式勾了 interest。
    const events = [
      ...paddingEvents(50, { axis: 'compact' }),
    ];
    const result = learnPreferenceWeights(events, { explicitProfile: { interest: 1, compact: 0, easy: 0 } });
    assert.equal(result.weights.interest, 1, 'interest 沒有任何行為訊號時，仍要維持顯式基準 1');
  });

  test('顯式基準是下限，不是上限——行為訊號足夠時可以往上調', () => {
    const events = Array.from({ length: 50 }, (_, i) => withdrawnEvent({
      code: `T${i}`, reason: 'time', t: `2026-01-01T00:${String(i % 60).padStart(2, '0')}:00.000Z`,
    }));
    const result = learnPreferenceWeights(events, { explicitProfile: { compact: 0 } });
    assert.ok(result.weights.compact > 0, '大量一致訊號應該能把權重推高於顯式的 0');
  });
});

describe('PL5 三態不得混用', () => {
  test('事件不足時回 insufficient，並附還差多少，權重回退為顯式設定', () => {
    const events = [withdrawnEvent({ reason: 'time', t: '2026-01-01T00:00:00.000Z' })];
    const result = learnPreferenceWeights(events, { explicitProfile: { compact: 1, easy: 0, interest: 0 } });
    assert.equal(result.sufficiency.status, SUFFICIENCY_STATUS.INSUFFICIENT);
    assert.equal(result.sufficiency.requiredEventCount, REQUIRED_USABLE_EVENT_COUNT);
    assert.ok(result.sufficiency.usableEventCount < result.sufficiency.requiredEventCount);
    assert.deepEqual(result.weights, { interest: 0, compact: 1, easy: 0 }, '不足時應等於顯式設定，不是半調子的學習值');
  });

  test('事件量足夠時回 sufficient', () => {
    const events = paddingEvents(50, { axis: 'compact' });
    const result = learnPreferenceWeights(events, { explicitProfile: {} });
    assert.equal(result.sufficiency.status, SUFFICIENCY_STATUS.SUFFICIENT);
  });

  test('沒有任何事件時，missingAxes 列出全部三軸', () => {
    const result = learnPreferenceWeights([], { explicitProfile: {} });
    assert.deepEqual(new Set(result.sufficiency.missingAxes), new Set(['interest', 'compact', 'easy']));
  });
});

describe('PL6 可追溯', () => {
  test('每個非零權重都能列出貢獻它的 eventId 與規則代號', () => {
    const withdraw = withdrawnEvent({ reason: 'time', t: '2026-01-01T00:00:00.000Z' });
    const events = [withdraw, ...paddingEvents(49, { axis: 'compact' })];
    const result = learnPreferenceWeights(events, { explicitProfile: {} });
    const ids = result.evidence.compact.map(item => item.eventId);
    assert.ok(ids.includes(withdraw.eventId));
    assert.ok(result.evidence.compact.every(item => item.ruleId === 'WITHDRAW_TIME'));
  });

  test('modelVersion 隨每次結果一起回傳', () => {
    const result = learnPreferenceWeights([], { explicitProfile: {} });
    assert.equal(result.modelVersion, PREFERENCE_LEARNING_MODEL_VERSION);
  });
});

describe('PL8 弱訊號不得翻盤', () => {
  test('30 筆 course_viewed 對 1 筆強訊號，累計貢獻不超過再一筆強訊號', () => {
    const strongPlusManyWeak = [
      withdrawnEvent({ code: 'S1', reason: 'content', t: '2026-01-01T00:00:00.500Z' }),
      ...Array.from({ length: 30 }, (_, i) => viewedEvent({
        code: `V${i}`, t: `2026-01-01T00:00:${String(i + 1).padStart(2, '0')}.000Z`,
      })),
      ...paddingEvents(50, { axis: 'compact' }),
    ];
    const twoStrong = [
      withdrawnEvent({ code: 'S1', reason: 'content', t: '2026-01-01T00:00:00.500Z' }),
      withdrawnEvent({ code: 'S2', reason: 'content', t: '2026-01-01T00:00:01.500Z' }),
      ...paddingEvents(50, { axis: 'compact' }),
    ];

    const a = learnPreferenceWeights(strongPlusManyWeak, { explicitProfile: {} });
    const b = learnPreferenceWeights(twoStrong, { explicitProfile: {} });

    assert.equal(a.sufficiency.status, SUFFICIENCY_STATUS.SUFFICIENT);
    assert.equal(b.sufficiency.status, SUFFICIENCY_STATUS.SUFFICIENT);
    // 核心不變量：不管弱訊號幾筆（只要 > 0），capped 之後的效果恰好等於
    // 再多一筆強訊號——「看了很多次」最多等於「明確表態過一次」。
    assert.equal(a.weights.interest, b.weights.interest);
  });

  test('31 筆與 30 筆弱訊號的效果相同——確認 cap 是硬上限，不是隨筆數線性成長', () => {
    const base = (n) => [
      withdrawnEvent({ code: 'S1', reason: 'content', t: '2026-01-01T00:00:00.500Z' }),
      ...Array.from({ length: n }, (_, i) => viewedEvent({
        code: `V${i}`, t: `2026-01-01T00:00:${String(i + 1).padStart(2, '0')}.000Z`,
      })),
      ...paddingEvents(50, { axis: 'compact' }),
    ];
    const a = learnPreferenceWeights(base(30), { explicitProfile: {} });
    const b = learnPreferenceWeights(base(31), { explicitProfile: {} });
    assert.equal(a.weights.interest, b.weights.interest);
  });
});

describe('PL9 看了又退不算正向', () => {
  test('同一門課先看後退，那次瀏覽不出現在 interest 的 evidence 裡', () => {
    const view = viewedEvent({ code: 'X1', t: '2026-01-01T00:00:00.000Z' });
    const withdraw = withdrawnEvent({ code: 'X1', reason: 'time', t: '2026-01-01T00:01:00.000Z' });
    const events = [view, withdraw, ...paddingEvents(48, { axis: 'compact' })];

    const result = learnPreferenceWeights(events, { explicitProfile: {} });
    const interestEventIds = result.evidence.interest.map(item => item.eventId);
    assert.ok(!interestEventIds.includes(view.eventId));
  });

  test('把時間順序對調（先退後看），那次瀏覽要被計入——證明真的在看時序', () => {
    const withdraw = withdrawnEvent({ code: 'X1', reason: 'time', t: '2026-01-01T00:00:00.000Z' });
    const view = viewedEvent({ code: 'X1', t: '2026-01-01T00:01:00.000Z' });
    const events = [withdraw, view, ...paddingEvents(48, { axis: 'compact' })];

    const result = learnPreferenceWeights(events, { explicitProfile: {} });
    const interestEventIds = result.evidence.interest.map(item => item.eventId);
    assert.ok(interestEventIds.includes(view.eventId), '退課之後的瀏覽是合理的正向訊號，不該被排除');
  });

  test('同一門課有多次退課，只要任一次晚於瀏覽就排除', () => {
    const view = viewedEvent({ code: 'X1', t: '2026-01-01T00:00:30.000Z' });
    const earlierWithdraw = withdrawnEvent({ code: 'X1', reason: 'time', t: '2026-01-01T00:00:00.000Z' });
    const laterWithdraw = withdrawnEvent({ code: 'X1', reason: 'time', t: '2026-01-01T00:01:00.000Z' });
    const events = [earlierWithdraw, view, laterWithdraw, ...paddingEvents(47, { axis: 'compact' })];

    const result = learnPreferenceWeights(events, { explicitProfile: {} });
    const interestEventIds = result.evidence.interest.map(item => item.eventId);
    assert.ok(!interestEventIds.includes(view.eventId));
  });
});

describe('PL10 事件類型的邊界情況', () => {
  test('recommendation_exposed 與 schedule_regenerated 不產生任何投票', () => {
    const events = [
      exposedEvent({ requestId: 'r1', displayedPlanIds: ['r1:a', 'r1:b'], t: '2026-01-01T00:00:00.000Z' }),
      { eventId: nextId('evt'), eventType: 'schedule_regenerated', timestamp: '2026-01-01T00:00:01.000Z' },
    ];
    const result = learnPreferenceWeights(events, { explicitProfile: {} });
    assert.equal(result.sufficiency.usableEventCount, 0);
  });

  test('accept 事件對應的曝光只有 1 個方案時不計入（沒有對照組）', () => {
    const events = [
      exposedEvent({ requestId: 'r1', displayedPlanIds: ['r1:easy_score'], t: '2026-01-01T00:00:00.000Z' }),
      acceptedEvent({ requestId: 'r1', variantId: 'easy_score', t: '2026-01-01T00:00:01.000Z' }),
      ...paddingEvents(49, { axis: 'compact' }),
    ];
    const result = learnPreferenceWeights(events, { explicitProfile: {} });
    assert.equal(result.evidence.easy.length, 0);
  });

  test('accept 事件找不到對應曝光時不計入', () => {
    const events = [
      acceptedEvent({ requestId: 'missing-exposure', variantId: 'easy_score', t: '2026-01-01T00:00:01.000Z' }),
      ...paddingEvents(49, { axis: 'compact' }),
    ];
    const result = learnPreferenceWeights(events, { explicitProfile: {} });
    assert.equal(result.evidence.easy.length, 0);
  });

  test('accept 事件對應 required_first 或 max_credits 這種不代表軸方向的 variant，不計入任何軸', () => {
    const events = [
      exposedEvent({ requestId: 'r1', displayedPlanIds: ['r1:required_first', 'r1:max_credits'], t: '2026-01-01T00:00:00.000Z' }),
      acceptedEvent({ requestId: 'r1', variantId: 'required_first', t: '2026-01-01T00:00:01.000Z' }),
      ...paddingEvents(49, { axis: 'compact' }),
    ];
    const result = learnPreferenceWeights(events, { explicitProfile: {} });
    assert.equal(result.evidence.interest.length + result.evidence.compact.length - 49, 0);
    assert.equal(result.evidence.easy.length, 0);
  });
});
