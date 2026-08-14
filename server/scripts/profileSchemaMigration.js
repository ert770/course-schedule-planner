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
const backupArg = process.argv.find(arg => arg.startsWith('--backup='));

const projectRoot = path.resolve(__dirname, '..', '..');
const usersPath = path.join(projectRoot, 'server', 'data', 'users.json');
const backupDir = path.join(projectRoot, 'server', 'backups', 'profile-schema');
const upSqlPath = path.join(projectRoot, 'server', 'migrations', '001_profile_schema_v1.up.sql');
const downSqlPath = path.join(projectRoot, 'server', 'migrations', '001_profile_schema_v1.down.sql');

function readUsers() {
  return JSON.parse(fs.readFileSync(usersPath, 'utf8'));
}

function splitStatements(sql) {
  return sql.split(';').map(statement => statement.trim()).filter(Boolean);
}

async function executeSqlFile(filePath) {
  for (const statement of splitStatements(fs.readFileSync(filePath, 'utf8'))) {
    await queryRows(statement);
  }
}

async function currentColumns() {
  const rows = await queryRows('SHOW COLUMNS FROM `User_Profiles`');
  return new Set(rows.map(row => row.Field));
}

async function createBackup() {
  fs.mkdirSync(backupDir, { recursive: true });
  const rows = await queryRows('SELECT * FROM `User_Profiles` ORDER BY `user_id`');
  const filePath = path.join(backupDir, `user-profiles-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(filePath, JSON.stringify({ createdAt: new Date().toISOString(), rows }, null, 2));
  return filePath;
}

async function backfillStudentIds() {
  for (const user of readUsers()) {
    if (user.id === undefined || !user.studentId) continue;
    await queryRows(
      'UPDATE `User_Profiles` SET `student_id` = ?, `class_name` = COALESCE(`class_name`, ?), `profile_schema_version` = 1 WHERE `user_id` = ?',
      [String(user.studentId), user.className ?? null, user.id]
    );
  }
}

async function run() {
  if (rollback) {
    if (!confirmed) throw new Error('rollback shared MySQL 前必須加上 --confirm-shared-mysql');
    if (!backupArg) throw new Error('rollback 必須提供 --backup=<備份檔路徑>');
    const backup = JSON.parse(fs.readFileSync(path.resolve(backupArg.slice(9)), 'utf8'));
    await executeSqlFile(downSqlPath);
    console.log(`Schema 已回滾；原始 ${backup.rows.length} 筆資料仍保存在備份檔，未自動覆寫其他欄位。`);
    return;
  }

  const columns = await currentColumns();
  const missing = ['student_id', 'class_name', 'profile_schema_version']
    .filter(column => !columns.has(column));
  const users = readUsers().filter(user => user.id !== undefined && user.studentId);
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', missingColumns: missing, backfillRows: users.length }, null, 2));

  if (!apply) return;
  if (!confirmed) throw new Error('修改 shared MySQL 前必須加上 --confirm-shared-mysql');
  if (missing.length === 0) {
    console.log('Schema 已是 v1；只檢查並補齊 student_id，重複執行不新增欄位。');
  } else if (missing.length === 3) {
    const backupPath = await createBackup();
    console.log(`備份完成：${backupPath}`);
    await executeSqlFile(upSqlPath);
  } else {
    throw new Error(`偵測到部分 migration 狀態：缺少 ${missing.join(', ')}，請先人工檢查。`);
  }
  await backfillStudentIds();
}

run()
  .catch(err => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => closePool());
