import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  CourseHistoryUnavailableError,
  mapCourseHistoryRow,
} from '../src/db/database.js';

function row(overrides = {}) {
  return {
    history_id: 7,
    academic_year: 113,
    semester: 2,
    catalog_course_code: 'IECS3002',
    course_name: '資料結構',
    score: '88.00',
    letter_grade: 'A',
    credits: '3.0',
    passed: 1,
    requirement_type: '必修',
    general_education_category: null,
    graduation_category: 'required',
    ...overrides,
  };
}

describe('H8 User_Course_History 資料庫契約', () => {
  test('H8 DB row 映射成既有 11 欄 courseHistory 契約', () => {
    assert.deepEqual(mapCourseHistoryRow(row()), {
      academicYear: 113,
      semester: 2,
      courseCode: 'IECS3002',
      courseName: '資料結構',
      score: 88,
      letterGrade: 'A',
      credits: 3,
      passed: true,
      requirementType: '必修',
      generalEducationCategory: null,
      graduationCategory: 'required',
    });
  });

  test('H8 passed=0 映射為 false，不受字串 truthiness 影響', () => {
    assert.equal(mapCourseHistoryRow(row({ passed: 0 })).passed, false);
  });

  test('H8 必要 DB 欄位缺漏時明確回報 503', () => {
    assert.throws(
      () => mapCourseHistoryRow(row({ course_name: null })),
      err => err instanceof CourseHistoryUnavailableError
        && err.status === 503
        && err.code === 'COURSE_HISTORY_UNAVAILABLE'
    );
  });

  test('H8 runtime 與畢業 route 不得再讀 users.json.courseHistory', () => {
    const memory = fs.readFileSync(new URL('../src/services/memoryService.js', import.meta.url), 'utf8');
    const graduation = fs.readFileSync(new URL('../src/routes/graduation.js', import.meta.url), 'utf8');
    const users = JSON.parse(fs.readFileSync(new URL('../data/users.json', import.meta.url), 'utf8'));
    assert.doesNotMatch(memory, /user\.courseHistory/);
    assert.match(memory, /getUserCourseHistory\(identity\)/);
    assert.doesNotMatch(graduation, /user\.courseHistory/);
    assert.ok(users.every(user => !Object.hasOwn(user, 'courseHistory')));
  });

  test('H8 migration 預設 dry-run，shared MySQL apply 必須雙重確認', () => {
    const migration = fs.readFileSync(new URL('../scripts/courseHistoryMigration.js', import.meta.url), 'utf8');
    assert.match(migration, /const apply = args\.has\('--apply'\)/);
    assert.match(migration, /const confirmed = args\.has\('--confirm-shared-mysql'\)/);
    assert.match(migration, /if \(!apply\) return/);
    assert.match(migration, /if \(!confirmed\) throw new Error/);
    assert.match(migration, /backup\(users, \[TARGET_TABLE\]\)/);
  });

  test('H8 migration 拒絕部分狀態，重跑 v1 僅驗證不重複匯入', () => {
    const migration = fs.readFileSync(new URL('../scripts/courseHistoryMigration.js', import.meta.url), 'utf8');
    assert.match(migration, /NEW_TABLE.*已存在.*未完成的 migration/s);
    assert.match(migration, /LEGACY_TABLE.*已存在.*拒絕猜測部分 migration 狀態/s);
    assert.match(migration, /if \(state\.alreadyV1\)[\s\S]*verifyImported\(users, TARGET_TABLE\)[\s\S]*未重複匯入/);
  });

  test('H8 schema 使用 catalog 課號、user FK，且 rollback 保留 v1 資料', () => {
    const up = fs.readFileSync(new URL('../migrations/004_course-history-v1.up.sql', import.meta.url), 'utf8');
    const down = fs.readFileSync(new URL('../migrations/004_course-history-v1.down.sql', import.meta.url), 'utf8');
    assert.match(up, /`catalog_course_code`/);
    assert.match(up, /UNIQUE KEY[^\n]*`user_id`, `catalog_course_code`, `academic_year`, `semester`/);
    assert.match(up, /REFERENCES `User_Profiles` \(`user_id`\) ON DELETE CASCADE/);
    assert.doesNotMatch(up, /REFERENCES `Courses`/);
    assert.match(down, /User_Course_History_Rollback_004/);
    assert.match(down, /User_Course_History_Legacy_004` TO `User_Course_History/);
  });
});
