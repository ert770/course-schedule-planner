import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { closePool, queryRows, withTransaction } from '../src/db/mysql.js';

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

function backfillPlan() {
  return readUsers().filter(user => user.id !== undefined && user.studentId);
}

// **這個回填假設的是一件無法由程式自己證明的事**：本機
// `server/data/users.json` 的 `id` 欄位，跟你目前連線的這個 shared MySQL
// 裡 `User_Profiles.user_id` 是同一位真實學生。這兩份資料如果是各自獨立
// 匯入、或曾經以不同順序重建過，`id` 對不上 `user_id` 也不會有任何錯誤
// 訊息——UPDATE 照樣「成功」，只是把 student_id 寫進了別人的 profile。
// 執行 `--apply` 前，操作者必須自行確認這份對照在你的環境裡成立
// （例如拿一小批已知帳號，人工核對 shared MySQL 裡 user_id 對應的資料
// 是否真的是同一位學生），不能只憑這個腳本的輸出就放心套用。
const IDENTITY_ASSUMPTION_WARNING = [
  '⚠️  本次回填假設 users.json 的 id 欄位與 shared MySQL 的',
  '   User_Profiles.user_id 對應同一位真實學生。這個對應無法由程式自動證明，',
  '   請先人工核對下方列出的對照表，確認無誤後才繼續。',
].join('\n');

function printBackfillPreview(users) {
  console.log(IDENTITY_ASSUMPTION_WARNING);
  console.log('預計回填對照（user_id → studentId, className）：');
  for (const user of users) {
    console.log(`  ${user.id} → ${user.studentId}${user.className ? `, ${user.className}` : ''}`);
  }
}

// 全部包在單一交易裡：任何一筆 UPDATE 沒有精準命中恰好 1 筆（代表
// users.json 的 id 在這個 shared MySQL 裡找不到對應 user_id——正是「本地
// id 與遠端 user_id 對不上」的具體訊號），立刻拋錯並讓整批 rollback，
// 不會留下部分套用、部分未套用的中間狀態。先前每筆各自 autocommit，
// 半途失敗就會留下半套資料，且完全沒有檢查 affectedRows，就算對錯了
// 學生也會靜默「成功」。
async function backfillStudentIds(users) {
  await withTransaction(async connection => {
    for (const user of users) {
      const [result] = await connection.execute(
        'UPDATE `User_Profiles` SET `student_id` = ?, `class_name` = COALESCE(`class_name`, ?), `profile_schema_version` = 1 WHERE `user_id` = ?',
        [String(user.studentId), user.className ?? null, user.id]
      );
      if (result.affectedRows !== 1) {
        throw new Error(
          `user_id=${user.id}（studentId=${user.studentId}）預期精準命中 1 筆，`
          + `實際命中 ${result.affectedRows} 筆。整批回填已中止並 rollback，`
          + '沒有任何資料被寫入。這代表 users.json 的 id 與這個 shared MySQL 的 '
          + 'User_Profiles.user_id 對不上，請勿假設本地 id 是權威來源——'
          + '先確認正確的 user_id ↔ studentId 對照，或聯繫掌握這個 shared MySQL 的人。'
        );
      }
    }
  });
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
  const users = backfillPlan();
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', missingColumns: missing, backfillRows: users.length }, null, 2));
  // 對照表在 dry-run 與 apply 都印出，讓操作者在下決定要不要加 --apply 之前
  // 就能核對——不是只在真的要寫入時才第一次看到要改哪些列。
  printBackfillPreview(users);

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
  await backfillStudentIds(users);
  console.log(`回填完成（單一交易，全部成功）：${users.length} 筆。`);
}

run()
  .catch(err => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => closePool());
