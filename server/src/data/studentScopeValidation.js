import { parseClassName } from '../skills/courseScope.js';
import { isKnownDepartment } from './departmentMapping.js';

// 系所、年級、班級三者必須互相對得上：註冊與修改基本資料共用同一套規則。
// 班級只接受學士班、甲～丁（一年級甲～丙），與註冊頁的下拉選單一致。
export function validateStudentScope({ department, gradeLevel, className } = {}) {
  if (typeof department !== 'string' || !isKnownDepartment(department)) return '請選擇有效系所';
  if (!Number.isInteger(Number(gradeLevel)) || Number(gradeLevel) < 1 || Number(gradeLevel) > 5) return '請選擇有效年級';
  if (typeof className !== 'string' || !className.trim() || className.length > 45) return '請選擇班級';
  const parsed = parseClassName(className);
  const allowed = Number(gradeLevel) === 1 ? ['甲', '乙', '丙'] : ['甲', '乙', '丙', '丁'];
  if (!parsed.isDepartmentClass || parsed.department !== department || parsed.degree !== 'bachelor'
    || parsed.grade !== Number(gradeLevel) || !allowed.includes(parsed.classSuffix)) return '班級與系所或年級不符';
  return null;
}

/**
 * 修改基本資料：這次有送系所、年級或班級，且與目前保存的值不同時，合併後整組檢查。
 * 沒有改變就不檢查，避免既有資料不完整的帳號在保存其他偏好時被擋下。
 */
export function validateStudentScopeChange(updates = {}, current = {}) {
  const fields = ['department', 'gradeLevel', 'className'];
  if (!fields.some(field => updates[field] !== undefined)) return null;
  const merged = {
    department: updates.department ?? current.department,
    gradeLevel: updates.gradeLevel ?? current.gradeLevel,
    className: updates.className ?? current.className,
  };
  const unchanged = String(merged.department ?? '') === String(current.department ?? '')
    && Number(merged.gradeLevel ?? 0) === Number(current.gradeLevel ?? 0)
    && String(merged.className ?? '') === String(current.className ?? '');
  return unchanged ? null : validateStudentScope(merged);
}
