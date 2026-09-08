// Roadmap #30：`preferenceLearningService.js` 的隱私路徑測試（PL7）。
//
// 刻意在匯入任何會讀 `.env` 的模組**之前**先清掉 DB 環境變數，逼所有東西走
// 記憶體 store——跟 `authRoutes.test.js` 同一個理由：這裡要驗證的是
// 「consent 閘門」與「刪除／讀取的資料層邏輯」本身，不需要也不該碰共用 MySQL。
// 真正對真實 MySQL 的驗證（新表建得出來、能寫能讀能刪）已經在實作階段用一次性
// 腳本對 demo 帳號與一個用完即刪的合成 subject 手動跑過，記在變更報告裡。

const DB_ENV_KEYS = ['DB_HOST', 'DB_USER', 'DB_NAME', 'DB_PASSWORD', 'DB_SSL_CA_PATH'];
for (const key of DB_ENV_KEYS) delete process.env[key];
process.env.NODE_ENV = 'test';
process.env.PRIVACY_STORE = 'memory';
process.env.PRIVACY_ENFORCEMENT_ENABLED = 'true';
process.env.ANALYTICS_ID_SECRET = 'preference-learning-service-test-secret-32chars';
process.env.PRIVACY_DATA_KEY_V1 = Buffer.alloc(32, 7).toString('base64');

const { test, describe, beforeEach } = await import('node:test');
const assert = (await import('node:assert/strict')).default;

const { randomUUID } = await import('node:crypto');

const {
  deriveSubjectId,
  recordConsentChoices,
  resetPrivacyMemoryStoreForTests,
} = await import('../src/services/privacyService.js');
const {
  resetInteractionEventStoreForTests,
  recordInteractionEvents,
  getInteractionEventsForExport,
} = await import('../src/services/interactionEventService.js');
const {
  recomputeLearnedWeights,
  getStoredLearnedWeights,
  getSchedulingPreferenceWeights,
  deleteLearnedWeights,
  resetPersonalization,
  getPersonalizationSource,
  resetLearnedWeightsStoreForTests,
  seedStaleModelVersionForTests,
} = await import('../src/services/preferenceLearningService.js');
const {
  SUFFICIENCY_STATUS,
  PREFERENCE_LEARNING_MODEL_VERSION,
  REQUIRED_USABLE_EVENT_COUNT,
} = await import('../src/skills/preferenceLearning.js');

// PL18–21（roadmap #31）用的合成事件：50 筆一致的退課理由，湊過
// `REQUIRED_USABLE_EVENT_COUNT`，讓 `sufficiency.status` 能落在 `sufficient`。
// `source: 'explicit_selection'` 是刻意選的——只有 `system_recommendation`
// 來源的事件需要對照真實曝光紀錄，這裡測的是完全無關的重設／來源標示邏輯，
// 不需要每筆都先造一次曝光（同 `interactionEvents.test.js` 的 `baseDraft()`）。
function paddingDrafts(count, reason = 'time') {
  return Array.from({ length: count }, (_, i) => ({
    eventType: 'course_withdrawn',
    requestId: randomUUID(),
    actionId: randomUUID(),
    course: { catalogCourseCode: `PL18-${i}`, sectionId: 1000 + i },
    term: { academicYear: 114, semester: 'second' },
    source: 'explicit_selection',
    feedbackReason: reason,
    versionSnapshot: { recommendationReasonVersion: null },
  }));
}

function identity(canonicalId) {
  return { canonicalId, numericId: null, studentId: canonicalId, found: true };
}

async function grantPersonalizationConsent(id) {
  await recordConsentChoices(id, {
    service_processing: true,
    personalization_learning: true,
    aggregate_research: false,
  });
}

beforeEach(() => {
  resetPrivacyMemoryStoreForTests();
  resetInteractionEventStoreForTests();
  resetLearnedWeightsStoreForTests();
});

describe('PL7 隱私路徑', () => {
  test('未同意 personalization_learning 時回 no-consent，且不寫入任何列', async () => {
    const id = identity('PL7-NO-CONSENT');
    const result = await recomputeLearnedWeights(id);
    assert.equal(result.sufficiency.status, SUFFICIENCY_STATUS.NO_CONSENT);
    assert.equal(result.weights, null);

    const stored = await getStoredLearnedWeights(id);
    assert.equal(stored, null, '沒有同意就不該有任何列可讀');
  });

  test('同意後重算會寫入一列，讀回的內容與計算結果一致', async () => {
    const id = identity('PL7-CONSENTED');
    await grantPersonalizationConsent(id);

    const result = await recomputeLearnedWeights(id, { prefs: { preferCompact: true } });
    assert.notEqual(result.sufficiency.status, SUFFICIENCY_STATUS.NO_CONSENT);

    const stored = await getStoredLearnedWeights(id);
    assert.ok(stored, '同意且算過之後應該讀得到儲存的那一列');
    assert.equal(stored.modelVersion, result.modelVersion);
    assert.deepEqual(stored.weights, result.weights);
    assert.equal(stored.sufficiency.status, result.sufficiency.status);
    assert.equal(stored.sufficiency.usableEventCount, result.sufficiency.usableEventCount);
  });

  test('刪除後這張表沒有殘留——直接用讀取路徑再查一次，不只信刪除回報的數字', async () => {
    const id = identity('PL7-DELETE');
    await grantPersonalizationConsent(id);
    await recomputeLearnedWeights(id, { prefs: {} });
    assert.ok(await getStoredLearnedWeights(id), '刪除前應該先確認資料真的存在');

    const subjectId = deriveSubjectId(id.canonicalId);
    const result = await deleteLearnedWeights(subjectId);
    assert.equal(result.learnedWeightsDeleted, 1);

    const after = await getStoredLearnedWeights(id);
    assert.equal(after, null, '刪除後不應該還讀得到');
  });

  test('重算是覆寫同一列，不是往後累加——同一個 subject 重算兩次仍只有一列', async () => {
    const id = identity('PL7-OVERWRITE');
    await grantPersonalizationConsent(id);
    // Roadmap #31：`recomputeLearnedWeights()` 現在會套用時間衰減，`now` 預設
    // 是真正的時鐘——兩次呼叫之間就算只差幾毫秒，`decay.appliedAt` 也會不同。
    // 要驗證的是「同一批事件重算兩次結果相同」這件事本身，所以固定傳入
    // 同一個 `now`，把時鐘變因素排除在外（PL1 可重播保證的前提本來就是
    // 「同一個 now」，這裡是它在 service 層的延伸）。
    const now = '2026-01-01T00:00:00.000Z';
    const first = await recomputeLearnedWeights(id, { prefs: {}, now });
    const second = await recomputeLearnedWeights(id, { prefs: {}, now });
    assert.deepEqual(first, second, '同一批事件、同一個 now 重算兩次應該逐位元相同（PL1 在 service 層的延伸）');

    const stored = await getStoredLearnedWeights(id);
    assert.deepEqual(stored.weights, second.weights);
  });
});

describe('PL18 resetPersonalization()', () => {
  test('清空學到的權重與作為其輸入的互動事件，不動顯式 Profile 的觸及範圍', async () => {
    const id = identity('PL18-RESET');
    await grantPersonalizationConsent(id);
    await recordInteractionEvents(id, paddingDrafts(50));
    await recomputeLearnedWeights(id, { prefs: { preferCompact: true } });

    assert.ok(await getStoredLearnedWeights(id), '重算後應該有已存的權重列');
    assert.ok((await getInteractionEventsForExport(id)).length >= 50, '重算後應該有互動事件');

    const result = await resetPersonalization(id);
    assert.equal(result.profilePreserved, true);
    assert.ok(result.learnedWeightsDeleted >= 1);
    assert.ok(result.interactionEventsDeleted >= 50);

    // 直接用讀取路徑再查一次，不只信刪除回報的數字——PL7-DELETE 同一套標準。
    assert.equal(await getStoredLearnedWeights(id), null, '重設後不應該還讀得到權重');
    assert.deepEqual(await getInteractionEventsForExport(id), [], '重設後不應該還讀得到事件');
  });
});

describe('PL19 getPersonalizationSource() 四態', () => {
  test('未同意 → no-consent，weights 為 null', async () => {
    const id = identity('PL19-NO-CONSENT');
    const result = await getPersonalizationSource(id, { prefs: {} });
    assert.equal(result.source, 'no-consent');
    assert.equal(result.weights, null);
    // roadmap #5B：`appliedToScheduling` 是常數旗標（學到的權重是否已接進
    // 排課決策的方案層），不隨這個人的 consent 狀態改變——即使這個人自己
    // 沒同意，全系統的排課引擎確實已經在讀學到的權重。
    assert.equal(result.appliedToScheduling, true);
  });

  test('已同意但事件不足 → insufficient，weights 等於顯式設定', async () => {
    const id = identity('PL19-INSUFFICIENT');
    await grantPersonalizationConsent(id);
    const result = await getPersonalizationSource(id, { prefs: { preferCompact: true } });
    assert.equal(result.source, 'insufficient');
    assert.deepEqual(result.weights, result.explicitProfile);
    assert.equal(result.explicitProfileEmpty, false);
  });

  test('已同意、顯式設定全空 → explicitProfileEmpty 為 true（對應冷啟動狀態）', async () => {
    const id = identity('PL19-EMPTY');
    await grantPersonalizationConsent(id);
    const result = await getPersonalizationSource(id, { prefs: {} });
    assert.equal(result.explicitProfileEmpty, true);
  });

  test('已同意、事件充足且行為指向與顯式不同 → learned', async () => {
    const id = identity('PL19-LEARNED');
    await grantPersonalizationConsent(id);
    await recordInteractionEvents(id, paddingDrafts(50, 'time')); // 全部強訊號在 compact 軸
    const result = await getPersonalizationSource(id, { prefs: {} }); // 顯式 compact = 0
    assert.equal(result.sufficiency.status, SUFFICIENCY_STATUS.SUFFICIENT);
    assert.equal(result.source, 'learned');
    assert.ok(result.weights.compact > result.explicitProfile.compact);
  });

  test('已同意、事件充足但行為沒有指向任何額外方向 → explicit', async () => {
    const id = identity('PL19-EXPLICIT');
    await grantPersonalizationConsent(id);
    // 50 筆 time 退課全部落在 compact 軸，顯式已經是 compact=1（上限），
    // 行為訊號無法把它推得更高，因此學到的值等於顯式設定本身。
    await recordInteractionEvents(id, paddingDrafts(50, 'time'));
    const result = await getPersonalizationSource(id, { prefs: { preferCompact: true } });
    assert.equal(result.sufficiency.status, SUFFICIENCY_STATUS.SUFFICIENT);
    assert.equal(result.source, 'explicit');
  });
});

describe('PL20 過期判定：沒有新事件不重算，來了新事件才重算', () => {
  test('連續呼叫兩次、中間沒有新事件，computedAt 不變；加一筆新事件後再呼叫才前進', async () => {
    const id = identity('PL20-STALE');
    await grantPersonalizationConsent(id);
    await recordInteractionEvents(id, paddingDrafts(50));

    const first = await getPersonalizationSource(id, { prefs: {} });
    assert.ok(first.computedAt, '第一次呼叫應該觸發重算並寫入 computedAt');

    const second = await getPersonalizationSource(id, { prefs: {} });
    assert.equal(second.computedAt, first.computedAt, '沒有新事件時不該重算');

    // 事件時間戳與 `computedAt` 都來自真實時鐘（毫秒精度），記憶體 store 沒有
    // I/O 等待，快到有機率落在同一毫秒——讓下一筆事件確定晚於 `first.computedAt`，
    // 不然「有新事件應該重算」這個斷言會間歇性假失敗。
    await new Promise(resolve => setTimeout(resolve, 5));
    await recordInteractionEvents(id, paddingDrafts(1, 'workload'));
    const third = await getPersonalizationSource(id, { prefs: {} });
    assert.notEqual(third.computedAt, second.computedAt, '有新事件後應該重算，computedAt 前進');
  });
});

describe('PL21 modelVersion 過期', () => {
  test('已存的舊版 modelVersion 列會被視為過期並重算成現行版本', async () => {
    const id = identity('PL21-OLD-VERSION');
    await grantPersonalizationConsent(id);
    await recordInteractionEvents(id, paddingDrafts(50));

    // 直接寫入一列舊版本號的權重，模擬 `#31` 升版（v1 → v2）前留下的列——
    // `learnPreferenceWeights()` 從不會自己產出 v1，這是唯一能造出這個狀態
    // 的方式，與 `privacyService.js` 的 `seedOutdatedConsentForTests()` 同理。
    const subjectId = deriveSubjectId(id.canonicalId);
    await seedStaleModelVersionForTests(subjectId, { modelVersion: 'preference-learning-v1' });
    const seeded = await getStoredLearnedWeights(id);
    assert.equal(seeded.modelVersion, 'preference-learning-v1', '前置：確認真的種進一列舊版本');

    const source = await getPersonalizationSource(id, { prefs: {} });
    assert.equal(source.modelVersion, PREFERENCE_LEARNING_MODEL_VERSION, '版本不符應觸發重算，讀回現行版本');

    const afterRead = await getStoredLearnedWeights(id);
    assert.equal(afterRead.modelVersion, PREFERENCE_LEARNING_MODEL_VERSION, '已存列本身也應該被覆寫成現行版本');
  });
});

describe('PL25-27 getSchedulingPreferenceWeights()（roadmap #5B）', () => {
  test('PL25 未同意 → no-consent，不觸發任何讀取或重算', async () => {
    const id = identity('PL25-NO-CONSENT');
    const result = await getSchedulingPreferenceWeights(id, { prefs: {} });
    assert.deepEqual(result, {
      applied: false, reason: 'no-consent', boosts: null, modelVersion: null, computedAt: null, sufficiency: null,
    });
  });

  test('PL25 已同意但從未算過 → absent', async () => {
    const id = identity('PL25-ABSENT');
    await grantPersonalizationConsent(id);
    const result = await getSchedulingPreferenceWeights(id, { prefs: {} });
    assert.equal(result.applied, false);
    assert.equal(result.reason, 'absent');
  });

  test('PL25 已同意但資料不足 → insufficient，且不重算', async () => {
    const id = identity('PL25-INSUFFICIENT');
    await grantPersonalizationConsent(id);
    await recomputeLearnedWeights(id, { prefs: {} }); // 0 筆事件，必然 insufficient
    const before = await getStoredLearnedWeights(id);

    const result = await getSchedulingPreferenceWeights(id, { prefs: {} });
    assert.equal(result.applied, false);
    assert.equal(result.reason, 'insufficient');

    // **這支只讀不重算**——與 getPersonalizationSource() 的差別就在這裡。
    const after = await getStoredLearnedWeights(id);
    assert.deepEqual(after, before, 'getSchedulingPreferenceWeights() 不得寫回任何一列');
  });

  test('PL26 資料充足 → applied，boosts 等於學到的值超出顯式基準的部分', async () => {
    const id = identity('PL26-APPLIED');
    await grantPersonalizationConsent(id);
    await recordInteractionEvents(id, paddingDrafts(50, 'time')); // 全部強訊號在 compact 軸
    await recomputeLearnedWeights(id, { prefs: { preferCompact: true } }); // 顯式 compact=1（先驗飽和）

    const result = await getSchedulingPreferenceWeights(id, { prefs: { preferCompact: true } });
    assert.equal(result.applied, true);
    assert.equal(result.reason, 'applied');
    // 顯式先驗已經是 1（勾了集中排課），50 筆一致證據頂多也只把學到的值頂到
    // 1，boost 因此應為 0——這正是「boost 是超出量」要保護的不回歸案例。
    assert.equal(result.boosts.compact, 0);
  });

  test('PL27 modelVersion 過期 → stale-model-version，且不重算、不覆寫已存列', async () => {
    const id = identity('PL27-STALE');
    await grantPersonalizationConsent(id);
    const subjectId = deriveSubjectId(id.canonicalId);
    await seedStaleModelVersionForTests(subjectId, { modelVersion: 'preference-learning-v1' });
    const before = await getStoredLearnedWeights(id);

    const result = await getSchedulingPreferenceWeights(id, { prefs: {} });
    assert.equal(result.applied, false);
    assert.equal(result.reason, 'stale-model-version');

    const after = await getStoredLearnedWeights(id);
    assert.deepEqual(after, before, '排課路徑讀到舊版本時不得順手重算或覆寫');
  });
});
