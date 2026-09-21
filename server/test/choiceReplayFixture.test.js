import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  REPLAY_PERSONAS,
  buildPersonaRounds,
  evaluateWeights,
  predictIndex,
  roundToEvents,
  splitRounds,
  systemScore,
  trueUtility,
} from '../scripts/lib/choiceReplayFixture.js';
import { learnChoicePerceptronWeights } from '../src/skills/preferenceLearning.js';

// Roadmap #10 任務 3A-6：重播素材本身也要能被信任——報告裡的數字全部由它產生，
// 產生器不對的話，四方對照就只是把同一個 bug 量了四次。

describe('#10 3A-6 重播素材與指標', () => {
  test('同一個 seed 逐位元可重現；不同 seed 產生不同資料', () => {
    const [persona] = REPLAY_PERSONAS;
    const first = buildPersonaRounds(persona, { seed: 1, rounds: 10 });
    const second = buildPersonaRounds(persona, { seed: 1, rounds: 10 });
    const other = buildPersonaRounds(persona, { seed: 2, rounds: 10 });
    assert.equal(JSON.stringify(first), JSON.stringify(second));
    assert.notEqual(JSON.stringify(first), JSON.stringify(other));
  });

  test('φ 完整時，系統分數的排序與 ⟨w, φ⟩ 一致（正仿射變換）', () => {
    const weights = { interest: 1.3, compact: -0.7, easy: 0.4 };
    const features = buildPersonaRounds(REPLAY_PERSONAS[0], { seed: 3, rounds: 12 })
      .flatMap(round => round.features);
    const byScore = [...features].sort((a, b) => systemScore(weights, b) - systemScore(weights, a));
    const byDot = [...features].sort((a, b) => trueUtility(weights, b) - trueUtility(weights, a));
    assert.deepEqual(byScore.map(item => item.planId), byDot.map(item => item.planId));
  });

  test('null-easy persona 的每個方案 easy 都是 null，且 CP 不更新該軸', () => {
    const persona = REPLAY_PERSONAS.find(item => item.id === 'null-easy');
    const rounds = buildPersonaRounds(persona, { seed: 5, rounds: 8 });
    assert.ok(rounds.every(round => round.features.every(feature => feature.easy === null)));

    const events = rounds.flatMap((round, index) => roundToEvents(round, { dayOffset: index }));
    const result = learnChoicePerceptronWeights(events, { explicitProfile: persona.explicitProfile });
    assert.equal(result.sufficiency.choiceCountByAxis.easy, 0);
    assert.ok(result.sufficiency.choiceCountByAxis.interest > 0);
  });

  test('每回合都產生成對的 plan_chosen 與 recommendation_accepted，供兩個引擎讀同一次互動', () => {
    const rounds = buildPersonaRounds(REPLAY_PERSONAS[0], { seed: 9, rounds: 4 });
    const events = rounds.flatMap((round, index) => roundToEvents(round, { dayOffset: index }));
    const count = type => events.filter(event => event.eventType === type).length;
    assert.equal(count('recommendation_exposed'), 4);
    assert.equal(count('plan_chosen'), 4);
    assert.equal(count('recommendation_accepted'), 4);
    // 兩者指向同一個方案，否則兩個引擎學的就不是同一次選擇。
    const chosen = events.find(event => event.eventType === 'plan_chosen');
    const accepted = events.find(event => event.eventType === 'recommendation_accepted');
    assert.equal(chosen.plan.planId, accepted.plan.planId);
  });

  test('切分不重疊，且 test 不參與訓練', () => {
    const rounds = buildPersonaRounds(REPLAY_PERSONAS[0], { seed: 11, rounds: 100 });
    const split = splitRounds(rounds, { training: 60, validation: 20 });
    assert.equal(split.training.length, 60);
    assert.equal(split.validation.length, 20);
    assert.equal(split.test.length, 20);
    const ids = new Set([...split.training, ...split.validation, ...split.test].map(round => round.roundIndex));
    assert.equal(ids.size, 100);
  });

  test('accuracy 與名次的定義：猜中時名次為 1', () => {
    const rounds = [{
      roundIndex: 0,
      chosenIndex: 1,
      features: [
        { planId: 'a', interest: 0.1, compact: 0.1, easy: 0.1 },
        { planId: 'b', interest: 0.9, compact: 0.1, easy: 0.1 },
      ],
    }];
    const perfect = evaluateWeights({ interest: 1, compact: 0, easy: 0 }, rounds);
    assert.equal(perfect.accuracy, 1);
    assert.equal(perfect.meanRank, 1);
    assert.equal(predictIndex({ interest: 1, compact: 0, easy: 0 }, rounds[0].features), 1);

    const wrong = evaluateWeights({ interest: -1, compact: 0, easy: 0 }, rounds);
    assert.equal(wrong.accuracy, 0);
    assert.equal(wrong.meanRank, 2);
  });
});
