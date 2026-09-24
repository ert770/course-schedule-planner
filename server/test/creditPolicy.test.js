// 2026-09-10：`resolveMinCredits()` 是唯一判斷「四年級下限 9」的地方，
// `scheduler.js` 與 `database.js` 都呼叫它。這裡直接測純函式本身；
// 真正抓住那個 bug（database.js 曾經寫死 12，蓋過這個判斷）的迴歸測試
// 在 `databaseProfileContract.test.js`。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_MIN_CREDITS, FINAL_YEAR_MIN_CREDITS, resolveMinCredits } from '../src/data/creditPolicy.js';

describe('resolveMinCredits：四年級下限 9，其餘 12', () => {
  test('四年級（gradeLevel 4）回傳 9', () => {
    assert.equal(resolveMinCredits(4), FINAL_YEAR_MIN_CREDITS);
  });

  test('大於四年級（延畢／研究生 gradeLevel 5）仍回傳 9', () => {
    assert.equal(resolveMinCredits(5), FINAL_YEAR_MIN_CREDITS);
  });

  test('一到三年級回傳 12', () => {
    assert.equal(resolveMinCredits(1), DEFAULT_MIN_CREDITS);
    assert.equal(resolveMinCredits(2), DEFAULT_MIN_CREDITS);
    assert.equal(resolveMinCredits(3), DEFAULT_MIN_CREDITS);
  });

  test('年級未知（null／undefined／非數字）安全預設為 12，不當成四年級', () => {
    assert.equal(resolveMinCredits(null), DEFAULT_MIN_CREDITS);
    assert.equal(resolveMinCredits(undefined), DEFAULT_MIN_CREDITS);
    assert.equal(resolveMinCredits('大四'), DEFAULT_MIN_CREDITS);
  });

  test('字串型數字（前端／DB 可能送字串）仍正確判斷', () => {
    assert.equal(resolveMinCredits('4'), FINAL_YEAR_MIN_CREDITS);
    assert.equal(resolveMinCredits('3'), DEFAULT_MIN_CREDITS);
  });
});
