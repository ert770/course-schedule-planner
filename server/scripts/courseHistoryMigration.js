// Roadmap #8：將 users.json.courseHistory 一次性搬入 shared MySQL。
//
// 預設只做 dry-run。正式套用必須同時傳入 --apply 與
// --confirm-shared-mysql；資料逐欄驗證完成前不會切換正式表名。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { closePool, queryRows, withTransaction } from '../src/db/mysql.js';
import {
  COURSE_HISTORY_REQUIRED_FIELDS,
  getEarnedCredits,
  getPassedCourseCodes,
  getTotalEarnedCredits,
  validateCourseHistoryEntry,
} from '../src/data/courseHistory.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env'), quiet: true });

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const rollback = args.has('--rollback');
const confirmed = args.has('--confirm-shared-mysql');

const projectRoot = path.resolve(__dirname, '..', '..');
const usersPath = path.join(projectRoot, 'server', 'data', 'users.json');
const backupDir = path.join(projectRoot, 'server', 'backups', 'course-history');
const upSqlPath = path.join(projectRoot, 'server', 'migrations', '004_course-history-v1.up.sql');
const downSqlPath = path.join(projectRoot, 'server', 'migrations', '004_course-history-v1.down.sql');
const TARGET_TABLE = 'User_Course_History';
const NEW_TABLE = 'User_Course_History_v1_new';
const LEGACY_TABLE = 'User_Course_History_Legacy_004';
const ROLLBACK_TABLE = 'User_Course_History_Rollback_004';

function statements(sql) {
  return sql.split(';').map(value => value.trim()).filter(Boolean);
}

async function executeSqlFile(filePath) {
  for (const statement of statements(fs.readFileSync(filePath, 'utf8'))) {
    await queryRows(statement);
  }
}

function readSourceUsers() {
  const users = JSON.parse(fs.readFileSync(usersPath, 'utf8'));
  return users.filter(user => Array.isArray(user.courseHistory) && user.courseHistory.length > 0);
}

function validateSource(users) {
  const seenAttempts = new Set();
  for (const user of users) {
    if (!Number.isInteger(Number(user.id))) {
      throw new Error(`studentId=${user.studentId ?? 'unknown'} 缺少 numeric id，無法對應 User_Profiles.user_id`);
    }
    for (const [index, entry] of user.courseHistory.entries()) {
      const validation = validateCourseHistoryEntry(entry);
      if (!validation.valid) {
        throw new Error(
          `studentId=${user.studentId} courseHistory[${index}] 缺少欄位：${validation.missingFields.join(', ')}`
        );
      }
      const attemptKey = [user.id, entry.courseCode, entry.academicYear, entry.semester].join('|');
      if (seenAttempts.has(attemptKey)) throw new Error(`修課紀錄唯一鍵重複：${attemptKey}`);
      seenAttempts.add(attemptKey);
    }
  }
}

async function tableExists(table) {
  const rows = await queryRows(
    'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
    [table]
  );
  return rows.length > 0;
}

async function tableColumns(table) {
  if (!await tableExists(table)) return [];
  const rows = await queryRows(
    'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION',
    [table]
  );
  return rows.map(row => row.COLUMN_NAME);
}

function isV1Columns(columns) {
  return [
    'history_id', 'user_id', 'catalog_course_code', 'academic_year', 'semester',
    'course_name', 'score', 'letter_grade', 'credits', 'passed', 'requirement_type',
    'general_education_category', 'graduation_category', 'source', 'created_at', 'updated_at',
  ].every(column => columns.includes(column));
}

async function assertIdentityRows(users) {
  for (const user of users) {
    const rows = await queryRows(
      'SELECT `user_id`, `department`, `grade_level` FROM `User_Profiles` WHERE `user_id` = ?',
      [Number(user.id)]
    );
    if (rows.length !== 1) {
      throw new Error(
        `users.json id=${user.id}（studentId=${user.studentId}）預期精準命中 1 筆 User_Profiles，實際 ${rows.length} 筆`
      );
    }
  }
}

async function backup(users, tables) {
  fs.mkdirSync(backupDir, { recursive: true });
  const snapshot = { createdAt: new Date().toISOString(), sourceUsers: users, tables: {} };
  for (const table of tables) {
    if (!await tableExists(table)) continue;
    const [ddl] = await queryRows(`SHOW CREATE TABLE \`${table}\``);
    const rows = await queryRows(`SELECT * FROM \`${table}\` ORDER BY 1`);
    snapshot.tables[table] = { ddl: ddl['Create Table'], rows };
  }
  const filePath = path.join(backupDir, `course-history-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2));
  return filePath;
}

const INSERT_SQL = `INSERT INTO \`${NEW_TABLE}\`
  (user_id, catalog_course_code, academic_year, semester, course_name, score,
   letter_grade, credits, passed, requirement_type, general_education_category,
   graduation_category, source)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

function insertParams(user, entry) {
  return [
    Number(user.id),
    entry.courseCode,
    Number(entry.academicYear),
    Number(entry.semester),
    entry.courseName,
    entry.score ?? null,
    entry.letterGrade ?? null,
    Number(entry.credits),
    entry.passed ? 1 : 0,
    entry.requirementType,
    entry.generalEducationCategory ?? null,
    entry.graduationCategory,
    'users_json_migration_004',
  ];
}

function mapRow(row) {
  return {
    academicYear: Number(row.academic_year),
    semester: Number(row.semester),
    courseCode: row.catalog_course_code,
    courseName: row.course_name,
    score: row.score === null ? null : Number(row.score),
    letterGrade: row.letter_grade,
    credits: Number(row.credits),
    passed: Number(row.passed) === 1,
    requirementType: row.requirement_type,
    generalEducationCategory: row.general_education_category,
    graduationCategory: row.graduation_category,
  };
}

function canonicalEntry(entry) {
  return Object.fromEntries(COURSE_HISTORY_REQUIRED_FIELDS.map(field => [field, entry[field] ?? null]));
}

async function verifyImported(users, table = NEW_TABLE) {
  for (const user of users) {
    const rows = await queryRows(
      `SELECT * FROM \`${table}\` WHERE \`user_id\` = ? ORDER BY \`academic_year\`, \`semester\`, \`history_id\``,
      [Number(user.id)]
    );
    const expected = user.courseHistory.map(canonicalEntry)
      .sort((a, b) => a.academicYear - b.academicYear || a.semester - b.semester || a.courseCode.localeCompare(b.courseCode));
    const actual = rows.map(mapRow).map(canonicalEntry)
      .sort((a, b) => a.academicYear - b.academicYear || a.semester - b.semester || a.courseCode.localeCompare(b.courseCode));
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`studentId=${user.studentId} 匯入後逐欄比較不一致`);
    }
    const earned = getEarnedCredits(actual);
    const total = getTotalEarnedCredits(actual);
    const passedCodes = getPassedCourseCodes(actual);
    if (actual.length !== user.courseHistory.length || passedCodes.length !== new Set(passedCodes).size) {
      throw new Error(`studentId=${user.studentId} 匯入筆數或課號唯一性驗證失敗`);
    }
    console.log(JSON.stringify({
      studentId: user.studentId,
      rows: actual.length,
      earned,
      totalEarned: total,
      uniquePassedCodes: new Set(passedCodes).size,
    }, null, 2));
  }
}

async function migrate(users) {
  if (await tableExists(NEW_TABLE)) throw new Error(`${NEW_TABLE} 已存在，可能是未完成的 migration，請先人工檢查`);
  if (await tableExists(LEGACY_TABLE)) throw new Error(`${LEGACY_TABLE} 已存在，但正式表尚非 v1，拒絕猜測部分 migration 狀態`);

  const backupPath = await backup(users, [TARGET_TABLE]);
  console.log(`備份完成：${backupPath}`);
  await executeSqlFile(upSqlPath);
  try {
    await withTransaction(async connection => {
      for (const user of users) {
        for (const entry of user.courseHistory) await connection.execute(INSERT_SQL, insertParams(user, entry));
      }
    });
    await verifyImported(users);
    await queryRows(
      `RENAME TABLE \`${TARGET_TABLE}\` TO \`${LEGACY_TABLE}\`, \`${NEW_TABLE}\` TO \`${TARGET_TABLE}\``
    );
    await verifyImported(users, TARGET_TABLE);
  } catch (err) {
    if (await tableExists(NEW_TABLE)) await queryRows(`DROP TABLE \`${NEW_TABLE}\``);
    throw err;
  }
}

async function rollbackMigration() {
  if (!confirmed) throw new Error('rollback shared MySQL 前必須加上 --confirm-shared-mysql');
  if (!await tableExists(LEGACY_TABLE)) throw new Error(`${LEGACY_TABLE} 不存在，無法 rollback`);
  if (await tableExists(ROLLBACK_TABLE)) throw new Error(`${ROLLBACK_TABLE} 已存在，拒絕覆蓋先前保留資料`);
  const backupPath = await backup([], [TARGET_TABLE, LEGACY_TABLE]);
  console.log(`rollback 前備份完成：${backupPath}`);
  await executeSqlFile(downSqlPath);
  console.log(`rollback 完成；v1 資料保留於 ${ROLLBACK_TABLE}`);
}

async function run() {
  if (rollback) return rollbackMigration();

  const users = readSourceUsers();
  validateSource(users);
  const columns = await tableColumns(TARGET_TABLE);
  const state = {
    mode: apply ? 'apply' : 'dry-run',
    sourceUsers: users.map(user => ({ id: user.id, studentId: user.studentId, rows: user.courseHistory.length })),
    targetColumns: columns,
    alreadyV1: isV1Columns(columns),
    legacyTableExists: await tableExists(LEGACY_TABLE),
    stagingTableExists: await tableExists(NEW_TABLE),
  };
  console.log(JSON.stringify(state, null, 2));
  await assertIdentityRows(users);

  if (!apply) return;
  if (!confirmed) throw new Error('修改 shared MySQL 前必須加上 --confirm-shared-mysql');
  if (state.alreadyV1) {
    await verifyImported(users, TARGET_TABLE);
    console.log('User_Course_History 已是 v1，驗證通過，未重複匯入。');
    return;
  }
  if (columns.length === 0) throw new Error(`${TARGET_TABLE} 不存在；本 migration 只接受已盤點的 legacy 表，拒絕猜測環境狀態`);
  await migrate(users);
  console.log('004 course-history migration 完成。');
}

run()
  .catch(err => { console.error(err.message); process.exitCode = 1; })
  .finally(() => closePool());
