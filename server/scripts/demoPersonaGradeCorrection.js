// 把三個 demo persona 的年級由四年級更正為三年級。
//
// 為什麼：三人都是 112 學年度入學，114 學年度是三年級；修課紀錄也顯示他們在 114 下學期
// 才修完三年級下的必修（計算機演算法、計算機結構學、專題研究(一)），四年級上的
// 專題研究(二) 尚未修。`User_Profiles` 卻記成四年級（班級 資訊四乙／資訊四合），
// 於是最低學分被算成四年級的 9、剩餘學期被算成 1、可修的班級也錯。
//
// 預設只做 dry-run。正式套用必須同時傳入 --apply 與 --confirm-shared-mysql。
// 只會動下面列出的三個 user_id，而且只在目前值與預期的舊值相符時才更新。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

import { closePool, isMysqlConfigured, queryRows, withTransaction } from '../src/db/mysql.js';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(scriptDir, '..', '.env'), quiet: true });
dotenv.config({ path: path.resolve(scriptDir, '..', '..', '.env'), quiet: true });

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const confirmed = args.has('--confirm-shared-mysql');
const backupDir = path.join(scriptDir, '..', 'backups', 'user-profiles');

// 班級只把年級字由「四」換成「三」，班別不變；`資訊三合` 是三年級的合班，課程資料中存在。
const CORRECTIONS = Object.freeze([
  { userId: 2, name: '黃廷崴', from: { gradeLevel: 4, className: '資訊四乙' }, to: { gradeLevel: 3, className: '資訊三乙' } },
  { userId: 3, name: '陳彥齊', from: { gradeLevel: 4, className: '資訊四乙' }, to: { gradeLevel: 3, className: '資訊三乙' } },
  { userId: 4, name: '黃思瑋', from: { gradeLevel: 4, className: '資訊四合' }, to: { gradeLevel: 3, className: '資訊三合' } },
]);

async function main() {
  if (!isMysqlConfigured()) throw new Error('未設定 MySQL。');
  if (apply && !confirmed) {
    throw new Error('--apply 必須同時傳入 --confirm-shared-mysql（這會改寫共用資料庫）。');
  }

  const rows = await queryRows(
    'SELECT user_id, name, grade_level, class_name, admission_year FROM User_Profiles WHERE user_id IN (?, ?, ?)',
    CORRECTIONS.map(item => item.userId)
  );
  const pending = [];
  for (const item of CORRECTIONS) {
    const row = rows.find(candidate => Number(candidate.user_id) === item.userId);
    if (!row) throw new Error(`User_Profiles.user_id=${item.userId} 不存在`);
    if (row.name !== item.name) throw new Error(`user ${item.userId} 姓名不符：${row.name}`);
    const current = `${row.grade_level}／${row.class_name}`;
    if (Number(row.grade_level) === item.to.gradeLevel && row.class_name === item.to.className) {
      console.log(`user ${item.userId} ${item.name}：已是 ${current}，略過`);
      continue;
    }
    if (Number(row.grade_level) !== item.from.gradeLevel || row.class_name !== item.from.className) {
      throw new Error(`user ${item.userId} 目前是 ${current}，不是預期的舊值，拒絕覆寫`);
    }
    console.log(`user ${item.userId} ${item.name}（入學 ${row.admission_year}）：${current} → ${item.to.gradeLevel}／${item.to.className}`);
    pending.push({ item, row });
  }

  if (!apply) {
    console.log('\ndry-run：沒有寫入任何資料。');
    return;
  }
  if (pending.length === 0) return;

  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(
    backupDir,
    `demo-grade-correction-${new Date().toISOString().replace(/[:.]/gu, '-')}.json`
  );
  fs.writeFileSync(backupPath, `${JSON.stringify(pending.map(entry => entry.row), null, 2)}\n`, 'utf8');
  console.log(`\n已備份原始列到 ${path.relative(process.cwd(), backupPath)}`);

  await withTransaction(async connection => {
    for (const { item } of pending) {
      const [result] = await connection.query(
        `UPDATE User_Profiles SET grade_level = ?, class_name = ?
          WHERE user_id = ? AND grade_level = ? AND class_name = ?`,
        [item.to.gradeLevel, item.to.className, item.userId, item.from.gradeLevel, item.from.className]
      );
      if (result.affectedRows !== 1) throw new Error(`user ${item.userId} 更新筆數不是 1，已 rollback`);
    }
  });
  console.log(`已更新 ${pending.length} 筆。`);
}

try {
  await main();
} finally {
  await closePool();
}
