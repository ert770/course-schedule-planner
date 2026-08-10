// Canonical user identity 與偏好標籤。
//
// 這組測試釘住兩個**實測到的資料分裂**：
//   1. 同一位學生因為前端送學號、MySQL 只收數字 user_id，而分裂成多份 profile。
//   2. Setup 送 `selectedTags`、MySQL 寫入只認 `preferenceTags`，
//      導致 `User_Profiles.preference_tags` 從未被前端更新過。

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveIdentityFrom,
  identityErrorResponse,
  isNumericId,
} from '../src/services/identityService.js';
import {
  tagsToFlags,
  flagsToTags,
  extractTags,
  isKnownTag,
  TAG_TO_FLAG,
} from '../src/data/preferenceTags.js';
import {
  findMorningPeriodEntries,
  stripMorningPeriods,
  MORNING_PERIOD,
} from '../src/utils/periods.js';

const USERS = [
  { id: 1, studentId: 'D1249697', name: '黃思瑜', className: '資訊三乙' },
];

describe('I1 canonical identity 解析', () => {
  test('I1 canonical 是學號，不是 numeric id', () => {
    const identity = resolveIdentityFrom(USERS, 'D1249697');

    assert.equal(identity.found, true);
    assert.equal(identity.canonicalId, 'D1249697');
    assert.equal(identity.numericId, '1', 'numericId 保留給 MySQL 邊界使用');
  });

  test('I1 用 numeric id 查詢也解析到同一個 canonical', () => {
    const byStudentId = resolveIdentityFrom(USERS, 'D1249697');
    const byNumericId = resolveIdentityFrom(USERS, '1');

    assert.equal(byNumericId.canonicalId, byStudentId.canonicalId);
    assert.equal(byNumericId.numericId, byStudentId.numericId);
  });

  test('I1 沒有 numeric id 的使用者標記為無法寫入 MySQL profile', () => {
    const identity = resolveIdentityFrom([{ studentId: 'X9999999' }], 'X9999999');

    assert.equal(identity.canonicalId, 'X9999999');
    assert.equal(identity.numericId, null);
    assert.equal(identity.canWriteMysqlProfile, false);
  });

  test('I1 isNumericId 只認純數字', () => {
    assert.equal(isNumericId('1'), true);
    assert.equal(isNumericId('D1249697'), false);
  });
});

describe('I2 拒絕 default 與未知使用者', () => {
  test('I2 default 不再是可用身分', () => {
    const identity = resolveIdentityFrom(USERS, 'default');

    assert.equal(identity.found, false);
    assert.equal(identityErrorResponse(identity).status, 401);
  });

  test('I2 沒帶身分回 401，查無此人回 404', () => {
    assert.equal(identityErrorResponse(resolveIdentityFrom(USERS, undefined)).status, 401);
    assert.equal(identityErrorResponse(resolveIdentityFrom(USERS, '')).status, 401);
    assert.equal(identityErrorResponse(resolveIdentityFrom(USERS, 'D0000000')).status, 404);
  });
});

describe('P1 偏好標籤與旗標對照', () => {
  test('P1 標籤推導旗標，且只展開為 true 的項目', () => {
    const flags = tagsToFlags(['#不排早八', '#不點名']);

    assert.equal(flags.noMorningClasses, true);
    assert.equal(flags.noRollCall, true);
    // **不得補 false 預設值**：合成的 false 會在合併時蓋掉使用者存的 true，
    // 那正是偏好靜默消失的成因。
    assert.equal('preferCompact' in flags, false);
  });

  test('P1 旗標轉回標籤只收 === true', () => {
    assert.deepEqual(flagsToTags({ noMorningClasses: true }), ['#不排早八']);
    assert.deepEqual(flagsToTags({ noMorningClasses: false }), []);
    assert.deepEqual(flagsToTags({ noMorningClasses: 'yes' }), []);
  });

  test('P1 #不點名 已納入正式清單', () => {
    // 先前它只存在於資料庫、不在前端清單中（稽核報告 F4），
    // 使用者看不到也改不掉。
    assert.equal(isKnownTag('#不點名'), true);
    assert.equal(TAG_TO_FLAG.get('#不點名'), 'noRollCall');
  });

  test('P1 未知標籤被丟棄，不會寫進資料庫', () => {
    assert.deepEqual(extractTags({ selectedTags: ['#不排早八', '#不存在的標籤'] }), ['#不排早八']);
  });
});

describe('P2 三種標籤欄位名都認得', () => {
  test('P2 Setup 送的 selectedTags 認得', () => {
    // **這是先前寫入失效的直接原因**：寫入函式只檢查 preferenceTags
    // 與 preferredCategories，而 Setup 送的是 selectedTags。
    assert.deepEqual(extractTags({ selectedTags: ['#不排早八'] }), ['#不排早八']);
  });

  test('P2 preferenceTags 與 preferredCategories 也認得', () => {
    assert.deepEqual(extractTags({ preferenceTags: ['#不點名'] }), ['#不點名']);
    assert.deepEqual(extractTags({ preferredCategories: ['#不點名'] }), ['#不點名']);
  });

  test('P2 只送旗標的呼叫端（AI Agent）也能推導出標籤', () => {
    assert.deepEqual(extractTags({ noMorningClasses: true }), ['#不排早八']);
  });

  test('P2 完全沒有標籤資訊時回傳 null，代表「不要更動」', () => {
    // 回空陣列會把使用者既有的標籤清空——不送不等於清除。
    assert.equal(extractTags({ department: '資訊工程學系' }), null);
  });
});

describe('C1 決策 C：第 1 節與 avoid_time 語意分離', () => {
  test('C1 08:00 解析為第 1 節，屬標籤領域', () => {
    // `findPeriodByTime` 明文規定 08:00 → 第 1 節（使用者說「避開八點」指的是早八）。
    const morning = findMorningPeriodEntries(['08:00']);

    assert.equal(morning.length, 7, '時間字串沒有星期資訊，展開為每天');
    assert.ok(morning.every(entry => entry.period === MORNING_PERIOD));
  });

  test('C1 avoid_time 剝除第 1 節後只剩第 2～14 節', () => {
    const kept = stripMorningPeriods([
      { day: 1, period: 1 },
      { day: 1, period: 3 },
      { day: 2, period: 5 },
    ]);

    assert.deepEqual(kept, [{ day: 1, period: 3 }, { day: 2, period: 5 }]);
  });

  test('C1 沒有第 1 節時原樣保留', () => {
    const input = [{ day: 3, period: 7 }];
    assert.deepEqual(stripMorningPeriods(input), input);
    assert.deepEqual(findMorningPeriodEntries(input), []);
  });
});
