// 依必選修科目表替「未分類」的歷史修課補分類。
//
// 要釘住的界線：只用課號與官方科目表判定；對不上就維持未分類，不用章節名稱或課名猜。
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyHistoryEntryByCurriculum,
  CLASSIFICATION_BASIS,
  NON_CS_REQUIRED_COURSE_CODES,
} from '../src/data/courseHistoryClassification.js';
import { parseCourseHistoryMarkdown } from '../src/data/courseHistoryMarkdown.js';
import { getEarnedCredits } from '../src/data/courseHistory.js';
import { REQUIRED_COURSES, normalizeCourseName } from '../src/data/csCurriculum.js';

const classify = (courseCode, courseName, extra = {}) => (
  classifyHistoryEntryByCurriculum({ courseCode, courseName, generalEducationCategory: null, ...extra })
);

describe('HC1 依科目表分類', () => {
  test('HC1 資工系必修 → required／必修', () => {
    assert.deepEqual(classify('IECS2001', '資料結構'), {
      graduationCategory: 'required', requirementType: '必修',
      basis: CLASSIFICATION_BASIS.DEPARTMENT_REQUIRED,
    });
  });

  test('HC1b 外系開課的系必修靠課號列舉', () => {
    for (const [code, name] of Object.entries(NON_CS_REQUIRED_COURSE_CODES)) {
      assert.equal(classify(code, name)?.graduationCategory, 'required', code);
    }
  });

  // 列舉表裡的每一門都必須真的在科目表的必修清單上，否則就是自己發明了一門必修。
  test('HC1c 外系必修列舉表的課名都在科目表必修清單上', () => {
    const required = new Set(REQUIRED_COURSES.map(course => normalizeCourseName(course.name)));
    for (const name of Object.values(NON_CS_REQUIRED_COURSE_CODES)) {
      assert.ok(required.has(normalizeCourseName(name)), name);
    }
  });

  test('HC1d 核心選修與選修 → elective／選修', () => {
    for (const [code, name] of [['IECS3021', '程式語言'], ['IECS2072', 'Web程式設計']]) {
      assert.deepEqual(classify(code, name), {
        graduationCategory: 'elective', requirementType: '選修',
        basis: CLASSIFICATION_BASIS.DEPARTMENT_ELECTIVE,
      }, code);
    }
  });

  test('HC1e 通識基礎必修：核心必修課號與中文／英文課名前綴', () => {
    for (const [code, name] of [
      ['GEG2000', '現代公民與社會實踐'],
      ['GEK2000', '科學與人文的對話'],
      ['CHIN1065', '中文思辨與表達(一)'],
      ['ENGL1009', '大學基礎英文(一)中高級'],
      ['ENGL1057', '大學精進英文(二)中高級'],
    ]) {
      assert.deepEqual(classify(code, name), {
        graduationCategory: 'general', requirementType: '必修',
        basis: CLASSIFICATION_BASIS.GENERAL_BASIC,
      }, code);
    }
  });
});

describe('HC2 對不上就不猜', () => {
  // 他系的同名課不是本系必修——只比課名會誤判。
  test('HC2 課名是必修、課號不是本系也不在列舉表 → null', () => {
    assert.equal(classify('MCAE2001', '線性代數'), null);
    assert.equal(classify('COME1001', '計算機概論'), null);
  });

  test('HC2b 列舉表的課號配上別的課名 → null', () => {
    assert.equal(classify('IEE1005', '電路學'), null);
  });

  test('HC2c 課名像選修但課號不是 IECS → null', () => {
    assert.equal(classify('COME3016', '網路程式設計'), null);
  });

  test('HC2d 不在科目表上的課（體育）→ null', () => {
    assert.equal(classify('ATHL1004', '體育(二)'), null);
  });

  test('HC2e 缺課號或課名 → null', () => {
    assert.equal(classify('', '資料結構'), null);
    assert.equal(classify('IECS2001', ''), null);
    assert.equal(classifyHistoryEntryByCurriculum(null), null);
  });
});

describe('HC3 Markdown 匯入會套用分類', () => {
  const markdown = `
## 基礎／共同課程
| 課程編碼 | 科目 | 實際修習學年 | 實際修習學期 | 實際修習學分 | 計入畢業學分 | 取得學分記錄 |
|---|---|---:|---:|---:|---:|---:|
| CHIN1065 | 中文思辨與表達(一) | 112 | 1 | 2 | 2 | 88 |
| ATHL1003 | 體育(一) | 112 | 1 | 1 | 0 | 90 |

## 資工核心／系內課程
| 課程編碼 | 科目 | 實際修習學年 | 實際修習學期 | 實際修習學分 | 計入畢業學分 | 取得學分記錄 |
|---|---|---:|---:|---:|---:|---:|
| IECS2001 | 資料結構 | 113 | 1 | 3 | 3 | 80 |
| MATH1005 | 微積分(一) | 112 | 1 | 3 | 3 | 75 |
| IECS3021 | 程式語言 | 114 | 1 | 3 | 3 | 85 |
| IECS9999 | 科目表上沒有的課 | 114 | 1 | 2 | 2 | 85 |

## 一般選修
| 課程編碼 | 科目 | 實際修習學年 | 實際修習學期 | 實際修習學分 | 計入畢業學分 | 取得學分記錄 |
|---|---|---:|---:|---:|---:|---:|
| BUSI1001 | 管理學 | 113 | 2 | 3 | 3 | 82 |
`;

  test('HC3 系內課依科目表分成必修與選修，對不上的維持未分類', () => {
    const { entries } = parseCourseHistoryMarkdown(markdown, { sourceName: 'fixture.md' });
    const byCode = Object.fromEntries(entries.map(entry => [
      entry.courseCode, [entry.graduationCategory, entry.requirementType],
    ]));

    assert.deepEqual(byCode, {
      CHIN1065: ['general', '必修'],
      ATHL1003: ['nonGraduation', '必修'],
      IECS2001: ['required', '必修'],
      MATH1005: ['required', '必修'],
      IECS3021: ['elective', '選修'],
      IECS9999: ['unspecified', '未確認'],
      // 章節已判定為系外的不覆寫。
      BUSI1001: ['external', '選修'],
    });
  });

  // 這是整件事的目的：缺口計算不再把系內課全算成未分類。
  test('HC3b 已取得學分落在正確的類別', () => {
    const { entries } = parseCourseHistoryMarkdown(markdown, { sourceName: 'fixture.md' });
    const earned = getEarnedCredits(entries);

    assert.equal(earned.required, 6);
    assert.equal(earned.elective, 3);
    assert.equal(earned.general, 2);
    assert.equal(earned.external, 3);
    assert.equal(earned.unspecified, 2);
  });
});
