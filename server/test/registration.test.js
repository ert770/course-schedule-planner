import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, validateRegistration } from '../src/services/accountService.js';
import { identityMatchesUser, legacyAuthEnabled } from '../src/services/identityService.js';

const valid = { studentId: 'D8800001', name: '測試', department: '資訊工程學系', gradeLevel: 1, className: '資訊一甲', password: 'SampleTest123', confirmPassword: 'SampleTest123' };
test('Argon2id verifies correct input and rejects incorrect or invalid hashes', async () => {
  const hash = await hashPassword(valid.password);
  assert.match(hash, /^\$argon2id\$v=19\$/);
  assert.equal(await verifyPassword(hash, valid.password), true);
  assert.equal(await verifyPassword(hash, 'DifferentTest123'), false);
  assert.equal(await verifyPassword('$argon2id$invalid', valid.password), false);
  assert.notEqual(await hashPassword(valid.password), hash);
});
test('registration validates basic fields', () => {
  assert.equal(validateRegistration(valid), null);
  for (const change of [{studentId:'d1234567'}, {name:'  '}, {department:'未知'}, {gradeLevel:0}, {className:''}, {password:'short'}, {password:'Special123!'}, {password:'中文Password123'}, {confirmPassword:'different'}]) assert.ok(validateRegistration({ ...valid, ...change }));
});
test('different student numbers cannot match solely by numeric ID', () => {
  assert.equal(identityMatchesUser({ id: 8, studentId: 'D8800003' }, { found:true, canonicalId:'D8800001', numericId:'8', source:'mysql' }), false);
  assert.equal(identityMatchesUser({ id: 8 }, { found:true, canonicalId:'D8800001', numericId:'8', source:'mysql' }), false);
});
// 2026-11-23 團隊決定：非 production 預設開啟（demo／Persona 帳號在 MySQL 沒有密碼雜湊），可設 false 關閉。
test('legacy authentication is on outside production unless disabled, and forbidden in production', () => {
  const oldMode = process.env.NODE_ENV, oldFlag = process.env.ALLOW_LEGACY_JSON_AUTH;
  try {
    process.env.NODE_ENV = 'development'; delete process.env.ALLOW_LEGACY_JSON_AUTH;
    assert.equal(legacyAuthEnabled(), true);
    process.env.ALLOW_LEGACY_JSON_AUTH = 'false'; assert.equal(legacyAuthEnabled(), false);
    process.env.ALLOW_LEGACY_JSON_AUTH = 'true'; assert.equal(legacyAuthEnabled(), true);
    process.env.NODE_ENV = 'production'; assert.equal(legacyAuthEnabled(), false);
  } finally {
    if (oldMode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = oldMode;
    if (oldFlag === undefined) delete process.env.ALLOW_LEGACY_JSON_AUTH; else process.env.ALLOW_LEGACY_JSON_AUTH = oldFlag;
  }
});

test('registration inserts a new profile in the supplied transaction and reserves legacy IDs', async () => {
  const { registerStudent } = await import('../src/services/accountService.js');
  let id = 5, transactions = 0, inserted = null, rollbacks = 0;
  const deps = {
    getClassNames: async () => ['資訊一甲'],
    getAll: async () => [{ id: 5, studentId: 'D8800003' }],
    hashPassword: async () => 'encoded-hash-placeholder',
    withTransaction: async fn => {
      transactions++;
      try { return await fn({ execute: async (sql, params) => {
        if (sql.startsWith('INSERT INTO `User_Id_Allocator`')) return [{ insertId: id++ }];
        inserted = params; return [{ affectedRows: 1 }];
      } }); } catch (error) { rollbacks++; throw error; }
    },
  };
  assert.deepEqual(await registerStudent(valid, deps), { success: true });
  assert.equal(transactions, 2); assert.equal(rollbacks, 1); assert.equal(inserted[0], 6); assert.equal(inserted[1], valid.studentId);
  assert.equal(inserted.at(-2), 'encoded-hash-placeholder');
  assert.equal(JSON.parse(inserted.at(-1)).values.initialSetupStage, 'history');
  assert.equal((await registerStudent({ ...valid, studentId: 'D8800003' }, deps)).status, 409);
  assert.equal(transactions, 2);
});

test('registration propagates insert failures for transaction rollback', async () => {
  const { registerStudent } = await import('../src/services/accountService.js');
  let rolledBack = false;
  const failure = new Error('simulated insert failure');
  const deps = { getClassNames: async () => ['資訊一甲'], getAll: async () => [], hashPassword: async () => 'hash',
    withTransaction: async fn => { try { return await fn({ execute: async sql => {
      if (sql.startsWith('INSERT INTO `User_Id_Allocator`')) return [{ insertId: 6 }];
      throw failure;
    } }); } catch (error) { rolledBack = true; throw error; } },
  };
  await assert.rejects(registerStudent(valid, deps), error => error === failure);
  assert.equal(rolledBack, true);
});

 test('行政班級按年級及系所驗證，不接受合班', () => {
  for (const suffix of ['甲', '乙', '丙']) assert.equal(validateRegistration({ ...valid, className: `資訊一${suffix}` }), null);
  for (const suffix of ['甲', '乙', '丙', '丁']) assert.equal(validateRegistration({ ...valid, gradeLevel: 2, className: `資訊二${suffix}` }), null);
  assert.equal(validateRegistration({ ...valid, gradeLevel: 5, className: '資訊五丁' }), null);
  for (const value of [
    { className: '資訊一丁' }, { className: '資訊一合' },
    { className: '資訊二甲' }, { className: '電機一甲' },
    { className: '資訊一甲乙' }, { gradeLevel: 3, className: '資訊三合' },
  ]) assert.ok(validateRegistration({ ...valid, ...value }));
});
