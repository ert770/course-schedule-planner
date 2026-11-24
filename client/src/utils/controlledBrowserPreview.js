// Merge by attempt identity without dropping conflicting values or distinct retakes.
export function buildHistoryPreview(result) {
  const grouped = new Map();
  const values = [...(result?.records ?? []), ...(result?.pendingRecords ?? [])];
  for (const row of values) {
    const validKey = row?.courseCode && Number.isInteger(row.academicYear) && Number.isInteger(row.semester);
    const key = validKey ? JSON.stringify([row.courseCode, row.academicYear, row.semester]) : Symbol('unresolved');
    const previous = grouped.get(key);
    if (!previous) { grouped.set(key, { ...row, conflictingRows: [...(row?.conflictingRows ?? [])] }); continue; }
    const different = ['courseName', 'credits', 'score', 'sourceScore', 'sourceCreditRecord'].some(field => (previous[field] ?? null) !== (row[field] ?? null));
    if (different) previous.conflictingRows.push(row);
    previous.conflictingRows.push(...(row.conflictingRows ?? []));
    previous.sourceCategories = [...new Set([...(previous.sourceCategories ?? []), ...(row.sourceCategories ?? [])])];
  }
  return [...grouped.values()];
}
