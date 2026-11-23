import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Static contract checks only; these do not execute MySQL DDL.
const up = readFileSync(new URL('../migrations/010_student-identity.up.sql', import.meta.url), 'utf8');
const down = readFileSync(new URL('../migrations/010_student-identity.down.sql', import.meta.url), 'utf8');
test('migration adds nullable unique student ID and bounded allocator starting point', () => {
  assert.match(up, /ADD COLUMN student_id VARCHAR\(32\) NULL/i);
  assert.match(up, /ADD UNIQUE KEY uq_user_profiles_student_id \(student_id\)/i);
  assert.match(up, /AUTO_INCREMENT=5/i);
  assert.match(up, /SIGNAL SQLSTATE '45000'/i);
  assert.doesNotMatch(up, /\b(?:UPDATE|DELETE|TRUNCATE)\s+(?:FROM\s+)?(?:`?User_Profiles`?)/i);
});
test('rollback refuses destructive execution', () => {
  assert.match(down, /SIGNAL SQLSTATE '45000'/i);
  assert.doesNotMatch(down, /\b(?:DROP|ALTER|DELETE|TRUNCATE)\s+(?:TABLE|FROM|User_Profiles)/i);
});
