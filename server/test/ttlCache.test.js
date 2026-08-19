import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { createTtlCache } from '../src/utils/ttlCache.js';

// 時鐘可注入，測試不必真的等待就能驗證到期行為。
function makeClock(start = 0) {
  let current = start;
  return {
    now: () => current,
    advance: (ms) => { current += ms; },
  };
}

describe('TC1-TC4 TTL promise 快取', () => {
  test('TC1 TTL 內連續呼叫兩次，producer 只執行一次', async () => {
    const clock = makeClock();
    let calls = 0;
    const getCached = createTtlCache(async () => {
      calls += 1;
      return `value-${calls}`;
    }, 1000, clock.now);

    const first = await getCached();
    const second = await getCached();

    assert.equal(calls, 1);
    assert.equal(first, 'value-1');
    assert.equal(second, 'value-1');
  });

  test('TC2 注入的 now 跨過 expiresAt 後再呼叫，producer 重新執行', async () => {
    const clock = makeClock();
    let calls = 0;
    const getCached = createTtlCache(async () => {
      calls += 1;
      return `value-${calls}`;
    }, 1000, clock.now);

    const first = await getCached();
    clock.advance(1001);
    const second = await getCached();

    assert.equal(calls, 2);
    assert.equal(first, 'value-1');
    assert.equal(second, 'value-2');
  });

  test('TC3 producer 第一次 reject，該次呼叫拋出；下一次呼叫立即重試，不快取失敗', async () => {
    const clock = makeClock();
    let calls = 0;
    const getCached = createTtlCache(async () => {
      calls += 1;
      if (calls === 1) throw new Error('boom');
      return `value-${calls}`;
    }, 1000, clock.now);

    await assert.rejects(getCached(), /boom/);
    // 沒有推進時鐘——若失敗被快取，這裡會在 TTL 內直接回傳同一個 rejection。
    const second = await getCached();

    assert.equal(calls, 2);
    assert.equal(second, 'value-2');
  });

  test('TC4 兩個呼叫在 producer 尚未 resolve 前同時發起，producer 只被呼叫一次', async () => {
    const clock = makeClock();
    let calls = 0;
    let resolveProducer;
    const getCached = createTtlCache(() => {
      calls += 1;
      return new Promise(resolve => { resolveProducer = resolve; });
    }, 1000, clock.now);

    const firstCall = getCached();
    const secondCall = getCached();

    resolveProducer('shared-value');
    const [first, second] = await Promise.all([firstCall, secondCall]);

    assert.equal(calls, 1);
    assert.equal(first, 'shared-value');
    assert.equal(second, 'shared-value');
  });

  // Codex adversarial review（2026-08-17）發現：舊實作的 rejection handler 無條件
  // `pending = null`。若第一代 producer（A）因逾時或連線錯誤跑得比 TTL 還久，
  // 新呼叫發現已過期會啟動第二代 producer（B）並取代 pending，此時 A 才姍姍來遲
  // 地 reject——舊碼會把「目前其實是 B」的 pending 一併清掉，讓後續呼叫誤以為
  // 沒有進行中的查詢而各自再起一個 producer，在資料庫本就不穩定時反而製造
  // query stampede。這則測試直接重現該時序。
  test('TC5 過期的舊 generation 在新 generation 已啟動後才 reject，不得清掉新 generation 的 pending', async () => {
    const clock = makeClock();
    let calls = 0;
    const deferreds = [];
    const getCached = createTtlCache(() => {
      calls += 1;
      let resolve;
      let reject;
      const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
      deferreds.push({ resolve, reject });
      return promise;
    }, 1000, clock.now);

    // Generation A 開始，尚未 resolve。
    const callA = getCached();
    assert.equal(calls, 1);

    // 時間推進超過 TTL，A 仍卡住未回應。
    clock.advance(1001);

    // 新呼叫發現已過期，啟動 Generation B，取代 pending。
    const callB = getCached();
    assert.equal(calls, 2);

    // A 這時才 reject（模擬比 B 晚回應的逾時錯誤）。
    deferreds[0].reject(new Error('stale generation timeout'));
    await assert.rejects(callA, /stale generation timeout/);

    // B 尚未 resolve 前的第三次呼叫，應該仍拿到同一個 pending（B），
    // 不應該因為 A 的 rejection 誤觸發第三個 producer。
    const callC = getCached();
    assert.equal(calls, 2, '不應該因為舊 generation 的 rejection 而多起一個 producer');

    deferreds[1].resolve('b-result');
    const [b, c] = await Promise.all([callB, callC]);
    assert.equal(b, 'b-result');
    assert.equal(c, 'b-result');
  });
});
