import test from 'node:test';
import assert from 'node:assert/strict';

import { buildMilpAxes } from '../src/skills/scheduler.js';
import { EASY_DIRECTION } from '../src/skills/scoringPolicy.js';

// 主軸訊號判定（roadmap #10 任務 1）：沒有訊號時不建模、以 no-signal 合併。
const entry = (interestScore, easyScore) => ({
  interestScore, easyScore, rated: easyScore !== null,
});

function inputs(competitive, summary = {}) {
  return { competitive, featureSummary: { hasInterestKeywords: true, fixedCount: 0, fixedDays: 0, ...summary } };
}

function basePlan({ interest = 0.2, easy = 0.5, rated = 4, usedDays = 4 } = {}) {
  return {
    preferenceBreakdown: { interest, easy },
    reviewCoverage: { rated },
    planMetrics: { usedDays },
  };
}

const axis = (axes, archetype) => axes.find(item => item.archetype === archetype);
const easyIntent = label => ({ label });

test('興趣：沒有興趣關鍵字或分數全部相同時為 no-signal', () => {
  const noKeywords = buildMilpAxes(
    inputs([entry(0.5, null), entry(0.2, null)], { hasInterestKeywords: false }),
    basePlan(), easyIntent(EASY_DIRECTION.NONE)
  );
  assert.equal(axis(noKeywords, 'interest').signal, false);
  assert.equal(axis(noKeywords, 'interest').detail, 'no-interest-keywords');

  const flat = buildMilpAxes(inputs([entry(0.3, null), entry(0.3, null)]), basePlan(), easyIntent(EASY_DIRECTION.NONE));
  assert.equal(axis(flat, 'interest').signal, false);
  assert.equal(axis(flat, 'interest').detail, 'flat-scores');

  const ok = buildMilpAxes(inputs([entry(0.9, null), entry(0.1, null)]), basePlan(), easyIntent(EASY_DIRECTION.NONE));
  assert.equal(axis(ok, 'interest').signal, true);
  assert.equal(axis(ok, 'interest').detail, null);
});

test('興趣：門檻高過池中最高分時為 no-signal，固定課的分數也算進上限', () => {
  const pool = [entry(0.30, null), entry(0.20, null)];
  const unreachable = buildMilpAxes(inputs(pool), basePlan({ interest: 0.4 }), easyIntent(EASY_DIRECTION.NONE));
  assert.equal(axis(unreachable, 'interest').signal, false);
  assert.equal(axis(unreachable, 'interest').detail, 'threshold-unreachable');
  assert.ok(Math.abs(axis(unreachable, 'interest').threshold - 0.42) < 1e-9);
  assert.ok(Math.abs(axis(unreachable, 'interest').reachableBound - 0.30) < 1e-9);

  const withFixed = buildMilpAxes(
    inputs(pool, { fixedCount: 1, fixedInterestSum: 0.9, fixedInterestMax: 0.9 }),
    basePlan({ interest: 0.4 }), easyIntent(EASY_DIRECTION.NONE)
  );
  assert.equal(axis(withFixed, 'interest').signal, true);
});

test('輕鬆：有足夠評價且分數不全相同時才有訊號，門檻沿用校準後的 baseline + 0.02', () => {
  const pool = [entry(0, 0.72), entry(0, 0.62), entry(0, 0.68), entry(0, 0.66)];
  const enough = buildMilpAxes(inputs(pool), basePlan({ easy: 0.6, rated: 4 }), easyIntent(EASY_DIRECTION.NONE));
  assert.equal(axis(enough, 'easy').signal, true);
  assert.ok(Math.abs(axis(enough, 'easy').threshold - 0.62) < 1e-9);

  // S₀ 有 8 門評價課 → 下限 4 門，池裡只有 3 門評價課時訊號不足。
  const insufficient = buildMilpAxes(inputs(pool.slice(0, 3)), basePlan({ easy: 0.6, rated: 8 }), easyIntent(EASY_DIRECTION.NONE));
  assert.equal(axis(insufficient, 'easy').signal, false);
  assert.equal(axis(insufficient, 'easy').detail, 'insufficient-rating');
});

test('輕鬆：S₀ 已是池中最涼的組合時為 no-signal，而不是門檻無解', () => {
  const pool = [entry(0, 0.72), entry(0, 0.55), entry(0, 0.61), entry(0, 0.40)];
  const axes = buildMilpAxes(inputs(pool), basePlan({ easy: 0.72, rated: 4 }), easyIntent(EASY_DIRECTION.NONE));
  assert.equal(axis(axes, 'easy').signal, false);
  assert.equal(axis(axes, 'easy').detail, 'threshold-unreachable');
  assert.ok(Math.abs(axis(axes, 'easy').threshold - 0.74) < 1e-9);

  // 固定課裡有更涼的課，平均值就有可能被拉上門檻，此時仍算有訊號。
  const withFixed = buildMilpAxes(
    inputs(pool, { fixedRatedCount: 1, fixedEasySum: 0.95, fixedEasyMax: 0.95, fixedEasyMin: 0.95 }),
    basePlan({ easy: 0.72, rated: 4 }), easyIntent(EASY_DIRECTION.NONE)
  );
  assert.equal(axis(withFixed, 'easy').signal, true);
});

test('挑戰：有足夠評價且分數不全相同時才有訊號，門檻沿用校準後的 baseline - 0.02', () => {
  const pool = [entry(0, 0.4), entry(0, 0.6), entry(0, 0.5), entry(0, 0.7)];
  const challenge = buildMilpAxes(inputs(pool), basePlan({ easy: 0.55, rated: 4 }), easyIntent(EASY_DIRECTION.CHALLENGE));
  assert.equal(axis(challenge, 'challenge').signal, true);
  assert.ok(Math.abs(axis(challenge, 'challenge').threshold - 0.53) < 1e-9);

  // S₀ 已經是池中最硬的組合：下限 0.4 仍高於門檻 0.28，無從再硬。
  const hardest = buildMilpAxes(inputs(pool), basePlan({ easy: 0.3, rated: 4 }), easyIntent(EASY_DIRECTION.CHALLENGE));
  assert.equal(axis(hardest, 'challenge').signal, false);
  assert.equal(axis(hardest, 'challenge').detail, 'threshold-unreachable');
});

test('評價數下限為 max(2, ⌈S₀ 評價課數 ÷ 2⌉)', () => {
  const pool = [entry(0, 0.3), entry(0, 0.9), entry(0, 0.6), entry(0, 0.5), entry(0, 0.4)];
  assert.equal(axis(buildMilpAxes(inputs(pool), basePlan({ rated: 5 }), easyIntent(EASY_DIRECTION.NONE)), 'easy').minRated, 3);
  assert.equal(axis(buildMilpAxes(inputs(pool), basePlan({ rated: 8 }), easyIntent(EASY_DIRECTION.NONE)), 'easy').minRated, 4);
  assert.equal(axis(buildMilpAxes(inputs(pool), basePlan({ rated: 1 }), easyIntent(EASY_DIRECTION.NONE)), 'easy').minRated, 2);
});

test('集中：固定課已佔滿可減少的天數時為 no-signal', () => {
  const pool = [entry(0, null), entry(0, null)];
  const blocked = buildMilpAxes(inputs(pool, { fixedDays: 4 }), basePlan({ usedDays: 4 }), easyIntent(EASY_DIRECTION.NONE));
  assert.equal(axis(blocked, 'compact').signal, false);
  assert.equal(axis(blocked, 'compact').detail, 'fixed-days-blocked');
  const ok = buildMilpAxes(inputs(pool, { fixedDays: 2 }), basePlan({ usedDays: 4 }), easyIntent(EASY_DIRECTION.NONE));
  assert.equal(axis(ok, 'compact').signal, true);
  assert.equal(axis(ok, 'compact').maxDays, 3);
});
