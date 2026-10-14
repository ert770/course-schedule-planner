// 協同過濾與 User Embedding 構想階段 7：建立課程共現表。
// 預設 dry-run；修改 shared MySQL 需要同時加上 --apply 與 --confirm-shared-mysql。
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
  ? '009_course-neighbors.down.sql'
  : '009_course-neighbors.up.sql');
const tables = ['Course_Neighbor_Builds', 'Course_Neighbors'];

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

async function run() {
  const existing = await existingTables(tables);
  console.log(JSON.stringify({
    mode: apply ? (rollback ? 'rollback' : 'apply') : 'dry-run',
    migration: path.basename(migration),
    existingTables: existing,
    missingTables: tables.filter(table => !existing.includes(table)),
  }, null, 2));

  if (!apply) return;
  if (!confirmed) throw new Error('修改 shared MySQL 前必須加上 --confirm-shared-mysql');
  if (!rollback && existing.length > 0) {
    throw new Error('共現表已存在（全部或部分）；請先檢查目前 schema，不自動覆蓋。');
  }
  if (rollback && existing.length === 0) throw new Error('共現表不存在，沒有可回復的 schema。');
  for (const statement of statements(fs.readFileSync(migration, 'utf8'))) await queryRows(statement);
  console.log(`${rollback ? 'rollback' : 'migration'} 完成。`);
}

run().catch(err => { console.error(err.message); process.exitCode = 1; }).finally(() => closePool());
