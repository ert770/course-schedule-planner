// 測試用 Persona（user_id 9001～9010）的同意紀錄初始化。
//
// 沒有服務處理同意就不能排課；沒有個人化學習同意就不會收集互動事件。這 10 位是
// 組員建立的測試人物，不是真實使用者，所以由 seed 代為寫入，`source` 標成
// `persona_seed` 以便日後與真人在隱私中心做的決定區分。
//
// 預設只做 dry-run。正式修改 shared MySQL 必須同時傳入
// --apply 與 --confirm-shared-mysql。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { v5 as uuidv5 } from 'uuid';

import { closePool, queryRows, withTransaction } from '../src/db/mysql.js';
import { DEMO_UUID_NAMESPACE } from '../src/data/demoPersonas.js';
import { PRIVACY_POLICY_VERSION, PRIVACY_PURPOSES } from '../src/data/privacyPolicy.js';
import { deriveSubjectId, toMysqlDate } from '../src/services/privacyService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env'), quiet: true });

const flags = new Set(process.argv.slice(2));
const apply = flags.has('--apply');
const confirmed = flags.has('--confirm-shared-mysql');

const CONSENT_SOURCE = 'persona_seed';
const PERSONA_USER_IDS = Object.freeze(Array.from({ length: 10 }, (_, index) => 9001 + index));
const PURPOSES = Object.freeze([
  PRIVACY_PURPOSES.SERVICE_PROCESSING,
  PRIVACY_PURPOSES.PERSONALIZATION_LEARNING,
]);

// subject_id 由登入身分的 canonical id 推導；有學號時 canonical id 就是學號
// （與 `demoPersonaCanonicalId()` 同一規則），所以帳號清單必須先有這 10 筆。
function loadAccounts() {
  const usersPath = path.resolve(__dirname, '..', 'data', 'users.json');
  const users = JSON.parse(fs.readFileSync(usersPath, 'utf8'));
  return PERSONA_USER_IDS.map(userId => {
    const account = users.find(user => Number(user.id) === userId);
    if (!account?.studentId) throw new Error(`帳號清單缺少 user_id=${userId} 的學號`);
    return { userId, studentId: String(account.studentId) };
  });
}

async function buildPayloads() {
  const payloads = [];
  for (const account of loadAccounts()) {
    const [profile] = await queryRows(
      'SELECT user_id, name FROM User_Profiles WHERE user_id = ?',
      [account.userId]
    );
    if (!profile) throw new Error(`User_Profiles.user_id=${account.userId} 不存在`);
    const subjectId = deriveSubjectId(account.studentId);
    const existing = await queryRows(
      'SELECT purpose, granted, source FROM Privacy_Consents WHERE subject_id = ? ORDER BY recorded_sequence',
      [subjectId]
    );
    if (existing.some(row => row.source !== CONSENT_SOURCE)) {
      throw new Error(`user ${account.userId} 已有非本 seed 的同意紀錄，拒絕代為改寫`);
    }
    payloads.push({ ...account, name: profile.name, subjectId, existing });
  }
  return payloads;
}

async function applyPayloads(payloads, now) {
  await withTransaction(async connection => {
    for (const payload of payloads) {
      await connection.execute(
        `INSERT INTO Privacy_Subject_State
          (subject_id, last_active_at, service_withdrawn_at, created_at, updated_at)
         VALUES (?, ?, NULL, ?, ?)
         ON DUPLICATE KEY UPDATE
          last_active_at = VALUES(last_active_at), service_withdrawn_at = NULL,
          updated_at = VALUES(updated_at)`,
        [payload.subjectId, toMysqlDate(now), toMysqlDate(now), toMysqlDate(now)]
      );
      for (const purpose of PURPOSES) {
        await connection.execute(
          `INSERT INTO Privacy_Consents
            (consent_id, subject_id, purpose, granted, policy_version, decided_at, source, request_id)
           VALUES (?, ?, ?, 1, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
            granted = VALUES(granted), policy_version = VALUES(policy_version),
            decided_at = VALUES(decided_at), source = VALUES(source), request_id = VALUES(request_id)`,
          [
            uuidv5(`persona-${payload.userId}-consent-${purpose}`, DEMO_UUID_NAMESPACE),
            payload.subjectId, purpose, PRIVACY_POLICY_VERSION, toMysqlDate(now),
            CONSENT_SOURCE, `persona-${payload.userId}`,
          ]
        );
      }
    }
  });
}

async function run() {
  const payloads = await buildPayloads();
  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'dry-run',
    policyVersion: PRIVACY_POLICY_VERSION,
    purposes: PURPOSES,
    personas: payloads.map(payload => ({
      userId: payload.userId,
      name: payload.name,
      studentId: payload.studentId,
      existingConsentRows: payload.existing.length,
      willWrite: PURPOSES.length,
    })),
  }, null, 2));

  if (!apply) return;
  if (!confirmed) throw new Error('修改 shared MySQL 前必須加上 --confirm-shared-mysql');
  await applyPayloads(payloads, new Date());
  const verification = [];
  for (const payload of payloads) {
    const rows = await queryRows(
      'SELECT purpose, granted, source FROM Privacy_Consents WHERE subject_id = ? ORDER BY purpose',
      [payload.subjectId]
    );
    verification.push({ userId: payload.userId, consents: rows });
  }
  console.log(JSON.stringify({ applied: true, verification }, null, 2));
}

run().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
}).finally(() => closePool());
