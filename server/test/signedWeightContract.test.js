// roadmap #10 任務 3B-0：`planPolicies[].weightMode` 的休眠 signed 契約。
//
// 存在的理由：Choice Perceptron 產生**三軸都帶號**的權重，而今天的值域只允許 `easy` 為負。
// CP 一旦套用，曝光事件就會驗證失敗被拒，而 `plan_chosen` 需要真實曝光佐證——等於 CP 啟用
// 的那一刻切斷自己的訓練資料來源。這組測試釘住兩件事：
//
//   1. **v2 的形狀完全沒變**（連 `weightMode: null` 都不能出現）；
//   2. signed 只有在三個條件同時成立時才被接受，而且呼叫端無法自己宣告成 CP。
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createInteractionEvent,
  normalizeInteractionEvent,
  validateInteractionEvent,
  INTERACTION_EVENT_TYPES,
  INTERACTION_SOURCES,
  PLAN_POLICY_WEIGHT_MODES,
} from '../src/data/interactionEventSchema.js';
import { resolveScoringPolicy } from '../src/skills/scoringPolicy.js';

const IDENTITY = { canonicalId: 'D1249697' };
const REQUEST_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACTION_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PLAN_ID = 'plan-a';

function course(sectionId = 101, catalogCourseCode = 'IECS3002') {
  return { sectionId, catalogCourseCode };
}

function exposureWithPolicy(policyOverrides = {}) {
  return {
    eventType: INTERACTION_EVENT_TYPES.RECOMMENDATION_EXPOSED,
    requestId: REQUEST_ID,
    actionId: ACTION_ID,
    term: { academicYear: 114, semester: '下學期' },
    plan: { planId: PLAN_ID, variantId: 'personalized' },
    position: { planRank: 1, courseRank: null },
    exposureContext: {
      surface: 'dashboard',
      trigger: 'initial_load',
      candidateSet: [course(101)],
      displayedSet: [course(101)],
      displayedPlanIds: [PLAN_ID],
      planPolicies: [{
        planId: PLAN_ID,
        variantId: 'personalized',
        version: 'personalized-scoring-v2',
        weights: { interest: 1, compact: 0, easy: 0 },
        categoryCoefficient: 0.35,
        creditCoefficient: 1,
        stopWhen: 'milp-optimized',
        source: { learnedApplied: false, reason: 'absent', modelVersion: null },
        ...policyOverrides,
      }],
    },
    versionSnapshot: {
      profileSchemaVersion: 1,
      modelVersion: 'scheduler-greedy-v1',
      recommendationReasonVersion: null,
    },
    source: INTERACTION_SOURCES.SYSTEM_RECOMMENDATION,
    feedbackReason: null,
  };
}

// `createInteractionEvent()` 對不合法的輸入是**丟例外**而不是回 `{ valid: false }`，
// 兩種失敗方式在這裡都算「被拒絕」。
function validate(policyOverrides) {
  try {
    return validateInteractionEvent(
      createInteractionEvent(IDENTITY, exposureWithPolicy(policyOverrides))
    );
  } catch (err) {
    return { valid: false, errors: [err.message] };
  }
}

describe('SW1 v2 的形狀完全不變', () => {
  // `resolveScoringPolicy()` 的回傳同時出現在課表 API 的 `generationPolicy`
  // （`scheduler.js` 的 plan diagnostics）與曝光事件的 `planPolicies`
  // （`scheduleService.buildExposureDraft()` 展開同一個物件）。多一個 key 兩邊都破。
  test('SW1 resolveScoringPolicy() 不輸出 weightMode', () => {
    const policy = resolveScoringPolicy({ preferCompact: true, interests: ['AI'] });

    assert.equal(Object.hasOwn(policy, 'weightMode'), false);
    assert.deepEqual(Object.keys(policy), [
      'version', 'weights', 'categoryCoefficient', 'creditCoefficient', 'source',
    ]);
  });

  // 正規化若寫成 `weightMode: asTrimmedString(...)`，v2 會拿到 `weightMode: null`，
  // 曝光 JSON 仍然變了。必須是條件展開。
  test('SW1b 正規化後的 v2 policy 連 weightMode 這個 key 都不存在', () => {
    const event = normalizeInteractionEvent(exposureWithPolicy());
    const policy = event.exposureContext.planPolicies[0];

    assert.equal(Object.hasOwn(policy, 'weightMode'), false);
    assert.equal(JSON.stringify(policy).includes('weightMode'), false);
  });

  test('SW1c 缺席即 boost，維持今天的值域', () => {
    assert.equal(validate({ weights: { interest: 3, compact: 3, easy: -3 } }).valid, true);
    // interest／compact 不得為負——這正是 CP 會踩到的那條線。
    assert.equal(validate({ weights: { interest: -0.209, compact: 0, easy: 0 } }).valid, false);
    assert.equal(validate({ weights: { interest: 0, compact: -0.209, easy: 0 } }).valid, false);
  });
});

describe('SW2 signed 需要三個條件同時成立', () => {
  const SIGNED = {
    weightMode: PLAN_POLICY_WEIGHT_MODES.SIGNED,
    version: 'personalized-scoring-v3-signed',
    source: { learnedApplied: true, reason: 'applied', modelVersion: 'choice-perceptron-v1' },
  };

  test('SW2 三條件齊備時，三軸都收 [-2, 2]', () => {
    assert.equal(validate({ ...SIGNED, weights: { interest: -2, compact: -2, easy: -2 } }).valid, true);
    assert.equal(validate({ ...SIGNED, weights: { interest: 2, compact: 2, easy: 2 } }).valid, true);
    assert.equal(validate({ ...SIGNED, weights: { interest: 0, compact: -0.209, easy: 0 } }).valid, true);
  });

  test('SW2b 超出 ±2 仍被拒（投影界線是 CHOICE_WEIGHT_LIMIT）', () => {
    assert.equal(validate({ ...SIGNED, weights: { interest: 2.001, compact: 0, easy: 0 } }).valid, false);
    assert.equal(validate({ ...SIGNED, weights: { interest: 0, compact: 0, easy: -2.5 } }).valid, false);
  });

  // 三個版本軸互不相干：scoring policy version 管權重契約、modelVersion 管 learner、
  // planFeatureVersion 管特徵格式。少任何一個就不是 signed。
  test('SW2c scoring policy version 不符 → 拒絕', () => {
    assert.equal(validate({
      ...SIGNED, version: 'personalized-scoring-v2',
      weights: { interest: -1, compact: 0, easy: 0 },
    }).valid, false);
  });

  test('SW2d learner modelVersion 不符 → 拒絕', () => {
    assert.equal(validate({
      ...SIGNED,
      source: { learnedApplied: true, reason: 'applied', modelVersion: 'preference-learning-v2' },
      weights: { interest: -1, compact: 0, easy: 0 },
    }).valid, false);
  });

  // 呼叫端光是送 `weightMode: 'signed'` 不會生效——這是「不能自稱是 CP」那條。
  // （曝光事件本來就只有伺服器寫得進來，這裡是 schema 層的第二道。）
  test('SW2e 只送 weightMode 而版本都還是 v2 → 拒絕', () => {
    assert.equal(validate({
      weightMode: PLAN_POLICY_WEIGHT_MODES.SIGNED,
      weights: { interest: -1, compact: -1, easy: -1 },
    }).valid, false);
  });

  // 只允許「缺席」或 `signed`。明確寫 `boost` 也拒絕，這樣「v2 不得出現這個 key」
  // 才是可以被強制的不變式，而不是靠自律。
  test('SW2f 明確寫 boost 或其他值 → 拒絕', () => {
    assert.equal(validate({ weightMode: 'boost' }).valid, false);
    assert.equal(validate({ weightMode: 'raw' }).valid, false);
  });

  test('SW2g NaN／Infinity／字串一律被拒（兩種 mode 都是）', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, '1', null]) {
      assert.equal(validate({ weights: { interest: bad, compact: 0, easy: 0 } }).valid, false, `boost ${bad}`);
      assert.equal(validate({ ...SIGNED, weights: { interest: bad, compact: 0, easy: 0 } }).valid, false, `signed ${bad}`);
    }
  });
});
