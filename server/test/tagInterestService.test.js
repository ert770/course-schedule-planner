import { beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { interestTagCatalog } from '../src/data/interestTagCatalog.js';
import {
  recordConsentChoices,
  resetPrivacyMemoryStoreForTests,
} from '../src/services/privacyService.js';
import {
  getInteractionEventsForExport,
  recordInteractionEvents,
  resetInteractionEventStoreForTests,
} from '../src/services/interactionEventService.js';
import {
  cleanupExpiredTagInterestProfiles,
  getStoredTagInterestProfile,
  getTagInterestProfile,
  recomputeTagInterestProfile,
  resetTagInterestStoreForTests,
} from '../src/services/tagInterestService.js';

process.env.NODE_ENV = 'test';
process.env.PRIVACY_STORE = 'memory';
process.env.PRIVACY_ENFORCEMENT_ENABLED = 'true';
process.env.ANALYTICS_ID_SECRET = 'tag-interest-service-test-secret-32-chars';

const identity = { canonicalId: 'D0000999' };
const tag = interestTagCatalog.canonicalTags.find(item => (
  item.eligibility?.interestLearningEligible === true
));

async function grantConsent() {
  return recordConsentChoices(identity, {
    service_processing: true,
    personalization_learning: true,
    aggregate_research: false,
  });
}

async function recordExplorationInterest() {
  return recordInteractionEvents(identity, [{
    eventType: 'interest_exploration_feedback',
    requestId: randomUUID(),
    actionId: randomUUID(),
    course: { catalogCourseCode: 'TAG1001', sectionId: 701 },
    term: { academicYear: 115, semester: 'first' },
    source: 'exploration',
    interestFeedback: { response: 'interested', canonicalTagIds: [tag.id] },
  }], {
    tagInterestContext: {
      course: {
        sectionId: 701,
        catalogCourseCode: 'TAG1001',
        category: '選修',
        department: '資訊一甲',
        ragTag: [tag.name],
      },
      profile: { department: '資訊工程學系', gradeLevel: 1, className: '資訊一甲' },
    },
  });
}

beforeEach(() => {
  resetPrivacyMemoryStoreForTests();
  resetInteractionEventStoreForTests();
  resetTagInterestStoreForTests();
});

describe('rag-tag-interest-v1 profile service', () => {
  test('未同意時保留明確先驗，但不讀取事件或寫入行為快取', async () => {
    await recordExplorationInterest();
    const result = await getTagInterestProfile(identity, {
      prefs: { interests: [tag.name] },
    });

    assert.equal(result.consented, false);
    assert.equal(result.source, 'no-consent');
    assert.equal(result.profile.tagInterests[0].prior, 1);
    assert.equal(await getStoredTagInterestProfile(identity), null);
    assert.deepEqual(await getInteractionEventsForExport(identity), [],
      '未同意時互動事件不應被 service 暴露給標籤 profile');
  });

  test('同意後從不可變事件快照重算並快取標籤興趣', async () => {
    await grantConsent();
    await recordExplorationInterest();

    const result = await getTagInterestProfile(identity, { prefs: {} });
    const interest = result.profile.tagInterests.find(item => item.canonicalTagId === tag.id);

    assert.equal(result.consented, true);
    assert.equal(result.source, 'learned');
    assert.ok(interest.positiveEvidence > 0);
    assert.ok(interest.score > 0);
    assert.equal((await getStoredTagInterestProfile(identity)).profile.modelVersion,
      'rag-tag-interest-v1');
  });

  test('cleanup 清除超過 180 天保存期限的標籤興趣快取', async () => {
    await grantConsent();
    const oldComputedAt = new Date(Date.now() - 181 * 86400000);
    await recomputeTagInterestProfile(identity, { prefs: {}, now: oldComputedAt });

    const dryRun = await cleanupExpiredTagInterestProfiles({ dryRun: true });
    assert.equal(dryRun.expiredTagInterestProfiles, 1);
    assert.ok(await getStoredTagInterestProfile(identity), 'dry run 不刪除資料');

    const applied = await cleanupExpiredTagInterestProfiles({ dryRun: false });
    assert.equal(applied.expiredTagInterestProfiles, 1);
    assert.equal(await getStoredTagInterestProfile(identity), null);
  });
});
