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

const catalogTermKey = (year, semester) => {
  const term = { 上: 1, 上學期: 1, 下: 2, 下學期: 2, 暑: 3, 暑期: 3, 暑修: 3 }[String(semester).trim()] ?? Number(semester);
  return `${Number(year)}:${term}`;
};

export async function loadHistoryTermCatalog(db, codes = []) {
  const placeholders = codes.map(() => '?').join(',');
  const terms = new Map();
  // NULL code rows represent term coverage even when the requested codes are absent.
  const offerings = `SELECT DISTINCT year AS academic_year, semester, NULL AS course_code, NULL AS course_name FROM Course_Sections
    ${codes.length ? `UNION ALL SELECT DISTINCT s.year, s.semester, c.subid3, c.name
      FROM Course_Sections s JOIN Courses c ON BINARY c.course_id = BINARY s.course_id
      WHERE BINARY c.subid3 IN (${placeholders})` : ''}`;
  const syllabi = `SELECT DISTINCT academic_year, semester, NULL AS course_code, NULL AS course_name FROM Course_Syllabi
    ${codes.length ? `UNION ALL SELECT DISTINCT academic_year, semester, course_code, NULL
      FROM Course_Syllabi WHERE BINARY course_code IN (${placeholders})` : ''}`;
  const [offeringRows] = await db.execute(offerings, codes);
  let syllabusRows;
  try {
    [syllabusRows] = await db.execute(syllabi, codes);
  } catch (error) {
    if (error.code !== 'ER_NO_SUCH_TABLE') throw error;
    syllabusRows = [];
  }
  for (const row of [...offeringRows, ...syllabusRows]) {
    const termKey = catalogTermKey(row.academic_year, row.semester);
    if (!terms.has(termKey)) terms.set(termKey, new Map());
    if (!row.course_code) continue;
    const term = terms.get(termKey);
    if (!term.has(row.course_code)) term.set(row.course_code, new Set());
    if (row.course_name) term.get(row.course_code).add(row.course_name);
  }
  return terms;
}

export function historyTermHasCatalog(terms, year, semester) {
  return terms.has(catalogTermKey(year, semester));
}

function matchHistoryCourse(terms, { courseCode, courseName, academicYear, semester }) {
  if (!courseCode) return { code: null, reason: 'missing_source_code' };
  const originalTerm = catalogTermKey(academicYear, semester);
  const originalNames = terms.get(originalTerm)?.get(courseCode);
  const acceptsName = names => [...names].some(name =>
    name.trim() === courseName.trim() || differsOnlyByOnlineSuffix(courseName, name));
  const match = (term, source) => ({ code: courseCode, reason: null, evidence: { term, source } });

  if (originalNames) {
    if (originalNames.size === 0) return match(originalTerm, 'syllabus');
    return acceptsName(originalNames)
      ? match(originalTerm, 'section')
      : { code: null, reason: 'code_name_conflict' };
  }

  const alternatives = [...terms.entries()]
    .filter(([term, courses]) => term !== originalTerm && courses.has(courseCode))
    .map(([term, courses]) => [term, courses.get(courseCode)])
    .sort(([a], [b]) => b.localeCompare(a, 'en', { numeric: true }));
  const section = alternatives.find(([, names]) => acceptsName(names));
  if (section) return match(section[0], 'section');
  if (alternatives.some(([, names]) => names.size > 0)) return { code: null, reason: 'code_name_conflict' };
  if (alternatives.length > 0) return match(alternatives[0][0], 'syllabus');
  return { code: null, reason: terms.has(originalTerm) ? 'not_found' : 'missing_term_catalog' };
}

function describeCatalogMatch({ code, reason, evidence }) {
  return {
    catalogMatchStatus: code === null ? 'unmatched' : 'matched',
    catalogMatchEvidence: evidence ?? null,
    matchReason: reason,
  };
}

// Read-only preview of already imported records. Update authorization is a separate operation.
export async function previewUnmatchedMyFcuHistory(db, userId) {
  if (!Number.isSafeInteger(userId) || userId < 1) throw Error('INVALID_USER_ID');
  const [rows] = await db.execute(`SELECT source_course_code AS courseCode, course_name AS courseName,
    academic_year AS academicYear, semester FROM User_Course_History
    WHERE user_id = ? AND source = 'myfcu_session' AND catalog_course_code IS NULL
    ORDER BY academic_year, semester, history_id`, [userId]);
  if (rows.length === 0) return [];
  const terms = await loadHistoryTermCatalog(db, [...new Set(rows.map(row => row.courseCode).filter(Boolean))]);
  return rows.map(row => ({
    academicYear: row.academicYear, semester: row.semester, sourceCourseCode: row.courseCode,
    ...matchHistoryCourse(terms, row),
  }));
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
  const termCatalog = sessionImport && codes.length ? await loadHistoryTermCatalog(db, codes) : new Map();
  const [catalog]=!sessionImport&&codes.length?await db.execute('SELECT DISTINCT name, subid3 FROM Courses WHERE BINARY subid3 IN ('+codes.map(()=>'?').join(',')+')',codes):[[]];
  const byCode=new Map();for(const c of catalog){const list=byCode.get(c.subid3)??new Set();list.add(c.name);byCode.set(c.subid3,list);}
  const [existing]=await db.execute('SELECT history_id,catalog_course_code,source_course_code,source_attempt_key,academic_year,semester,course_name,score,source,source_payload FROM User_Course_History WHERE user_id=?',[userId]);
  const key=r=>JSON.stringify([r.courseCode,Number(r.academicYear),Number(r.semester)]);
  const seen=new Set(existing.flatMap(r=>[r.catalog_course_code,r.source_course_code].filter(Boolean).map(courseCode=>key({courseCode,academicYear:r.academic_year,semester:r.semester}))));
  const attemptSeen=new Set(existing.filter(r=>r.source_attempt_key).map(r=>key({courseCode:r.source_attempt_key,academicYear:r.academic_year,semester:r.semester})));
  // A code-less duplicate can be merged only when one coded attempt has identical source facts.
  const codeLessDuplicates=new Map(),skipCodeLess=new Set();
  const sameAttempt=(a,b)=>['courseName','sourceClassName','academicYear','semester','credits','score','letterGrade','sourceScore','sourceCreditRecord'].every(f=>(a[f]??null)===(b[f]??null));
  for(const candidate of rows){if(!candidate||candidate.courseCode)continue;const matches=rows.filter(other=>other?.courseCode&&!other.conflictingRows?.length&&!candidate.conflictingRows?.length&&sameAttempt(candidate,other));const distinct=new Set(matches.map(r=>r.courseCode));if(distinct.size===1){const target=matches[0];skipCodeLess.add(candidate);const list=codeLessDuplicates.get(target)??[];list.push(candidate);codeLessDuplicates.set(target,list);}}
  let inserted=0,updated=0,skipped=namePlan?.mergedCount ?? 0,unmatched=0,conflicts=namePlan?.conflicts.length ?? 0;
  const existingNames = new Map();
  if (sessionImport) for (const entry of existing) { const name = typeof entry.course_name === 'string' ? entry.course_name.trim() : ''; if (name) { const list = existingNames.get(name) ?? []; list.push(entry); existingNames.set(name, list); } }
  for(const row of rows){
   if(!row||(row.courseCode!=null && row.courseCode!=='' && (typeof row.courseCode!=='string'||!/^[A-Z0-9]{1,45}$/.test(row.courseCode)))||typeof row.courseName!=='string'||!row.courseName.trim()||row.courseName.length>255||(!row.courseCode && (typeof row.sourceClassName!=='string'||!row.sourceClassName.trim()))||!Number.isInteger(row.academicYear)||row.academicYear<1||row.academicYear>65535||![1,2,3].includes(row.semester)||typeof row.credits!=='number'||!Number.isFinite(row.credits)||row.credits<0||row.credits>999.9)throw Error('INVALID_RECORD');
   if(skipCodeLess.has(row)){skipped++;continue;}
   const catalogMatch = sessionImport ? matchHistoryCourse(termCatalog, row) : null;
   if (sessionImport && row.courseCode && seen.has(key(row))) {
     const sameTermCode = existing.filter(entry => Number(entry.academic_year) === row.academicYear
       && Number(entry.semester) === row.semester
       && (entry.source_course_code === row.courseCode || entry.catalog_course_code === row.courseCode));
     const prior = sameTermCode.find(entry => entry.source === 'myfcu_session' && entry.source_course_code === row.courseCode);
     if (prior?.history_id) {
       const storedPayload = typeof prior.source_payload === 'string' ? JSON.parse(prior.source_payload) : prior.source_payload;
       const sameName = prior.course_name?.trim() === row.courseName.trim() || matchesOnlineHistoryAttempt(row, prior);
       const sameScore = prior.score == null || row.score == null || Number(prior.score) === row.score;
       if (!sameName || !sameScore || sameTermCode.length > 1 || catalogMatch.reason === 'code_name_conflict'
         || (prior.catalog_course_code != null && prior.catalog_course_code !== row.courseCode)
         || storedPayload?.matchReason === 'source_conflict') {
         conflicts++;
         continue;
       }
       const needsCode = prior.catalog_course_code == null;
       const newlyMatched = storedPayload?.catalogMatchStatus === 'unmatched' && catalogMatch.code !== null;
       if (needsCode || newlyMatched) {
         const payload = { ...storedPayload, ...describeCatalogMatch(catalogMatch) };
         if (!dryRun) {
           const [result] = await db.execute('UPDATE User_Course_History SET catalog_course_code=?,source_payload=? WHERE history_id=? AND user_id=? AND source=? AND catalog_course_code <=> ?',
             [row.courseCode, JSON.stringify(payload), prior.history_id, userId, 'myfcu_session', prior.catalog_course_code]);
           if (result.affectedRows !== 1) throw Error('HISTORY_CHANGED');
         }
         updated++;
       } else skipped++;
       continue;
     }
   }
   if (sessionImport && seen.has(key(row)) && existing.some(entry => matchesOnlineHistoryAttempt(row, entry))) {
     skipped++;
     continue;
   }
   if (sessionImport) {
     const entries = (existingNames.get(row.courseName.trim()) ?? []).filter(entry =>
       !row.courseCode || (entry.source_course_code !== row.courseCode && entry.catalog_course_code !== row.courseCode)
       || (Number(entry.academic_year) === row.academicYear && Number(entry.semester) === row.semester));
     if (entries.length > 0) {
       const incoming = typeof row.score === 'number' ? row.score : null;
       if (incoming !== null && entries.some(entry => entry.score != null && Number(entry.score) !== incoming)) conflicts++;
       else skipped++;
       continue;
     }
   }
   const exactCode=byCode.get(row.courseCode)??new Set();
   let code=null,reason=null;
   if(row.conflictingRows?.length)reason='source_conflict';
   else if(sessionImport) {
     code = row.courseCode || null;
     reason = catalogMatch.reason;
   }
   else if(!row.courseCode)reason='missing_source_code';
   else if(!exactCode.size)reason='not_found';
   else if (!exactCode.has(row.courseName)) reason='code_name_conflict';
   else code=row.courseCode;
   const raw=JSON.stringify({sourceCourseCode:row.courseCode??null,courseName:row.courseName,academicYear:row.academicYear,semester:row.semester,credits:row.credits,sourceScore:row.sourceScore??null,sourceNumericScore:row.score??null,sourceCategories:row.sourceCategories??[],sourceClassName:row.sourceClassName??null,sourceGraduationCredits:row.sourceGraduationCredits??null,sourceCreditRecord:row.sourceCreditRecord??null,conflictingRows:row.conflictingRows??[],matchReason:reason,sourceRecord:row,codeLessDuplicates:codeLessDuplicates.get(row)??[],mergedSourceRows:row.mergedSourceRows??[],...(sessionImport?describeCatalogMatch(catalogMatch):{})});
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
   if (sessionImport) {
     const entry = { course_name:row.courseName, source_course_code:row.courseCode, source_attempt_key:attemptKey, academic_year:row.academicYear, semester:row.semester, score };
     const name = row.courseName.trim();
     existingNames.set(name, [...(existingNames.get(name) ?? []), entry]);
     existing.push(entry);
   }
   attemptSeen.add(attempt);if(row.courseCode)seen.add(key(row));if(code)seen.add(key({...row,courseCode:code}));inserted++;if(reason)unmatched++;if(['source_conflict','code_name_conflict','ambiguous','invalid_code'].includes(reason))conflicts++;
  }
  return {inserted,...(updated?{updated}:{}),skipped,unmatched,conflicts,...(legacyUnusable?{legacyUnusable}:{})};
 });
}
