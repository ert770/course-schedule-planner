// Roadmap #23：為 `User_Profiles` 新增 `admission_year` 欄位並回填。
//
// 預設只做 dry-run。正式套用必須同時傳入 --apply 與 --confirm-shared-mysql
// （與 `courseHistoryMigration.js` 同一套規格——這是共用 MySQL，不是本專案獨佔）。
//
// **回填一律交叉驗證，對不上就中止不猜。** 入學年度有兩個獨立來源：
//   1. `grade_level` + `ACTIVE_TERM.academicYear`：入學年度 = 目前學年度 − 年級 + 1
//   2. `User_Course_History` 最早的 `academic_year`
// 兩者一致才寫入。不一致代表其中一個來源有問題（例如休學、轉學、延畢、
// 或成績單匯入不完整），那種情況下寫進去的值會是錯的，而錯的入學年度會靜默
// 選到錯的畢業規則版本——寧可留 NULL，讓 `resolveGraduationRule()` 誠實回報
// 「入學年度未知」。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { closePool, queryRows, withTransaction } from '../src/db/mysql.js';
import { ACTIVE_TERM } from '../src/data/activeTerm.js';
import { reconcileAdmissionYear } from '../src/data/admissionYear.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env'), quiet: true });

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const rollback = args.has('--rollback');
const confirmed = args.has('--confirm-shared-mysql');

const projectRoot = path.resolve(__dirname, '..', '..');
const backupDir = path.join(projectRoot, 'server', 'backups', 'admission-year');
const upSqlPath = path.join(projectRoot, 'server', 'migrations', '005_admission-year.up.sql');
const downSqlPath = path.join(projectRoot, 'server', 'migrations', '005_admission-year.down.sql');
const TARGET_TABLE = 'User_Profiles';
const TARGET_COLUMN = 'admission_year';

function statements(sql) {
  return sql.split(';').map(value => value.trim()).filter(Boolean);
}

async function executeSqlFile(filePath) {
  for (const statement of statements(fs.readFileSync(filePath, 'utf8'))) {
    await queryRows(statement);
  }
}

async function columnExists() {
  const rows = await queryRows(
    'SELECT COLUMN_NAME FROM information_schema.COLUMNS '
    + 'WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    [TARGET_TABLE, TARGET_COLUMN]
  );
  return rows.length > 0;
}

async function backup() {
  fs.mkdirSync(backupDir, { recursive: true });
  const [ddl] = await queryRows(`SHOW CREATE TABLE \`${TARGET_TABLE}\``);
  const rows = await queryRows(`SELECT * FROM \`${TARGET_TABLE}\` ORDER BY \`user_id\``);
  const snapshot = { createdAt: new Date().toISOString(), ddl: ddl['Create Table'], rows };
  const filePath = path.join(
    backupDir,
    `user-profiles-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  );
  fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2));
  return filePath;
}

async function buildBackfillPlan() {
  const profiles = await queryRows(
    `SELECT \`user_id\`, \`department\`, \`grade_level\` FROM \`${TARGET_TABLE}\` ORDER BY \`user_id\``
  );
  const history = await queryRows(
    'SELECT `user_id`, MIN(`academic_year`) AS earliest FROM `User_Course_History` GROUP BY `user_id`'
  );
  const earliestByUser = new Map(history.map(row => [Number(row.user_id), Number(row.earliest)]));

  return profiles.map(profile => {
    const { admissionYear, reason } = reconcileAdmissionYear({
      gradeLevel: profile.grade_level,
      earliestHistoryYear: earliestByUser.get(Number(profile.user_id)) ?? null,
      activeAcademicYear: ACTIVE_TERM.academicYear,
    });
    return {
      userId: Number(profile.user_id),
      department: profile.department,
      gradeLevel: profile.grade_level,
      earliestHistoryYear: earliestByUser.get(Number(profile.user_id)) ?? null,
      admissionYear,
      skippedReason: reason,
    };
  });
}

async function runRollback() {
  if (!confirmed) throw new Error('rollback shared MySQL 前必須加上 --confirm-shared-mysql');
  if (!await columnExists()) throw new Error(`${TARGET_TABLE}.${TARGET_COLUMN} 不存在，無法 rollback`);

  const backupPath = await backup();
  console.log(`rollback 前備份完成：${backupPath}`);
  await executeSqlFile(downSqlPath);
  console.log(`rollback 完成；欄位已移除，原始資料保存於 ${backupPath}`);
}

async function run() {
  if (rollback) return runRollback();

  const exists = await columnExists();
  const plan = await buildBackfillPlan();

  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'dry-run',
    activeAcademicYear: ACTIVE_TERM.academicYear,
    columnExists: exists,
    profiles: plan.length,
    willBackfill: plan.filter(row => row.admissionYear !== null).length,
    willSkip: plan.filter(row => row.admissionYear === null).length,
    plan,
  }, null, 2));

  if (!apply) {
    console.log('\n這是 dry-run。確認上方回填對照無誤後，加上 --apply --confirm-shared-mysql 才會實際寫入。');
    return;
  }
  if (!confirmed) throw new Error('修改 shared MySQL 前必須加上 --confirm-shared-mysql');

  const backupPath = await backup();
  console.log(`備份完成：${backupPath}`);

  if (!exists) {
    await executeSqlFile(upSqlPath);
    console.log(`${TARGET_TABLE}.${TARGET_COLUMN} 欄位已新增。`);
  } else {
    console.log(`${TARGET_TABLE}.${TARGET_COLUMN} 已存在，跳過 ALTER TABLE，只做回填。`);
  }

  const backfill = plan.filter(row => row.admissionYear !== null);
  await withTransaction(async connection => {
    for (const row of backfill) {
      // 只回填目前為 NULL 的列：重複執行不覆蓋任何人工修正過的值。
      await connection.execute(
        `UPDATE \`${TARGET_TABLE}\` SET \`${TARGET_COLUMN}\` = ? `
        + `WHERE \`user_id\` = ? AND \`${TARGET_COLUMN}\` IS NULL`,
        [row.admissionYear, row.userId]
      );
    }
  });

  const after = await queryRows(
    `SELECT \`user_id\`, \`${TARGET_COLUMN}\` FROM \`${TARGET_TABLE}\` ORDER BY \`user_id\``
  );
  console.log('回填後實際值：', JSON.stringify(after));
  console.log('005 admission-year migration 完成。');
}

run()
  .catch(err => { console.error(err.message); process.exitCode = 1; })
  .finally(() => closePool());
