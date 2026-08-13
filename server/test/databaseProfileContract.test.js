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
