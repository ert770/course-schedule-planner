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

// 課程主題問答接管線（S_tag 段）：服務層整段不 mock。
// 問答存的 interestSelections → getTagInterestProfile（真的 service，記憶體 store）
// → loadTagInterestContextSafely（排課實際呼叫的入口）→ 候選班次的 S_tag。
// 每項都有「沒勾」的對照組，差異只來自 interestSelections。
describe('STS 課程主題問答 → S_tag 服務層', () => {
  const selectable = interestTagCatalog.canonicalTags.filter(item => (
    item.eligibility?.interestLearningEligible === true && item.eligibility?.crossCourseMatchEligible === true
  ));
  const mainIds = item => new Set(item.categoryAssignments.map(path => path.mainCategoryId));
  const tagA = selectable[0];
  const tagZ = selectable.find(item => [...mainIds(item)].every(id => !mainIds(tagA).has(id)));
  const tick = item => ({
    group: 'outside', categoryId: item.categoryAssignments[0].mainCategoryId, level: 'main', mode: 'followup',
    tagIds: [item.id],
  });
  const candidates = [
    { id: 9101, ragTag: [tagA.name] },
    { id: 9102, ragTag: [tagZ.name] },
  ];
  const scores = async (prefs, loadTagInterestContextSafely) => {
    const context = await loadTagInterestContextSafely(identity, candidates, { mode: 'active', prefs });
    return {
      source: context.profileSource,
      a: context.coursesBySectionId['9101'].score ?? 0,
      z: context.coursesBySectionId['9102'].score ?? 0,
    };
  };

  test('STS1 未同意：只勾問答標籤 A，A 的課有 S_tag、Z 的課沒有；沒勾時兩門都沒有', async () => {
    const { loadTagInterestContextSafely } = await import('../src/services/scheduleService.js');
    const control = await scores({ interestSelections: [] }, loadTagInterestContextSafely);
    const ticked = await scores({ interestSelections: [tick(tagA)] }, loadTagInterestContextSafely);

    assert.equal(ticked.source, 'explicit-prior');
    assert.equal(control.a, 0);
    assert.ok(ticked.a > 0, '勾選的標籤應該讓含它的課得到 S_tag');
    assert.equal(ticked.z, control.z, '沒勾的標籤分數不變');
  });

  test('STS2 已同意：改了問答，快取的標籤興趣檔會失效，分數跟著換到新勾的標籤', async () => {
    await grantConsent();
    const { loadTagInterestContextSafely } = await import('../src/services/scheduleService.js');
    const first = await scores({ interestSelections: [tick(tagA)] }, loadTagInterestContextSafely);
    assert.equal(first.source, 'consented-learned');
    assert.ok(first.a > 0);
    assert.equal(first.z, 0);
    assert.ok(await getStoredTagInterestProfile(identity), '同意後會寫入快取');

    const changed = await scores({ interestSelections: [tick(tagZ)] }, loadTagInterestContextSafely);
    assert.equal(changed.a, 0, '取消勾選 A 後不可再沿用舊快取');
    assert.ok(changed.z > 0);
  });

  test('STS3 只選方向、沒勾標籤：S_tag 與沒選時相同（方向不計分）', async () => {
    const { loadTagInterestContextSafely } = await import('../src/services/scheduleService.js');
    const control = await scores({ interestSelections: [] }, loadTagInterestContextSafely);
    const directionOnly = await scores({
      interestSelections: [{ ...tick(tagA), tagIds: [] }],
    }, loadTagInterestContextSafely);
    assert.deepEqual({ a: directionOnly.a, z: directionOnly.z }, { a: control.a, z: control.z });
  });
});
