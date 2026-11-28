// 2026-11-28：學分上下限在設定頁、首頁與聊天共用同一份資料。
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeScheduleOptions, syncCreditLimit } from '../src/data/scheduleOptions.js';
import { buildScheduleConstraints } from '../src/services/constraintService.js';
import { buildSystemPrompt, describeCreditTarget } from '../src/services/promptService.js';

describe('CR1 學分設定', () => {
  test('超修旗標存在 scheduleOptions，上限依它放寬到 30', () => {
    assert.deepEqual(normalizeScheduleOptions({ allowCreditOverload: true }), { allowCreditOverload: true });
    const prefs = { targetCreditsMax: 28, targetCreditsMin: 12, scheduleOptions: { allowCreditOverload: true } };
    assert.equal(buildScheduleConstraints({}, prefs).maxCredits, 28);
    assert.equal(buildScheduleConstraints({}, { ...prefs, scheduleOptions: {} }).maxCredits, 25);
  });

  test('兩個學分上限欄位保持一致，後寫的值生效', () => {
    assert.deepEqual(syncCreditLimit({ scheduleOptions: { maxCredits: 18 } }),
      { scheduleOptions: { maxCredits: 18 }, targetCreditsMax: 18 });
    assert.deepEqual(syncCreditLimit({ targetCreditsMax: 20 }),
      { targetCreditsMax: 20, scheduleOptions: { maxCredits: null } });
    assert.deepEqual(syncCreditLimit({ preferredTrack: 'x' }), { preferredTrack: 'x' });
  });

  test('Agent 的目標學分是最高學分，最低另外列出', () => {
    assert.deepEqual(describeCreditTarget({ targetCreditsMax: 25, targetCreditsMin: 9, scheduleOptions: { maxCredits: 18, minCredits: 15 } }),
      { max: 18, min: 15 });
    assert.deepEqual(describeCreditTarget({ targetCreditsMax: 22, targetCreditsMin: 12 }), { max: 22, min: 12 });
    assert.ok(buildSystemPrompt({ targetCreditsMax: 22, targetCreditsMin: 12 })
      .includes('目標學分：22 學分（以最高學分為目標；最低 12）'));
  });
});
