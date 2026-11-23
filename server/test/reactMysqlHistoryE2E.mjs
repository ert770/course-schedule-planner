// Test-only: invoked while a dedicated disposable local Docker MySQL is running.
import mysql from 'mysql2/promise';import crypto from 'node:crypto';import {readFile} from 'node:fs/promises';import {spawnSync} from 'node:child_process';import {createRequire} from 'node:module';import {hashPassword} from '../src/services/accountService.js';import {createCourseHistoryImporter} from '../src/services/courseHistoryImportService.js';import assert from 'node:assert/strict';
import {initializeEmptyDatabase} from '../scripts/initLocalDatabase.mjs';
const require=createRequire(import.meta.url);const db='codex_history_'+crypto.randomBytes(8).toString('hex');let c,created=false;
try{
 if(!process.argv.includes('--execute')||process.env.ISOLATED_MYSQL_USER!=='history_test'||!process.env.ISOLATED_MYSQL_TEST_PASSWORD)throw Error('GUARD');
 const port=Number(process.env.ISOLATED_HISTORY_MYSQL_PORT);if(!Number.isInteger(port)||port<1024||port>65535)throw Error('GUARD');
 c=await mysql.createConnection({host:'127.0.0.1',port,user:'history_test',password:process.env.ISOLATED_MYSQL_TEST_PASSWORD});
 await c.query('CREATE DATABASE `'+db+'` CHARACTER SET utf8mb4');created=true;await c.changeUser({database:db});
 await initializeEmptyDatabase(c);await assert.rejects(initializeEmptyDatabase(c),/DATABASE_NOT_EMPTY/);console.log('PASS clean isolated database initialization and 004/011-015');
 const fixtures=JSON.parse(await readFile(new URL('./fixtures/account-isolation/users.json',import.meta.url),'utf8'));
 for(const [id,key] of [[1,'AC-FIXTURE-A'],[2,'AC-FIXTURE-B']]){const u=fixtures.find(x=>x.studentId===key);if(!u?.password)throw Error('FIXTURE');const h=await hashPassword(u.password);await c.execute('INSERT INTO User_Profiles(user_id,student_id,name,password_hash,department,grade_level,class_name,max_credits) VALUES (?,?,?,?,?,?,?,?)',[id,key,'虛構',h,'資訊工程學系',2,'資訊二甲',25]);}
 if(process.env.LOCAL_MYFCU_SYNTHETIC_E2E==='true')await c.execute('INSERT INTO User_Course_History(user_id,catalog_course_code,academic_year,semester,course_name,credits,passed,requirement_type,graduation_category,source) VALUES (?,?,?,?,?,?,?,?,?,?)',[1,'KEEP1',110,1,'original',3,1,'必修','required','original']);
 await c.execute(`INSERT INTO Courses VALUES (?,?,?,?,?,?,?,?),(?,?,?,?,?,?,?,?)`,['C1','虛構已修',3,'選修','資訊二甲','TEST1001',2,null,'C2','虛構未修',3,'選修','資訊二甲','TEST2001',2,null]);
 if(process.env.LOCAL_MYFCU_SYNTHETIC_E2E==='true')for(let i=1;i<=6;i++)await c.execute('INSERT INTO Courses(course_id,name,dept,subid3,credits,type,target_grade) VALUES (?,?,?,?,?,?,?)',['SYN'+i,i===1?'虛構課程甲':'虛構課程'+i,'資訊二甲','TEST100'+i,3,'選修',2]);
 await c.execute(`INSERT INTO Course_Sections(section_id,course_id,teacher,room,time_str,year,semester,selection_code) VALUES (?,?,?,?,?,?,?,?),(?,?,?,?,?,?,?,?)`,[1,'C1','虛構','教室','星期一第1-2節',114,2,'S1',2,'C2','虛構','教室','星期二第1-2節',114,2,'S2']);
 const env={...process.env,ISOLATED_HISTORY_MYSQL_E2E:'true',ISOLATED_E2E_DATABASE:db};
 const run=spawnSync(process.execPath,[require.resolve('./reactMockBrowserSmoke.cjs')],{env,cwd:new URL('../..',import.meta.url),encoding:'utf8',timeout:120000,windowsHide:true});
 for(const line of (run.stdout??'').split(/\r?\n/))if(line.startsWith('PASS ')||line.startsWith('BLOCKED_OR_FAIL')||line.startsWith('DEBUG_'))console.log(line);
 const [rows]=await c.execute('SELECT user_id,catalog_course_code,course_name,academic_year,semester,credits,score,passed,requirement_type,graduation_category,source_credit_record FROM User_Course_History WHERE user_id=?'+(process.env.LOCAL_MYFCU_SYNTHETIC_E2E==='true'?" AND source='myfcu_self_attested'":''),[1]);
 console.log('DEBUG_DB_ROWS '+rows.length);if(run.status!==0)throw Error('BROWSER_FAILED');
 const [schedules]=await c.query('SELECT user_id,schedule_json FROM Saved_Schedules');if(process.env.LOCAL_MYFCU_SYNTHETIC_E2E==='true'&&(!schedules.some(r=>r.user_id===1)||!schedules.some(r=>r.user_id===5)||schedules.some(r=>![1,5].includes(r.user_id))))throw Error('SCHEDULE_MYSQL_VERIFY_FAILED');
 if(process.env.LOCAL_MYFCU_SYNTHETIC_E2E==='true'){const [registered]=await c.execute('SELECT user_id,password_hash FROM User_Profiles WHERE student_id=?',['D8800002']);if(registered.length!==1||registered[0].user_id!==5||!String(registered[0].password_hash).startsWith('$argon2id$'))throw Error('REGISTER_MYSQL_VERIFY_FAILED');}
 if(process.env.LOCAL_MYFCU_SYNTHETIC_E2E==='true'){
  const scoreMatches=r=>{const text=String(r.source_credit_record??'').trim();if(!/^(?:100|[0-9]{1,2})(?:\.\d+)?$/.test(text)||Number(text)>100)return r.score===null&&r.passed===null;const score=Number(text);return r.score!==null&&Number(r.score)===score&&r.passed!==null&&Number(r.passed)===Number(score>=60);};
  if(rows.length!==7||rows.some(r=>r.source_credit_record==null||!scoreMatches(r))||!rows.some(r=>r.catalog_course_code==='TEST1001')||!rows.some(r=>r.score!==null&&Number(r.score)===60&&Number(r.passed)===1)||!rows.some(r=>r.score===null&&r.passed===null))throw Error('DB_VERIFY_FAILED');
  const [raw]=await c.query("SELECT COUNT(*) AS n FROM User_Course_History WHERE catalog_course_code='TEST1001' AND JSON_UNQUOTE(JSON_EXTRACT(source_payload,'$.codeLessDuplicates[0].courseCode'))=''");const [pending]=await c.query("SELECT COUNT(*) AS n FROM User_Course_History WHERE user_id=1 AND catalog_course_code IS NULL AND source_course_code='MISSING1' AND source_attempt_key IS NOT NULL");const [original]=await c.query("SELECT credits,score,passed,course_name FROM User_Course_History WHERE user_id=1 AND catalog_course_code='KEEP1'");if(Number(raw[0].n)!==1||Number(pending[0].n)!==1||original.length!==1||Number(original[0].credits)!==3||original[0].score!==null||Number(original[0].passed)!==1||original[0].course_name!=='original')throw Error('DB_VERIFY_FAILED');
 }else if(rows.length!==6||rows.some(r=>r.score!==null||r.source_credit_record==null))throw Error('DB_VERIFY_FAILED');
 if(process.env.LOCAL_MYFCU_SYNTHETIC_E2E==='true'){const [audit]=await c.query('SELECT user_id,trust_level,statement_version FROM Local_History_Attestations');if(audit.length!==7||audit.some(r=>r.user_id!==1||r.trust_level!=='local_self_attested'||r.statement_version!=='local-history-v1'))throw Error('ATTESTATION_FAILED');console.log('PASS seven local self-attestations persisted in MySQL');}
 const [other]=await c.execute('SELECT COUNT(*) AS n FROM User_Course_History WHERE user_id=?',[2]);if(other[0].n!==0)throw Error('ISOLATION_FAILED');
 if(process.env.LOCAL_MYFCU_SYNTHETIC_E2E==='true'){console.log('PASS auto import: code-less duplicate preserved and unmatched history saved; independent SQL verified');}else{
 const tx=async fn=>{await c.beginTransaction();try{const result=await fn(c);await c.commit();return result;}catch(e){await c.rollback();throw e;}};
 const importer=createCourseHistoryImporter(tx),id={found:true,source:'mysql',canonicalId:'AC-FIXTURE-A',numericId:'1',canWriteMysqlProfile:true};
 const body=records=>({consent:true,identityConfirmed:true,fieldsConfirmed:true,records});
 const items=rows.map(r=>({courseCode:r.catalog_course_code,courseName:r.course_name,academicYear:Number(r.academic_year),semester:Number(r.semester),credits:Number(r.credits),score:null,passed:!!r.passed,requirementType:r.requirement_type,graduationCategory:r.graduation_category,sourceCreditRecord:r.source_credit_record}));
 assert.equal((await importer.commit(body(items),id)).inserted,0);
 await assert.rejects(importer.commit(body([{...items[0],credits:items[0].credits+1}]),id));
 if(rows.filter(r=>r.catalog_course_code==='TEST1001').length!==2)throw Error('RETAKE_FAILED');
 await assert.rejects(importer.commit({...body([items[0]]),user_id:2},id));
 await assert.rejects(tx(async conn=>{await conn.execute('INSERT INTO User_Profiles(user_id,student_id) VALUES (?,?)',[3,'SYNTHETIC_ROLLBACK']);throw Error('ROLLBACK');}));
 const [rollback]=await c.execute('SELECT COUNT(*) AS n FROM User_Profiles WHERE user_id=?',[3]);assert.equal(rollback[0].n,0);
 console.log('PASS duplicate, retake, conflict, cross-account rejection and rollback');
 }
 console.log('PASS：React 寫入隔離 MySQL，獨立查詢確認歸屬、成績及來源記錄。');
}catch(e){console.log('E2E_FAILED '+(['GUARD','FIXTURE','BROWSER_FAILED','DB_VERIFY_FAILED','ISOLATION_FAILED'].includes(e.message)?e.message:'SETUP_OR_DATABASE'));process.exitCode=1;}
finally{if(c){if(created)try{await c.query('DROP DATABASE `'+db+'`');}catch{console.log('CLEANUP_UNCONFIRMED');process.exitCode=1;}await c.end().catch(()=>{});}}
