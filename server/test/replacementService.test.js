// 課程格「備選」（2026-11-28）：只列可以直接換上的非必修課，依排課分數排序。
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { ALTERNATIVE_LIMIT, listAlternatives } from '../src/services/replacementService.js';

const block = (dayOfWeek, startPeriod, endPeriod) => ({ dayOfWeek, startPeriod, endPeriod });
const course = (id, name, code, timeBlocks, extra = {}) => ({
  id, sectionId: id, name, catalogCourseCode: code, timeBlocks, credits: 2, category: '通識',
  eligibility: 'eligible', ragTag: [], department: '通識', ...extra,
});

const A = course(1, '目前的通識', 'GE1', [block(2, 3, 4)]);
const B = course(2, '另一門課', 'IECS1', [block(3, 6, 7)], { category: '選修', department: '資訊三合' });
const catalog = new Map([A, B].map(item => [item.id, item]));
const pool = [
  A, B,
  course(10, '候選甲', 'GE10', [block(1, 3, 4)]),
  course(11, '衝堂課', 'GE11', [block(3, 6, 7)]),
  course(12, '必修課', 'IECS12', [block(1, 6, 7)], { category: '必修' }),
  course(13, '資格待確認', 'GE13', [block(1, 8, 9)], { eligibility: 'unknown' }),
  course(14, '同名課', 'GE14', [block(1, 10, 11)]),
  course(15, '同名課', 'GE14', [block(5, 3, 4)]),
  course(16, '超過學分', 'GE16', [block(5, 6, 7)], { credits: 30 }),
];

const deps = (extra = {}) => ({
  loadPreferences: async () => ({ department: '資訊工程學系', gradeLevel: 3, className: '資訊三甲', courseHistory: [] }),
  prepare: async () => ({ mergedConstraints: { maxCredits: 25, department: '資訊工程學系' } }),
  searchPool: async () => pool,
  lookupCourses: async ids => new Map(ids.map(id => [id, catalog.get(id)]).filter(([, value]) => value)),
  loadTag: async () => null,
  loadVector: async () => null,
  loadCf: async () => null,
  ...extra,
});

describe('RP1 備選清單', () => {
  test('排除衝堂、必修、資格待確認、超過學分上限與課表上的課；同一門課只列一次', async () => {
    const result = await listAlternatives({ canonicalId: 'D1' }, { sectionId: 1, currentIds: [1, 2] }, deps());
    const names = result.alternatives.map(item => item.name);
    assert.deepEqual([...names].sort(), ['候選甲', '同名課']);
    for (const item of result.alternatives) assert.equal(item.course.sectionId, item.sectionId);
  });

  test('使用者自己加入的課也能查備選', async () => {
    const result = await listAlternatives({ canonicalId: 'D1' }, { sectionId: 2, currentIds: [1, 2] }, deps());
    assert.ok(result.alternatives.length > 0);
    assert.ok(result.alternatives.some(item => item.name === '衝堂課'), '換掉 B 之後原本衝堂的時段空出來了');
  });

  test('要換的課不在目前課表時回 400', async () => {
    await assert.rejects(
      listAlternatives({ canonicalId: 'D1' }, { sectionId: 99, currentIds: [1, 2] }, deps()),
      error => error.status === 400,
    );
  });

  test(`最多列 ${ALTERNATIVE_LIMIT} 門`, async () => {
    const many = Array.from({ length: 20 }, (_, index) => course(100 + index, `課${index}`, `X${index}`, [block(1, 1 + (index % 10), 1 + (index % 10))]));
    const result = await listAlternatives({ canonicalId: 'D1' }, { sectionId: 1, currentIds: [1, 2] }, deps({
      searchPool: async () => [A, B, ...many],
      loadPreferences: async () => ({ department: '資訊工程學系', gradeLevel: 3, className: '資訊三甲' }),
    }));
    assert.equal(result.alternatives.length, ALTERNATIVE_LIMIT);
  });
});
