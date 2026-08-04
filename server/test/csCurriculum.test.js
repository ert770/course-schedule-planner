// 資工系課程分類（114 必選修科目表 + 113 課程地圖）。
//
// 這些測試同時是資料本身的驗收：`c.` 15 門與三條路徑的核心選修學分數
// 若被改壞，門數與學分斷言會立刻失敗。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  CORE_ELECTIVES,
  ELECTIVES,
  CS_TRACKS,
  classifyCsCourse,
  isCsCourse,
  isCsCurriculumCourseName,
  normalizeCourseName,
} from '../src/data/csCurriculum.js';

describe('必選修科目表資料', () => {
  test('c. 為核心選修 15 門，d. 為選修 53 門', () => {
    assert.equal(CORE_ELECTIVES.length, 15);
    assert.equal(ELECTIVES.length, 53);
  });

  test('核心選修清單與科目表逐門一致', () => {
    assert.deepEqual(
      CORE_ELECTIVES.map(course => course.name).sort(),
      [
        '人工智慧導論', '密碼學', '數位系統設計', '數位系統設計實驗',
        '物件導向設計', '物件導向設計實習', '程式語言', '系統分析與設計',
        '網路程式設計', '網路程式設計實習', '編譯器', '資訊與網路安全',
        '軟體工程開發實務', '電子學', '電子學實驗',
      ].sort()
    );
  });

  test('三條路徑的核心選修學分：技術應用 15、嵌入式 11、網路與安全 9', () => {
    // 嵌入式缺 1 學分、網路與安全缺 3 學分，與既有規格記載的差額一致，
    // 可交叉驗證課程地圖的歸類沒有抄錯。
    const creditsByTrack = new Map(CS_TRACKS.map(track => [track, 0]));
    for (const course of CORE_ELECTIVES) {
      creditsByTrack.set(course.track, creditsByTrack.get(course.track) + course.credits);
    }

    assert.equal(creditsByTrack.get('技術應用類'), 15);
    assert.equal(creditsByTrack.get('嵌入式系統類'), 11);
    assert.equal(creditsByTrack.get('網路與安全類'), 9);
  });

  test('每門核心選修都有修課路徑', () => {
    for (const course of CORE_ELECTIVES) {
      assert.ok(CS_TRACKS.includes(course.track), `${course.name} 缺少修課路徑`);
    }
  });

  test('課名不重複', () => {
    const names = [...CORE_ELECTIVES, ...ELECTIVES].map(course => normalizeCourseName(course.name));
    assert.equal(new Set(names).size, names.length);
  });
});

describe('課程分類', () => {
  const csCourse = (name, subid3) => ({ name, subid3, category: '選修' });

  test('資工系課號 + 科目表課名才算資工系選修', () => {
    assert.equal(classifyCsCourse(csCourse('人工智慧導論', 'IECS3059')).category, '核心選修');
    assert.equal(classifyCsCourse(csCourse('嵌入式系統', 'IECS3048')).category, '選修');
  });

  test('修課路徑隨分類一併回傳', () => {
    assert.equal(classifyCsCourse(csCourse('密碼學', 'IECS3052')).track, '網路與安全類');
    assert.equal(classifyCsCourse(csCourse('數位影像處理', 'IECS0000')).track, '嵌入式系統類');
  });

  test('同名的他系課程不得被分類為資工系課程', () => {
    // 資料庫實例：網路程式設計只有通訊系的 COME3016、電子學只有機電系的 MCAE3103。
    assert.equal(classifyCsCourse(csCourse('網路程式設計', 'COME3016')), null);
    assert.equal(classifyCsCourse(csCourse('電子學', 'MCAE3103')), null);
    assert.equal(classifyCsCourse(csCourse('系統分析與設計', 'UPSI2008')), null);
  });

  test('資工系課號但不在核心選修／選修清單中（例如必修、碩士班）不分類', () => {
    assert.equal(classifyCsCourse(csCourse('計算機演算法', 'IECS3002')), null);
    assert.equal(classifyCsCourse(csCourse('碩士論文', 'IECS7990')), null);
  });

  test('課號缺漏或空值不會爆炸', () => {
    for (const value of [null, undefined, {}, { name: '密碼學' }]) {
      assert.equal(classifyCsCourse(value), null);
    }
  });

  test('isCsCourse 依課號前綴判定，不看班級名稱', () => {
    // 密碼學 IECS3052 掛在 `資通安全學程` 底下，仍是資工系開的課。
    assert.equal(isCsCourse({ subid3: 'IECS3052', department: '資通安全學程' }), true);
    assert.equal(isCsCourse({ subid3: 'MATH3069', department: '應數三合' }), false);
  });
});

describe('本系科目表課名（系外選修重複判定用）', () => {
  test('必修、核心選修、選修都算本系課程', () => {
    assert.equal(isCsCurriculumCourseName('計算機演算法'), true);
    assert.equal(isCsCurriculumCourseName('密碼學'), true);
    assert.equal(isCsCurriculumCourseName('嵌入式系統'), true);
  });

  test('非本系科目回傳 false', () => {
    assert.equal(isCsCurriculumCourseName('個體經濟學'), false);
  });

  test('空白與全形括號差異不影響比對', () => {
    assert.equal(isCsCurriculumCourseName('作業系統（二）'), true);
    assert.equal(isCsCurriculumCourseName(' 程式語言 '), true);
  });
});
