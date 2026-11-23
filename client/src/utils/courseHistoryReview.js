// Extraction completeness does not imply a grade, pass result, or import readiness.
export function summarizeHistoryReview(rows, sourceSummary={}, plan=null) {
 const valid=rows.filter(r=>r && typeof r.courseCode==='string' && !!r.courseCode.trim() && typeof r.courseName==='string' && !!r.courseName.trim() && Number.isInteger(r.academicYear) && [1,2,3].includes(r.semester) && typeof r.credits==='number' && Number.isFinite(r.credits)).length;
 const conflicts=new Set(rows.flatMap((r,i)=>r.conflictingRows?.length?[i]:[]));
 for(const item of plan?.items??[])if(item.status==='conflict_input'||item.status==='conflict_existing')conflicts.add(item.index);
 const unresolved=rows.filter(r=>!['true','false'].includes(r.passed) || !r.requirementType || !r.graduationCategory || r.conflictingRows?.length).length;
 return {rawRows:Number.isInteger(sourceSummary.rawRows)?sourceSummary.rawRows:null,duplicates:Number.isInteger(sourceSummary.duplicateRows)?sourceSummary.duplicateRows:null,excluded:Number.isInteger(sourceSummary.excludedRows)?sourceSummary.excludedRows:null,extracted:rows.length,valid,unresolved,importable:plan?.counts?.new??null,conflicts:conflicts.size};
}
