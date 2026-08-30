// Roadmap #2：`Interaction_Events` 的 shared MySQL migration。
//
// 契約與 `privacyMigration.js` 完全一致：預設 dry-run 只回報現況，
// `--apply` 才真的執行，且必須另外加上 `--confirm-shared-mysql`——
// 這是與組員共用的資料庫，部署原始碼不等於同意改結構。
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
  ? '003_interaction-events.down.sql'
  : '003_interaction-events.up.sql');
const tables = ['Interaction_Events'];

// #2 的表對 `Privacy_Subject_State` 有 FK。#33 的 migration 尚未套用時就建表
// 會失敗在難以解讀的 errno 1215，先明確檢查並回報。
const prerequisites = ['Privacy_Subject_State'];

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
  const presentPrerequisites = await existingTables(prerequisites);
  const missingPrerequisites = prerequisites.filter(table => !presentPrerequisites.includes(table));

  console.log(JSON.stringify({
    mode: apply ? (rollback ? 'rollback' : 'apply') : 'dry-run',
    migration: path.basename(migration),
    existingTables: existing,
    missingTables: tables.filter(table => !existing.includes(table)),
    prerequisites: presentPrerequisites,
    missingPrerequisites,
  }, null, 2));

  if (!apply) return;
  if (!confirmed) throw new Error('修改 shared MySQL 前必須加上 --confirm-shared-mysql');
  if (!rollback && missingPrerequisites.length > 0) {
    throw new Error(`缺少 002_privacy-foundation 的 ${missingPrerequisites.join('、')}，請先完成 #33 migration`);
  }
  for (const statement of statements(fs.readFileSync(migration, 'utf8'))) await queryRows(statement);
  console.log(`${rollback ? 'rollback' : 'migration'} 完成。`);
}

run().catch(err => { console.error(err.message); process.exitCode = 1; }).finally(() => closePool());
