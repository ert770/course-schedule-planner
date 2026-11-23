// Explicitly local, disposable acceptance environment; no project .env is loaded.
import mysql from 'mysql2/promise';
import crypto from 'node:crypto';
import { readFile,stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import net from 'node:net';
import { hashPassword } from '../src/services/accountService.js';
import { writeUnmatchedCsv } from './unmatchedCoursesCsv.mjs';

const password=process.env.LOCAL_ACCEPTANCE_DB_PASSWORD, loginPassword=process.env.LOCAL_ACCEPTANCE_LOGIN_PASSWORD;
const port=Number(process.env.LOCAL_MYFCU_ACCEPTANCE_PORT);
if(process.platform!=='win32'||!password||!loginPassword||loginPassword.length<8||!Number.isInteger(port)||port<1024||port>65535) throw Error('LOCAL_ACCEPTANCE_GUARD');
const root=fileURLToPath(new URL('../..',import.meta.url));
const db='codex_history_'+crypto.randomBytes(8).toString('hex');
const children=[];let connection,created=false,stopping=false;
async function cleanup(){
 if(stopping)return;stopping=true;
 for(const child of children)child.kill();
 if(connection){
  if(created && !process.argv.includes('--smoke')){
   try{const [pending]=await connection.execute('SELECT catalog_course_code,academic_year,semester,reason,source_payload FROM Unmatched_Course_History WHERE user_id=? ORDER BY academic_year,semester,id',[1]);const [unmatchedHistory]=await connection.execute("SELECT source_course_code AS catalog_course_code,academic_year,semester,COALESCE(JSON_UNQUOTE(JSON_EXTRACT(source_payload,'$.matchReason')),'not_found') AS reason,source_payload FROM User_Course_History WHERE user_id=? AND catalog_course_code IS NULL ORDER BY academic_year,semester,history_id",[1]);const unique=new Map();for(const r of [...pending,...unmatchedHistory]){const raw=typeof r.source_payload==='string'?JSON.parse(r.source_payload):r.source_payload??{};const code=raw.sourceCourseCode??r.catalog_course_code;const k=JSON.stringify([code||[raw.courseName,raw.sourceClassName],Number(r.academic_year),Number(r.semester)]);unique.set(k,r);}const file=await writeUnmatchedCsv(path.join(root,'reports'),[...unique.values()]);console.log(`未匹配紀錄已匯出至 ${file}`);}
   catch{console.error('未匹配紀錄匯出失敗；隔離資料庫將保留在執行中的容器，請勿關閉容器並先處理。');process.exitCode=74;await connection.end().catch(()=>{});return;}
  }
  if(created){let audit;try{audit=await mysql.createConnection({host:'127.0.0.1',port,user:'history_test',password,database:db});const [rows]=await audit.query('SELECT catalog_course_code,academic_year,semester,course_name,credits,score,source_payload FROM User_Course_History WHERE user_id=1');const [pending]=await audit.query('SELECT COUNT(*) AS n FROM User_Course_History WHERE user_id=1 AND catalog_course_code IS NULL');let mismatches=0;for(const row of rows){const raw=typeof row.source_payload==='string'?JSON.parse(row.source_payload):row.source_payload;const [byCode]=await audit.execute('SELECT subid3 FROM Courses WHERE BINARY subid3=BINARY ? AND BINARY name=BINARY ?',[row.catalog_course_code,row.course_name]);const validMatch=row.catalog_course_code===null||(raw?.sourceCourseCode===row.catalog_course_code && byCode.length>0);if(!validMatch||Number(row.academic_year)!==raw?.academicYear||Number(row.semester)!==raw?.semester||Number(row.credits)!==raw?.credits||(row.score!==null&&Number(row.score)!==raw?.sourceNumericScore))mismatches++;}console.log(`獨立 SQL 核對：寫入 ${rows.length} 筆、待查 ${pending[0].n} 筆、代碼／學年／學期／學分／成績異常 ${mismatches} 筆；重複跳過數請看首頁同步摘要。`);}catch{console.log('獨立 SQL 核對未完成。');process.exitCode=1;}finally{await audit?.end().catch(()=>{});}if(!process.argv.includes('--keep-environment'))try{await connection.query('DROP DATABASE `'+db+'`');}catch{console.log('隔離測試庫清理未確認；容器停止後資料仍會移除。');}else console.log(`隔離資料庫已保留：${db}`);}
  await connection.end().catch(()=>{});
 }
}
process.on('SIGINT',()=>void cleanup().then(()=>process.exit(process.exitCode||0)));
process.on('SIGTERM',()=>void cleanup().then(()=>process.exit(process.exitCode||0)));
try{
 for(const port of [3001,5173]) await new Promise((resolve,reject)=>{const probe=net.createServer();probe.once('error',reject);probe.listen({host:'127.0.0.1',port,exclusive:true},()=>probe.close(resolve));});
 connection=await mysql.createConnection({host:'127.0.0.1',port,user:'history_test',password});
 await connection.query('CREATE DATABASE `'+db+'` CHARACTER SET utf8mb4');created=true;await connection.changeUser({database:db});if(process.argv.includes('--keep-environment'))console.log(`驗收資料庫：${db}（127.0.0.1:${port}）`);
 await connection.query(`CREATE TABLE User_Profiles(user_id INT PRIMARY KEY,student_id VARCHAR(32) UNIQUE,name VARCHAR(80),password_hash VARCHAR(255),department VARCHAR(100),grade_level INT,class_name VARCHAR(100),preference_tags JSON,avoid_time JSON,max_credits INT,program_type VARCHAR(50),enrolled_programs JSON,college VARCHAR(80),must_take_courses JSON,avoid_instructors JSON,preferences_json JSON)`);
 const schema=await readFile(new URL('../migrations/004_course-history-v1.up.sql',import.meta.url),'utf8');await connection.query(schema.replace('`User_Course_History_v1_new`','`User_Course_History`'));
 for(const name of ['011_history-source-credit.up.sql','012_local_history_attestation.up.sql','013_history_course_match.up.sql','014_unmatched_source_identity.up.sql','015_history_source_course_code.up.sql']){const sql=(await readFile(new URL('../migrations/'+name,import.meta.url),'utf8')).replace(/^\s*--.*$/gm,'');for(const statement of sql.split(';').map(s=>s.trim()).filter(Boolean))await connection.query(statement);}
 await connection.execute('INSERT INTO User_Profiles(user_id,student_id,name,password_hash,department,grade_level,class_name,max_credits) VALUES (?,?,?,?,?,?,?,?)',[1,'D8800000','本機測試',await hashPassword(loginPassword),'資訊工程學系',2,'資訊二甲',25]);
 await connection.query(`CREATE TABLE Courses(course_id VARCHAR(80) PRIMARY KEY,name VARCHAR(100),credits DECIMAL(4,1),type VARCHAR(50),dept VARCHAR(100),subid3 VARCHAR(45),target_grade INT,prerequisites TEXT)`);
 // The offline catalog snapshot has no history table; do not fabricate syllabi.
 await connection.query('CREATE TABLE Course_Syllabi (source_key CHAR(64) PRIMARY KEY,course_code VARCHAR(45),academic_year SMALLINT UNSIGNED,semester TINYINT UNSIGNED)');
 if(!process.argv.includes('--smoke'))console.log('隔離測試庫未載入歷年大綱；無法驗證大綱優先層。');
 if(!process.argv.includes('--smoke')){const file=process.env.LOCAL_ACCEPTANCE_CATALOG;if(!file||(await stat(file)).size>20_000_000)throw Error('CATALOG_REQUIRED');const catalog=JSON.parse(await readFile(file,'utf8'));if(!Array.isArray(catalog)||!catalog.length||catalog.length>100000)throw Error('CATALOG_INVALID');for(const row of catalog){if(!row||['course_id','name','dept','subid3'].some(k=>typeof row[k]!=='string'||!row[k].trim()||row[k].length>(k==='course_id'?80:100))||row.subid3.length>45)throw Error('CATALOG_INVALID');await connection.execute('INSERT INTO Courses(course_id,name,dept,subid3) VALUES (?,?,?,?)',[row.course_id,row.name,row.dept,row.subid3]);}console.log(`已載入隔離課程目錄：${catalog.length} 筆。`);}
 await connection.query(`CREATE TABLE Course_Sections(section_id INT PRIMARY KEY,course_id VARCHAR(80),teacher VARCHAR(80),room VARCHAR(80),time_str VARCHAR(80),time_bitmask VARCHAR(80),year INT,semester INT,current_student INT,rag_context TEXT,rag_tag TEXT,selection_code VARCHAR(80),limit_student INT,has_midterm INT,has_final INT,has_teamwork INT,has_presentation INT,is_english_taught INT,assessment_summary TEXT)`);
 await connection.query(`CREATE TABLE Course_Reviews(Reviews_id INT PRIMARY KEY,selection_code VARCHAR(80),Reviews_tags TEXT,Review_content TEXT,sweetness INT,coolness INT,workload INT,value INT,overall INT,review_count INT,source VARCHAR(50),url TEXT,scraped_at DATETIME)`);
 if(process.argv.includes('--smoke')){
  const {importExtractedHistory}=await import('../src/services/courseHistoryAutoImport.js');
  await connection.execute('INSERT INTO Courses(course_id,name,dept,subid3) VALUES (?,?,?,?)',['FAKE-1','虛構','資訊二甲','TEST1001']);
  const identity={found:true,source:'mysql',canWriteMysqlProfile:true,numericId:1,canonicalId:'D8800000'};
  const records=[{courseCode:'TEST1001',courseName:'虛構',sourceClassName:'資訊二甲',academicYear:112,semester:1,credits:3,sourceCreditRecord:'X'},{courseCode:'MISSING1',courseName:'不存在',sourceClassName:'資訊二甲',academicYear:112,semester:1,credits:3}];
  const tx=async fn=>{await connection.beginTransaction();try{const value=await fn(connection);await connection.commit();return value;}catch(e){await connection.rollback();throw e;}};
  const first=await importExtractedHistory(identity,records,tx),second=await importExtractedHistory(identity,records,tx);
  const [check]=await connection.query('SELECT course_id,catalog_course_code,source_course_code,score,passed,requirement_type,graduation_category,source_credit_record FROM User_Course_History ORDER BY history_id');
  if(first.inserted!==2||first.unmatched!==1||second.skipped!==2||check.length!==2||check[0].catalog_course_code!=='TEST1001'||check[1].catalog_course_code!==null||check[1].source_course_code!=='MISSING1'||check[0].score!==null||check[0].passed!==null||check[0].requirement_type!==null||check[0].graduation_category!==null||check[0].source_credit_record!=='X')throw Error('AUTO_IMPORT_VERIFY_FAILED');
  console.log('PASS 隔離 MySQL：匹配、未匹配、重複與未知值。');
 }
 const allowed=['SYSTEMROOT','WINDIR','COMSPEC','PATH','PATHEXT','TEMP','TMP','USERPROFILE','LOCALAPPDATA','APPDATA','PROGRAMFILES','PROGRAMFILES(X86)','PROGRAMDATA','HOMEDRIVE','HOMEPATH'];
 const clean=Object.fromEntries(Object.entries(process.env).filter(([k])=>allowed.includes(k.toUpperCase())));
 const env={...clean,NODE_ENV:'development',LOCAL_MYFCU_PREVIEW:'true',LOCAL_MYFCU_ACCEPTANCE:'true',LOCAL_MYFCU_ACCEPTANCE_PORT:String(port),LOCAL_MYFCU_ALLOW_LOCAL_DB:'true',LOCAL_MYFCU_SELF_ATTESTED_IMPORT:'true',CONTROLLED_BROWSER_MOCK:'false',CONTROLLED_BROWSER_REAL_TEST:'false',CONTROLLED_BROWSER_PERSONAL_TEST:'false',ISOLATED_HISTORY_MYSQL_E2E:'false',LOCAL_MYFCU_SYNTHETIC_E2E:'false',COURSE_HISTORY_IMPORT_ENABLED:'false',PRIVACY_STORE:'memory',PRIVACY_ENFORCEMENT_ENABLED:'false',CF_INTEREST_MODE:'off',DB_HOST:'127.0.0.1',DB_PORT:String(port),DB_USER:'history_test',DB_NAME:db,DB_PASSWORD:password,DB_SSL_CA_PATH:'',SESSION_SECRET:crypto.randomBytes(32).toString('hex'),ANALYTICS_ID_SECRET:crypto.randomBytes(32).toString('hex'),CLIENT_ORIGIN:'http://localhost:5173',PORT:'3001'};
 const launch=(cmd,args,cwd,e)=>{const p=spawn(cmd,args,{cwd,env:e,windowsHide:true,stdio:'ignore'});children.push(p);p.once('exit',()=>{if(!stopping){console.error('本機服務意外結束，正在清理。');void cleanup().then(()=>process.exit(1));}});};
 launch(process.execPath,['src/app.js'],path.join(root,'server'),env);
 launch(process.execPath,[path.join(root,'client/node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--strictPort'],path.join(root,'client'),{...clean,VITE_API_PROXY_TARGET:'http://127.0.0.1:3001'});
 for(const url of ['http://127.0.0.1:3001/','http://127.0.0.1:5173/']){let ready=false;for(let n=0;n<80;n++){try{await fetch(url);ready=true;break;}catch{await new Promise(r=>setTimeout(r,250));}}if(!ready)throw Error('LOCAL_SERVICE_NOT_READY');}
 console.log('開啟 http://localhost:5173/ ，使用測試帳號 D8800000 與剛設定的測試密碼登入。');
 console.log(process.argv.includes('--keep-environment')?'自行登入官方 MyFCU；資料只寫入隔離測試庫，結束後測試庫與容器會保留。':'自行登入官方 MyFCU；資料與聲明只寫入此隔離測試庫。結束請按 Ctrl+C，測試庫與容器會刪除。');
 console.log('課程目錄僅來自本機快照；未確認的通過狀態與分類不會視為已修學分。');
 if(process.argv.includes('--smoke'))await cleanup();else await new Promise(resolve=>process.once('SIGINT',resolve));
}catch{console.error('隔離驗收啟動失敗；請確認連接埠、Docker 與本機依賴。');await cleanup();process.exitCode=1;}
