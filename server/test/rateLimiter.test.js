import { beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { checkRateLimit, resetRateLimiterForTests } from '../src/utils/rateLimiter.js';

beforeEach(() => {
  resetRateLimiterForTests();
});

describe('#2 rate limiter (對抗式審查：/api/interactions 原本沒有節流)', () => {
  test('RL-1 視窗內第 limit 次呼叫仍允許，第 limit+1 次開始拒絕', () => {
    for (let i = 0; i < 5; i++) {
      assert.equal(checkRateLimit('subject-a', 5), true, `第 ${i + 1} 次應允許`);
    }
    assert.equal(checkRateLimit('subject-a', 5), false, '第 6 次應被拒絕');
  });

  test('RL-2 不同 key 各自獨立計數，互不影響', () => {
    for (let i = 0; i < 5; i++) checkRateLimit('subject-a', 5);
    assert.equal(checkRateLimit('subject-a', 5), false);
    assert.equal(checkRateLimit('subject-b', 5), true, '另一個 subject 不受影響');
  });

  test('RL-3 limit 為 0 時第一次呼叫就拒絕', () => {
    assert.equal(checkRateLimit('subject-c', 0), false);
  });
});
