import crypto from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import { isMysqlConfigured, queryRows, withTransaction } from '../db/mysql.js';
import {
  PRIVACY_POLICY,
  PRIVACY_POLICY_VERSION,
  PRIVACY_PURPOSES,
  PRIVACY_RETENTION,
  isPrivacyPurpose,
} from '../data/privacyPolicy.js';

const memoryStore = {
  consents: [],
  chatMessages: [],
  audits: [],
  requests: [],
  subjects: new Map(),
};

export class PrivacyError extends Error {
  constructor(message, { status = 500, code = 'PRIVACY_ERROR' } = {}) {
    super(message);
    this.name = 'PrivacyError';
    this.status = status;
    this.code = code;
  }
}

export function isPrivacyEnforcementEnabled() {
  return process.env.PRIVACY_ENFORCEMENT_ENABLED === 'true' || process.env.NODE_ENV === 'production';
}

function useMemoryStore() {
  if (process.env.PRIVACY_STORE === 'memory') {
    if (process.env.NODE_ENV === 'production') {
      throw new PrivacyError('production 不可使用記憶體 privacy store', { code: 'PRIVACY_STORE_UNSAFE' });
    }
    return true;
  }
  return !isMysqlConfigured() && process.env.NODE_ENV === 'test';
}

function requireSecret(name, minimumLength = 32) {
  const value = process.env[name];
  if (!value || value.length < minimumLength) {
    throw new PrivacyError(`${name} 必須設定且至少 ${minimumLength} 個字元`, {
      status: 503,
      code: 'PRIVACY_CONFIGURATION_ERROR',
    });
  }
  return value;
}

function getEncryptionKey() {
  const encoded = process.env.PRIVACY_DATA_KEY_V1;
  if (!encoded) {
    throw new PrivacyError('PRIVACY_DATA_KEY_V1 尚未設定', {
      status: 503,
      code: 'PRIVACY_CONFIGURATION_ERROR',
    });
  }
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32) {
    throw new PrivacyError('PRIVACY_DATA_KEY_V1 必須是 32 bytes 的 Base64 金鑰', {
      status: 503,
      code: 'PRIVACY_CONFIGURATION_ERROR',
    });
  }
  return key;
}

export function assertPrivacyConfigured() {
  if (!isPrivacyEnforcementEnabled()) return;
  requireSecret('ANALYTICS_ID_SECRET');
  getEncryptionKey();
  if (process.env.NODE_ENV === 'production' && process.env.PRIVACY_STORE === 'memory') {
    throw new PrivacyError('production 不可使用記憶體 privacy store', { code: 'PRIVACY_STORE_UNSAFE' });
  }
  if (process.env.NODE_ENV === 'production' && !isMysqlConfigured()) {
    throw new PrivacyError('production privacy enforcement 需要 MySQL', {
      code: 'PRIVACY_STORE_UNAVAILABLE',
    });
  }
}

export function deriveSubjectId(canonicalId) {
  const canonical = String(canonicalId ?? '').trim();
  if (!canonical) throw new PrivacyError('缺少 canonical user ID', { status: 400, code: 'INVALID_IDENTITY' });
  const digest = crypto
    .createHmac('sha256', requireSecret('ANALYTICS_ID_SECRET'))
    .update(canonical, 'utf8')
    .digest('hex');
  return `v1:${digest}`;
}

export function encryptChatContent(content) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(content), 'utf8'), cipher.final()]);
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    keyVersion: 'v1',
  };
}

export function decryptChatContent(record) {
  if (record.keyVersion !== 'v1') {
    throw new PrivacyError(`不支援的聊天金鑰版本：${record.keyVersion}`, { code: 'UNKNOWN_KEY_VERSION' });
  }
  try {
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      getEncryptionKey(),
      Buffer.from(record.iv, 'base64')
    );
    decipher.setAuthTag(Buffer.from(record.authTag ?? record.auth_tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(record.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new PrivacyError('聊天資料驗證失敗，拒絕解密', { code: 'CHAT_INTEGRITY_ERROR' });
  }
}

function nowDate() {
  return new Date();
}

function toMysqlDate(value) {
  return new Date(value).toISOString().slice(0, 23).replace('T', ' ');
}

function latestByPurpose(rows) {
  const latest = {};
  for (const row of rows) {
    if (!latest[row.purpose]) {
      latest[row.purpose] = {
        purpose: row.purpose,
        granted: Boolean(row.granted),
        policyVersion: row.policyVersion ?? row.policy_version,
        decidedAt: new Date(row.decidedAt ?? row.decided_at).toISOString(),
      };
    }
  }
  return latest;
}

async function touchSubject(subjectId, connection = null, at = nowDate()) {
  if (useMemoryStore()) {
    const existing = memoryStore.subjects.get(subjectId);
    memoryStore.subjects.set(subjectId, {
      subjectId,
      createdAt: existing?.createdAt ?? at.toISOString(),
      updatedAt: at.toISOString(),
      lastActiveAt: at.toISOString(),
      serviceWithdrawnAt: existing?.serviceWithdrawnAt ?? null,
    });
    return;
  }
  const executor = connection ? connection.execute.bind(connection) : queryRows;
  await executor(
    `INSERT INTO Privacy_Subject_State
      (subject_id, last_active_at, service_withdrawn_at, created_at, updated_at)
     VALUES (?, ?, NULL, ?, ?)
     ON DUPLICATE KEY UPDATE last_active_at = VALUES(last_active_at), updated_at = VALUES(updated_at)`,
    [subjectId, toMysqlDate(at), toMysqlDate(at), toMysqlDate(at)]
  );
}

async function loadConsentRows(subjectId) {
  if (useMemoryStore()) return memoryStore.consents.filter(row => row.subjectId === subjectId).reverse();
  return queryRows(
    `SELECT purpose, granted, policy_version, decided_at, recorded_sequence
       FROM Privacy_Consents
      WHERE subject_id = ?
      ORDER BY recorded_sequence DESC`,
    [subjectId]
  );
}

export async function getConsentStatus(identity) {
  if (!isPrivacyEnforcementEnabled()) {
    return {
      enforcementEnabled: false,
      policy: PRIVACY_POLICY,
      requiresAction: false,
      consents: {},
    };
  }
  const subjectId = deriveSubjectId(identity.canonicalId);
  const consents = latestByPurpose(await loadConsentRows(subjectId));
  const service = consents[PRIVACY_PURPOSES.SERVICE_PROCESSING];
  const hasCurrentServiceConsent = Boolean(service?.granted && service.policyVersion === PRIVACY_POLICY_VERSION);
  return {
    enforcementEnabled: true,
    policy: PRIVACY_POLICY,
    requiresAction: !hasCurrentServiceConsent,
    reason: !service
      ? 'CONSENT_REQUIRED'
      : service.policyVersion !== PRIVACY_POLICY_VERSION
        ? 'CONSENT_VERSION_OUTDATED'
        : service.granted ? null : 'CONSENT_REQUIRED',
    consents,
  };
}

function normalizeChoices(choices) {
  const normalized = {};
  for (const purpose of Object.values(PRIVACY_PURPOSES)) {
    normalized[purpose] = choices?.[purpose] === true;
  }
  if (!normalized[PRIVACY_PURPOSES.SERVICE_PROCESSING]) {
    throw new PrivacyError('使用核心服務必須同意必要的 service_processing 用途', {
      status: 400,
      code: 'SERVICE_CONSENT_REQUIRED',
    });
  }
  return normalized;
}

export async function recordConsentChoices(identity, choices, { source = 'privacy_center', requestId = null } = {}) {
  const subjectId = deriveSubjectId(identity.canonicalId);
  const normalized = normalizeChoices(choices);
  const at = nowDate();
  if (useMemoryStore()) {
    await touchSubject(subjectId, null, at);
    for (const [purpose, granted] of Object.entries(normalized)) {
      memoryStore.consents.push({
        consentId: uuidv4(), subjectId, purpose, granted,
        policyVersion: PRIVACY_POLICY_VERSION, decidedAt: at.toISOString(), source, requestId,
      });
    }
  } else {
    await withTransaction(async connection => {
      await touchSubject(subjectId, connection, at);
      for (const [purpose, granted] of Object.entries(normalized)) {
        await connection.execute(
          `INSERT INTO Privacy_Consents
            (consent_id, subject_id, purpose, granted, policy_version, decided_at, source, request_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [uuidv4(), subjectId, purpose, granted, PRIVACY_POLICY_VERSION, toMysqlDate(at), source, requestId]
        );
      }
    });
  }
  return getConsentStatus(identity);
}

export async function requirePurpose(identity, purpose) {
  if (!isPrivacyPurpose(purpose)) {
    throw new PrivacyError('未知的資料用途', { status: 400, code: 'INVALID_PRIVACY_PURPOSE' });
  }
  if (!isPrivacyEnforcementEnabled()) return;
  const status = await getConsentStatus(identity);
  const consent = status.consents[purpose];
  if (!consent?.granted || consent.policyVersion !== PRIVACY_POLICY_VERSION) {
    throw new PrivacyError('尚未同意目前版本所需的資料用途', {
      status: 428,
      code: consent && consent.policyVersion !== PRIVACY_POLICY_VERSION
        ? 'CONSENT_VERSION_OUTDATED'
        : 'CONSENT_REQUIRED',
    });
  }
}

function encryptedChatRow(subjectId, role, content, createdAt) {
  const encrypted = encryptChatContent(content);
  const expiresAt = new Date(createdAt.getTime() + PRIVACY_RETENTION.rawChatDays * 86400000);
  return {
    messageId: uuidv4(), subjectId, role, ...encrypted,
    createdAt: createdAt.toISOString(), expiresAt: expiresAt.toISOString(),
  };
}

export async function saveChatExchange(identity, userContent, assistantContent) {
  await requirePurpose(identity, PRIVACY_PURPOSES.SERVICE_PROCESSING);
  const subjectId = deriveSubjectId(identity.canonicalId);
  const at = nowDate();
  const rows = [
    encryptedChatRow(subjectId, 'user', userContent, at),
    encryptedChatRow(subjectId, 'assistant', assistantContent, new Date(at.getTime() + 1)),
  ];
  if (useMemoryStore()) {
    await touchSubject(subjectId, null, at);
    memoryStore.chatMessages.push(...rows);
    return;
  }
  await withTransaction(async connection => {
    await touchSubject(subjectId, connection, at);
    for (const row of rows) {
      await connection.execute(
        `INSERT INTO Chat_Messages
          (message_id, subject_id, role, ciphertext, iv, auth_tag, key_version, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [row.messageId, subjectId, row.role, row.ciphertext, row.iv, row.authTag, row.keyVersion,
          toMysqlDate(row.createdAt), toMysqlDate(row.expiresAt)]
      );
    }
  });
}

export async function getChatHistory(identity, limit = 20) {
  await requirePurpose(identity, PRIVACY_PURPOSES.SERVICE_PROCESSING);
  const subjectId = deriveSubjectId(identity.canonicalId);
  const boundedLimit = Math.max(1, Math.min(50, Number(limit) || 20));
  let rows;
  if (useMemoryStore()) {
    const now = Date.now();
    rows = memoryStore.chatMessages
      .filter(row => row.subjectId === subjectId && new Date(row.expiresAt).getTime() > now)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, boundedLimit)
      .reverse();
  } else {
    rows = await queryRows(
      `SELECT role, ciphertext, iv, auth_tag, key_version, created_at
         FROM Chat_Messages
        WHERE subject_id = ? AND expires_at > UTC_TIMESTAMP(3)
        ORDER BY created_at DESC
        LIMIT ${boundedLimit}`,
      [subjectId]
    );
    rows.reverse();
  }
  return rows.map(row => ({
    role: row.role,
    content: decryptChatContent({
      ciphertext: row.ciphertext,
      iv: row.iv,
      authTag: row.authTag ?? row.auth_tag,
      keyVersion: row.keyVersion ?? row.key_version,
    }),
    createdAt: new Date(row.createdAt ?? row.created_at).toISOString(),
  }));
}

export async function clearChatHistory(identity) {
  const subjectId = deriveSubjectId(identity.canonicalId);
  let deletedCount;
  if (useMemoryStore()) {
    const before = memoryStore.chatMessages.length;
    memoryStore.chatMessages = memoryStore.chatMessages.filter(row => row.subjectId !== subjectId);
    deletedCount = before - memoryStore.chatMessages.length;
  } else {
    const result = await queryRows('DELETE FROM Chat_Messages WHERE subject_id = ?', [subjectId]);
    deletedCount = result.affectedRows;
  }
  await writeAudit(subjectId, 'delete', 'raw_chat', 'success', { deletedCount });
  return { deletedCount };
}

export async function markServiceWithdrawn(identity) {
  const subjectId = deriveSubjectId(identity.canonicalId);
  const at = nowDate();
  if (useMemoryStore()) {
    await touchSubject(subjectId, null, at);
    memoryStore.subjects.get(subjectId).serviceWithdrawnAt = at.toISOString();
  } else {
    await touchSubject(subjectId, null, at);
    await queryRows(
      'UPDATE Privacy_Subject_State SET service_withdrawn_at = ?, updated_at = ? WHERE subject_id = ?',
      [toMysqlDate(at), toMysqlDate(at), subjectId]
    );
  }
}

export async function writeAudit(subjectId, action, resourceType, outcome, metadata = {}, requestId = null) {
  const row = {
    auditId: uuidv4(), subjectId, action, resourceType, outcome, requestId,
    occurredAt: nowDate().toISOString(), metadata,
  };
  if (useMemoryStore()) {
    await touchSubject(subjectId);
    memoryStore.audits.push(row);
  } else {
    await touchSubject(subjectId);
    await queryRows(
      `INSERT INTO Privacy_Audit_Log
        (audit_id, subject_id, action, resource_type, outcome, request_id, occurred_at, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [row.auditId, subjectId, action, resourceType, outcome, requestId,
        toMysqlDate(row.occurredAt), JSON.stringify(metadata)]
    );
  }
}

export async function createDeletionIntent(identity) {
  const subjectId = deriveSubjectId(identity.canonicalId);
  const token = crypto.randomBytes(24).toString('base64url');
  const row = {
    requestId: uuidv4(), subjectId, requestType: 'delete_service_data',
    tokenHash: crypto.createHash('sha256').update(token).digest('hex'),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    completedAt: null, status: 'pending', createdAt: nowDate().toISOString(),
  };
  if (useMemoryStore()) {
    await touchSubject(subjectId);
    memoryStore.requests.push(row);
  } else {
    await touchSubject(subjectId);
    await queryRows(
      `INSERT INTO Privacy_Data_Requests
        (request_id, subject_id, request_type, token_hash, expires_at, completed_at, status, created_at)
       VALUES (?, ?, ?, ?, ?, NULL, 'pending', ?)`,
      [row.requestId, subjectId, row.requestType, row.tokenHash, toMysqlDate(row.expiresAt), toMysqlDate(row.createdAt)]
    );
  }
  return { requestId: row.requestId, token, expiresAt: row.expiresAt, confirmationPhrase: '刪除我的資料' };
}

export async function consumeDeletionIntent(identity, requestId, token) {
  const subjectId = deriveSubjectId(identity.canonicalId);
  const tokenHash = crypto.createHash('sha256').update(String(token ?? '')).digest('hex');
  const sameTokenHash = expected => {
    const left = Buffer.from(tokenHash, 'hex');
    const right = Buffer.from(String(expected || ''), 'hex');
    return left.length === right.length && crypto.timingSafeEqual(left, right);
  };
  if (useMemoryStore()) {
    const row = memoryStore.requests.find(item => item.requestId === requestId && item.subjectId === subjectId);
    if (!row || row.status !== 'pending' || !sameTokenHash(row.tokenHash) || new Date(row.expiresAt) <= nowDate()) {
      throw new PrivacyError('刪除確認已失效或不正確', { status: 400, code: 'INVALID_DELETION_INTENT' });
    }
    row.status = 'completed';
    row.completedAt = nowDate().toISOString();
    return;
  }
  await withTransaction(async connection => {
    const [rows] = await connection.execute(
      `SELECT token_hash, expires_at, status FROM Privacy_Data_Requests
        WHERE request_id = ? AND subject_id = ? FOR UPDATE`,
      [requestId, subjectId]
    );
    const row = rows[0];
    if (!row || row.status !== 'pending' || !sameTokenHash(row.token_hash) || new Date(row.expires_at) <= nowDate()) {
      throw new PrivacyError('刪除確認已失效或不正確', { status: 400, code: 'INVALID_DELETION_INTENT' });
    }
    await connection.execute(
      `UPDATE Privacy_Data_Requests SET status = 'completed', completed_at = ? WHERE request_id = ?`,
      [toMysqlDate(nowDate()), requestId]
    );
  });
}

export async function cleanupExpiredPrivacyData({ dryRun = true } = {}) {
  const now = nowDate();
  const auditCutoff = new Date(now.getTime() - PRIVACY_RETENTION.consentAuditAfterWithdrawalDays * 86400000);
  if (useMemoryStore()) {
    const expiredChat = memoryStore.chatMessages.filter(row => new Date(row.expiresAt) <= now).length;
    const expiredSubjects = new Set([...memoryStore.subjects.values()]
      .filter(row => row.serviceWithdrawnAt && new Date(row.serviceWithdrawnAt) <= auditCutoff)
      .map(row => row.subjectId));
    if (!dryRun) memoryStore.chatMessages = memoryStore.chatMessages.filter(row => new Date(row.expiresAt) > now);
    if (!dryRun) {
      memoryStore.consents = memoryStore.consents.filter(row => !expiredSubjects.has(row.subjectId));
      memoryStore.audits = memoryStore.audits.filter(row => !expiredSubjects.has(row.subjectId));
      memoryStore.requests = memoryStore.requests.filter(row => !expiredSubjects.has(row.subjectId));
      for (const subjectId of expiredSubjects) memoryStore.subjects.delete(subjectId);
    }
    return { mode: dryRun ? 'dry-run' : 'apply', expiredChat, expiredWithdrawnSubjects: expiredSubjects.size };
  }
  const [count] = await queryRows('SELECT COUNT(*) AS count FROM Chat_Messages WHERE expires_at <= UTC_TIMESTAMP(3)');
  const [withdrawn] = await queryRows(
    'SELECT COUNT(*) AS count FROM Privacy_Subject_State WHERE service_withdrawn_at IS NOT NULL AND service_withdrawn_at <= ?',
    [toMysqlDate(auditCutoff)]
  );
  if (!dryRun) {
    await queryRows('DELETE FROM Chat_Messages WHERE expires_at <= UTC_TIMESTAMP(3)');
    await withTransaction(async connection => {
      const cutoff = toMysqlDate(auditCutoff);
      await connection.execute('DELETE r FROM Privacy_Data_Requests r JOIN Privacy_Subject_State s ON s.subject_id = r.subject_id WHERE s.service_withdrawn_at <= ?', [cutoff]);
      await connection.execute('DELETE a FROM Privacy_Audit_Log a JOIN Privacy_Subject_State s ON s.subject_id = a.subject_id WHERE s.service_withdrawn_at <= ?', [cutoff]);
      await connection.execute('DELETE c FROM Privacy_Consents c JOIN Privacy_Subject_State s ON s.subject_id = c.subject_id WHERE s.service_withdrawn_at <= ?', [cutoff]);
      await connection.execute('DELETE FROM Privacy_Subject_State WHERE service_withdrawn_at <= ?', [cutoff]);
    });
  }
  return {
    mode: dryRun ? 'dry-run' : 'apply',
    expiredChat: Number(count.count),
    expiredWithdrawnSubjects: Number(withdrawn.count),
  };
}

export function resetPrivacyMemoryStoreForTests() {
  memoryStore.consents = [];
  memoryStore.chatMessages = [];
  memoryStore.audits = [];
  memoryStore.requests = [];
  memoryStore.subjects = new Map();
}

export function getPrivacyPolicy() {
  return PRIVACY_POLICY;
}

export default {
  assertPrivacyConfigured,
  deriveSubjectId,
  encryptChatContent,
  decryptChatContent,
  getConsentStatus,
  recordConsentChoices,
  requirePurpose,
  saveChatExchange,
  getChatHistory,
  clearChatHistory,
  markServiceWithdrawn,
  createDeletionIntent,
  consumeDeletionIntent,
  cleanupExpiredPrivacyData,
};
