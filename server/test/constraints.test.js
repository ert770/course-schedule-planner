// docs/TEST_PLAN.md 的 S11、S12、S15，以及 docs/API_SPEC.md「限制條件合併語意」。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { buildScheduleConstraints } from '../src/services/constraintService.js';

describe('S11-S12 陣列型偏好的合併語意', () => {
  const saved = {
    preferredKeywords: ['網路', '資安'],
    blockedPeriods: [{ day: 3, period: 5 }],
    mustTakeCourses: [7],
  };

  test('S11 送空陣列時退回已儲存偏好，不得清空', () => {
    // 空陣列在 JavaScript 是 truthy，用 `||` 合併會把已儲存偏好整個蓋掉。
    // 前端每次都送出本地建的空 blockedPeriods，這曾讓使用者的封鎖時段被靜默丟棄。
    const merged = buildScheduleConstraints({
      preferredKeywords: [],
      blockedPeriods: [],
      mustTakeCourseIds: [],
    }, saved);

    assert.deepEqual(merged.preferredKeywords, ['網路', '資安']);
    assert.equal(merged.blockedPeriods.length, 1);
    assert.deepEqual(merged.mustTakeCourseIds, [7]);
  });

  test('S12 送非空陣列時覆蓋已儲存偏好', () => {
    const merged = buildScheduleConstraints({ preferredKeywords: ['AI'] }, saved);

    assert.deepEqual(merged.preferredKeywords, ['AI']);
  });

  test('兩邊都沒有時回傳空陣列而非 undefined', () => {
    const merged = buildScheduleConstraints({}, {});

    assert.deepEqual(merged.preferredKeywords, []);
    assert.deepEqual(merged.blockedPeriods, []);
  });
});

describe('修課歷史只由 profile 直通', () => {
  test('courseHistory 直接取自 prefs，不接受 request 覆蓋', () => {
    const savedHistory = [
      { courseCode: 'IECS3002', passed: true },
      { courseCode: 'IECS3003', passed: false },
    ];
    const requestHistory = [{ courseCode: 'FAKE0001', passed: true }];

    const merged = buildScheduleConstraints(
      { courseHistory: requestHistory },
      { courseHistory: savedHistory }
    );

    assert.strictEqual(merged.courseHistory, savedHistory);
    assert.notStrictEqual(merged.courseHistory, requestHistory);
  });

  test('prefs 未提供 courseHistory 時回傳空陣列', () => {
    const merged = buildScheduleConstraints(
      { courseHistory: [{ courseCode: 'FAKE0001', passed: true }] },
      {}
    );

    assert.deepEqual(merged.courseHistory, []);
  });
});

describe('布林型偏好的合併語意', () => {
  test('false 是有效值，會覆蓋已儲存偏好', () => {
    const merged = buildScheduleConstraints(
      { noMorningClasses: false },
      { noMorningClasses: true }
    );

    assert.equal(merged.noMorningClasses, false);
  });

  test('未提供時退回已儲存偏好', () => {
    const merged = buildScheduleConstraints({}, { noMorningClasses: true });

    assert.equal(merged.noMorningClasses, true);
  });
});

describe('S15 mondayFree 展開', () => {
  test('展開為週一第 1-14 節封鎖', () => {
    const merged = buildScheduleConstraints({ mondayFree: true }, {});
    const monday = merged.blockedPeriods.filter(item => item.day === 1);

    assert.equal(monday.length, 14);
  });

  test('與已儲存的封鎖時段合併而非取代', () => {
    const merged = buildScheduleConstraints(
      { mondayFree: true },
      { blockedPeriods: [{ day: 3, period: 5 }] }
    );

    assert.equal(merged.blockedPeriods.length, 15);
    assert.ok(merged.blockedPeriods.some(item => item.day === 3 && item.period === 5));
  });
});

describe('本次操作狀態不從已儲存偏好回填', () => {
  test('selectedCourseIds 與 watchingCourseIds 只取 request', () => {
    const merged = buildScheduleConstraints({}, {
      selectedCourseIds: [1, 2],
      watchingCourseIds: [3],
    });

    assert.deepEqual(merged.selectedCourseIds, []);
    assert.deepEqual(merged.watchingCourseIds, []);
  });

  test('sessionAvoidances 只取 request，不從偏好回填', () => {
    const fromPrefs = buildScheduleConstraints({}, {
      sessionAvoidances: [{ sectionId: 101, reason: 'content' }],
    });
    const fromRequest = buildScheduleConstraints(
      { sessionAvoidances: [{ sectionId: 101, reason: 'content' }] }, {}
    );

    assert.deepEqual(fromPrefs.sessionAvoidances, [], '「這次不想要」不該沉澱成永久設定');
    assert.equal(fromRequest.sessionAvoidances.length, 1);
  });

  // `avoidInstructors` 是持久化的 profile 欄位，而 `pickList()` 的語意是
  // 「request 非空就覆蓋已儲存偏好」。把本次避開的教師塞進去，會把使用者
  // 存好的避開教師清單整包蓋掉。
  test('本次避開不得影響持久化的 avoidInstructors', () => {
    const merged = buildScheduleConstraints(
      { sessionAvoidances: [{ sectionId: 101, reason: 'instructor', instructor: '王大明' }] },
      { avoidInstructors: ['李小華'] }
    );

    assert.deepEqual(merged.avoidInstructors, ['李小華']);
    assert.equal(merged.sessionAvoidances.length, 1);
  });
});

describe('roadmap #5B：preferChallengingCourses 與 learnedPreference', () => {
  test('preferChallengingCourses 走既有的布林合併語意（request 覆蓋、未提供退回已存偏好）', () => {
    const fromRequest = buildScheduleConstraints(
      { preferChallengingCourses: true },
      { preferChallengingCourses: false }
    );
    assert.equal(fromRequest.preferChallengingCourses, true);

    const fromPrefs = buildScheduleConstraints({}, { preferChallengingCourses: true });
    assert.equal(fromPrefs.preferChallengingCourses, true);

    const explicitFalseOverride = buildScheduleConstraints(
      { preferChallengingCourses: false },
      { preferChallengingCourses: true }
    );
    assert.equal(explicitFalseOverride.preferChallengingCourses, false);
  });

  test('learnedPreference 從 context 直通，不與 request／偏好合併', () => {
    const learnedPreference = { applied: true, reason: 'applied', boosts: { interest: 0, compact: 0, easy: 0.4 } };
    const merged = buildScheduleConstraints({}, {}, { learnedPreference });
    assert.equal(merged.learnedPreference, learnedPreference);
  });

  test('context 沒有 learnedPreference 時為 null，不是 undefined', () => {
    const merged = buildScheduleConstraints({}, {});
    assert.equal(merged.learnedPreference, null);
  });
});

describe('畢業配額只接受後端計算結果', () => {
  test('request 與 profile 不能覆寫 graduationPlanning', () => {
    const trustedPlanning = {
      enabled: true,
      gaps: { required: 2, elective: 6, general: 4, external: 0 },
      remainingSemesters: 1,
    };
    const forgedPlanning = {
      enabled: true,
      gaps: { required: 0, elective: 99, general: 0, external: 0 },
      remainingSemesters: 8,
    };

    const merged = buildScheduleConstraints(
      { graduationPlanning: forgedPlanning },
      { graduationPlanning: forgedPlanning },
      { graduationPlanning: trustedPlanning }
    );

    assert.strictEqual(merged.graduationPlanning, trustedPlanning);
    assert.notStrictEqual(merged.graduationPlanning, forgedPlanning);
  });

  test('context 沒有資料時維持 null', () => {
    const merged = buildScheduleConstraints(
      { graduationPlanning: { enabled: true } },
      { graduationPlanning: { enabled: true } }
    );
    assert.equal(merged.graduationPlanning, null);
  });
});

// 2026-09-10：`minCredits` 的合併語意本身沒有 bug（`input.minCredits ?? prefs.targetCreditsMin`
// 一直都是對的），真正的 bug 在上游——`database.js` 曾經把 `prefs.targetCreditsMin` 寫死成
// 12，這裡收到的因此永遠是 12，不是 undefined。這組測試釘住「這一層的合併邏輯本身正確」，
// 讓迴歸只可能出現在 `database.js`（見 `databaseProfileContract.test.js` 的對應測試）。
describe('minCredits 合併：request 覆蓋已存值，缺席時原樣傳遞年級判斷的結果', () => {
  test('四年級 Profile 算出的 9 沒有被 request 蓋掉時，原樣傳遞', () => {
    const merged = buildScheduleConstraints({}, { gradeLevel: 4, targetCreditsMin: 9 });
    assert.equal(merged.minCredits, 9);
  });

  test('request 明確指定 minCredits 時覆蓋已存值（例如使用者這次要求超修門檻）', () => {
    const merged = buildScheduleConstraints({ minCredits: 15 }, { gradeLevel: 4, targetCreditsMin: 9 });
    assert.equal(merged.minCredits, 15);
  });

  test('兩邊都沒有時是 undefined，交由 scheduler.js 的 resolveMinCredits() 依年級決定，而不是這一層自己補一個數字', () => {
    const merged = buildScheduleConstraints({}, {});
    assert.equal(merged.minCredits, undefined);
  });
});
