// These functions never infer status or classifications; callers supply explicit confirmations.
const conflict = row => Array.isArray(row.conflictingRows) && row.conflictingRows.length > 0;
export function confirmCreditRecordScores(rows, confirmed) {
  if (confirmed !== true) return rows;
  return rows.map(row=>{
    const raw=String(row.sourceCreditRecord??'').trim();
    if(conflict(row) || (row.score!=='' && row.score!=null) || !/^\d{1,3}(?:\.\d{1,2})?$/.test(raw) || Number(raw)>100)return row;
    return {...row,score:Number(raw)};
  });
}
export function confirmSourceClassification(rows, source, requirementType, graduationCategory, confirmed) {
  const validRequirement=['必修','選修'].includes(requirementType);
  const validCategory=['required','elective','general','external','unspecified','nonGraduation'].includes(graduationCategory);
  if(confirmed!==true || !source || !validRequirement || !validCategory)return rows;
  return rows.map(row=>{
    if(conflict(row) || !Array.isArray(row.sourceCategories) || row.sourceCategories.length!==1 || row.sourceCategories[0]!==source || (row.requirementType && row.requirementType!==requirementType) || (row.graduationCategory && row.graduationCategory!==graduationCategory))return row;
    return {...row,requirementType:row.requirementType||requirementType,graduationCategory:row.graduationCategory||graduationCategory};
  });
}
export function confirmSameScoreOutcome(rows, score, passed, confirmed) {
  if(confirmed!==true || !['true','false'].includes(passed) || score==='' || !Number.isFinite(Number(score)))return rows;
  return rows.map(row=>{
    if(conflict(row) || row.score==='' || row.score==null || Number(row.score)!==Number(score) || row.passed!=='')return row;
    return {...row,passed};
  });
}

// A student may explicitly attest a shared outcome; no score threshold is inferred.
export function confirmSourceOutcome(rows, source, passed, confirmed) {
 if(confirmed!==true || !source || !['true','false'].includes(passed)) return rows;
 return rows.map(row=>conflict(row) || !Array.isArray(row.sourceCategories) || row.sourceCategories.length!==1 || row.sourceCategories[0]!==source || row.passed!=='' ? row : {...row,passed});
}
