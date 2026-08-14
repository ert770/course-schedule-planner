import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyGeneralEducationCourse,
  GENERAL_EDUCATION_DOMAINS_112_TO_114,
  getGeneralEducationRule,
  RECOGNIZED_GENERAL_EDUCATION_COURSES_114_2,
} from '../src/data/generalEducationCatalog.js';

describe('#12B 通識適用學年度規則', () => {
  test('111、112～114、115 起會選到不同規則版本', () => {
    assert.equal(getGeneralEducationRule(111).version, 'through-111');
    assert.equal(getGeneralEducationRule(112).version, '112-114');
    assert.equal(getGeneralEducationRule(114).version, '112-114');
    assert.equal(getGeneralEducationRule(115).version, 'from-115');
    assert.equal(getGeneralEducationRule(null), null);
  });

  test('112～114 規則保留官方四領域，115 起不分領域', () => {
    assert.deepEqual(
      [...getGeneralEducationRule(114).domains],
      [...GENERAL_EDUCATION_DOMAINS_112_TO_114]
    );
    assert.equal(getGeneralEducationRule(114).domainRequired, true);
    assert.deepEqual([...getGeneralEducationRule(115).domains], []);
    assert.equal(getGeneralEducationRule(115).domainRequired, false);
  });
});

describe('#12B 通識課程分類', () => {
  test('114-2 直接以 MySQL 的官方領域名稱分類，不靠課號前綴', () => {
    const classified = classifyGeneralEducationCourse({
      year: 114,
      semester: '下學期',
      catalogCourseCode: 'NOT-GE-PREFIX',
      department: '科技知識原理與趨勢浪潮',
    });

    assert.equal(classified.category, '通識');
    assert.equal(classified.domain, '科技知識原理與趨勢浪潮');
    assert.equal(classified.ruleVersion, '112-114');
    assert.equal(classified.recognitionType, 'direct');
    assert.equal(classified.classificationSource, 'general_education_department');
  });

  test('看起來像通識的課號，沒有正式領域或認抵資料時不會被猜成通識', () => {
    assert.equal(classifyGeneralEducationCourse({
      year: 114,
      semester: '下學期',
      catalogCourseCode: 'GEFAKE1001',
      department: '資訊三乙',
    }), null);
  });

  test('115 起即使來源仍保留舊領域標記，API 也回傳不分領域', () => {
    const classified = classifyGeneralEducationCourse({
      year: 115,
      semester: '上學期',
      catalogCourseCode: 'GEK2001',
      department: '科技知識原理與趨勢浪潮',
    });

    assert.equal(classified.category, '通識');
    assert.equal(classified.domain, null);
    assert.equal(classified.ruleVersion, 'from-115');
  });

  test('114-2 三門跨院認抵課可用正式課號逐筆分類', () => {
    for (const recognized of RECOGNIZED_GENERAL_EDUCATION_COURSES_114_2) {
      const classified = classifyGeneralEducationCourse({
        year: 114,
        semester: '下學期',
        catalogCourseCode: recognized.catalogCourseCode,
        department: '非通識領域班級',
      });

      assert.equal(classified.category, '通識', recognized.catalogCourseCode);
      assert.equal(classified.domain, recognized.domain, recognized.catalogCourseCode);
      assert.equal(classified.recognitionType, 'cross_college', recognized.catalogCourseCode);
      assert.equal(
        classified.classificationSource,
        'general_education_recognition',
        recognized.catalogCourseCode
      );
    }
  });

  test('114-2 認抵表不會倒套到其他學期', () => {
    assert.equal(classifyGeneralEducationCourse({
      year: 114,
      semester: '上學期',
      catalogCourseCode: 'IINE2832',
      department: '創能學院綜合班',
    }), null);
  });
});
