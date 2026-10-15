// roadmap #32／協同過濾構想階段 8：離線比較的切分、名次與 bootstrap。
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { interestTagCatalog } from '../src/data/interestTagCatalog.js';
import { buildTagInterestSnapshot } from '../src/skills/tagInterestLearning.js';
import { bootstrapDiff, rankOf, splitOutcomes, topK } from '../scripts/lib/hybridComparison.js';

const tag = interestTagCatalog.canonicalTags.find(item => item.eligibility?.crossCourseMatchEligible === true
  && item.eligibility?.interestLearningEligible === true);
let sequence = 0;
function event(eventType, courseCode, minute, extra = {}) {
  sequence += 1;
  const course = { catalogCourseCode: courseCode, ragTag: [tag.name], category: '選修' };
  const base = {
    eventId: `e${sequence}`,
    eventType,
    timestamp: new Date(Date.UTC(2026, 9, 14, 10, minute)).toISOString(),
    course: { catalogCourseCode: courseCode },
    ...extra,
  };
  return { ...base, tagInterestSnapshot: buildTagInterestSnapshot(base, course, { resolved: true }) };
}

describe('HC：#32 離線比較', () => {
  test('HC-1 切分：結果事件依時間排序，最後 30%（至少 1 門）當測試；瀏覽與探索問卷不算結果', () => {
    const events = [
      event('course_favorited', 'A', 1),
      event('course_viewed', 'V', 2),
      event('course_favorited', 'B', 3),
      event('course_favorited', 'C', 4),
      event('course_selected', 'D', 5, { source: 'explicit_selection' }),
    ];
    const split = splitOutcomes(events);
    assert.equal(split.outcomeCount, 4);
    assert.deepEqual(split.testCodes, ['C', 'D']);
    assert.equal(split.cutoff, Date.parse(events[3].timestamp));
    assert.equal(splitOutcomes([event('course_viewed', 'V', 1)]), null);
  });

  test('HC-2 名次：同分取平均；topK 依分數再依課號', () => {
    const scores = { A: 3, B: 1, C: 1, D: 0 };
    const score = c => scores[c];
    assert.equal(rankOf('A', Object.keys(scores), score), 1);
    assert.equal(rankOf('B', Object.keys(scores), score), 2.5);
    assert.equal(rankOf('D', Object.keys(scores), score), 4);
    assert.deepEqual(topK(Object.keys(scores), score, 3), ['A', 'B', 'C']);
  });

  test('HC-3 bootstrap 可重現；全為正的差異信賴區間在 0 以上；樣本太少不給區間', () => {
    const first = bootstrapDiff([0.1, 0.2, 0.3, 0.2]);
    assert.deepEqual(bootstrapDiff([0.1, 0.2, 0.3, 0.2]), first);
    assert.ok(first.ci95[0] > 0);
    assert.equal(bootstrapDiff([0.5]).ci95, null);
  });
});
