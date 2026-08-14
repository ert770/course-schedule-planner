// 修課歷史的派生運算（`server/src/data/courseHistory.js`）。
//
// 這組測試釘住 2026-08-11 的欄位整併：`completedCourseCodes`、
// `completedCourseNames`、`completedCourseIds`、`completedCredits`、`earnedCredits`
// 五個欄位從 `users.json` 移除，改由 `courseHistory` 當場算。
// 最後兩個案例是**迴歸基準**——用真實的 53 筆資料比對整併前的既有值，
// 確保整併只是換了計算方式，沒有改變結果。

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  COURSE_HISTORY_REQUIRED_FIELDS,
  getFailedRequiredCourseCodes,
  getLatestAttemptsByCourseCode,
  getPassedCourseCodes,
  getEarnedCredits,
  getTotalEarnedCredits,
  validateCourseHistoryEntry,
} from '../src/data/courseHistory.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function entry(overrides = {}) {
  return {
    academicYear: 113,
    semester: 1,
    courseCode: 'IECS2001',
    courseName: '資料結構',
    score: 88,
    letterGrade: 'A',
    credits: 3,
    passed: true,
    requirementType: '必修',
    generalEducationCategory: null,
    graduationCategory: 'required',
    ...overrides,
  };
}

const EMPTY_CREDITS = {
  required: 0, elective: 0, general: 0, external: 0, unspecified: 0,
};

describe('H1 getPassedCourseCodes：只收通過的課號', () => {
  test('H1 未通過的課不列入已修', () => {
    // 未通過的課是重補修的對象。若把它算成已修，排課器會把學生真正需要
    // 重修的課從候選池排除——這正是已修排除與自動重補修必須互斥的原因。
    const history = [
      entry({ courseCode: 'IECS3001', passed: true }),
      entry({ courseCode: 'IECS3002', passed: false, score: 45, letterGrade: 'E' }),
    ];

    assert.deepEqual(getPassedCourseCodes(history), ['IECS3001']);
  });

  test('H1 不計畢業學分的課仍算已修過', () => {
    // 體育、國防科技不計入畢業學分，但確實修過了，不該再被推薦。
    // 「計不計學分」與「修沒修過」是兩件事。
    const history = [entry({ courseCode: 'ATHL1003', graduationCategory: 'nonGraduation' })];

    assert.deepEqual(getPassedCourseCodes(history), ['ATHL1003']);
  });

  test('H1 空陣列或未帶參數都回傳空陣列', () => {
    assert.deepEqual(getPassedCourseCodes([]), []);
    assert.deepEqual(getPassedCourseCodes(), []);
    assert.deepEqual(getPassedCourseCodes(null), []);
  });
});

describe('H2 getEarnedCredits：依畢業分類加總', () => {
  test('H2 未通過的課不計學分', () => {
    const history = [
      entry({ credits: 3, passed: true }),
      entry({ credits: 3, passed: false, score: 50 }),
    ];

    assert.deepEqual(getEarnedCredits(history), { ...EMPTY_CREDITS, required: 3 });
  });

  test('H2 nonGraduation 不計入任何分類', () => {
    const history = [
      entry({ credits: 3, graduationCategory: 'required' }),
      entry({ credits: 1, graduationCategory: 'nonGraduation' }),
    ];

    const earned = getEarnedCredits(history);

    assert.deepEqual(earned, { ...EMPTY_CREDITS, required: 3 });
    assert.equal(getTotalEarnedCredits(history), 3, 'nonGraduation 不進總學分');
  });

  test('H2 分類缺漏時歸入 unspecified，不靜默丟棄學分', () => {
    const history = [
      entry({ courseCode: 'TEST1001', credits: 2, graduationCategory: null }),
      entry({ courseCode: 'TEST1002', credits: 2, graduationCategory: '不存在的分類' }),
    ];

    assert.deepEqual(getEarnedCredits(history), { ...EMPTY_CREDITS, unspecified: 4 });
  });

  test('H2 空陣列回傳全 0 而非 undefined', () => {
    assert.deepEqual(getEarnedCredits([]), EMPTY_CREDITS);
    assert.deepEqual(getEarnedCredits(), EMPTY_CREDITS);
    assert.equal(getTotalEarnedCredits([]), 0);
  });
});

describe('H4 最新修課紀錄與不及格必修', () => {
  test('H4 同課先不及格後通過時只視為已完成', () => {
    const history = [
      entry({ academicYear: 112, semester: 1, passed: false, score: 45, letterGrade: 'E' }),
      entry({ academicYear: 113, semester: 2, passed: true, score: 80, letterGrade: 'A-' }),
    ];

    assert.deepEqual(getPassedCourseCodes(history), ['IECS2001']);
    assert.deepEqual(getFailedRequiredCourseCodes(history), []);
    assert.equal(getLatestAttemptsByCourseCode(history).get('IECS2001').academicYear, 113);
  });

  test('H4 最新一筆為不及格必修時回傳課號', () => {
    const history = [
      entry({ academicYear: 113, semester: 1, passed: true }),
      entry({ academicYear: 114, semester: 2, passed: false, score: 50, letterGrade: 'D' }),
    ];

    assert.deepEqual(getPassedCourseCodes(history), []);
    assert.deepEqual(getFailedRequiredCourseCodes(history), ['IECS2001']);
  });

  test('H4 不及格選修不會成為自動重補修', () => {
    const history = [entry({ passed: false, requirementType: '選修' })];
    assert.deepEqual(getFailedRequiredCourseCodes(history), []);
  });
});

describe('H5 courseHistory 完整欄位契約', () => {
  test('H5 完整紀錄通過驗證', () => {
    assert.equal(validateCourseHistoryEntry(entry()).valid, true);
  });

  test('H5 缺欄位時列出缺少的欄位', () => {
    const invalid = entry();
    delete invalid.academicYear;
    delete invalid.graduationCategory;
    assert.deepEqual(validateCourseHistoryEntry(invalid).missingFields, [
      'academicYear',
      'graduationCategory',
    ]);
  });

  test('H5 demo 53 筆紀錄都有全部必要欄位', () => {
    const users = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', 'data', 'users.json'), 'utf8')
    );
    const demo = users.find(user => user.studentId === 'D1249697');
    assert.ok(demo.courseHistory.every(item => validateCourseHistoryEntry(item).valid));
    assert.equal(COURSE_HISTORY_REQUIRED_FIELDS.length, 11);
  });
});

describe('H3 迴歸基準：與整併前的既有值相符', () => {
  // 整併前 `users.json` 存的是 `completedCredits: 118` 與
  // `earnedCredits: {required:61, elective:22, general:24, external:11}`。
  // 這兩個案例確保由 `courseHistory` 現算的結果與那組值逐項相同——
  // 整併只是換了計算方式，不是改變畢業進度的數字。
  const users = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'data', 'users.json'), 'utf8')
  );
  const demo = users.find(user => user.studentId === 'D1249697');

  test('H3 demo 使用者的 courseHistory 有 53 筆且都帶 passed', () => {
    assert.ok(demo, '找不到 demo 使用者 D1249697');
    assert.equal(demo.courseHistory.length, 53);
    assert.ok(
      demo.courseHistory.every(item => typeof item.passed === 'boolean'),
      '每一筆都必須有 passed 布林，否則派生結果會靜默少算'
    );
  });

  test('H3 分類學分為 61/22/24/11，總學分為 118', () => {
    assert.deepEqual(getEarnedCredits(demo.courseHistory), {
      required: 61,
      elective: 22,
      general: 24,
      external: 11,
      unspecified: 0,
    });
    assert.equal(getTotalEarnedCredits(demo.courseHistory), 118);
  });

  test('H3 已通過課號為 53 個，且不含重複', () => {
    const codes = getPassedCourseCodes(demo.courseHistory);

    assert.equal(codes.length, 53);
    assert.equal(new Set(codes).size, 53, '同一課號重複會讓已修排除的判定失去意義');
  });

  test('H3 整併後的 users.json 不得再有派生欄位', () => {
    // 這些欄位一旦被誰加回去，就會再度出現「同一份資料兩個代表」的漂移。
    for (const field of [
      'completedCourseCodes',
      'completedCourseNames',
      'completedCourseIds',
      'completedCredits',
      'earnedCredits',
    ]) {
      assert.ok(
        !(field in demo),
        `${field} 已整併進 courseHistory，不得再出現在 users.json`
      );
    }
  });
});
