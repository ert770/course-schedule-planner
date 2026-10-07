import test from 'node:test';
import assert from 'node:assert/strict';

import {
  READINESS,
  checkReadiness,
  evaluateChoiceRounds,
  groupBySubject,
  hierarchicalBootstrap,
  percentile,
  roundToEvents,
  splitChronological,
} from '../scripts/lib/choiceEvaluation.js';
import { REPLAY_PERSONAS, buildPersonaRounds } from '../scripts/lib/choiceReplayFixture.js';
import { roundsFromEvents } from '../scripts/choicePerceptronEvaluation.js';
import {
  buildScenarios, describePlan, explicitDirection, parseChoice, querySignature, shuffled,
} from '../scripts/lib/personaScenarios.js';
import { learnChoicePerceptronWeights } from '../src/skills/preferenceLearning.js';

// 用既有的合成 persona 產生回合，補上本模組需要的 subject／時間／requestId。
function fixtureRounds(persona, subject, count, seed = 1) {
  return buildPersonaRounds(persona, { seed, rounds: count }).map((round, index) => ({
    subject,
    requestId: `${subject}-${String(index).padStart(3, '0')}`,
    timestamp: new Date(Date.UTC(2026, 0, 1 + index)).toISOString(),
    features: round.features,
    planPolicies: [],
    chosenIndex: round.chosenIndex,
  }));
}

const profileOf = persona => ({ explicit: persona.explicitProfile, v2Explicit: persona.explicitProfile });

test('CE1 時間切分依序為 60／20／20，test 一定是最晚的回合', () => {
  const rounds = fixtureRounds(REPLAY_PERSONAS[0], 'a', 25);
  const split = splitChronological(groupBySubject([...rounds].reverse()).get('a'));
  assert.deepEqual(
    [split.training.length, split.validation.length, split.test.length],
    [15, 5, 5]
  );
  assert.ok(split.training.at(-1).timestamp < split.validation[0].timestamp);
  assert.ok(split.validation.at(-1).timestamp < split.test[0].timestamp);
});

test('CE2 資料不足時回報 no-data 並列出原因，不計算任何指標', () => {
  const rounds = [
    ...fixtureRounds(REPLAY_PERSONAS[0], 'a', 25),
    ...fixtureRounds(REPLAY_PERSONAS[1], 'b', 10),
  ];
  const report = evaluateChoiceRounds(rounds, {});
  assert.equal(report.verdict, 'no-data');
  assert.equal(report.readiness.eligibleSubjects, 1);
  assert.ok(report.readiness.reasons.length >= 2);
  assert.equal(report.accuracy, undefined);
});

test('CE3 readiness 門檻：3 位、每位 20 筆、合計 100 筆', () => {
  const groups = groupBySubject(['a', 'b', 'c'].flatMap((subject, index) => (
    fixtureRounds(REPLAY_PERSONAS[index], subject, 34)
  )));
  const readiness = checkReadiness(groups);
  assert.equal(readiness.ready, true);
  assert.equal(readiness.total, 102);
  assert.ok(readiness.total >= READINESS.minTotalChoices);
});

test('CE4 行為與顯式設定相反的使用者：CP 明顯贏過只用顯式偏好', () => {
  const personas = [REPLAY_PERSONAS[1], REPLAY_PERSONAS[1], REPLAY_PERSONAS[1]];
  const rounds = personas.flatMap((persona, index) => fixtureRounds(persona, `s${index}`, 60, index + 1));
  const profiles = Object.fromEntries(personas.map((persona, index) => [`s${index}`, profileOf(persona)]));
  const report = evaluateChoiceRounds(rounds, profiles, { bootstrap: { iterations: 300 } });
  assert.notEqual(report.verdict, 'no-data');
  assert.ok(report.accuracy.cp > report.accuracy.explicit + 0.2);
  assert.equal(report.consistentGroup.subjects, 0);
  // 沒有人落在一致族群時，那一項是「無資料」，結論不能是 go。
  assert.equal(report.criteria.consistentGroup, null);
  assert.notEqual(report.verdict, 'go');
  assert.deepEqual(report.notEvaluated, ['hardViolations', 'schedulingSuccessRate', 'latencyP95']);
});

test('CE5 評估可重現：同一份輸入得到逐位元相同的報告', () => {
  const rounds = REPLAY_PERSONAS.flatMap((persona, index) => fixtureRounds(persona, `s${index}`, 40, 7));
  const profiles = Object.fromEntries(REPLAY_PERSONAS.map((persona, index) => [`s${index}`, profileOf(persona)]));
  const options = { bootstrap: { iterations: 200, seed: 5 } };
  assert.deepEqual(
    evaluateChoiceRounds(rounds, profiles, options),
    evaluateChoiceRounds([...rounds].reverse(), profiles, options)
  );
});

test('CE6 階層式 bootstrap：全為 0 的差值區間就是 [0, 0]；空輸入回 null', () => {
  assert.deepEqual(
    hierarchicalBootstrap([[0, 0, 0], [0, 0]], { iterations: 50 }),
    { lower: 0, upper: 0, iterations: 50 }
  );
  assert.equal(hierarchicalBootstrap([], { iterations: 50 }).lower, null);
  const positive = hierarchicalBootstrap([[1, 1, 0, 1], [1, 0, 1, 1], [1, 1, 1, 1]], { iterations: 400, seed: 3 });
  assert.ok(positive.lower > 0 && positive.upper <= 1);
});

test('CE7 percentile 取第 75 百分位（向上取位）', () => {
  assert.equal(percentile([1, 2, 3, 4], 0.75), 3);
  assert.equal(percentile([5], 0.75), 5);
  assert.equal(percentile([], 0.75), null);
});

test('CE8 回合還原成的事件能被正式 learner 當成一筆可學的 choice', () => {
  const [round] = fixtureRounds(REPLAY_PERSONAS[0], 'a', 1);
  const learned = learnChoicePerceptronWeights(roundToEvents(round), {});
  assert.equal(learned.sufficiency.choiceCount, 1);
  assert.deepEqual(learned.skipped, []);
});

test('CE9 事件 → 回合 → 事件 來回一致；單一方案與選了未展示方案的事件不成回合', () => {
  const rounds = fixtureRounds(REPLAY_PERSONAS[0], 'a', 3);
  const events = rounds.flatMap(roundToEvents);
  const rebuilt = roundsFromEvents(events, 'a');
  assert.deepEqual(rebuilt.map(round => round.chosenIndex), rounds.map(round => round.chosenIndex));

  const single = roundToEvents({ ...rounds[0], requestId: 'single', features: [rounds[0].features[0]], chosenIndex: 0 });
  const stray = roundToEvents({ ...rounds[1], requestId: 'stray' });
  stray[1].plan = { planId: 'not-displayed', variantId: 'x' };
  assert.deepEqual(roundsFromEvents([...single, ...stray], 'a'), []);
});

test('PS1 情境可重現、互不重複，且不會把學分壓到下限以下', () => {
  const first = buildScenarios({ targetCreditsMax: 12 }, { seed: 9007 });
  const second = buildScenarios({ targetCreditsMax: 12 }, { seed: 9007 });
  assert.deepEqual(first, second);
  assert.equal(new Set(first.map(item => item.scenarioId)).size, first.length);
  assert.ok(first.every(item => item.input.maxCredits === undefined || item.input.maxCredits >= 9));
  assert.equal(buildScenarios({ targetCreditsMax: 25 }, { seed: 1 }).length, 273);
});

test('PS2 模型回覆解析：格式不合或選了不存在的方案回 null，不補猜', () => {
  assert.deepEqual(parseChoice('{"choice":"B","reason":"課比較集中"}', 3), { index: 1, reason: '課比較集中' });
  assert.deepEqual(parseChoice('好的：{"choice":"方案 a","reason":""}', 2), { index: 0, reason: '' });
  assert.equal(parseChoice('{"choice":"C","reason":"x"}', 2), null);
  assert.equal(parseChoice('我選 B', 3), null);
  assert.equal(parseChoice('{choice: B}', 3), null);
});

test('PS3 方案描述不洩漏方案名稱、主軸與系統分數', () => {
  const text = describePlan({
    id: 'personalized_easy',
    title: '涼課與高分優先',
    preferenceScore: 0.9,
    preferenceBreakdown: { interest: 0, compact: 0.4, easy: 0.5 },
    generationPolicy: { archetype: 'easy' },
    totalCredits: 3,
    schedule: [{
      name: '資料庫系統', category: '必修', credits: 3, dayOfWeek: 2, startPeriod: 2, endPeriod: 4,
      instructor: '王老師', hasMidterm: false, reviewEvidence: { avgCoolness: 4.2, avgWorkload: 1.8 },
    }],
  }, 'A');
  assert.match(text, /方案 A（共 3 學分，1 天有課）/);
  assert.match(text, /資料庫系統｜必修｜3 學分｜週二 2-4節｜王老師｜無期中考｜評價（1～5）：涼度 4\.2、負擔 1\.8/);
  assert.doesNotMatch(text, /personalized|涼課與高分優先|archetype|0\.9/);
});

test('PS4 顯式方向、方案簽章與洗牌', () => {
  assert.deepEqual(explicitDirection({ preferCompact: true, preferChallengingCourses: true }), { interest: 0, compact: 1, easy: -1 });
  assert.deepEqual(explicitDirection({ preferEasy: true }), { interest: 0, compact: 0, easy: 1 });
  const planA = { schedule: [{ sectionId: 2 }, { sectionId: 1 }] };
  const planB = { schedule: [{ sectionId: 3 }] };
  assert.equal(querySignature([planA, planB]), querySignature([planB, { schedule: [{ sectionId: 1 }, { sectionId: 2 }] }]));
  assert.deepEqual(shuffled([1, 2, 3, 4], 9), shuffled([1, 2, 3, 4], 9));
  assert.deepEqual([...shuffled([1, 2, 3, 4], 9)].sort(), [1, 2, 3, 4]);
});
