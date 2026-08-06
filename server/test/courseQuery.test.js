import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { filterCourses } from '../src/skills/courseQuery.js';

const courses = [
  { id: 1, name: '甲班課程', department: '資訊三甲', category: '必修' },
  { id: 2, name: '乙班課程', department: '資訊三乙', category: '必修' },
  { id: 3, name: '合班課程', department: '資訊三合', category: '必修' },
  { id: 4, name: '二年級課程', department: '資訊二甲', category: '必修' },
  { id: 5, name: '其他系課程', department: '電機三甲', category: '必修' },
  { id: 6, name: '共同課程', department: '國文綜合班', category: '必修' },
];

describe('課程搜尋的班級範圍', () => {
  test('資訊三甲只取得本人班級與同年級合班', () => {
    const result = filterCourses(courses, {
      department: '資訊工程學系',
      grade: 3,
      className: '甲',
    });

    assert.deepEqual(result.map(course => course.id), [1, 3]);
  });

  test('年級與班別實際改變搜尋結果', () => {
    const gradeTwo = filterCourses(courses, {
      department: '資訊工程學系',
      grade: 2,
      className: '甲',
    });
    const gradeThreeB = filterCourses(courses, {
      department: '資訊工程學系',
      grade: 3,
      className: '乙',
    });

    assert.deepEqual(gradeTwo.map(course => course.id), [4]);
    assert.deepEqual(gradeThreeB.map(course => course.id), [2, 3]);
  });

  test('其他搜尋條件會在班級範圍內繼續收斂', () => {
    const result = filterCourses(courses, {
      department: '資訊工程學系',
      grade: 3,
      className: '甲',
      keyword: '合班',
    });

    assert.deepEqual(result.map(course => course.id), [3]);
  });
});
