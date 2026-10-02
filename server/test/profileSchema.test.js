import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PROFILE_SCHEMA_VERSION,
  normalizeProfile,
  validateProfile,
} from '../src/data/profileSchema.js';
import {
  mergeSemesterPlanningPreferences,
  readSemesterPlanningPreferences,
} from '../src/data/semesterPlanningPreferences.js';

describe('P3 versioned Profile schema', () => {
  test('任意來源的 Profile 正規化為 v1 固定形狀', () => {
    const normalized = normalizeProfile({
      department: "'資訊工程學系'",
      gradeLevel: '3',
      selectedTags: ['#不排早八'],
      blockedPeriods: [{ day: 3, period: 1 }],
    });

    assert.equal(normalized.schemaVersion, PROFILE_SCHEMA_VERSION);
    assert.equal(normalized.department, '資訊工程學系');
    assert.equal(normalized.gradeLevel, 3);
    assert.deepEqual(normalized.preferenceTags, ['#不排早八']);
    assert.equal(normalized.noMorningClasses, true);
    assert.equal(validateProfile(normalized).valid, true);
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

  test('從 preferencesJson 還原並驗證興趣偏好', () => {
    const profile = normalizeProfile({
      preferencesJson: {
        schemaVersion: 1,
        values: {
          preferredTrack: '網路與安全類',
          interests: ['資安', '網路'],
        },
      },
    });

    assert.equal(profile.preferredTrack, '網路與安全類');
    assert.deepEqual(profile.interests, ['資安', '網路']);
    assert.deepEqual(profile.preferredKeywords, []);
    assert.equal(validateProfile(profile).valid, true);
  });

  test('從 preferencesJson 還原剩餘學期，更新時保留其他 values', () => {
    const stored = {
      schemaVersion: 1,
      values: { interests: ['資安'], useLearnedPreference: false, remainingSemesters: 4 },
    };
    assert.deepEqual(
      readSemesterPlanningPreferences({ preferencesJson: stored }),
      { remainingSemesters: 4 }
    );

    const updated = mergeSemesterPlanningPreferences(stored, { remainingSemesters: 2 });
    assert.equal(updated.values.remainingSemesters, 2);
    assert.deepEqual(updated.values.interests, ['資安']);
    assert.equal(updated.values.useLearnedPreference, false);

    const profile = normalizeProfile({ preferencesJson: updated });
    assert.equal(profile.remainingSemesters, 2);
    assert.equal(validateProfile(profile).valid, true);
  });
});

// v0 相容層已於 2026-09-13 整組退役。這一組測試釘住的是「退役後的行為」，
// 不是「v0 還能用」——先前 2026-09-11 的課程年級改名只掃掉三組別名中的一組
// （`grade`），另外兩組留著，造成半殘狀態且沒有任何測試發現。
// 這裡把三組一起釘死，任何人只要試圖單獨復活其中一組就會有測試失敗。
describe('P3-B v0 欄位名不再被靜默接受（相容層已退役）', () => {
  test('v0 的 grade／maxCredits／avoidTime 不再對應到 v1 欄位', () => {
    const normalized = normalizeProfile({
      grade: 3,
      maxCredits: 22,
      avoidTime: [{ day: 3, period: 1 }],
    });

    // 三個 v1 欄位都退回預設值，代表 v0 名稱確實沒有被當成輸入。
    assert.equal(normalized.gradeLevel, null);
    assert.equal(normalized.targetCreditsMax, 25);
    assert.deepEqual(normalized.blockedPeriods, []);
  });

  test('normalizeProfile 不再輸出 migrateProfileV0ToV1', async () => {
    const module = await import('../src/data/profileSchema.js');
    assert.equal(module.migrateProfileV0ToV1, undefined);
    assert.equal(module.default.migrateProfileV0ToV1, undefined);
  });
});
