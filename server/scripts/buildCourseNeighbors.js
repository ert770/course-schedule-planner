// 協同過濾與 User Embedding 構想階段 7：手動重建課程共現表。
//
//   node scripts/buildCourseNeighbors.js                         dry-run：只算、只印彙總，不寫入
//   node scripts/buildCourseNeighbors.js --include-simulated     dry-run 並加入 Persona／demo（只驗證管線，結果標為模擬）
//   node scripts/buildCourseNeighbors.js --apply --confirm-shared-mysql   只用真人資料寫入正式共現表
//
// 輸出只有彙總數字與課號，不含 subject 或學號。伺服器平時每 24 小時自動重建一次。
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { closePool } from '../src/db/mysql.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env'), quiet: true });

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const includeSimulated = args.has('--include-simulated');

async function run() {
  if (apply && !args.has('--confirm-shared-mysql')) throw new Error('寫入 shared MySQL 前必須加上 --confirm-shared-mysql');
  if (apply && includeSimulated) throw new Error('--include-simulated 只能用於 dry-run');
  const { rebuildCourseNeighbors } = await import('../src/services/courseNeighborService.js');
  const build = await rebuildCourseNeighbors({ persist: apply, includeSimulated });
  const sample = [...build.neighbors].slice(0, 5).map(([code, list]) => ({
    courseCode: code,
    neighbors: list.slice(0, 3).map(item => ({ courseCode: item.courseCode, similarity: Number(item.similarity.toFixed(3)) })),
  }));
  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'dry-run',
    simulatedIncluded: includeSimulated,
    modelVersion: build.modelVersion,
    computedAt: build.computedAt,
    settings: build.settings,
    stats: build.stats,
    gate: build.gate,
    sample,
  }, null, 2));
}

run().catch(err => { console.error(err.message); process.exitCode = 1; }).finally(() => closePool());
