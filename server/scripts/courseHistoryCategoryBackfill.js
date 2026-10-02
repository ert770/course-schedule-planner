// 依必選修科目表回填 User_Course_History 中「未分類」的畢業分類。
//
// 預設只做 dry-run。正式套用必須同時傳入 --apply 與 --confirm-shared-mysql。
// 只會更新 `graduation_category = 'unspecified'` 的列，而且只在課號對得上科目表時才改；
// 已有分類的列（含另一來源匯入、逐門帶分類的紀錄）一律不動。套用前把受影響的列備份到
// server/backups/course-history/（已被 .gitignore 排除）。
//
// 用法：
//   node scripts/courseHistoryCategoryBackfill.js
//   node scripts/courseHistoryCategoryBackfill.js --apply --confirm-shared-mysql
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

import { closePool, isMysqlConfigured, queryRows, withTransaction } from '../src/db/mysql.js';
import { classifyHistoryEntryByCurriculum } from '../src/data/courseHistoryClassification.js';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(scriptDir, '..', '.env'), quiet: true });
dotenv.config({ path: path.resolve(scriptDir, '..', '..', '.env'), quiet: true });

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const confirmed = args.has('--confirm-shared-mysql');
const backupDir = path.join(scriptDir, '..', 'backups', 'course-history');

function summarize(rows) {
  const byUser = new Map();
  for (const row of rows) {
    const bucket = byUser.get(row.user_id) ?? {};
    const key = row.graduation_category;
    bucket[key] = (bucket[key] || 0) + Number(row.credits);
    byUser.set(row.user_id, bucket);
  }
  return byUser;
}

async function main() {
  if (!isMysqlConfigured()) throw new Error('未設定 MySQL，無法回填。');
  if (apply && !confirmed) {
    throw new Error('--apply 必須同時傳入 --confirm-shared-mysql（這會改寫共用資料庫）。');
  }

  const rows = await queryRows(
    `SELECT history_id, user_id, catalog_course_code, course_name, credits, passed,
            requirement_type, general_education_category, graduation_category, source
       FROM User_Course_History
      ORDER BY user_id, catalog_course_code, history_id`
  );
  const changes = [];
  const unresolved = [];
  for (const row of rows) {
    if (row.graduation_category !== 'unspecified') continue;
    const classified = classifyHistoryEntryByCurriculum({
      courseCode: row.catalog_course_code,
      courseName: row.course_name,
      generalEducationCategory: row.general_education_category,
    });
    if (classified) changes.push({ row, classified });
    else unresolved.push(row);
  }

  const before = summarize(rows.filter(row => Number(row.passed) === 1));
  const after = summarize(rows.filter(row => Number(row.passed) === 1).map(row => {
    const change = changes.find(item => item.row.history_id === row.history_id);
    return change ? { ...row, graduation_category: change.classified.graduationCategory } : row;
  }));

  console.log(`未分類共 ${changes.length + unresolved.length} 筆；可依科目表分類 ${changes.length} 筆，維持未分類 ${unresolved.length} 筆。`);
  const basisCount = {};
  for (const { classified } of changes) basisCount[classified.basis] = (basisCount[classified.basis] || 0) + 1;
  console.log('依據：', JSON.stringify(basisCount));
  for (const row of unresolved) {
    console.log(`  維持未分類：user ${row.user_id} ${row.catalog_course_code} ${row.course_name}（${row.credits} 學分）`);
  }
  console.log('\n已通過學分，依分類（前 → 後）：');
  for (const [userId, bucket] of before) {
    console.log(`  user ${userId}`);
    console.log(`    前 ${JSON.stringify(bucket)}`);
    console.log(`    後 ${JSON.stringify(after.get(userId))}`);
  }

  if (!apply) {
    console.log('\ndry-run：沒有寫入任何資料。');
    return;
  }

  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(
    backupDir,
    `category-backfill-${new Date().toISOString().replace(/[:.]/gu, '-')}.json`
  );
  fs.writeFileSync(backupPath, `${JSON.stringify(changes.map(item => item.row), null, 2)}\n`, 'utf8');
  console.log(`\n已備份 ${changes.length} 筆原始列到 ${path.relative(process.cwd(), backupPath)}`);

  let updated = 0;
  await withTransaction(async connection => {
    for (const { row, classified } of changes) {
      // WHERE 再檢查一次 unspecified：備份之後若有人改過這一列，就不覆寫。
      const [result] = await connection.query(
        `UPDATE User_Course_History
            SET graduation_category = ?, requirement_type = ?
          WHERE history_id = ? AND graduation_category = 'unspecified'`,
        [classified.graduationCategory, classified.requirementType, row.history_id]
      );
      updated += result.affectedRows;
    }
    if (updated !== changes.length) {
      throw new Error(`預期更新 ${changes.length} 筆，實際 ${updated} 筆；已 rollback。`);
    }
  });
  console.log(`已更新 ${updated} 筆。`);
}

try {
  await main();
} finally {
  await closePool();
}
