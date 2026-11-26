import { withTransaction } from '../db/mysql.js';
import { createHash } from 'node:crypto';
import { planHistoryByName } from '../../../client/src/utils/historyNameDedup.js';

function differsOnlyByOnlineSuffix(firstName, secondName) {
  const first = firstName?.trim();
  const second = secondName?.trim();
  if (!first || !second || first === second) return false;
  const onlineSuffix = /\s*\(Online\)$/;
  return first.replace(onlineSuffix, '') === second
    || second.replace(onlineSuffix, '') === first;
}

function matchesOnlineHistoryAttempt(incoming, stored) {
  if (!incoming.courseCode
    || (incoming.courseCode !== stored.catalog_course_code && incoming.courseCode !== stored.source_course_code)
    || incoming.academicYear !== Number(stored.academic_year)
    || incoming.semester !== Number(stored.semester)
    || !Number.isFinite(incoming.score) || stored.score == null
    || incoming.score !== Number(stored.score)) return false;

  return differsOnlyByOnlineSuffix(incoming.courseName, stored.course_name);
}

// All input comes from the server-owned extraction session, never from the client.
export async function importExtractedHistory(identity,rows,transaction=withTransaction,{sessionImport=false,dryRun=false}={}){
 const userId=Number(identity?.numericId);
 if(!identity?.found || identity.source!=='mysql' || !identity.canWriteMysqlProfile || !Number.isSafeInteger(userId) || userId<1 || !Array.isArray(rows) || rows.length>1000)throw Error('INVALID_IMPORT');
 return transaction(async db=>{
  const [profile]=await db.execute('SELECT student_id FROM User_Profiles WHERE user_id = ?' + (dryRun ? '' : ' FOR UPDATE'),[userId]);
  if(profile.length!==1||profile[0].student_id!==identity.canonicalId)throw Error('IDENTITY_MISMATCH');
  const [pending]=await db.execute('SELECT catalog_course_code,academic_year,semester,source_payload FROM Unmatched_Course_History WHERE user_id=? ORDER BY id',[userId]);
  const inputKey=r=>JSON.stringify([r?.courseCode||[r?.courseName,r?.sourceClassName],Number(r?.academicYear),Number(r?.semester)]);
  const inputSeen=new Set(rows.map(inputKey));let legacyUnusable=0;rows=[...rows];
  for(const entry of (sessionImport ? [] : pending)){try{const raw=typeof entry.source_payload==='string'?JSON.parse(entry.source_payload):entry.source_payload;const source=raw?.sourceRecord??{courseCode:raw?.sourceCourseCode??entry.catalog_course_code,courseName:raw?.courseName,sourceClassName:raw?.sourceClassName,academicYear:Number(entry.academic_year),semester:Number(entry.semester),credits:raw?.credits,score:raw?.sourceNumericScore??null,letterGrade:raw?.letterGrade??null,sourceScore:raw?.sourceScore??null,sourceCreditRecord:raw?.sourceCreditRecord??null,sourceCategories:raw?.sourceCategories??[],conflictingRows:raw?.conflictingRows??[]};if(!source||(source.courseCode!=null&&source.courseCode!==''&&(typeof source.courseCode!=='string'||!/^[A-Z0-9]{1,45}$/.test(source.courseCode)))||typeof source.courseName!=='string'||!source.courseName.trim()||source.courseName.length>255||!Number.isInteger(source.academicYear)||source.academicYear<1||source.academicYear>65535||![1,2,3].includes(source.semester)||typeof source.credits!=='number'||!Number.isFinite(source.credits)||source.credits<0||source.credits>999.9||(!source.courseCode&&(typeof source.sourceClassName!=='string'||!source.sourceClassName.trim()))){legacyUnusable++;continue;}const k=inputKey(source);if(!inputSeen.has(k)){rows.push(source);inputSeen.add(k);}}catch{legacyUnusable++;}}
  if(rows.length>1000)throw Error('INVALID_IMPORT');
  const namePlan = sessionImport ? planHistoryByName(rows) : null;
  if (namePlan) rows = namePlan.candidates;
  const codes=[...new Set(rows.map(r=>r?.courseCode).filter(c=>typeof c==='string'&&/^[A-Z0-9]{1,45}$/.test(c)))];
  const [catalog]=codes.length?await db.execute('SELECT DISTINCT name, subid3 FROM Courses WHERE BINARY subid3 IN ('+codes.map(()=>'?').join(',')+')',codes):[[]];
  const byCode=new Map();for(const c of catalog){const list=byCode.get(c.subid3)??new Set();list.add(c.name);byCode.set(c.subid3,list);}
  const [existing]=await db.execute('SELECT catalog_course_code,source_course_code,source_attempt_key,academic_year,semester,course_name,score FROM User_Course_History WHERE user_id=?',[userId]);
  const key=r=>JSON.stringify([r.courseCode,Number(r.academicYear),Number(r.semester)]);
  const seen=new Set(existing.flatMap(r=>[r.catalog_course_code,r.source_course_code].filter(Boolean).map(courseCode=>key({courseCode,academicYear:r.academic_year,semester:r.semester}))));
  const attemptSeen=new Set(existing.filter(r=>r.source_attempt_key).map(r=>key({courseCode:r.source_attempt_key,academicYear:r.academic_year,semester:r.semester})));
  // A code-less duplicate can be merged only when one coded attempt has identical source facts.
  const codeLessDuplicates=new Map(),skipCodeLess=new Set();
  const sameAttempt=(a,b)=>['courseName','sourceClassName','academicYear','semester','credits','score','letterGrade','sourceScore','sourceCreditRecord'].every(f=>(a[f]??null)===(b[f]??null));
  for(const candidate of rows){if(!candidate||candidate.courseCode)continue;const matches=rows.filter(other=>other?.courseCode&&!other.conflictingRows?.length&&!candidate.conflictingRows?.length&&sameAttempt(candidate,other));const distinct=new Set(matches.map(r=>r.courseCode));if(distinct.size===1){const target=matches[0];skipCodeLess.add(candidate);const list=codeLessDuplicates.get(target)??[];list.push(candidate);codeLessDuplicates.set(target,list);}}
  let inserted=0,skipped=namePlan?.mergedCount ?? 0,unmatched=0,conflicts=namePlan?.conflicts.length ?? 0;
  const existingNames = new Map();
  if (sessionImport) for (const entry of existing) { const name = typeof entry.course_name === 'string' ? entry.course_name.trim() : ''; if (name) { const list = existingNames.get(name) ?? []; list.push(entry); existingNames.set(name, list); } }
  for(const row of rows){
   if(!row||(row.courseCode!=null && row.courseCode!=='' && (typeof row.courseCode!=='string'||!/^[A-Z0-9]{1,45}$/.test(row.courseCode)))||typeof row.courseName!=='string'||!row.courseName.trim()||row.courseName.length>255||(!row.courseCode && (typeof row.sourceClassName!=='string'||!row.sourceClassName.trim()))||!Number.isInteger(row.academicYear)||row.academicYear<1||row.academicYear>65535||![1,2,3].includes(row.semester)||typeof row.credits!=='number'||!Number.isFinite(row.credits)||row.credits<0||row.credits>999.9)throw Error('INVALID_RECORD');
   if(skipCodeLess.has(row)){skipped++;continue;}
   if (sessionImport && seen.has(key(row)) && existing.some(entry => matchesOnlineHistoryAttempt(row, entry))) {
     skipped++;
     continue;
   }
   if (sessionImport && existingNames.has(row.courseName.trim())) { const entries = existingNames.get(row.courseName.trim()); const incoming = typeof row.score === 'number' ? row.score : null; if (incoming !== null && entries.some(e => e.score != null && Number(e.score) !== incoming)) conflicts++; else skipped++; continue; }
   const exactCode=byCode.get(row.courseCode)??new Set();
   let code=null,reason=null;
   if(row.conflictingRows?.length)reason='source_conflict';
   else if(!row.courseCode)reason='missing_source_code';
   else if(!exactCode.size)reason='not_found';
   else if (!exactCode.has(row.courseName) && !(sessionImport && [...exactCode].some(name => differsOnlyByOnlineSuffix(row.courseName, name)))) reason='code_name_conflict';
   else code=row.courseCode;
   const raw=JSON.stringify({sourceCourseCode:row.courseCode??null,courseName:row.courseName,academicYear:row.academicYear,semester:row.semester,credits:row.credits,sourceScore:row.sourceScore??null,sourceNumericScore:row.score??null,sourceCategories:row.sourceCategories??[],sourceClassName:row.sourceClassName??null,sourceGraduationCredits:row.sourceGraduationCredits??null,sourceCreditRecord:row.sourceCreditRecord??null,conflictingRows:row.conflictingRows??[],matchReason:reason,sourceRecord:row,codeLessDuplicates:codeLessDuplicates.get(row)??[],mergedSourceRows:row.mergedSourceRows??[]});
   const attemptKey=createHash('sha256').update(JSON.stringify(row.courseCode?['code',row.courseCode]:['name_class',row.courseName,row.sourceClassName])).digest('hex');
   const attempt=key({...row,courseCode:attemptKey});
   if((row.courseCode&&seen.has(key(row)))||attemptSeen.has(attempt)){
    if (sessionImport) { const prior = existing.find(e => Number(e.academic_year)===Number(row.academicYear) && Number(e.semester)===Number(row.semester) && (e.source_course_code===row.courseCode || e.catalog_course_code===row.courseCode || e.source_attempt_key===attemptKey)); if (prior?.course_name && prior.course_name.trim()!==row.courseName.trim()) { conflicts++; continue; } }
    skipped++;continue;
   }
   const score=!row.conflictingRows?.length&&typeof row.score==='number'&&Number.isFinite(row.score)&&row.score>=0&&row.score<=100&&Math.abs(row.score*100-Math.round(row.score*100))<1e-8?row.score:null;
   const passed=score===null?null:score>=60?1:0;
   const letter=typeof row.letterGrade==='string'&&row.letterGrade.length<=10?row.letterGrade:null;
   if (!dryRun) await db.execute('INSERT INTO User_Course_History (user_id,course_id,catalog_course_code,source_course_code,source_attempt_key,academic_year,semester,course_name,credits,score,letter_grade,passed,requirement_type,graduation_category,source,source_credit_record,source_payload) VALUES (?,NULL,?,?,?,?,?,?,?,?,?,?,NULL,NULL,?,?,?)',[userId,code,row.courseCode||null,attemptKey,row.academicYear,row.semester,row.courseName,row.credits,score,letter,passed,sessionImport?'myfcu_session': 'myfcu_self_attested',row.sourceCreditRecord??null,raw]);
   if(!dryRun && !sessionImport) await db.execute('INSERT INTO Local_History_Attestations (user_id,course_code,academic_year,semester,trust_level,statement_version,confirmed_at) VALUES (?,?,?,?,?,?,UTC_TIMESTAMP(3))',[userId,row.courseCode||code||null,row.academicYear,row.semester,'local_self_attested','local-history-v1']);
   if (sessionImport) { existingNames.set(row.courseName.trim(), [{ score }]); existing.push({ course_name:row.courseName, source_course_code:row.courseCode, source_attempt_key:attemptKey, academic_year:row.academicYear, semester:row.semester, score }); }
   attemptSeen.add(attempt);if(row.courseCode)seen.add(key(row));if(code)seen.add(key({...row,courseCode:code}));inserted++;if(reason)unmatched++;if(['source_conflict','code_name_conflict','ambiguous','invalid_code'].includes(reason))conflicts++;
  }
  return {inserted,skipped,unmatched,conflicts,...(legacyUnusable?{legacyUnusable}:{})};
 });
}
