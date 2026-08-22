import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '..', '.env');
const args = new Set(process.argv.slice(2));
const rotate = args.has('--rotate');
const confirmed = args.has('--confirm-local-secret-write');

if (!confirmed) {
  throw new Error('寫入本機 server/.env 前必須加上 --confirm-local-secret-write');
}

const original = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
const newline = original.includes('\r\n') ? '\r\n' : '\n';
let lines = original ? original.replace(/\r\n/g, '\n').split('\n') : [];

function currentValue(name) {
  const line = lines.find(value => value.startsWith(`${name}=`));
  return line ? line.slice(name.length + 1).trim() : null;
}

function isPlaceholder(value) {
  return !value || /^(replace_|your_|change_|example)/i.test(value);
}

function upsert(name, value) {
  const index = lines.findIndex(line => line.startsWith(`${name}=`));
  const next = `${name}=${value}`;
  if (index === -1) lines.push(next);
  else lines[index] = next;
}

const analyticsExisting = currentValue('ANALYTICS_ID_SECRET');
const dataKeyExisting = currentValue('PRIVACY_DATA_KEY_V1');
const analyticsChanged = rotate || isPlaceholder(analyticsExisting);
const dataKeyChanged = rotate || isPlaceholder(dataKeyExisting);

if (analyticsChanged) upsert('ANALYTICS_ID_SECRET', crypto.randomBytes(48).toString('base64url'));
if (dataKeyChanged) upsert('PRIVACY_DATA_KEY_V1', crypto.randomBytes(32).toString('base64'));
upsert('PRIVACY_STORE', 'mysql');
upsert('PRIVACY_ENFORCEMENT_ENABLED', 'true');

while (lines.length > 0 && lines.at(-1) === '') lines.pop();
fs.writeFileSync(envPath, `${lines.join(newline)}${newline}`, { encoding: 'utf8', mode: 0o600 });

console.log(JSON.stringify({
  target: 'server/.env',
  analyticsIdSecret: analyticsChanged ? 'generated' : 'preserved',
  privacyDataKeyV1: dataKeyChanged ? 'generated' : 'preserved',
  privacyStore: 'mysql',
  privacyEnforcementEnabled: true,
  secretValuesPrinted: false,
}, null, 2));
