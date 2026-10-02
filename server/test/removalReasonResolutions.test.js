// Agent 追問移除原因之後，把答覆套回本次避開清單。
//
// 職責分界要測得出來：`outcome` 是模型依使用者的自然語言判斷的，後端**無從核實**；
// 後端只驗證它驗證得了的三件事（section 確實待補、reason 在值域內、scope 由後端算）。
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { applyRemovalReasonResolutions } from '../src/services/agentService.js';

function planningContext(removedCourses) {
  return { removedCourses };
}

const PENDING = { sectionId: 101, reason: null, pendingReason: true };
const ANSWERED = { sectionId: 102, reason: 'time', pendingReason: false };

describe('RR1 後端驗證得了的三件事', () => {
  test('RR1 合法答覆套用，範圍交給後續由 reason 推導（這裡只帶 reason）', () => {
    const result = applyRemovalReasonResolutions(
      planningContext([PENDING]),
      [{ sectionId: 101, outcome: 'resolved', reason: 'workload' }]
    );

    assert.deepEqual(result, [{ sectionId: 101, reason: 'workload', pendingReason: false }]);
  });

  test('RR2 指向不是待補項目的 sectionId → 丟棄該筆，其餘照常', () => {
    const result = applyRemovalReasonResolutions(
      planningContext([PENDING, ANSWERED]),
      [
        { sectionId: 999, outcome: 'resolved', reason: 'workload' },
        { sectionId: 102, outcome: 'resolved', reason: 'content' },
      ]
    );

    // 102 已經有原因、不在待補清單，模型不得覆寫它。
    assert.deepEqual(result, [
      { sectionId: 101, reason: null, pendingReason: true },
      { sectionId: 102, reason: 'time', pendingReason: false },
    ]);
  });

  test('RR3 reason 不在值域內 → 丟棄該筆，維持待補', () => {
    const result = applyRemovalReasonResolutions(
      planningContext([PENDING]),
      [{ sectionId: 101, outcome: 'resolved', reason: '作業太多' }]
    );

    assert.deepEqual(result, [{ sectionId: 101, reason: null, pendingReason: true }]);
  });

  test('RR4 未知的 outcome 一律忽略', () => {
    const result = applyRemovalReasonResolutions(
      planningContext([PENDING]),
      [{ sectionId: 101, outcome: 'maybe', reason: 'workload' }]
    );

    assert.equal(result[0].pendingReason, true);
  });
});

describe('RR5 使用者不願意說明', () => {
  // 「還沒問到」與「問過了、他不想講」都是 reason === null，但前者要再問、
  // 後者不該再問。因此 declined 之後 pendingReason 必須變成 false。
  test('RR5 declined → 維持只排除該班次，但不再追問', () => {
    const result = applyRemovalReasonResolutions(
      planningContext([PENDING]),
      [{ sectionId: 101, outcome: 'declined', reason: null }]
    );

    assert.deepEqual(result, [{ sectionId: 101, reason: null, pendingReason: false }]);
  });
});

describe('RR6 沒有答覆時完全不改變既有狀態', () => {
  test('RR6 沒有規劃狀態 → 空清單', () => {
    assert.deepEqual(applyRemovalReasonResolutions(null, null), []);
    assert.deepEqual(applyRemovalReasonResolutions(planningContext([]), []), []);
  });

  test('RR6b 有移除清單但模型沒送答覆 → 原封不動帶出去', () => {
    const result = applyRemovalReasonResolutions(planningContext([PENDING, ANSWERED]), null);

    assert.deepEqual(result, [
      { sectionId: 101, reason: null, pendingReason: true },
      { sectionId: 102, reason: 'time', pendingReason: false },
    ]);
  });

  test('RR6c 答覆不是陣列時忽略，不讓整次排課失敗', () => {
    const result = applyRemovalReasonResolutions(planningContext([PENDING]), { sectionId: 101 });
    assert.equal(result[0].pendingReason, true);
  });
});
