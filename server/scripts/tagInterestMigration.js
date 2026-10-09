// Roadmap #43 stage 3: the migration is dry-run by default. Shared MySQL schema
// changes require both --apply and --confirm-shared-mysql.
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
  ? '008_tag-interest-profile.down.sql'
  : '008_tag-interest-profile.up.sql');
const tableName = 'Learned_Tag_Interests';
const addedColumns = ['rating', 'interest_feedback_json', 'tag_interest_snapshot_json'];
const prerequisites = ['Privacy_Subject_State', 'Interaction_Events'];

function statements(sql) {
  return sql.split(';').map(value => value.trim()).filter(Boolean);
}

async function existingTables(names) {
  const found = [];
  for (const table of names) {
    const rows = await queryRows(
      'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
      [table]
    );
    if (rows.length > 0) found.push(table);
  }
  return found;
}

async function existingAddedColumns() {
  const placeholders = addedColumns.map(() => '?').join(', ');
  const rows = await queryRows(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Interaction_Events'
        AND COLUMN_NAME IN (${placeholders})`,
    addedColumns
  );
  return rows.map(row => row.COLUMN_NAME ?? row.column_name);
}

async function run() {
  const existing = await existingTables([tableName]);
  const presentPrerequisites = await existingTables(prerequisites);
  const missingPrerequisites = prerequisites.filter(table => !presentPrerequisites.includes(table));
  const presentAddedColumns = await existingAddedColumns();
  const missingAddedColumns = addedColumns.filter(column => !presentAddedColumns.includes(column));
  console.log(JSON.stringify({
    mode: apply ? (rollback ? 'rollback' : 'apply') : 'dry-run',
    migration: path.basename(migration),
    existingTables: existing,
    missingTables: existing.includes(tableName) ? [] : [tableName],
    presentAddedColumns,
    missingAddedColumns,
    prerequisites: presentPrerequisites,
    missingPrerequisites,
  }, null, 2));

  if (!apply) return;
  if (!confirmed) throw new Error('修改 shared MySQL 前必須加上 --confirm-shared-mysql');
  if (!rollback && missingPrerequisites.length > 0) {
    throw new Error(`缺少必要隱私／互動表：${missingPrerequisites.join('、')}`);
  }
  if (!rollback && (existing.includes(tableName) || presentAddedColumns.length > 0)) {
    throw new Error('標籤興趣 migration 的表或欄位已存在；請先檢查目前 schema，不自動覆蓋。');
  }
  if (rollback && !existing.includes(tableName) && presentAddedColumns.length === 0) {
    throw new Error('標籤興趣 migration 的表與欄位都不存在，沒有可回復的 schema。');
  }
  if (rollback && presentAddedColumns.length > 0 && missingAddedColumns.length > 0) {
    throw new Error('事件欄位只有部分存在，無法安全自動 rollback；請先檢查目前 schema。');
  }
  if (rollback && existing.includes(tableName) && presentAddedColumns.length === 0) {
    throw new Error('標籤興趣表存在但事件欄位不存在，無法確認 schema 狀態；請先人工檢查。');
  }
  for (const statement of statements(fs.readFileSync(migration, 'utf8'))) await queryRows(statement);
  console.log(`${rollback ? 'rollback' : 'migration'} 完成。`);
}

run().catch(err => { console.error(err.message); process.exitCode = 1; }).finally(() => closePool());
