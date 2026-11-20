import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { validateProfileUpdate } from '../src/data/profileUpdateValidation.js';

// `POST /api/profile` 的輸入驗證。純函式測試——路由確實有接上這些規則，
// 由真實帳號的瀏覽器實測證明（見 2026-09-20 任務 3A 變更報告的驗收紀錄）。
describe('#10 任務 3A POST /api/profile 的輸入驗證', () => {
  test('合法輸入回 null（不擋）', () => {
    assert.equal(validateProfileUpdate({}), null);
    assert.equal(validateProfileUpdate({ selectedTags: ['#不排早八'] }), null);
    assert.equal(validateProfileUpdate({ useLearnedPreference: true }), null);
    assert.equal(validateProfileUpdate({ useLearnedPreference: false }), null);
    assert.equal(validateProfileUpdate({ preferredTrack: null }), null);
    assert.equal(validateProfileUpdate({ interests: [] }), null);
    assert.equal(validateProfileUpdate({ remainingSemesters: 1 }), null);
    assert.equal(validateProfileUpdate({ remainingSemesters: 8 }), null);
    assert.equal(validateProfileUpdate({ remainingSemesters: null }), null);
  });

  test('remainingSemesters 只接受 1～8 的整數或 null', () => {
    for (const value of [0, 9, 1.5, '2', {}, []]) {
      assert.match(
        validateProfileUpdate({ remainingSemesters: value }) ?? '',
        /remainingSemesters 必須是 1～8 的整數或 null/u
      );
    }
  });

  test('useLearnedPreference 只接受布林值', () => {
    for (const value of ['false', 'true', 0, 1, null, {}, []]) {
      assert.match(
        validateProfileUpdate({ useLearnedPreference: value }) ?? '',
        /useLearnedPreference 必須是布林值/u,
        `${JSON.stringify(value)} 應該被擋下`
      );
    }
  });

  // 先前的漏洞：頂層 `useLearnedPreference` 有布林檢查，但整包 `preferencesJson`
  // 照收，送 `{ values: { useLearnedPreference: "false" } }` 就能把不合法的字串
  // 存進去，讀取時再靜默退回 true——型別檢查等於白做。
  test('preferencesJson 一律拒絕，字串不能從這條路徑繞過布林檢查', () => {
    assert.match(
      validateProfileUpdate({
        preferencesJson: { schemaVersion: 1, values: { useLearnedPreference: 'false' } },
      }) ?? '',
      /preferencesJson 不可直接更新/u
    );
  });

  test('preferencesJson 即使形狀與值都合法也拒絕（整包覆寫會洗掉其他鍵）', () => {
    assert.match(
      validateProfileUpdate({
        preferencesJson: { schemaVersion: 1, values: { useLearnedPreference: false } },
      }) ?? '',
      /preferencesJson 不可直接更新/u
    );
    assert.match(validateProfileUpdate({ preferencesJson: {} }) ?? '', /preferencesJson/u);
  });

  test('既有的陣列、字串與 department 規則維持不變', () => {
    assert.match(validateProfileUpdate({ interests: 'AI' }) ?? '', /interests 必須是陣列/u);
    assert.match(validateProfileUpdate({ mustTakeCourses: {} }) ?? '', /mustTakeCourses 必須是陣列/u);
    assert.match(validateProfileUpdate({ preferredTrack: 42 }) ?? '', /preferredTrack 必須是字串或 null/u);
    assert.match(validateProfileUpdate({ department: '' }) ?? '', /department 必須是非空字串/u);
    assert.match(validateProfileUpdate({ department: {} }) ?? '', /department 必須是非空字串/u);
  });

  test('第一個不合法的欄位決定訊息，不會把多個錯誤混在一起', () => {
    const error = validateProfileUpdate({ department: '', interests: 'AI' });
    assert.match(error, /department/u);
    assert.doesNotMatch(error, /interests/u);
  });
});

describe('Step A：interestSelections 的輸入驗證', () => {
  const ok = { group: 'outside', categoryId: 'main_x', tagIds: ['tag_1'] };

  test('IV1 合法的選擇結果通過；省略 tagIds 與空陣列都算合法（只選類別、尚未追問）', () => {
    assert.equal(validateProfileUpdate({ interestSelections: [] }), null);
    assert.equal(validateProfileUpdate({ interestSelections: [ok] }), null);
    assert.equal(validateProfileUpdate({
      interestSelections: [{ group: 'department', categoryId: 'sub_x', mode: 'direct' }],
    }), null);
  });

  test('IV2 不是陣列、項目不是物件，都在邊界擋下', () => {
    assert.match(validateProfileUpdate({ interestSelections: 'x' }) ?? '', /interestSelections 必須是陣列/u);
    assert.match(validateProfileUpdate({ interestSelections: {} }) ?? '', /interestSelections 必須是陣列/u);
    for (const item of [null, 'main_x', 5, ['main_x']]) {
      assert.match(
        validateProfileUpdate({ interestSelections: [item] }) ?? '',
        /每一筆必須是物件/u
      );
    }
  });

  test('IV3 未知組別、空 categoryId、非字串 tagIds 被擋下', () => {
    assert.match(
      validateProfileUpdate({ interestSelections: [{ ...ok, group: 'other' }] }) ?? '',
      /interestSelections\.group 必須是/u
    );
    assert.match(
      validateProfileUpdate({ interestSelections: [{ ...ok, categoryId: '  ' }] }) ?? '',
      /categoryId 必須是非空字串/u
    );
    assert.match(
      validateProfileUpdate({ interestSelections: [{ ...ok, categoryId: 5 }] }) ?? '',
      /categoryId 必須是非空字串/u
    );
    assert.match(
      validateProfileUpdate({ interestSelections: [{ ...ok, tagIds: 'tag_1' }] }) ?? '',
      /tagIds 必須是字串陣列/u
    );
    assert.match(
      validateProfileUpdate({ interestSelections: [{ ...ok, tagIds: ['tag_1', 7] }] }) ?? '',
      /tagIds 必須是字串陣列/u
    );
  });

  test('IV4 超過上限的筆數被擋下（防止異常大的請求）', () => {
    const many = Array.from({ length: 49 }, (_, i) => ({ ...ok, categoryId: `main_${i}` }));
    assert.match(validateProfileUpdate({ interestSelections: many }) ?? '', /最多 48 筆/u);
    assert.equal(validateProfileUpdate({ interestSelections: many.slice(0, 48) }), null);
  });

  test('IV5 preferencesJson 整包覆寫仍被拒絕，訊息改為列出 interestSelections 專屬欄位', () => {
    const message = validateProfileUpdate({ preferencesJson: { values: {} } }) ?? '';
    assert.match(message, /preferencesJson 不可直接更新/u);
    assert.match(message, /interestSelections/u);
  });
});
