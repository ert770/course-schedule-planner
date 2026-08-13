import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { filterCategorizedCourses, filterCourses } from '../src/skills/courseQuery.js';
import { buildCourseQueryScope } from '../src/skills/courseScope.js';

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

const categorizedCourses = [
  { id: 11, name: '計算機演算法', catalogCourseCode: 'IECS3002', department: '資訊三乙', category: '必修' },
  { id: 12, name: '人工智慧導論', catalogCourseCode: 'IECS3059', department: '資訊三合', category: '選修' },
  { id: 13, name: '嵌入式系統', catalogCourseCode: 'IECS3048', department: '資訊三合', category: '選修' },
  { id: 14, name: '財務報表分析', catalogCourseCode: 'ACCT3001', department: '會計三甲', category: '選修' },
  { id: 15, name: '他系必修', catalogCourseCode: 'ACCT3002', department: '會計三甲', category: '必修' },
  { id: 16, name: '共同選修', catalogCourseCode: 'GE001', department: '核心必修綜合班', category: '選修' },
  { id: 17, name: '碩士選修', catalogCourseCode: 'ACCT6001', department: '會計碩一', category: '選修' },
];

const studentScope = buildCourseQueryScope({
  department: '資訊工程學系',
  grade: 3,
  className: '乙',
});

describe('#12A 先分類再搜尋', () => {
  test('未指定分類時維持 F7，只回本人班級與合班', () => {
    const result = filterCategorizedCourses(categorizedCourses, {}, studentScope);
    assert.deepEqual(result.map(course => course.id), [11, 12, 13]);
  });

  test('核心選修由 MySQL 選修解析後才進行篩選', () => {
    const [course] = filterCategorizedCourses(
      categorizedCourses,
      { category: '核心選修' },
      studentScope
    );

    assert.equal(course.id, 12);
    assert.equal(course.category, '核心選修');
    assert.equal(course.sourceCategory, '選修');
    assert.equal(course.classificationSource, 'cs_curriculum');
  });

  test('資工科目表的非核心課程解析為一般選修', () => {
    const result = filterCategorizedCourses(
      categorizedCourses,
      { category: '一般選修' },
      studentScope
    );
    assert.deepEqual(result.map(course => course.id), [13]);
  });

  test('只有明確搜尋系外選修時才擴展到其他系所', () => {
    const result = filterCategorizedCourses(
      categorizedCourses,
      { category: '系外選修' },
      studentScope
    );

    assert.deepEqual(result.map(course => course.id), [14]);
    assert.equal(result[0].outsideElective.needsOfficeConfirmation, true);
  });

  test('系外選修不得混入與學生不同學制的碩士課程', () => {
    const result = filterCategorizedCourses(
      categorizedCourses,
      { category: '系外選修' },
      studentScope
    );
    assert.equal(result.some(course => course.id === 17), false);
  });

  test('通識分類保留不處理並回傳明確錯誤', () => {
    assert.throws(
      () => filterCategorizedCourses(categorizedCourses, { category: '通識' }, studentScope),
      error => error.code === 'GENERAL_EDUCATION_CATEGORY_UNAVAILABLE' && error.status === 422
    );
  });

  test('三個學生範圍欄位不完整時不得退回廣泛搜尋', () => {
    const incompleteScope = buildCourseQueryScope({ department: '資訊工程學系', grade: 3 });
    assert.throws(
      () => filterCategorizedCourses(categorizedCourses, {}, incompleteScope),
      error => error.code === 'CLASS_NAME_REQUIRED'
    );
  });
});
