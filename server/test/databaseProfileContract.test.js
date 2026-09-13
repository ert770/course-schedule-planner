// A5：`User_Profiles.completed_courses` 仍存在於共用 MySQL schema，
// 但本專案的資料層必須完全停止讀寫它。
//
// 這裡檢查的是應用程式邊界 `database.js`，不檢查 `schema.sql`：欄位本身刻意
// 不做 ALTER TABLE，未來是否刪除要由共用資料庫的維護者另行協調。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const databaseSource = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'db', 'database.js'),
  'utf8'
);

describe('A1/A5 profile 衍生欄位與 completed_courses 停止讀寫', () => {
  test('database.js 不再讀取或寫入 completed_courses', () => {
    assert.doesNotMatch(databaseSource, /completed_courses/);
  });

  test('database.js 不再產生或接受舊的 completed course profile 欄位', () => {
    for (const field of [
      'completedCourseCodes',
      'completedCourseNames',
      'completedCourseIds',
      'completedCourses',
      'completedCredits',
      'earnedCredits',
    ]) {
      assert.ok(
        !databaseSource.includes(field),
        `${field} 必須由 courseHistory 當場計算，不得出現在 profile 資料層`
      );
    }
  });
});

// 2026-09-10：`targetCreditsMin` 曾經在這裡寫死 `12`，蓋過 `scheduler.js` 的
// 「四年級以上下限 9」判斷（`constraints.minCredits` 明確存在時，
// `scheduler.js` 的 `?? defaultMinCredits(constraints)` 永遠不會被呼叫），
// 導致四年級下限在真實請求中從未生效過。改回頭寫死任何具體數字都會
// 重現同一種 bug——這裡直接鎖住「必須呼叫共用的 resolveMinCredits()」，
// 而不是只檢查「沒有 12」，因為換成其他寫死的數字一樣是同一類錯誤。
describe('B10 targetCreditsMin 必須依年級判斷，不得寫死', () => {
  test('mapUserProfileRow() 呼叫 resolveMinCredits() 而不是寫死的數字', () => {
    assert.match(
      databaseSource,
      /targetCreditsMin:\s*resolveMinCredits\(/,
      'targetCreditsMin 必須來自 resolveMinCredits(row.grade_level)，不得是寫死的常數——' +
      '寫死任何數字都會蓋掉四年級下限 9 的判斷'
    );
  });

  test('database.js 有從 creditPolicy.js 匯入 resolveMinCredits', () => {
    assert.match(databaseSource, /import\s*\{[^}]*resolveMinCredits[^}]*\}\s*from\s*['"]\.\.\/data\/creditPolicy\.js['"]/);
  });
});

// 2026-09-10：`capacity: normalizeNumber(row.limit_amount, null)` 曾經是
// 這裡唯一寫下去的版本，直接連線即時查證才發現 `Number(null) === 0` 且
// `Number.isFinite(0)` 為真，`normalizeNumber` 的 fallback 分支永遠選不到——
// 全庫容量會一律顯示 `0`（看起來像「額滿」），而不是誠實的「尚未登錄」。
// 鎖住必須用會正確處理 null 的版本，不得再用 `normalizeNumber`。
describe('B11 capacity 必須正確區分 null（未登錄）與 0（真的額滿）', () => {
  test('mapCourseRow() 的 capacity 呼叫 normalizeNullableNumber()，不是會把 null 吃成 0 的 normalizeNumber()', () => {
    assert.match(
      databaseSource,
      /capacity:\s*normalizeNullableNumber\(/,
      'capacity 必須用 normalizeNullableNumber()——用 normalizeNumber() 會讓 null 容量顯示成 0'
    );
  });
});

describe('B12 課程年級與先修欄位契約', () => {
  test('SQL 讀取 target_grade/prerequisites，API 只輸出 gradeLevel', () => {
    assert.match(databaseSource, /c\.\\`target_grade\\`/u);
    assert.match(databaseSource, /c\.\\`prerequisites\\`/u);
    assert.match(databaseSource, /gradeLevel:\s*normalizeCourseGradeLevel\(row\.target_grade\)/u);
    assert.doesNotMatch(databaseSource, /targetGrade\s*:/u);
  });
});
