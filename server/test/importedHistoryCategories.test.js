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
