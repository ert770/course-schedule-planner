// 系列課（「西班牙文(一)(二)(三)…」）。資料庫沒有先修資料，這裡依課名推測（與 scheduler.js 的
// SERIES_SUFFIX 同一個規則）：系列第 n 級（n > 1）只在已通過第 n－1 級時才推薦。
// 2026-10-15 Persona 實測：只修過西班牙文(一)(二)的人，探索卡推薦了西班牙文(四)。
// 只用於推薦（興趣探索卡、探索頁），不擋使用者自己搜尋或加選。
const SERIES_SUFFIX = /^(.+?)\s*[（(]([一二三四五六七八九十])[)）]\s*$/u;
const NUMERALS = '一二三四五六七八九十';

export function parseCourseSeries(name) {
  const match = String(name ?? '').trim().match(SERIES_SUFFIX);
  if (!match) return null;
  return { key: match[1].trim(), level: NUMERALS.indexOf(match[2]) + 1 };
}

/** 已通過的系列等級：Map(系列名稱 → Set(等級))。 */
export function passedSeriesLevels(courseHistory = []) {
  const levels = new Map();
  for (const entry of Array.isArray(courseHistory) ? courseHistory : []) {
    if (!entry?.passed) continue;
    const series = parseCourseSeries(entry.courseName ?? entry.name);
    if (!series) continue;
    if (!levels.has(series.key)) levels.set(series.key, new Set());
    levels.get(series.key).add(series.level);
  }
  return levels;
}

/** 這門課在系列順序上是否適合推薦：非系列課、第 1 級，或已通過前一級。 */
export function isSeriesLevelReachable(courseName, passedLevels) {
  const series = parseCourseSeries(courseName);
  if (!series || series.level <= 1) return true;
  return passedLevels?.get(series.key)?.has(series.level - 1) === true;
}

export default { parseCourseSeries, passedSeriesLevels, isSeriesLevelReachable };
