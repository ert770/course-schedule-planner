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

const {
  deriveSubjectId,
  recordConsentChoices,
  resetPrivacyMemoryStoreForTests,
} = await import('../src/services/privacyService.js');
const { resetInteractionEventStoreForTests } = await import('../src/services/interactionEventService.js');
const {
  recomputeLearnedWeights,
  getStoredLearnedWeights,
  deleteLearnedWeights,
  resetLearnedWeightsStoreForTests,
} = await import('../src/services/preferenceLearningService.js');
const { SUFFICIENCY_STATUS } = await import('../src/skills/preferenceLearning.js');

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
    const first = await recomputeLearnedWeights(id, { prefs: {} });
    const second = await recomputeLearnedWeights(id, { prefs: {} });
    assert.deepEqual(first, second, '同一批事件重算兩次應該逐位元相同（PL1 在 service 層的延伸）');

    const stored = await getStoredLearnedWeights(id);
    assert.deepEqual(stored.weights, second.weights);
  });
});
