import { argon2, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { getAll } from '../db/database.js';
import { queryRows, withTransaction } from '../db/mysql.js';
import { createWithAllocatedUserId, UserIdCollisionError } from '../db/userIdAllocator.js';
import { parseClassName } from '../skills/courseScope.js';
import { isKnownDepartment } from '../data/departmentMapping.js';

const derive = promisify(argon2);
const params = { parallelism: 1, tagLength: 32, memory: 19456, passes: 2 };
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const digest = await derive('argon2id', { ...params, message: Buffer.from(password), nonce: salt });
  return `$argon2id$v=19$m=19456,t=2,p=1$${salt.toString('base64').replace(/=+$/, '')}$${digest.toString('base64').replace(/=+$/, '')}`;
}
export async function verifyPassword(hash, password) {
  if (typeof hash !== 'string' || typeof password !== 'string') return false;
  const match = /^\$argon2id\$v=19\$m=19456,t=2,p=1\$([A-Za-z0-9+/]{22})\$([A-Za-z0-9+/]{43})$/.exec(hash);
  if (!match) return false;
  const expected = Buffer.from(match[2], 'base64');
  const actual = await derive('argon2id', { ...params, message: Buffer.from(password), nonce: Buffer.from(match[1], 'base64') });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export function validateRegistration(input) {
  const { studentId, name, department, gradeLevel, className, password, confirmPassword } = input ?? {};
  if (typeof studentId !== 'string' || !/^D[0-9]{7}$/.test(studentId)) return '學號須為大寫 D 加上 7 位數字';
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 45) return '請輸入姓名（最多 45 字）';
  if (typeof department !== 'string' || !isKnownDepartment(department)) return '請選擇有效系所';
  if (!Number.isInteger(Number(gradeLevel)) || Number(gradeLevel) < 1 || Number(gradeLevel) > 5) return '請選擇有效年級';
  if (typeof className !== 'string' || !className.trim() || className.length > 45) return '請選擇班級';
  const parsed = parseClassName(className);
  const allowed = Number(gradeLevel) === 1 ? ['甲', '乙', '丙'] : ['甲', '乙', '丙', '丁'];
  if (!parsed.isDepartmentClass || parsed.department !== department || parsed.degree !== 'bachelor' || parsed.grade !== Number(gradeLevel) || !allowed.includes(parsed.classSuffix)) return '班級與系所或年級不符';
  if (typeof password !== 'string' || !/^[A-Za-z0-9]{8,}$/.test(password) || password.length > 1024) return '密碼至少 8 位字元，僅限英文字母及數字';
  if (password !== confirmPassword) return '兩次密碼不一致';
  return null;
}
export async function registerStudent(input, deps = {}) {
  const error = validateRegistration(input);
  if (error) return { error, status: 400 };
  const { studentId, department, className, password } = input;
  // Reserve all legacy student IDs even when legacy login is disabled.
  const legacy = await (deps.getAll ?? getAll)('users');
  if (legacy.some(u => String(u.studentId ?? '') === studentId)) return { error: '此學號已存在，請聯絡管理員', status: 409 };
  const hash = await (deps.hashPassword ?? hashPassword)(password);
  try {
    await createWithAllocatedUserId(deps.withTransaction ?? withTransaction, async (connection, id) => {
      // Never attach a freshly registered account to a legacy JSON identity.
      if (legacy.some(u => String(u.id) === String(id))) throw new UserIdCollisionError();
      try {
        await connection.execute('INSERT INTO `User_Profiles` (`user_id`, `student_id`, `name`, `department`, `grade_level`, `class_name`, `password_hash`) VALUES (?, ?, ?, ?, ?, ?, ?)', [id, studentId, input.name.trim(), department, Number(input.gradeLevel), className, hash]);
      } catch (e) {
        if (e.code === 'ER_DUP_ENTRY' && /(?:for key|for constraint)\s+['`"]?(?:User_Profiles\.)?PRIMARY/i.test(e.message ?? '')) throw new UserIdCollisionError({ cause: e });
        throw e;
      }
    }, { maxAttempts: 100 });
    return { success: true };
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY' && /uq_user_profiles_student_id/i.test(e.message ?? '')) return { error: '此學號已存在，請聯絡管理員', status: 409 };
    throw e;
  }
}
export async function findMysqlAccount(studentId) {
  const rows = await queryRows('SELECT `user_id`, `student_id`, `name`, `password_hash` FROM `User_Profiles` WHERE `student_id` = ? LIMIT 1', [studentId]);
  const row = rows[0];
  if (!row) return null;
  row.watchlist = [];
  const columns = await queryRows("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'User_Profiles' AND COLUMN_NAME = 'watchlist'");
  if (columns.length) {
    const data = await queryRows('SELECT watchlist FROM User_Profiles WHERE user_id = ? AND student_id = ?', [row.user_id, row.student_id]);
    try { row.watchlist = typeof data[0]?.watchlist === 'string' ? JSON.parse(data[0].watchlist) : (data[0]?.watchlist ?? []); } catch { row.watchlist = []; }
  }
  return row;
}
