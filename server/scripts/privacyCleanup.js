import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { closePool } from '../src/db/mysql.js';
import { cleanupExpiredPrivacyData } from '../src/services/privacyService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env'), quiet: true });

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const confirmed = args.has('--confirm-retention-delete');

async function run() {
  if (apply && !confirmed) throw new Error('執行保存期限刪除前必須加上 --confirm-retention-delete');
  console.log(JSON.stringify(await cleanupExpiredPrivacyData({ dryRun: !apply }), null, 2));
}

run().catch(err => { console.error(err.message); process.exitCode = 1; }).finally(() => closePool());
