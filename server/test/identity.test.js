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
  identityMatchesUser,
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
import { normalizeBlockedPeriods, MORNING_PERIOD } from '../src/utils/periods.js';
import { buildScheduleConstraints } from '../src/services/constraintService.js';
import { generateSchedule } from '../src/skills/scheduler.js';
import { makeCourse } from './fixtures.js';

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

  test('I1 null 或空白學號退回各自 numeric id，不共用字串 null 身分', () => {
    const demoUsers = [
      { id: 2, studentId: null, name: '黃廷崴' },
      { id: 3, studentId: '  ', name: '陳彥齊' },
    ];

    const second = resolveIdentityFrom(demoUsers, '2');
    const third = resolveIdentityFrom(demoUsers, '3');

    assert.equal(second.canonicalId, '2');
    assert.equal(second.studentId, null);
    assert.equal(second.numericId, '2');
    assert.equal(third.canonicalId, '3');
    assert.equal(third.studentId, null);
    assert.notEqual(second.canonicalId, third.canonicalId);
    assert.equal(resolveIdentityFrom(demoUsers, 'null').found, false);
    assert.equal(identityMatchesUser(demoUsers[0], second), true);
    assert.equal(identityMatchesUser(demoUsers[1], second), false);
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

// 第 1 節（早八）由兩組**互相獨立**的設定涵蓋，可以重疊，排課時取聯集：
//
//   avoid_time  → 逐格指定星期，第 1～14 節皆可（「星期三第 1 節不要」）
//   #不排早八   → 只有第 1 節，但跨整週（「每天第一節都不要」）
//
// 這組測試釘住「兩者語意不同」。曾經一度規定第 1 節只能用標籤設定、
// `avoid_time` 讀寫時都剝掉第 1 節，那會讓「只避開某一天的早八」無法表達。
describe('C1 avoid_time 與 #不排早八 互相獨立', () => {
  const morningCourse = (id, dayOfWeek) => makeCourse(id, {
    dayOfWeek,
    startPeriod: 1,
    endPeriod: 2,
    category: '選修',
  });

  const scheduledIds = (result) => new Set(result.schedule.map(course => Number(course.id)));

  test('C1 avoid_time 保留第 1 節，不再被剝除', () => {
    const input = [{ day: 3, period: MORNING_PERIOD }, { day: 1, period: 5 }];

    assert.deepEqual(normalizeBlockedPeriods(input), input);
  });

  test('C1 只設 avoid_time 星期三第 1 節時，其他天的早八不受影響', () => {
    // 語意差異的核心：這不是「不排早八」，只是「星期三的早八不要」。
    const constraints = buildScheduleConstraints(
      { blockedPeriods: [{ day: 3, period: MORNING_PERIOD }], minCredits: 0 },
      {}
    );

    assert.equal(constraints.noMorningClasses, false, 'avoid_time 不得推導出標籤');

    const result = generateSchedule(
      [morningCourse(1, 3), morningCourse(2, 4)],
      constraints
    );
    const ids = scheduledIds(result);

    assert.ok(!ids.has(1), '星期三的早八要被擋下');
    assert.ok(ids.has(2), '星期四的早八不該被擋');
  });

  test('C1 只勾 #不排早八 時，每一天的第 1 節都排不進來', () => {
    const constraints = buildScheduleConstraints({ minCredits: 0 }, { noMorningClasses: true });

    assert.deepEqual(constraints.blockedPeriods, [], '標籤不得寫進 avoid_time');

    const result = generateSchedule(
      [morningCourse(1, 3), morningCourse(2, 4)],
      constraints
    );

    assert.equal(result.schedule.length, 0);
  });

  test('C1 兩者同時設定時取聯集，不互相抵銷', () => {
    const constraints = buildScheduleConstraints(
      { blockedPeriods: [{ day: 2, period: 6 }], minCredits: 0 },
      { noMorningClasses: true }
    );

    const result = generateSchedule(
      [
        morningCourse(1, 3),
        makeCourse(2, { dayOfWeek: 2, startPeriod: 6, endPeriod: 7 }),
        makeCourse(3, { dayOfWeek: 5, startPeriod: 8, endPeriod: 9 }),
      ],
      constraints
    );
    const ids = scheduledIds(result);

    assert.ok(!ids.has(1), '早八由標籤擋下');
    assert.ok(!ids.has(2), '星期二第 6 節由 avoid_time 擋下');
    assert.ok(ids.has(3), '兩者都沒涵蓋的時段仍可排入');
  });
});
