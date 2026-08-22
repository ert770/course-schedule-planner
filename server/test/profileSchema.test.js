import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PROFILE_SCHEMA_VERSION,
  migrateProfileV0ToV1,
  normalizeProfile,
  validateProfile,
} from '../src/data/profileSchema.js';

describe('P3 versioned Profile schema', () => {
  test('v0 Profile 正規化為 v1 固定形狀', () => {
    const migrated = migrateProfileV0ToV1({
      department: "'資訊工程學系'",
      grade: '3',
      selectedTags: ['#不排早八'],
      avoidTime: [{ day: 3, period: 1 }],
    });

    assert.equal(migrated.schemaVersion, PROFILE_SCHEMA_VERSION);
    assert.equal(migrated.department, '資訊工程學系');
    assert.equal(migrated.gradeLevel, 3);
    assert.deepEqual(migrated.preferenceTags, ['#不排早八']);
    assert.equal(migrated.noMorningClasses, true);
    assert.equal(validateProfile(migrated).valid, true);
  });

  test('重複正規化不改變結果', () => {
    const once = normalizeProfile({ department: '資訊工程學系', gradeLevel: 3 });
    assert.deepEqual(normalizeProfile(once), once);
  });

  test('錯誤 schema version 會被 validator 拒絕', () => {
    const profile = normalizeProfile({});
    profile.schemaVersion = 0;
    assert.equal(validateProfile(profile).valid, false);
  });
});
