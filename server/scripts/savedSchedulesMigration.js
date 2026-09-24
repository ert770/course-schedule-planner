// Saved_Schedules + User_Profiles extra columns migration for shared MySQL.
//
// Default mode is read-only dry-run. Applying or rolling back requires both
// --apply and --confirm-shared-mysql because deploying source code is not consent
// to mutate the schema shared with project teammates.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { closePool, queryRows } from '../src/db/mysql.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env'), quiet: true });

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const rollback = args.has('--rollback');
const confirmed = args.has('--confirm-shared-mysql');
const migration = path.resolve(__dirname, '..', 'migrations', rollback
  ? '007_saved-schedules-and-profile-extras.down.sql'
  : '007_saved-schedules-and-profile-extras.up.sql');

const TABLE = 'Saved_Schedules';
const PREREQUISITE_TABLE = 'User_Profiles';
const PROFILE_COLUMNS = [
  'must_take_courses',
  'avoid_instructors',
  'preferences_json',
  'password_hash',
  'watchlist',
  'skill_tree',
  'overall_score',
  'overall_score_max',
];

function statements(sql) {
  return sql.split(';').map(value => value.trim()).filter(Boolean);
}

async function tableExists(name) {
  const rows = await queryRows(
    'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
    [name]
  );
  return rows.length > 0;
}

async function existingColumns(table, columns) {
  const found = [];
  for (const column of columns) {
    const rows = await queryRows(
      'SELECT COLUMN_NAME FROM information_schema.COLUMNS '
        + 'WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
      [table, column]
    );
    if (rows.length > 0) found.push(column);
  }
  return found;
}

function assertConsistentState({ tablePresent, presentColumns }) {
  const allColumnsPresent = presentColumns.length === PROFILE_COLUMNS.length;
  const noColumnsPresent = presentColumns.length === 0;
  if ((tablePresent && allColumnsPresent) || (!tablePresent && noColumnsPresent)) return;

  throw new Error(
    '偵測到 migration 007 部分套用狀態，為避免覆蓋組員的 schema，請先人工核對。'
  );
}

async function run() {
  const prerequisitePresent = await tableExists(PREREQUISITE_TABLE);
  const tablePresent = await tableExists(TABLE);
  const presentColumns = prerequisitePresent
    ? await existingColumns(PREREQUISITE_TABLE, PROFILE_COLUMNS)
    : [];
  const missingColumns = PROFILE_COLUMNS.filter(column => !presentColumns.includes(column));

  console.log(JSON.stringify({
    mode: apply ? (rollback ? 'rollback' : 'apply') : 'dry-run',
    migration: path.basename(migration),
    existingTables: tablePresent ? [TABLE] : [],
    missingTables: tablePresent ? [] : [TABLE],
    existingColumns: presentColumns,
    missingColumns,
    prerequisites: prerequisitePresent ? [PREREQUISITE_TABLE] : [],
    missingPrerequisites: prerequisitePresent ? [] : [PREREQUISITE_TABLE],
  }, null, 2));

  if (!apply) return;
  if (!confirmed) throw new Error('修改 shared MySQL 前必須加上 --confirm-shared-mysql');
  if (!prerequisitePresent) throw new Error('缺少 User_Profiles，無法執行 migration 007');

  assertConsistentState({ tablePresent, presentColumns });
  const alreadyAtTarget = rollback
    ? !tablePresent && presentColumns.length === 0
    : tablePresent && missingColumns.length === 0;
  if (alreadyAtTarget) {
    console.log(rollback ? 'rollback 已是目標狀態。' : 'migration 007 已套用。');
    return;
  }

  for (const statement of statements(fs.readFileSync(migration, 'utf8'))) {
    await queryRows(statement);
  }
  console.log(`${rollback ? 'rollback' : 'migration'} 完成。`);
}

run()
  .catch(err => { console.error(err.message); process.exitCode = 1; })
  .finally(() => closePool());
