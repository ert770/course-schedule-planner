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
  PREFERENCE_DECAY_HALF_LIFE_DAYS,
  STALE_TERM_DECAY_FACTOR,
  learnPreferenceWeights,
  computeLearnedBoosts,
} from '../src/skills/preferenceLearning.js';

let seq = 0;
function nextId(prefix) {
  seq += 1;
  return `${prefix}-${seq}`;
}

function withdrawnEvent({ code = 'IECS0001', reason, t, term }) {
  return {
    eventId: nextId('evt'),
    eventType: 'course_withdrawn',
    feedbackReason: reason,
    timestamp: t,
    course: { catalogCourseCode: code, sectionId: null },
    // term 只在 #31 的衰減測試需要時提供；不給就是 undefined，
    // decayFactorFor() 對缺 term 的事件一律不做學期降權。
    ...(term ? { term } : {}),
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
  // Roadmap #31 之後，可重播的敘述變嚴格：同一批事件 ＋ 同一個 `now` ＋
  // 同一個 `activeTerm` 才保證逐位元相同——時間衰減讓「同一批事件」單獨
  // 不再足夠。三個測試分別釘住：不給 now/activeTerm 時（與 #30 相同）、
  // 打亂輸入順序時、以及有給 now/activeTerm 時。
  test('同一批事件跑兩次（不套用衰減），結果逐位元相同', () => {
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

  test('同一批事件 + 同一個 now + 同一個 activeTerm 跑兩次，結果逐位元相同', () => {
    const events = [
      withdrawnEvent({ reason: 'time', t: '2026-01-01T00:00:00.000Z' }),
      ...paddingEvents(48, { axis: 'compact' }),
    ];
    const options = {
      explicitProfile: { compact: 1 },
      now: '2026-06-01T00:00:00.000Z',
      activeTerm: { academicYear: 114, semester: 'second' },
    };
    const a = learnPreferenceWeights(events, options);
    const b = learnPreferenceWeights(events, options);
    assert.deepEqual(a, b);
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

describe('PL11 半衰期時間衰減', () => {
  test('恰好一個半衰期前的事件，effectiveSampleSize 的貢獻是新事件的一半', () => {
    const now = '2026-07-01T00:00:00.000Z';
    const halfLifeAgo = new Date(new Date(now).getTime() - PREFERENCE_DECAY_HALF_LIFE_DAYS * 86400000).toISOString();

    const fresh = learnPreferenceWeights(
      [withdrawnEvent({ reason: 'time', t: now }), ...paddingEvents(49, { axis: 'interest' })],
      { explicitProfile: {}, now },
    );
    const halfLifeOld = learnPreferenceWeights(
      [withdrawnEvent({ reason: 'time', t: halfLifeAgo }), ...paddingEvents(49, { axis: 'interest' })],
      { explicitProfile: {}, now },
    );

    // 兩邊都只有這一筆事件貢獻 compact 軸，其餘 49 筆 padding 在 interest 軸。
    assert.equal(fresh.decay.effectiveSampleSize.compact, 1);
    assert.equal(halfLifeOld.decay.effectiveSampleSize.compact, 0.5);
  });
});

describe('PL12 跨學期降權', () => {
  test('舊學期事件的權重低於同一事件在當前學期時；省略 activeTerm 時兩者相同', () => {
    const now = '2026-07-01T00:00:00.000Z';
    const activeTerm = { academicYear: 114, semester: 'second' };
    const staleTerm = { academicYear: 113, semester: 'first' };

    const currentTermEvents = [
      withdrawnEvent({ reason: 'time', t: now, term: activeTerm }),
      ...paddingEvents(49, { axis: 'interest' }),
    ];
    const staleTermEvents = [
      withdrawnEvent({ reason: 'time', t: now, term: staleTerm }),
      ...paddingEvents(49, { axis: 'interest' }),
    ];

    const withActiveTerm = learnPreferenceWeights(currentTermEvents, { explicitProfile: {}, now, activeTerm });
    const withStaleTerm = learnPreferenceWeights(staleTermEvents, { explicitProfile: {}, now, activeTerm });
    assert.ok(withStaleTerm.weights.compact < withActiveTerm.weights.compact);
    assert.equal(withStaleTerm.decay.staleTermEventCount, 1);
    assert.equal(withActiveTerm.decay.staleTermEventCount, 0);

    // 省略 activeTerm：兩邊都不做學期降權，結果應該相同。
    const noActiveTermA = learnPreferenceWeights(currentTermEvents, { explicitProfile: {}, now });
    const noActiveTermB = learnPreferenceWeights(staleTermEvents, { explicitProfile: {}, now });
    assert.equal(noActiveTermA.weights.compact, noActiveTermB.weights.compact);
  });
});

describe('PL13 衰減不影響 usableEventCount', () => {
  test('同一批事件在相差一年的兩個 now 下，usableEventCount 完全相同', () => {
    const events = [withdrawnEvent({ reason: 'time', t: '2026-01-01T00:00:00.000Z' }), ...paddingEvents(30, { axis: 'compact' })];
    const early = learnPreferenceWeights(events, { explicitProfile: {}, now: '2026-02-01T00:00:00.000Z' });
    const late = learnPreferenceWeights(events, { explicitProfile: {}, now: '2027-02-01T00:00:00.000Z' });
    assert.equal(early.sufficiency.usableEventCount, late.sufficiency.usableEventCount);
    assert.equal(early.sufficiency.usableEventCount, 31);
  });
});

describe('PL14 衰減後仍是強訊號', () => {
  test('衰減到 0.3 的強訊號不得被歸進弱訊號 cap', () => {
    // 3 個半衰期後，衰減係數 = 0.5^3 = 0.125，遠低於 STRONG_VOTE_WEIGHT，
    // 但這仍然是一筆強訊號（退課），不該被 foldAxis 誤判成弱訊號掃進 cap。
    const now = '2026-01-01T00:00:00.000Z';
    const threeHalfLivesAgo = new Date(
      new Date(now).getTime() - 3 * PREFERENCE_DECAY_HALF_LIFE_DAYS * 86400000,
    ).toISOString();

    const decayedStrongOnly = learnPreferenceWeights(
      [withdrawnEvent({ reason: 'time', t: threeHalfLivesAgo }), ...paddingEvents(49, { axis: 'interest' })],
      { explicitProfile: {}, now },
    );
    // 若被誤判為弱訊號，effectiveSampleSize 會被 cap 在 1（WEAK_VOTE_AXIS_CAP）；
    // 這裡衰減係數 0.125 遠小於 cap，唯一能證明「沒被 cap 邏輯攔截」的方式是
    // 確認它就是原始衰減值，而不是被硬性夾住的上限值。
    assert.equal(decayedStrongOnly.decay.effectiveSampleSize.compact, Math.round(0.125 * 1000) / 1000);
  });
});

describe('PL15 弱訊號 cap 在衰減之後才套用', () => {
  test('7 筆全新瀏覽（原始總和剛過 cap）飽和在 cap；同樣 7 筆衰減 0.5 後嚴格小於 cap', () => {
    // 7 * WEAK_VOTE_WEIGHT(0.15) = 1.05，剛好超過 cap = 1，全新時會被 cap 夾住。
    // 衰減 0.5 之後總和只剩 0.525，還沒到 cap，此時 cap 應該不介入。
    const now = '2026-01-01T00:00:00.000Z';
    const halfLifeAgo = new Date(new Date(now).getTime() - PREFERENCE_DECAY_HALF_LIFE_DAYS * 86400000).toISOString();

    const sevenViews = (t) => Array.from({ length: 7 }, (_, i) => viewedEvent({ code: `V${i}`, t }));

    const fresh = learnPreferenceWeights(
      [...sevenViews(now), ...paddingEvents(50, { axis: 'compact' })],
      { explicitProfile: {}, now },
    );
    const decayed = learnPreferenceWeights(
      [...sevenViews(halfLifeAgo), ...paddingEvents(50, { axis: 'compact' })],
      { explicitProfile: {}, now },
    );

    assert.equal(fresh.decay.effectiveSampleSize.interest, 1); // 1.05 被 cap 夾在 1
    assert.equal(decayed.decay.effectiveSampleSize.interest, 0.525); // 1.05 * 0.5，未達 cap
    assert.ok(decayed.decay.effectiveSampleSize.interest < 1, '衰減後應嚴格小於 cap');
  });
});

describe('PL16 時鐘純度', () => {
  test('省略 now 時 decay.appliedAt 為 null，且結果與「now 設為事件當下」相同', () => {
    const t = '2026-03-01T00:00:00.000Z';
    const events = [withdrawnEvent({ reason: 'time', t }), ...paddingEvents(49, { axis: 'interest' })];

    const noNow = learnPreferenceWeights(events, { explicitProfile: {} });
    assert.equal(noNow.decay.appliedAt, null);

    const sameInstant = learnPreferenceWeights(events, { explicitProfile: {}, now: t });
    assert.equal(noNow.weights.compact, sameInstant.weights.compact);
  });

  test('未來時間戳不得讓衰減係數大於 1（放大權重）', () => {
    const now = '2026-01-01T00:00:00.000Z';
    const future = '2026-06-01T00:00:00.000Z'; // 晚於 now
    const withFutureTimestamp = learnPreferenceWeights(
      [withdrawnEvent({ reason: 'time', t: future }), ...paddingEvents(49, { axis: 'interest' })],
      { explicitProfile: {}, now },
    );
    // 未來時間戳被夾住在 ageDays=0，等同衰減係數 1——不應超過「當下事件」的份量。
    assert.equal(withFutureTimestamp.decay.effectiveSampleSize.compact, 1);
  });
});

describe('PL17 單調性：多一筆同軸弱訊號權重不得下降', () => {
  test('1 筆強訊號 + 1 筆未飽和弱訊號 的權重 >= 只有 1 筆強訊號', () => {
    const strongOnly = learnPreferenceWeights(
      [withdrawnEvent({ code: 'S1', reason: 'content', t: '2026-01-01T00:00:00.000Z' })],
      { explicitProfile: {} },
    );
    const strongPlusOneWeak = learnPreferenceWeights(
      [
        withdrawnEvent({ code: 'S1', reason: 'content', t: '2026-01-01T00:00:00.000Z' }),
        viewedEvent({ code: 'V1', t: '2026-01-01T00:00:01.000Z' }),
      ],
      { explicitProfile: {} },
    );
    assert.ok(
      strongPlusOneWeak.weights.interest >= strongOnly.weights.interest,
      `多一筆支持性弱訊號不該讓權重下降：${strongPlusOneWeak.weights.interest} < ${strongOnly.weights.interest}`,
    );
  });
});

describe('PL24 computeLearnedBoosts（roadmap #5B）', () => {
  test('boost 是學到的值超出顯式基準的部分', () => {
    const boosts = computeLearnedBoosts(
      { interest: 0.6, compact: 1, easy: 0.3 },
      { interest: 0.2, compact: 0, easy: 0 },
    );
    assert.deepEqual(boosts, { interest: 0.4, compact: 1, easy: 0.3 });
  });

  test('顯式先驗已飽和（prior=1）時 boost 為 0——這是不回歸的關鍵案例', () => {
    // foldAxis() 的下限保證學到的值在 prior=1 時恆等於 1；若直接拿學到的
    // 原值當強度，所有勾了集中排課的使用者會在沒有任何新證據下被加重權重。
    const boosts = computeLearnedBoosts(
      { interest: 0, compact: 1, easy: 0 },
      { interest: 0, compact: 1, easy: 0 },
    );
    assert.equal(boosts.compact, 0);
  });

  test('boost 恆被夾在 [0,1]，不會因為浮點誤差變成負數', () => {
    const boosts = computeLearnedBoosts(
      { interest: 0.9999, compact: 0, easy: 0 },
      { interest: 1, compact: 0, easy: 0 },
    );
    assert.ok(boosts.interest >= 0);
  });

  test('weights 為 null 時整個回傳 null，不是全 0 物件', () => {
    assert.equal(computeLearnedBoosts(null, { interest: 0, compact: 0, easy: 0 }), null);
  });

  test('省略 explicitProfile 時視為三軸皆為 0', () => {
    const boosts = computeLearnedBoosts({ interest: 0.5, compact: 0, easy: 0 });
    assert.equal(boosts.interest, 0.5);
  });
});
