import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { closePool } from '../src/db/mysql.js';
import { cleanupExpiredPrivacyData } from '../src/services/privacyService.js';
import { cleanupExpiredInteractionEvents } from '../src/services/interactionEventService.js';
import { cleanupExpiredLearnedWeights } from '../src/services/preferenceLearningService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env'), quiet: true });

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const confirmed = args.has('--confirm-retention-delete');

async function run() {
  if (apply && !confirmed) throw new Error('執行保存期限刪除前必須加上 --confirm-retention-delete');
  // 三種資料的保存期限不同（Raw Chat 30 天、interaction events／learned
  // weights 180 天），但都由這一支負責，避免其中一種被漏掉而無限累積。
  const dryRun = !apply;
  console.log(JSON.stringify({
    ...(await cleanupExpiredPrivacyData({ dryRun })),
    ...(await cleanupExpiredInteractionEvents({ dryRun })),
    ...(await cleanupExpiredLearnedWeights({ dryRun })),
  }, null, 2));
}

run().catch(err => { console.error(err.message); process.exitCode = 1; }).finally(() => closePool());
