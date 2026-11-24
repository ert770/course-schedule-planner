import { planCourseHistoryImport } from './courseHistoryImportPlanner.js';
import { withTransaction } from '../db/mysql.js';

const error = (message,status=400)=>Object.assign(new Error(message),{status,safeImportError:true});
const identityFields=['userId','user_id','studentId','student_id','numericId','canonicalId'];
function validate(body,identity) {
  if(!body || typeof body!=='object' || Array.isArray(body) || identityFields.some(k=>Object.hasOwn(body,k))) throw error('不可指定資料所屬使用者');
  if (!identity?.found || identity.source !== 'mysql' || !identity?.canWriteMysqlProfile || !Number.isSafeInteger(Number(identity.numericId)) || Number(identity.numericId)<=0) throw error('登入身分無法對應資料',403);
  if (body.consent!==true || body.identityConfirmed!==true || body.fieldsConfirmed!==true) throw error('請先確認資料使用、資料屬於本人及欄位正確');
  if(!Array.isArray(body.records)||body.records.length===0||body.records.length>1000) throw error('修課紀錄筆數無效');
  if(body.records.some(row=>row && identityFields.some(k=>Object.hasOwn(row,k)))) throw error('不可指定資料所屬使用者');
  return Number(identity.numericId);
}
export const normalizeImportExisting = r=>({courseCode:r.catalog_course_code??null,sourceCourseCode:r.source_course_code??null,courseName:r.course_name,academicYear:Number(r.academic_year),semester:Number(r.semester),credits:Number(r.credits),score:r.score==null?null:Number(r.score),letterGrade:r.letter_grade??null,passed:r.passed==null?null:Number(r.passed)===1,requirementType:r.requirement_type,generalEducationCategory:r.general_education_category??null,graduationCategory:r.graduation_category,sourceCreditRecord:r.source_credit_record??null});
const selectSql='SELECT catalog_course_code,source_course_code,course_name,academic_year,semester,credits,score,letter_grade,passed,requirement_type,general_education_category,graduation_category FROM User_Course_History WHERE user_id = ?';
export function createCourseHistoryImporter(transaction=withTransaction) {
  async function run(body,identity,write,options={}) {
    const userId=validate(body,identity);
    return transaction(async connection=>{
      // Serialize our imports for this profile; other writers still face the unique index.
      const [profile]=await connection.execute('SELECT user_id, student_id FROM User_Profiles WHERE user_id = ? FOR UPDATE',[userId]);
      if(profile.length!==1 || profile[0].student_id !== identity.canonicalId)throw error('登入使用者資料無法安全對應',403);
      const requiresSource=body.records.some(r=>r?.sourceCreditRecord!=null);
      const query=requiresSource?selectSql.replace(' FROM User_Course_History',',source_credit_record FROM User_Course_History'):selectSql;
      const [rows]=await connection.execute(query,[userId]);
      const plan=planCourseHistoryImport(body.records,rows.map(normalizeImportExisting));
      if(!write)return {plan};
      if(plan.items.some(item=>['invalid','conflict_input','conflict_existing'].includes(item.status)))throw error('資料無效或存在衝突，請重新預覽後處理',409);
      const insert=plan.items.filter(item=>item.status==='new').map(item=>body.records[item.index]);
      if(insert.length){
        // Legacy imports without the source field remain compatible before migration 011.
        const preserveSource=insert.some(r=>r.sourceCreditRecord!=null);
        const placeholders=insert.map(()=>preserveSource?'(?,?,?,?,?,?,?,?,?,?,?,?,?,?)':'(?,?,?,?,?,?,?,?,?,?,?,?,?)').join(',');
        const params=insert.flatMap(r=>[userId,r.courseCode,r.academicYear,r.semester,r.courseName,r.score,r.letterGrade??null,r.credits,r.passed?1:0,r.requirementType,r.generalEducationCategory??null,r.graduationCategory,'manual_confirmed_import',...(preserveSource?[r.sourceCreditRecord??null]:[])]);
        await connection.execute('INSERT INTO User_Course_History (user_id,catalog_course_code,academic_year,semester,course_name,score,letter_grade,credits,passed,requirement_type,general_education_category,graduation_category,source'+(preserveSource?',source_credit_record':'')+') VALUES '+placeholders,params);
        if(options.localAttested){
          const auditPlaceholders=insert.map(() => '(?,?,?,?,?,?,UTC_TIMESTAMP(3))').join(',');
          const auditParams=insert.flatMap(r=>[userId,r.courseCode,r.academicYear,r.semester,'local_self_attested','local-history-v1']);
          await connection.execute('INSERT INTO Local_History_Attestations (user_id,course_code,academic_year,semester,trust_level,statement_version,confirmed_at) VALUES '+auditPlaceholders,auditParams);
        }
      }
      return {inserted:insert.length,skipped:plan.items.length-insert.length};
    });
  }
  return {preview:(body,identity,options)=>run(body,identity,false,options),commit:(body,identity,options)=>run(body,identity,true,options)};
}
export const courseHistoryImporter=createCourseHistoryImporter();
