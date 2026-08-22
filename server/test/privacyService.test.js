import { beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PrivacyError,
  clearChatHistory,
  consumeDeletionIntent,
  createDeletionIntent,
  decryptChatContent,
  deriveSubjectId,
  encryptChatContent,
  getChatHistory,
  getConsentStatus,
  recordConsentChoices,
  resetPrivacyMemoryStoreForTests,
  saveChatExchange,
} from '../src/services/privacyService.js';

const identityA = { canonicalId: 'D0000001' };
const identityB = { canonicalId: 'D0000002' };
const allChoices = {
  service_processing: true,
  personalization_learning: false,
  aggregate_research: false,
};

beforeEach(() => {
  process.env.NODE_ENV = 'test';
  process.env.PRIVACY_STORE = 'memory';
  process.env.PRIVACY_ENFORCEMENT_ENABLED = 'true';
  process.env.ANALYTICS_ID_SECRET = 'test-only-analytics-secret-32-characters';
  process.env.PRIVACY_DATA_KEY_V1 = Buffer.alloc(32, 7).toString('base64');
  resetPrivacyMemoryStoreForTests();
});

describe('#33 pseudonym and encrypted chat', () => {
  test('subject ID is stable and never contains canonical ID', () => {
    const first = deriveSubjectId(identityA.canonicalId);
    assert.equal(first, deriveSubjectId(identityA.canonicalId));
    assert.match(first, /^v1:[a-f0-9]{64}$/);
    assert.equal(first.includes(identityA.canonicalId), false);
    assert.notEqual(first, deriveSubjectId(identityB.canonicalId));
  });

  test('AES-256-GCM round-trips and rejects tampering', () => {
    const encrypted = encryptChatContent('不排星期一早八');
    assert.equal(encrypted.ciphertext.includes('不排'), false);
    assert.equal(decryptChatContent(encrypted), '不排星期一早八');
    assert.throws(
      () => decryptChatContent({ ...encrypted, authTag: Buffer.alloc(16).toString('base64') }),
      err => err instanceof PrivacyError && err.code === 'CHAT_INTEGRITY_ERROR'
    );
  });
});

describe('#33 consent, isolation and deletion confirmation', () => {
  test('necessary consent defaults denied; optional choices remain false', async () => {
    const before = await getConsentStatus(identityA);
    assert.equal(before.requiresAction, true);
    const after = await recordConsentChoices(identityA, allChoices);
    assert.equal(after.requiresAction, false);
    assert.equal(after.consents.personalization_learning.granted, false);
    assert.equal(after.consents.aggregate_research.granted, false);

    const changed = await recordConsentChoices(identityA, {
      ...allChoices,
      personalization_learning: true,
    });
    assert.equal(changed.consents.personalization_learning.granted, true);
    assert.equal(changed.consents.aggregate_research.granted, false);
  });

  test('chat is isolated per subject and can be cleared without touching another subject', async () => {
    await recordConsentChoices(identityA, allChoices);
    await recordConsentChoices(identityB, allChoices);
    await saveChatExchange(identityA, 'A-user', 'A-assistant');
    await saveChatExchange(identityB, 'B-user', 'B-assistant');
    assert.deepEqual((await getChatHistory(identityA)).map(row => row.content), ['A-user', 'A-assistant']);
    assert.deepEqual((await getChatHistory(identityB)).map(row => row.content), ['B-user', 'B-assistant']);
    assert.equal((await clearChatHistory(identityA)).deletedCount, 2);
    assert.equal((await getChatHistory(identityA)).length, 0);
    assert.equal((await getChatHistory(identityB)).length, 2);
  });

  test('deletion token is scoped, short-lived and single-use', async () => {
    const intent = await createDeletionIntent(identityA);
    await assert.rejects(
      consumeDeletionIntent(identityB, intent.requestId, intent.token),
      err => err.code === 'INVALID_DELETION_INTENT'
    );
    await consumeDeletionIntent(identityA, intent.requestId, intent.token);
    await assert.rejects(
      consumeDeletionIntent(identityA, intent.requestId, intent.token),
      err => err.code === 'INVALID_DELETION_INTENT'
    );
  });
});
