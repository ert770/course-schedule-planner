import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interestTagCatalog } from '../src/data/interestTagCatalog.js';
import { getHistoryFeedbackCourses } from '../src/services/historyFeedbackService.js';

const [a, b] = interestTagCatalog.canonicalTags
  .filter(tag => tag.eligibility?.crossCourseMatchEligible === true)
  .map(tag => tag.name);
const section = (id, code, name, ragTag) => ({
  id, sectionId: id, catalogCourseCode: code, name, ragTag, year: 114, semester: '下學期',
});
const courses = [
  section(11, 'ELEC1', '選修一', [a, b]),
  section(10, 'ELEC1', '選修一', [a, b]),
  section(12, 'GEN1', '通識一', [a]),
  section(13, 'REQ1', '必修一', [a]),
  section(14, 'NOTAG', '沒有標籤的課', []),
];
const history = (courseCode, graduationCategory, academicYear, semester, passed = true) => ({
  academicYear, semester, courseCode, courseName: courseCode, score: passed ? 85 : 40, letterGrade: null,
  credits: 3, passed, requirementType: '選修', generalEducationCategory: null, graduationCategory,
});
const profile = {
  courseHistory: [
    history('ELEC1', 'elective', 113, 1),
    history('GEN1', 'general', 113, 2),
    history('REQ1', 'required', 113, 2),
    history('NOTAG', 'elective', 112, 1),
    history('OLD1', 'external', 112, 2),
    history('FAIL1', 'elective', 113, 1, false),
  ],
};
const deps = (events = [], consented = true) => ({
  loadConsent: async () => consented,
  loadProfile: async () => profile,
  loadCourses: async () => courses,
  loadEvents: async () => events,
  now: () => Date.parse('2026-10-14T00:00:00.000Z'),
});

test('HFS-1 只列已通過的非必修課；排除沒有標籤與本學期沒開的課；學期由近到遠', async () => {
  const result = await getHistoryFeedbackCourses({ canonicalId: 'T1' }, deps());
  assert.equal(result.consented, true);
  assert.deepEqual(result.groups.map(group => `${group.academicYear}-${group.semester}`), ['113-2', '113-1']);
  assert.deepEqual(result.groups.flatMap(group => group.courses.map(course => course.courseCode)), ['GEN1', 'ELEC1']);
  assert.equal(result.groups[1].courses[0].sectionId, 10, '同課號取最小的班次 ID');
  assert.deepEqual(result.excluded, { noTags: 1, notOfferedThisTerm: 1 });
  assert.equal(result.pendingCount, 2);
});

test('HFS-2 帶出未到期事件中最後一次的回答；已回答的課不算待回答', async () => {
  const event = (code, response, timestamp) => ({
    eventType: 'history_course_feedback', timestamp,
    course: { catalogCourseCode: code }, interestFeedback: { response, canonicalTagIds: [] },
  });
  const result = await getHistoryFeedbackCourses({ canonicalId: 'T1' }, deps([
    event('ELEC1', 'liked', '2026-09-01T00:00:00.000Z'),
    event('ELEC1', 'disliked', '2026-10-01T00:00:00.000Z'),
    event('GEN1', 'liked', '2025-01-01T00:00:00.000Z'), // 已超過 180 天保存期限
  ]));
  const byCode = Object.fromEntries(result.groups.flatMap(group => group.courses).map(course => [course.courseCode, course.response]));
  assert.deepEqual(byCode, { ELEC1: 'disliked', GEN1: null });
  assert.equal(result.pendingCount, 1);
});

test('HFS-3 未同意個人化學習時不列任何課', async () => {
  const result = await getHistoryFeedbackCourses({ canonicalId: 'T1' }, deps([], false));
  assert.equal(result.consented, false);
  assert.deepEqual(result.groups, []);
  assert.equal(result.pendingCount, 0);
});
