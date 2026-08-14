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

describe('Part B 課程物件課號欄位契約', () => {
  test('MySQL subid3 只映射為 catalogCourseCode', () => {
    assert.match(databaseSource, /catalogCourseCode:\s*row\.subid3/);
    assert.doesNotMatch(databaseSource, /(?:^|[,{]\s*)subid3:\s*row\.subid3/m);
  });
});
