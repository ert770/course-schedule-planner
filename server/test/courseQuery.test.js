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
  { id: 18, name: '幸福水臺灣', catalogCourseCode: 'GEG1037', department: '全球氣候變遷與永續發展', category: '選修', year: 114, semester: '下學期' },
  { id: 19, name: '台灣考古學與原住民', catalogCourseCode: 'HSS1007', department: '文學與文化創意學分學程', category: '選修', year: 114, semester: '下學期' },
  { id: 20, name: '看似通識但沒有正式分類', catalogCourseCode: 'GEFAKE1001', department: '核心必修綜合班', category: '選修', year: 114, semester: '下學期' },
];

const studentScope = buildCourseQueryScope({
  department: '資訊工程學系',
  grade: 3,
  className: '乙',
});

const termMixedCourses = [
  { id: 101, name: '本學期資料結構', department: '資訊三乙', category: '必修', year: 114, semester: '下學期' },
  { id: 102, name: '舊學期資料結構', department: '資訊三乙', category: '必修', year: 113, semester: '上學期' },
  { id: 103, name: '未標註學期的選修', department: '資訊三乙', category: '選修' },
];

describe('#12A 先分類再搜尋', () => {
  test('未指定分類時維持 F7，只回本人班級與合班', () => {
    const result = filterCategorizedCourses(categorizedCourses, {}, studentScope);
    assert.deepEqual(result.map(course => course.id), [11, 12, 13]);
  });

  test('#20 每門候選課都帶有 term 與 scopeReason', () => {
    const result = filterCategorizedCourses(categorizedCourses, {}, studentScope);
    for (const course of result) {
      assert.equal(typeof course.term, 'object');
      assert.equal(typeof course.term.isActiveTerm, 'boolean');
      assert.equal(typeof course.scopeReason, 'string');
      assert.ok(course.scopeReason.length > 0);
    }
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
    // #20：認列結果算出來後，scopeReason 要被精修文字覆寫，不是留著
    // annotateCourseCategory() 給的系外選修預設文字。
    assert.match(result[0].scopeReason, /惟依規定仍須向系辦公室確認/);
  });

  test('系外選修不得混入與學生不同學制的碩士課程', () => {
    const result = filterCategorizedCourses(
      categorizedCourses,
      { category: '系外選修' },
      studentScope
    );
    assert.equal(result.some(course => course.id === 17), false);
  });

  test('通識搜尋會跨班級回傳直接領域課與官方認抵課', () => {
    const result = filterCategorizedCourses(
      categorizedCourses,
      { category: '通識' },
      studentScope
    );

    assert.deepEqual(result.map(course => course.id), [18, 19]);
    assert.equal(result[0].generalEducationDomain, '全球氣候變遷與永續發展');
    assert.equal(result[0].classificationSource, 'general_education_department');
    assert.equal(result[1].generalEducationDomain, '世界格局與歷史地理視野');
    assert.equal(result[1].classificationSource, 'general_education_recognition');
    assert.equal(result[0].eligibility, 'unknown');
    assert.equal(result[0].classKind, 'commonCurriculum');
    assert.match(result[0].eligibilityReason, /正式適用對象規則尚未確認/);
    assert.equal(result[1].eligibility, 'unknown');
    assert.equal(result[1].classKind, 'creditProgram');
  });

  test('排課候選可在本人班級課程之外納入通識，普通搜尋仍維持 F7', () => {
    const ordinary = filterCategorizedCourses(categorizedCourses, {}, studentScope);
    const scheduling = filterCategorizedCourses(
      categorizedCourses,
      {},
      studentScope,
      { includeGeneralEducation: true }
    );

    assert.equal(ordinary.some(course => course.category === '通識'), false);
    assert.deepEqual(
      scheduling.filter(course => course.category === '通識').map(course => course.id),
      [18, 19]
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

describe('#20 active term 過濾（courseQuery 無條件過濾，無「明確指定」豁免）', () => {
  test('非本學期課程即使其他篩選條件都符合也不出現在搜尋結果', () => {
    const result = filterCategorizedCourses(termMixedCourses, {}, studentScope);
    assert.deepEqual(result.map(course => course.id), [101, 103]);
  });

  test('未標註學年學期的課程視為本學期，不受影響', () => {
    const result = filterCategorizedCourses(termMixedCourses, {}, studentScope);
    const untagged = result.find(course => course.id === 103);
    assert.equal(untagged.term.isActiveTerm, true);
  });
});
