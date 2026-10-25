// 2026-10-15 Persona UX 測試發現：全校查詢的「授課語言」比對不存在的 course.language，選任何語言都是 0 筆。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterCatalogCourses } from '../src/skills/courseQuery.js';

const courses = [
  { id: 1, name: 'Data Science', isEnglishTaught: true, category: '一般選修' },
  { id: 2, name: '資料結構', isEnglishTaught: false, category: '必修' },
  { id: 3, name: '資料庫', category: '一般選修' },
];

test('LANG-1 English 只留全英授課；中文排除全英授課；全部不篩', () => {
  assert.deepEqual(filterCatalogCourses(courses, { language: 'English' }).map(c => c.id), [1]);
  assert.deepEqual(filterCatalogCourses(courses, { language: '中文 (Chinese)' }).map(c => c.id), [2, 3]);
  assert.equal(filterCatalogCourses(courses, { language: '全部' }).length, 3);
  assert.equal(filterCatalogCourses(courses, {}).length, 3);
});
