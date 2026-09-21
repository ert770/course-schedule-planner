import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  USE_LEARNED_PREFERENCE_DEFAULT,
  mergePersonalizationPreferences,
  readPersonalizationPreferences,
} from '../src/data/personalizationPreferences.js';
import { mergeInterestPreferences } from '../src/data/interestPreferences.js';
import { normalizeProfile } from '../src/data/profileSchema.js';

// Roadmap #10 任務 3A：個人化學習的使用者開關。
// **3A 只負責定義與持久化，不讓它生效**——真正接上
// `getSchedulingPreferenceWeights()` 是 3B 的事（見 preferenceLearningService.test.js
// 的對應測試，那裡釘住「現在還沒被消費」）。
describe('#10 任務 3A useLearnedPreference 的讀寫與合併', () => {
  test('預設開啟；存過 false 之後讀得回 false', () => {
    assert.equal(readPersonalizationPreferences({}).useLearnedPreference, USE_LEARNED_PREFERENCE_DEFAULT);
    assert.equal(
      readPersonalizationPreferences({
        preferencesJson: { schemaVersion: 1, values: { useLearnedPreference: false } },
      }).useLearnedPreference,
      false
    );
  });

  test('非布林值一律退回預設，不做型別轉換', () => {
    for (const value of ['false', 0, null, 'true', 1, {}]) {
      assert.equal(
        readPersonalizationPreferences({
          preferencesJson: { schemaVersion: 1, values: { useLearnedPreference: value } },
        }).useLearnedPreference,
        USE_LEARNED_PREFERENCE_DEFAULT,
        `${JSON.stringify(value)} 不該被當成布林值`
      );
    }
  });

  test('updates 沒帶這個欄位時完全不動它', () => {
    const stored = { schemaVersion: 1, values: { useLearnedPreference: false, interests: ['AI'] } };
    const merged = mergePersonalizationPreferences(stored, { interests: ['資安'] });
    assert.equal(merged.values.useLearnedPreference, false);
  });

  test('只改興趣不會洗掉開關；只改開關不會洗掉興趣', () => {
    const withInterest = mergeInterestPreferences({ schemaVersion: 1, values: {} }, { interests: ['AI'] });
    const withSwitch = mergePersonalizationPreferences(withInterest, { useLearnedPreference: false });
    assert.deepEqual(withSwitch.values.interests, ['AI']);
    assert.equal(withSwitch.values.useLearnedPreference, false);

    // 之後只更新興趣（memoryService 會把兩個 merger 串起來）。
    const afterInterestUpdate = mergePersonalizationPreferences(
      mergeInterestPreferences(withSwitch, { interests: ['資安'] }),
      { interests: ['資安'] }
    );
    assert.deepEqual(afterInterestUpdate.values.interests, ['資安']);
    assert.equal(afterInterestUpdate.values.useLearnedPreference, false);

    // 之後只更新開關。
    const afterSwitchUpdate = mergePersonalizationPreferences(
      mergeInterestPreferences(afterInterestUpdate, {}),
      { useLearnedPreference: true }
    );
    assert.deepEqual(afterSwitchUpdate.values.interests, ['資安']);
    assert.equal(afterSwitchUpdate.values.useLearnedPreference, true);
  });

  test('preferences_json 的其他鍵不受影響', () => {
    const stored = { schemaVersion: 1, values: { somethingElse: 'keep-me' } };
    const merged = mergePersonalizationPreferences(stored, { useLearnedPreference: false });
    assert.equal(merged.values.somethingElse, 'keep-me');
    assert.equal(merged.schemaVersion, 1);
  });

  test('normalizeProfile 把開關攤到 profile 頂層，預設為 true', () => {
    assert.equal(normalizeProfile({ userId: 'D1249697' }).useLearnedPreference, true);
    assert.equal(
      normalizeProfile({
        userId: 'D1249697',
        preferencesJson: { schemaVersion: 1, values: { useLearnedPreference: false } },
      }).useLearnedPreference,
      false
    );
  });
});
