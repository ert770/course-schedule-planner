// The same grouping is used by the preview and server-side Session import.
// 2026-11-23 團隊決定：只合併同一學年、同一學期、同課名的列；不同學期（例如重修）一律保留各自一筆。
export function planHistoryByName(rows = []) {
  const groups = new Map();
  for (const row of rows) {
    const name = typeof row?.courseName === 'string' ? row.courseName.trim() : '';
    // 課名＋學年＋學期才算同一筆；沒有課名時每列獨立。
    const key = name ? `${name}|${row?.academicYear ?? ''}|${row?.semester ?? ''}` : Symbol('missing-name');
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  const candidates = [], conflicts = [];
  let mergedCount = 0;
  for (const group of groups.values()) {
    const scores = new Set(group.map(r => r?.score).filter(v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100));
    const sourceConflict = group.some(r => r?.conflictingRows?.length);
    if (scores.size > 1 || sourceConflict) {
      conflicts.push({ courseName: group[0]?.courseName?.trim() ?? '', rows: group });
      continue;
    }
    const selected = group.find(r => typeof r?.score === 'number' && Number.isFinite(r.score) && r.score >= 0 && r.score <= 100) ?? group[0];
    candidates.push({ ...selected, courseName: selected?.courseName?.trim() ?? '', mergedSourceRows: group.filter(r => r !== selected) });
    mergedCount += group.length - 1;
  }
  return { candidates, conflicts, mergedCount };
}
