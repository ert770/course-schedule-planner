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
  ? '002_privacy-foundation.down.sql'
  : '002_privacy-foundation.up.sql');
const tables = ['Privacy_Subject_State', 'Privacy_Consents', 'Privacy_Audit_Log', 'Privacy_Data_Requests', 'Chat_Messages'];

function statements(sql) {
  return sql.split(';').map(value => value.trim()).filter(Boolean);
}

async function run() {
  const existing = [];
  for (const table of tables) {
    const rows = await queryRows(
      'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
      [table]
    );
    if (rows.length > 0) existing.push(table);
  }
  console.log(JSON.stringify({
    mode: apply ? (rollback ? 'rollback' : 'apply') : 'dry-run',
    migration: path.basename(migration),
    existingTables: existing,
    missingTables: tables.filter(table => !existing.includes(table)),
  }, null, 2));

  if (!apply) return;
  if (!confirmed) throw new Error('修改 shared MySQL 前必須加上 --confirm-shared-mysql');
  for (const statement of statements(fs.readFileSync(migration, 'utf8'))) await queryRows(statement);
  console.log(`${rollback ? 'rollback' : 'migration'} 完成。`);
}

run().catch(err => { console.error(err.message); process.exitCode = 1; }).finally(() => closePool());
