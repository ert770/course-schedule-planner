import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import dotenv from 'dotenv';

dotenv.config({ quiet: true });

const mysqlOptIn = process.env.TAG_INTEREST_MYSQL_TEST === '1';
const selectedTestDb = String(process.env.TAG_INTEREST_TEST_DB_NAME ?? '').trim();
const configuredDb = String(process.env.DB_NAME ?? '').trim();
const databaseNameIsExplicitlyTest = /(^|[_-])test($|[_-])/i.test(selectedTestDb);

if (mysqlOptIn && (!selectedTestDb || selectedTestDb !== configuredDb || !databaseNameIsExplicitlyTest)) {
  throw new Error(
    '拒絕執行 MySQL 標籤興趣整合測試：DB_NAME 必須與 TAG_INTEREST_TEST_DB_NAME 完全相同，且資料庫名稱必須含獨立的 test 字樣。'
  );
}

const { isMysqlConfigured, queryRows, withTransaction, closePool } = await import('../src/db/mysql.js');
if (mysqlOptIn && !isMysqlConfigured()) {
  throw new Error('已啟用 MySQL 整合測試，但缺少 DB_HOST、DB_USER 或 DB_NAME。');
}

let testIdentity = null;
let testSubjectId = null;

if (mysqlOptIn) {
  process.env.NODE_ENV = 'test';
  process.env.PRIVACY_ENFORCEMENT_ENABLED = 'true';
  process.env.ANALYTICS_ID_SECRET = 'rag-tag-interest-mysql-test-secret-only';
  delete process.env.PRIVACY_STORE;

  const privacy = await import('../src/services/privacyService.js');
  const interactions = await import('../src/services/interactionEventService.js');
  const tagInterest = await import('../src/services/tagInterestService.js');
  const { resetPersonalization } = await import('../src/services/preferenceLearningService.js');
  const { interestTagCatalog } = await import('../src/data/interestTagCatalog.js');

  const learningTag = interestTagCatalog.canonicalTags.find(tag => (
    tag.eligibility?.interestLearningEligible === true
  ));

  if (!learningTag) {
    throw new Error('標籤目錄中找不到可學習標籤，無法執行 MySQL 整合測試。');
  }

  test('rag-tag-interest MySQL persistence: consent, event idempotency, profile recompute and cleanup', async () => {
    testIdentity = { canonicalId: `rag-tag-test-${randomUUID()}` };
    testSubjectId = privacy.deriveSubjectId(testIdentity.canonicalId);

    try {
      const consent = await privacy.recordConsentChoices(testIdentity, {
        service_processing: true,
        personalization_learning: true,
        aggregate_research: false,
      }, { source: 'integration_test', requestId: randomUUID() });

      assert.equal(consent.consents.personalization_learning.granted, true);

      const event = {
        eventType: 'interest_exploration_feedback',
        requestId: randomUUID(),
        actionId: randomUUID(),
        course: { catalogCourseCode: 'TAGTEST0001', sectionId: 990001 },
        term: { academicYear: 115, semester: 'second' },
        source: 'exploration',
        interestFeedback: { response: 'interested', canonicalTagIds: [learningTag.id] },
      };
      const tagInterestContext = {
        course: {
          sectionId: 990001,
          catalogCourseCode: 'TAGTEST0001',
          category: '選修',
          department: '資訊一甲',
          ragTag: [learningTag.name],
        },
        profile: { department: '資訊工程學系', gradeLevel: 1, className: '資訊一甲' },
      };

      const firstWrite = await interactions.recordInteractionEvents(
        testIdentity,
        [event],
        { tagInterestContext }
      );
      assert.equal(firstWrite.recorded, 1);
      assert.equal(firstWrite.results[0]?.status, 'append');

      const duplicateWrite = await interactions.recordInteractionEvents(
        testIdentity,
        [event],
        { tagInterestContext }
      );
      assert.equal(duplicateWrite.results[0]?.status, 'duplicate');

      const [persistedEventCount] = await queryRows(
        `SELECT COUNT(*) AS count
           FROM Interaction_Events
          WHERE subject_id = ? AND event_type = 'interest_exploration_feedback'`,
        [testSubjectId]
      );
      assert.equal(Number(persistedEventCount.count), 1, '同一事件只應持久化一列');

      const exportedEvents = await interactions.getInteractionEventsForExport(testIdentity);
      assert.equal(exportedEvents.length, 1);
      assert.deepEqual(exportedEvents[0].tagInterestSnapshot.evidenceTagIds, [learningTag.id]);

      const computed = await tagInterest.getTagInterestProfile(testIdentity, { prefs: {} });
      const learnedTag = computed.profile.tagInterests.find(item => item.canonicalTagId === learningTag.id);
      assert.equal(computed.consented, true);
      assert.ok(learnedTag?.positiveEvidence > 0, '探索正向回饋應進入標籤興趣檔案');

      const storedProfile = await tagInterest.getStoredTagInterestProfile(testIdentity);
      assert.equal(storedProfile?.profile.modelVersion, 'rag-tag-interest-v1');

      const [persistedProfileCount] = await queryRows(
        'SELECT COUNT(*) AS count FROM Learned_Tag_Interests WHERE subject_id = ?',
        [testSubjectId]
      );
      assert.equal(Number(persistedProfileCount.count), 1, '重算後應持久化一份 profile 快取');

      const reset = await resetPersonalization(testIdentity, { requestId: randomUUID() });
      assert.equal(reset.interactionEventsDeleted, 1);
      assert.equal(reset.tagInterestProfilesDeleted, 1);

      const [remainingEventCount] = await queryRows(
        'SELECT COUNT(*) AS count FROM Interaction_Events WHERE subject_id = ?',
        [testSubjectId]
      );
      const [remainingProfileCount] = await queryRows(
        'SELECT COUNT(*) AS count FROM Learned_Tag_Interests WHERE subject_id = ?',
        [testSubjectId]
      );
      assert.equal(Number(remainingEventCount.count), 0, '個人化重設應刪除興趣事件');
      assert.equal(Number(remainingProfileCount.count), 0, '個人化重設應刪除標籤興趣快取');
    } finally {
      await withTransaction(async connection => {
        await connection.execute('DELETE FROM Interaction_Events WHERE subject_id = ?', [testSubjectId]);
        await connection.execute('DELETE FROM Learned_Tag_Interests WHERE subject_id = ?', [testSubjectId]);
        await connection.execute('DELETE FROM Learned_Preference_Weights WHERE subject_id = ?', [testSubjectId]);
        await connection.execute('DELETE FROM Privacy_Consents WHERE subject_id = ?', [testSubjectId]);
        await connection.execute('DELETE FROM Privacy_Audit_Log WHERE subject_id = ?', [testSubjectId]);
        await connection.execute('DELETE FROM Privacy_Subject_State WHERE subject_id = ?', [testSubjectId]);
      });

      const [remaining] = await queryRows(
        'SELECT COUNT(*) AS count FROM Privacy_Subject_State WHERE subject_id = ?',
        [testSubjectId]
      );
      assert.equal(Number(remaining.count), 0, '測試結束後必須刪除合成 subject');
      testIdentity = null;
      testSubjectId = null;
    }
  });
} else {
  test('rag-tag-interest MySQL persistence integration (skipped without explicit isolated test DB)', {
    skip: '未設定 TAG_INTEREST_MYSQL_TEST=1 與獨立測試資料庫；不連線也不寫入目前資料庫',
  }, () => {});
}

after(async () => {
  // Best-effort cleanup if an assertion or connection fails after the synthetic subject was created.
  if (testSubjectId && isMysqlConfigured()) {
    try {
      await withTransaction(async connection => {
        await connection.execute('DELETE FROM Interaction_Events WHERE subject_id = ?', [testSubjectId]);
        await connection.execute('DELETE FROM Learned_Tag_Interests WHERE subject_id = ?', [testSubjectId]);
        await connection.execute('DELETE FROM Learned_Preference_Weights WHERE subject_id = ?', [testSubjectId]);
        await connection.execute('DELETE FROM Privacy_Consents WHERE subject_id = ?', [testSubjectId]);
        await connection.execute('DELETE FROM Privacy_Audit_Log WHERE subject_id = ?', [testSubjectId]);
        await connection.execute('DELETE FROM Privacy_Subject_State WHERE subject_id = ?', [testSubjectId]);
      });
    } finally {
      testIdentity = null;
      testSubjectId = null;
    }
  }
  await closePool();
});
