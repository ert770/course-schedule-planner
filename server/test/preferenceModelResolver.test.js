// roadmap #10 任務 3B-0：per-user 的模型解析與 CP sufficiency codec。
//
// 兩件事要釘住：
//   1. **本輪 `activeEngine` 恆為 v2**，shadow 名單不得改變任何 active 行為；
//   2. CP 的 sufficiency metadata **只出現在 CP 列**——`getPersonalizationSource()` 會把
//      `sufficiency` 直接回給 API，舊的 v2 列多一個 `calibrated` 就不再 deep-equal。
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  PREFERENCE_ENGINES,
  resolveExpectedPreferenceModel,
  rowToWeightsForTests,
} from '../src/services/preferenceLearningService.js';
import { PREFERENCE_LEARNING_MODEL_VERSION } from '../src/skills/preferenceLearning.js';

const SUBJECT_A = 'v1:aaaa';
const SUBJECT_B = 'v1:bbbb';

let savedMode;
let savedShadow;

beforeEach(() => {
  savedMode = process.env.PREFERENCE_LEARNER_MODE;
  savedShadow = process.env.PREFERENCE_SHADOW_SUBJECT_IDS;
  delete process.env.PREFERENCE_LEARNER_MODE;
  delete process.env.PREFERENCE_SHADOW_SUBJECT_IDS;
});

afterEach(() => {
  if (savedMode === undefined) delete process.env.PREFERENCE_LEARNER_MODE;
  else process.env.PREFERENCE_LEARNER_MODE = savedMode;
  if (savedShadow === undefined) delete process.env.PREFERENCE_SHADOW_SUBJECT_IDS;
  else process.env.PREFERENCE_SHADOW_SUBJECT_IDS = savedShadow;
});

describe('PM1 activeEngine 本輪恆為 v2', () => {
  test('PM1 沒有設定時就是 v2', () => {
    const resolved = resolveExpectedPreferenceModel();

    assert.equal(resolved.activeEngine, PREFERENCE_ENGINES.V2);
    assert.equal(resolved.activeModelVersion, PREFERENCE_LEARNING_MODEL_VERSION);
    assert.equal(resolved.shadowEngine, null);
  });

  // CP active 分支還沒實作。設成別的值不該靜默套用一個不存在的路徑。
  test('PM1b 設成 choice-perceptron 也不會讓它變成 active', () => {
    process.env.PREFERENCE_LEARNER_MODE = 'choice-perceptron';

    const resolved = resolveExpectedPreferenceModel({ subjectId: SUBJECT_A });
    assert.equal(resolved.activeEngine, PREFERENCE_ENGINES.V2);
    assert.equal(resolved.activeModelVersion, PREFERENCE_LEARNING_MODEL_VERSION);
  });

  // 這是 P2′ 的防線：shadow 只影響離線評估，不能碰 active 判定。
  test('PM2 shadow 名單只改變 shadowEngine，A 與 B 的 active 結果完全相同', () => {
    process.env.PREFERENCE_SHADOW_SUBJECT_IDS = `${SUBJECT_A}`;

    const a = resolveExpectedPreferenceModel({ subjectId: SUBJECT_A });
    const b = resolveExpectedPreferenceModel({ subjectId: SUBJECT_B });

    assert.equal(a.shadowEngine, PREFERENCE_ENGINES.CHOICE_PERCEPTRON);
    assert.equal(b.shadowEngine, null);
    assert.deepEqual(
      { engine: a.activeEngine, version: a.activeModelVersion },
      { engine: b.activeEngine, version: b.activeModelVersion }
    );
  });

  test('PM2b 名單解析容忍空白與空項目', () => {
    process.env.PREFERENCE_SHADOW_SUBJECT_IDS = `  , ${SUBJECT_A} ,, `;

    assert.equal(
      resolveExpectedPreferenceModel({ subjectId: SUBJECT_A }).shadowEngine,
      PREFERENCE_ENGINES.CHOICE_PERCEPTRON
    );
    assert.equal(resolveExpectedPreferenceModel({ subjectId: SUBJECT_B }).shadowEngine, null);
  });

  test('PM2c 沒有 subjectId 時不查名單', () => {
    process.env.PREFERENCE_SHADOW_SUBJECT_IDS = SUBJECT_A;
    assert.equal(resolveExpectedPreferenceModel().shadowEngine, null);
  });
});

describe('PM3 CP sufficiency codec 只作用在 CP 列', () => {
  function row(modelVersion, evidence) {
    return {
      modelVersion,
      interestWeight: 0.5, compactWeight: -0.25, easyWeight: 0,
      sufficiencyStatus: 'sufficient',
      usableEventCount: 60, requiredEventCount: 50,
      evidence,
      computedAt: '2026-09-22T00:00:00.000Z',
    };
  }

  // 最重要的一條：v2 的 sufficiency 形狀一個欄位都不能多。
  test('PM3 v2 列的 sufficiency 維持三個欄位', () => {
    const parsed = rowToWeightsForTests(row(PREFERENCE_LEARNING_MODEL_VERSION, { votes: {} }));

    assert.deepEqual(Object.keys(parsed.sufficiency).sort(), [
      'requiredEventCount', 'status', 'usableEventCount',
    ]);
    assert.equal(Object.hasOwn(parsed.sufficiency, 'calibrated'), false);
  });

  test('PM3b CP 列還原 calibrated／choiceCount／choiceCountByAxis', () => {
    const parsed = rowToWeightsForTests(row('choice-perceptron-v1', {
      schemaVersion: 1,
      trails: { interest: [], compact: [], easy: [] },
      sufficiency: {
        calibrated: true,
        choiceCount: 24,
        requiredChoiceCount: 20,
        choiceCountByAxis: { interest: 24, compact: 24, easy: 19 },
      },
    }));

    assert.equal(parsed.sufficiency.calibrated, true);
    assert.equal(parsed.sufficiency.choiceCount, 24);
    assert.equal(parsed.sufficiency.requiredChoiceCount, 20);
    assert.deepEqual(parsed.sufficiency.choiceCountByAxis, { interest: 24, compact: 24, easy: 19 });
  });

  // 缺 metadata 時保守擋住——寧可讓 CP 用不了，也不要讓沒校準的權重上線。
  test('PM3c CP 列缺 metadata → calibrated 為 false', () => {
    const parsed = rowToWeightsForTests(row('choice-perceptron-v1', { schemaVersion: 1 }));

    assert.equal(parsed.sufficiency.calibrated, false);
    assert.equal(parsed.sufficiency.choiceCount, 0);
    assert.deepEqual(parsed.sufficiency.choiceCountByAxis, { interest: 0, compact: 0, easy: 0 });
  });

  test('PM3d evidence 是 JSON 字串時也能解析（MySQL 讀回來的形狀）', () => {
    const parsed = rowToWeightsForTests(row('choice-perceptron-v1', JSON.stringify({
      schemaVersion: 1,
      sufficiency: { calibrated: true, choiceCount: 11, choiceCountByAxis: { interest: 11, compact: 10, easy: 3 } },
    })));

    assert.equal(parsed.sufficiency.calibrated, true);
    assert.equal(parsed.sufficiency.choiceCount, 11);
    assert.equal(parsed.sufficiency.requiredChoiceCount, null);
  });
});
