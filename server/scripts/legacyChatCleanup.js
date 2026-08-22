import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..', '..');
const legacyPath = path.resolve(projectRoot, 'server', 'data', 'chat_history.json');
const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const confirmed = args.has('--confirm-legacy-chat-delete');

function assertTarget() {
  const expectedParent = path.resolve(projectRoot, 'server', 'data');
  if (path.dirname(legacyPath) !== expectedParent || path.basename(legacyPath) !== 'chat_history.json') {
    throw new Error('legacy chat 路徑不在預期的 server/data 目錄，拒絕操作');
  }
}

function summary() {
  if (!fs.existsSync(legacyPath)) return { exists: false, rows: 0, earliest: null, latest: null };
  const rows = JSON.parse(fs.readFileSync(legacyPath, 'utf8'));
  const dates = rows.map(row => Date.parse(row.createdAt)).filter(Number.isFinite).sort((a, b) => a - b);
  return {
    exists: true,
    rows: rows.length,
    earliest: dates.length ? new Date(dates[0]).toISOString() : null,
    latest: dates.length ? new Date(dates.at(-1)).toISOString() : null,
  };
}

assertTarget();
console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', target: legacyPath, ...summary() }, null, 2));
if (apply) {
  if (!confirmed) throw new Error('刪除舊聊天檔前必須加上 --confirm-legacy-chat-delete');
  fs.unlinkSync(legacyPath);
  console.log('舊聊天檔已刪除；此操作沒有建立含個資的備份。');
}
