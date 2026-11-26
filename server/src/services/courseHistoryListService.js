import { queryRows } from '../db/mysql.js';
import { historyTermHasCatalog, loadHistoryTermCatalog } from './courseHistoryAutoImport.js';

// This read-only view intentionally keeps unknown values; it is not the recommendation profile.
export async function listCourseHistory(identity, query=queryRows) {
 const id=Number(identity?.numericId);
 if(!identity?.found || identity.source!=='mysql' || !identity.canWriteMysqlProfile || !Number.isSafeInteger(id) || id<=0)throw Object.assign(new Error('登入身分無法對應資料'),{status:403});
 const rows=await query('SELECT history_id,catalog_course_code,source_course_code,course_name,academic_year,semester,score,letter_grade,credits,passed,requirement_type,graduation_category,general_education_category,source FROM User_Course_History WHERE user_id=? ORDER BY academic_year DESC,semester DESC,history_id DESC',[id]);
 const needsCoverage = row => row.source === 'myfcu_session' && row.catalog_course_code == null &&
  row.source_course_code && row.academic_year != null && row.semester != null;
 const coverage = rows.some(needsCoverage) ? await loadHistoryTermCatalog({
  execute: async (sql, params) => [await query(sql, params)],
 }) : null;
 return rows.map(r=>({id:r.history_id,catalogCourseCode:r.catalog_course_code??null,sourceCourseCode:r.source_course_code??null,courseName:r.course_name,academicYear:r.academic_year==null?null:Number(r.academic_year),semester:r.semester==null?null:Number(r.semester),score:r.score==null?null:Number(r.score),letterGrade:r.letter_grade??null,credits:r.credits==null?null:Number(r.credits),passed:r.passed==null?null:Number(r.passed)===1,requirementType:r.requirement_type??null,graduationCategory:r.graduation_category??null,generalEducationCategory:r.general_education_category??null,
  ...(coverage && needsCoverage(r) && !historyTermHasCatalog(coverage, r.academic_year, r.semester) ? {matchReason:'missing_term_catalog'} : {}),
 }));
}
