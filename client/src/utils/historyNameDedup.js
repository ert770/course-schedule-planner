// The same grouping is used by the preview and server-side Session import.
// 2026-11-23 團隊決定：只合併同一學年、同一學期、同課名的列；不同學期（例如重修）一律保留各自一筆。
function sameSourceAttempt(first, second) {
  const className = typeof first?.sourceClassName === 'string' && first.sourceClassName.trim();
  const knownGrade = Number.isFinite(first.score) || (typeof first.letterGrade === 'string' && first.letterGrade.trim());
  return Boolean(className) && typeof second?.sourceClassName === 'string' && className === second.sourceClassName.trim()
    && Number.isFinite(first.credits) && Boolean(knownGrade)
    && ['credits', 'score', 'letterGrade']
      .every(field => (first[field] ?? null) === (second[field] ?? null));
}

export function planHistoryByName(rows = [], { reconcileSourceCodes = true } = {}) {
  const groups = new Map();
  for (const row of rows) {
    const name = typeof row?.courseName === 'string' ? row.courseName.trim() : '';
    // 課名＋學年＋學期才算同一筆；沒有課名時每列獨立。
    const key = name ? JSON.stringify([name, row?.academicYear, row?.semester]) : Symbol('missing-name');
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  const candidates = [], conflicts = [];
  let mergedCount = 0;
  for (const group of groups.values()) {
    const scores = new Set(group.map(r => r?.score).filter(v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100));
    const sourceConflict = group.some(r => r?.conflictingRows?.length);
    const coded = reconcileSourceCodes ? group.filter(row => row?.courseCode) : [];
    const codes = new Set(coded.map(row => row.courseCode));
    const mixedCodes = coded.length > 0 && coded.length < group.length;
    const unverifiedMerge = mixedCodes && (
      typeof coded[0].courseCode !== 'string' || !/^[A-Z0-9]{1,45}$/.test(coded[0].courseCode)
      || group.some(row => !sameSourceAttempt(coded[0], row))
    );
    if (scores.size > 1 || sourceConflict || codes.size > 1 || unverifiedMerge) {
      conflicts.push({ courseName: group[0]?.courseName?.trim() ?? '', rows: group });
      continue;
    }
    const selected = mixedCodes ? coded[0]
      : group.find(r => typeof r?.score === 'number' && Number.isFinite(r.score) && r.score >= 0 && r.score <= 100) ?? group[0];
    candidates.push({ ...selected, courseName: selected?.courseName?.trim() ?? '', mergedSourceRows: group.filter(r => r !== selected) });
    mergedCount += group.length - 1;
  }
  return { candidates, conflicts, mergedCount };
}
