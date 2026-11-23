import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allocateUserId, UserIdRangeExhaustedError } from '../src/db/userIdAllocator.js';

// Simulated connection only: no database or real transaction is opened.
test('allocates using the supplied connection and accepts both range boundaries', async () => {
  for (const id of [5, 8999]) {
    const calls = [];
    const connection = { execute: async sql => { calls.push(sql); return [{ insertId: id }]; } };
    assert.equal(await allocateUserId(connection), id);
    assert.deepEqual(calls, ['INSERT INTO `User_Id_Allocator` () VALUES ()']);
  }
});

test('rejects out-of-range or invalid IDs so the caller can roll back', async () => {
  for (const id of [4, 9000, 0, undefined, 1.5]) {
    await assert.rejects(allocateUserId({ execute: async () => [{ insertId: id }] }), UserIdRangeExhaustedError);
  }
});

test('propagates database failures for caller rollback', async () => {
  const failure = Object.assign(new Error('database failure'), { code: 'ER_LOCK_DEADLOCK' });
  await assert.rejects(allocateUserId({ execute: async () => { throw failure; } }), error => error === failure);
  await assert.rejects(allocateUserId(null), TypeError);
});

test('simulated concurrent allocations use distinct returned IDs, including gaps', async () => {
  let next = 5;
  const connection = () => ({ execute: async () => [{ insertId: next++ }] });
  const ids = await Promise.all(Array.from({ length: 100 }, () => allocateUserId(connection())));
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(await allocateUserId({ execute: async () => [{ insertId: 150 }] }), 150);
});

test('retries only explicitly identified profile primary collisions in fresh transactions', async () => {
  const { createWithAllocatedUserId, UserIdCollisionError } = await import('../src/db/userIdAllocator.js');
  let next = 5;
  let rollbacks = 0;
  const runTransaction = async fn => {
    try { return await fn({ execute: async () => [{ insertId: next++ }] }); }
    catch (error) { rollbacks++; throw error; }
  };
  const id = await createWithAllocatedUserId(runTransaction, async (_connection, userId) => {
    if (userId === 5) throw new UserIdCollisionError();
    return userId;
  });
  assert.equal(id, 6);
  assert.equal(rollbacks, 1);
  const duplicateStudent = Object.assign(new Error('duplicate student'), { code: 'ER_DUP_ENTRY' });
  await assert.rejects(createWithAllocatedUserId(runTransaction, async () => { throw duplicateStudent; }), error => error === duplicateStudent);
  assert.equal(rollbacks, 2);
  await assert.rejects(createWithAllocatedUserId(runTransaction, async () => { throw new UserIdCollisionError(); }, { maxAttempts: 2 }), UserIdCollisionError);
  assert.equal(rollbacks, 4);
});
