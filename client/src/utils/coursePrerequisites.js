// 課程詳情的「先修條件」文字。
//
// `Courses.prerequisites` 有三種格式：
//   - null：資料尚未提供（不代表沒有先修）
//   - 陣列：舊格式，元素為課名字串；空陣列代表沒有先修
//   - 物件：{ rules: [{ name, course_id }], required_ids, course_code, course_name }
//     （2026-10 起部分課程改為此格式；先前直接 String() 會顯示成 [object Object]）
const UNKNOWN = '尚未取得官方先修資料';
const NONE = '無';

function ruleLabel(rule) {
  if (typeof rule === 'string') return rule.trim();
  if (!rule || typeof rule !== 'object') return '';
  const name = String(rule.name ?? '').trim();
  const code = String(rule.course_id ?? '').trim();
  return name || code;
}

function joinLabels(items) {
  const labels = [...new Set(items.map(ruleLabel).filter(Boolean))];
  return labels.length > 0 ? labels.join('、') : NONE;
}

export function formatCoursePrerequisites(value) {
  if (value === null || value === undefined) return UNKNOWN;
  if (Array.isArray(value)) return joinLabels(value);
  if (typeof value === 'object') {
    if (Array.isArray(value.rules)) return joinLabels(value.rules);
    if (Array.isArray(value.required_ids)) return joinLabels(value.required_ids);
    return UNKNOWN;
  }
  const text = String(value).trim();
  return text || NONE;
}
