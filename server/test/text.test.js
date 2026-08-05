// D3：`User_Profiles.department` 的實際值為 `'資訊工程學系'`——包含字面單引號字元本身。
// 任何字串比對（畢業建議的系所比對、前端系所下拉選單、路線圖 #13 的系所對照）
// 都會失敗且沒有任何錯誤訊息。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { stripWrappingQuotes, normalizeDepartment, isDepartmentInput } from '../src/utils/text.js';

describe('去除包裹引號', () => {
  test('半形單引號（D3 的實際值）', () => {
    assert.equal(stripWrappingQuotes("'資訊工程學系'"), '資訊工程學系');
  });

  test('半形雙引號與反引號', () => {
    assert.equal(stripWrappingQuotes('"資訊工程學系"'), '資訊工程學系');
    assert.equal(stripWrappingQuotes('`資訊工程學系`'), '資訊工程學系');
  });

  test('全形引號', () => {
    assert.equal(stripWrappingQuotes('「資訊工程學系」'), '資訊工程學系');
    assert.equal(stripWrappingQuotes('『資訊工程學系』'), '資訊工程學系');
    assert.equal(stripWrappingQuotes('“資訊工程學系”'), '資訊工程學系');
    assert.equal(stripWrappingQuotes('‘資訊工程學系’'), '資訊工程學系');
  });

  test('重複包裹會剝到乾淨為止', () => {
    assert.equal(stripWrappingQuotes(`"'資訊工程學系'"`), '資訊工程學系');
  });

  test('引號內外的空白一併修剪', () => {
    assert.equal(stripWrappingQuotes("  ' 資訊工程學系 '  "), '資訊工程學系');
  });

  test('乾淨的值原樣保留', () => {
    assert.equal(stripWrappingQuotes('資訊工程學系'), '資訊工程學系');
    assert.equal(stripWrappingQuotes('機械與電腦輔助工程學系'), '機械與電腦輔助工程學系');
  });

  test('不成對的引號不動，避免誤刪內容', () => {
    assert.equal(stripWrappingQuotes("'資訊工程學系"), "'資訊工程學系");
    assert.equal(stripWrappingQuotes('資訊工程學系"'), '資訊工程學系"');
    assert.equal(stripWrappingQuotes("O'Brien"), "O'Brien");
  });

  test('引號屬於內容的一部分時不剝除', () => {
    // 首尾雖然都是單引號，但剝除後內部仍有引號，代表是內容而非包裹。
    assert.equal(stripWrappingQuotes("'甲' 與 '乙'"), "'甲' 與 '乙'");
  });

  test('非字串原樣回傳', () => {
    assert.equal(stripWrappingQuotes(null), null);
    assert.equal(stripWrappingQuotes(undefined), undefined);
    assert.equal(stripWrappingQuotes(123), 123);
  });
});

describe('系所名稱正規化', () => {
  test('去除引號並修剪空白', () => {
    assert.equal(normalizeDepartment("'資訊工程學系'"), '資訊工程學系');
    assert.equal(normalizeDepartment('  電機工程學系  '), '電機工程學系');
  });

  test('null 與 undefined 回傳 null，不會變成 "null"', () => {
    assert.equal(normalizeDepartment(null), null);
    assert.equal(normalizeDepartment(undefined), null);
  });

  test('不做型別強制轉換，錯誤型別一律為 null', () => {
    // String() 轉換會產生看起來正常的髒值：物件變 "[object Object]"、
    // 陣列變 "資訊工程學系,電機工程學系"、數字變 "123"，寫進資料庫後
    // 在 API 回應中都像一般字串，但所有系所比對都會失敗。
    for (const value of [{}, { name: '資訊工程學系' }, ['資訊工程學系', '電機工程學系'], 123, true, false, () => {}]) {
      assert.equal(normalizeDepartment(value), null, JSON.stringify(value));
    }
  });
});

describe('系所寫入值檢查', () => {
  test('非空字串才可寫入', () => {
    assert.equal(isDepartmentInput('資訊工程學系'), true);
    assert.equal(isDepartmentInput("'資訊工程學系'"), true);
  });

  test('錯誤型別一律拒絕', () => {
    for (const value of [{}, ['資訊工程學系'], 123, true, null, undefined]) {
      assert.equal(isDepartmentInput(value), false, JSON.stringify(value));
    }
  });

  test('空字串與只有引號或空白的值一律拒絕', () => {
    // `User_Profiles.department` 為 NOT NULL，空值不是合法輸入。
    for (const value of ['', '   ', "''", '「」', '  ""  ']) {
      assert.equal(isDepartmentInput(value), false, JSON.stringify(value));
    }
  });
});

describe('D3 效果：系所比對', () => {
  test('未正規化時比對失敗，正規化後成立', () => {
    const rawFromDb = "'資訊工程學系'";
    const selectOptionValue = '資訊工程學系';

    assert.notEqual(rawFromDb, selectOptionValue, '這正是 D3 造成靜默失效的原因');
    assert.equal(normalizeDepartment(rawFromDb), selectOptionValue);
  });
});
