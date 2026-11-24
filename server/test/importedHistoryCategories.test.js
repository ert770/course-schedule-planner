// MyFCU 匯入的修課紀錄：讀取時排除無課號／成績無法判讀的列，並補上 NULL 的修別與畢業分類（2026-11-23 團隊決定 B(a)）。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fillMissingHistoryCategories, isUsableHistoryRow, mapCourseHistoryRow } from '../src/db/database.js';

const row = overrides => ({
  history_id: 1, academic_year: 112, semester: 1, catalog_course_code: 'IECS1001', course_name: '虛構課程',
  score: 80, letter_grade: null, credits: 3, passed: 1,
  requirement_type: null, general_education_category: null, graduation_category: null,
  ...overrides,
});

test('IH1 沒有課號或成績無法判讀的列不進推薦', () => {
  assert.equal(isUsableHistoryRow(row()), true);
  assert.equal(isUsableHistoryRow(row({ catalog_course_code: null })), false);
  assert.equal(isUsableHistoryRow(row({ passed: null })), false);
  assert.equal(isUsableHistoryRow(row({ passed: 0 })), true, '不及格仍是可判讀的成績');
});

test('IH2 對不上科目表的課補成「未確認／unspecified」，可正常轉成修課紀錄', () => {
  const filled = fillMissingHistoryCategories(row({ catalog_course_code: 'ZZZZ9999', course_name: '虛構外系課' }));
  assert.equal(filled.requirement_type, '未確認');
  assert.equal(filled.graduation_category, 'unspecified');
  assert.equal(mapCourseHistoryRow(filled).graduationCategory, 'unspecified');
  // 原本會因 NULL 欄位丟出錯誤，整份修課紀錄載入失敗。
  assert.throws(() => mapCourseHistoryRow(row()));
});

test('IH3 通識基礎必修依課號補分類', () => {
  const filled = fillMissingHistoryCategories(row({ catalog_course_code: 'GEG2000', course_name: '現代公民與社會實踐' }));
  assert.equal(filled.graduation_category, 'general');
  assert.equal(filled.requirement_type, '必修');
});

test('IH4 已有分類的列不改寫', () => {
  const original = row({ requirement_type: '選修', graduation_category: 'external' });
  assert.equal(fillMissingHistoryCategories(original), original);
  const partial = fillMissingHistoryCategories(row({ requirement_type: '選修' }));
  assert.equal(partial.requirement_type, '選修');
  assert.equal(partial.graduation_category, 'unspecified');
});

// 2026-11-23 團隊決定：補分類加上不計畢業、通識（課程表）、系外選修（機械認列條件）三條規則。
const { buildStudentScope } = await import('../src/skills/courseScope.js');
const csScope = buildStudentScope({ department: '資訊工程學系', className: '資訊三乙', gradeLevel: 3 });
const section = (code, department, type = '選修', name = '虛構外系課') => ({
  name, type, category: type, department, catalogCourseCode: code, gradeLevel: 2, year: 114, semester: '下學期',
});
const contextWith = (...sections) => ({
  scope: csScope,
  catalogByCode: new Map(sections.map(s => [s.catalogCourseCode, [s]])),
});

test('IH5 體育、國防科技、班級活動依課名歸「不計畢業」，不需要課程表', () => {
  for (const name of ['體育(二)', '體育－羽球', '國防科技', '班級活動']) {
    const filled = fillMissingHistoryCategories(row({ catalog_course_code: 'ATHL1004', course_name: name }));
    assert.deepEqual([filled.graduation_category, filled.requirement_type], ['nonGraduation', '必修'], name);
  }
});

test('IH6 課程表裡是通識課的歸「通識」', () => {
  const ge = section('GEH1001', '科技知識原理與趨勢浪潮');
  const filled = fillMissingHistoryCategories(row({ catalog_course_code: 'GEH1001', course_name: '虛構通識' }), contextWith(ge));
  assert.deepEqual([filled.graduation_category, filled.requirement_type], ['general', '通識']);
});

test('IH7 外系課歸「系外選修」；開課班的必修對別系學生仍算系外課', () => {
  const elective = fillMissingHistoryCategories(row({ catalog_course_code: 'FINA2001', course_name: '虛構財金課' }),
    contextWith(section('FINA2001', '財金二甲')));
  assert.deepEqual([elective.graduation_category, elective.requirement_type], ['external', '選修']);
  const otherRequired = fillMissingHistoryCategories(row({ catalog_course_code: 'MGT2001', course_name: '虛構企管課' }),
    contextWith(section('MGT2001', '企管二甲', '必修')));
  assert.equal(otherRequired.graduation_category, 'external');
});

// 2026-11-24 使用者決定「都先算系外」：進修部、非系所單位開的課也先算系外。
test('IH8 進修部與非系所單位開的課也先算系外；本系課號與課程表查不到的維持未分類', () => {
  const continuing = fillMissingHistoryCategories(row({ catalog_course_code: 'MGT2002', course_name: '虛構進修部課' }),
    contextWith(section('MGT2002', '企管進修二甲')));
  assert.equal(continuing.graduation_category, 'external', '只有進修部班次');
  const language = fillMissingHistoryCategories(row({ catalog_course_code: 'JAPN1001', course_name: '虛構日文' }),
    contextWith(section('JAPN1001', '語言中心')));
  assert.equal(language.graduation_category, 'external', '非系所單位');
  const ownCode = fillMissingHistoryCategories(row({ catalog_course_code: 'IECS9999', course_name: '虛構本系課' }),
    contextWith(section('IECS9999', '資訊三甲')));
  assert.equal(ownCode.graduation_category, 'unspecified', '本系課號不在科目表');
  const missingCatalog = fillMissingHistoryCategories(row({ catalog_course_code: 'FINA9999', course_name: '虛構舊課' }), contextWith());
  assert.equal(missingCatalog.graduation_category, 'unspecified', '課程表查不到');
});

test('IH9 沒有課程表與系所（查詢失敗）時只用課名與科目表，不丟錯誤', () => {
  const filled = fillMissingHistoryCategories(row({ catalog_course_code: 'FINA2001', course_name: '虛構財金課' }), {});
  assert.equal(filled.graduation_category, 'unspecified');
});
