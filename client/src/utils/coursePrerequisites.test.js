import { test } from 'node:test';
import assert from 'node:assert/strict';

import { formatCoursePrerequisites } from './coursePrerequisites.js';

test('null／undefined 是資料尚未提供，不是沒有先修', () => {
  assert.equal(formatCoursePrerequisites(null), '尚未取得官方先修資料');
  assert.equal(formatCoursePrerequisites(undefined), '尚未取得官方先修資料');
});

test('舊格式陣列：列出課名；空陣列是沒有先修', () => {
  assert.equal(formatCoursePrerequisites(['資料結構', '離散數學']), '資料結構、離散數學');
  assert.equal(formatCoursePrerequisites([]), '無');
});

test('物件格式：列出 rules 的課名，沒有課名時用課號，重複的只列一次', () => {
  assert.equal(formatCoursePrerequisites({
    rules: [
      { name: '資料結構', course_id: 'IECS2001' },
      { name: '計算機概論實習(一)', course_id: 'IEE1002' },
      { name: '', course_id: 'IEE1003' },
      { name: '資料結構', course_id: 'IECS2001' },
    ],
    required_ids: ['IECS2001', 'IEE1002', 'IEE1003'],
    course_code: 'IECS3022',
    course_name: '資料庫系統',
  }), '資料結構、計算機概論實習(一)、IEE1003');
  assert.equal(formatCoursePrerequisites({ rules: [] }), '無');
  assert.equal(formatCoursePrerequisites({ required_ids: ['IECS2001'] }), 'IECS2001');
  assert.equal(formatCoursePrerequisites({ unexpected: true }), '尚未取得官方先修資料');
});

test('字串原樣顯示', () => {
  assert.equal(formatCoursePrerequisites('需先修資料結構'), '需先修資料結構');
});
