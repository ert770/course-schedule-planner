import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ACTIVE_TERM,
  annotateTerm,
  getCourseTerm,
  isActiveTermCourse,
  normalizeSemesterLabel,
} from '../src/data/activeTerm.js';

describe('#20 active term 常數', () => {
  test('ACTIVE_TERM 預設值為 114 學年下學期，且已凍結', () => {
    assert.equal(ACTIVE_TERM.academicYear, 114);
    assert.equal(ACTIVE_TERM.semester, '下學期');
    assert.throws(() => { ACTIVE_TERM.academicYear = 999; }, TypeError);
  });
});

describe('#20 normalizeSemesterLabel', () => {
  test('數字、簡稱、全稱、英文都能正規化成 first/second', () => {
    assert.equal(normalizeSemesterLabel('1'), 'first');
    assert.equal(normalizeSemesterLabel('上'), 'first');
    assert.equal(normalizeSemesterLabel('上學期'), 'first');
    assert.equal(normalizeSemesterLabel('first'), 'first');
    assert.equal(normalizeSemesterLabel('2'), 'second');
    assert.equal(normalizeSemesterLabel('下'), 'second');
    assert.equal(normalizeSemesterLabel('下學期'), 'second');
    assert.equal(normalizeSemesterLabel('second'), 'second');
  });

  test('無法辨識或缺值回傳 null，不強行猜測', () => {
    assert.equal(normalizeSemesterLabel(''), null);
    assert.equal(normalizeSemesterLabel(null), null);
    assert.equal(normalizeSemesterLabel(undefined), null);
    assert.equal(normalizeSemesterLabel('秋季班'), null);
  });
});

describe('#20 getCourseTerm', () => {
  test('讀 course.year，course.semester 轉字串', () => {
    assert.deepEqual(getCourseTerm({ year: 114, semester: '下學期' }), {
      academicYear: 114,
      semester: '下學期',
    });
  });

  test('year 缺席時退回 academicYear 欄位', () => {
    assert.deepEqual(getCourseTerm({ academicYear: 113, semester: 1 }), {
      academicYear: 113,
      semester: '1',
    });
  });

  test('兩者皆缺時回傳 null／null', () => {
    assert.deepEqual(getCourseTerm({}), { academicYear: null, semester: null });
  });
});

describe('#20 isActiveTermCourse', () => {
  test('學年與學期皆相符 → true', () => {
    assert.equal(isActiveTermCourse({ year: 114, semester: '下學期' }), true);
  });

  test('學年不符 → false', () => {
    assert.equal(isActiveTermCourse({ year: 113, semester: '下學期' }), false);
  });

  test('學期不符 → false', () => {
    assert.equal(isActiveTermCourse({ year: 114, semester: '上學期' }), false);
  });

  test('學年學期皆缺 → true（相容既有未標註學期的資料，不新增排除）', () => {
    assert.equal(isActiveTermCourse({}), true);
  });

  test('只缺學年，學期相符 → true', () => {
    assert.equal(isActiveTermCourse({ semester: '下學期' }), true);
  });

  test('只缺學期，學年相符 → true', () => {
    assert.equal(isActiveTermCourse({ year: 114 }), true);
  });

  test('學期寫法無法辨識時不當成不符合', () => {
    assert.equal(isActiveTermCourse({ year: 114, semester: '秋季班' }), true);
  });

  test('可傳入自訂 activeTerm 覆寫比對基準', () => {
    const customTerm = { academicYear: 113, semester: '上學期' };
    assert.equal(isActiveTermCourse({ year: 113, semester: '上學期' }, customTerm), true);
    assert.equal(isActiveTermCourse({ year: 114, semester: '下學期' }, customTerm), false);
  });
});

describe('#20 annotateTerm', () => {
  test('回傳這門課自己的學年學期，而不是 ACTIVE_TERM 常數的值', () => {
    assert.deepEqual(annotateTerm({ year: 113, semester: '上學期' }), {
      academicYear: 113,
      semester: '上學期',
      isActiveTerm: false,
    });
  });

  test('本學期課程 isActiveTerm 為 true', () => {
    assert.deepEqual(annotateTerm({ year: 114, semester: '下學期' }), {
      academicYear: 114,
      semester: '下學期',
      isActiveTerm: true,
    });
  });
});
