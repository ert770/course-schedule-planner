import test from 'node:test';
import assert from 'node:assert/strict';
import { creditRangeFromProfile, creditRangePayload, validateCreditRange } from './creditRange.js';

test('讀取 profile：以 scheduleOptions 為先，最低不低於年級下限', () => {
  assert.deepEqual(creditRangeFromProfile({ targetCreditsMin: 9, targetCreditsMax: 25 }),
    { floor: 9, value: { min: '9', max: '25', overload: false } });
  assert.deepEqual(creditRangeFromProfile({
    targetCreditsMin: 12, targetCreditsMax: 25,
    scheduleOptions: { minCredits: 5, maxCredits: 28, allowCreditOverload: true },
  }), { floor: 12, value: { min: '12', max: '28', overload: true } });
});

test('範圍檢查', () => {
  assert.equal(validateCreditRange({ min: '12', max: '20', overload: false }, 12), null);
  assert.match(validateCreditRange({ min: '8', max: '20', overload: false }, 9), /不能低於 9/);
  assert.match(validateCreditRange({ min: '12', max: '28', overload: false }, 12), /超修/);
  assert.equal(validateCreditRange({ min: '12', max: '28', overload: true }, 12), null);
  assert.match(validateCreditRange({ min: '20', max: '15', overload: false }, 12), /不能高於/);
  assert.match(validateCreditRange({ min: '', max: '20', overload: false }, 12), /整數/);
});

test('送出內容', () => {
  assert.deepEqual(creditRangePayload({ min: '15', max: '18', overload: false }),
    { targetCreditsMax: 18, scheduleOptions: { minCredits: 15, maxCredits: 18, allowCreditOverload: false } });
});
