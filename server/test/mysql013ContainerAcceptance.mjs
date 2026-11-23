// Disposable, network-disabled Docker MySQL acceptance. Synthetic data only.
import {execFileSync,spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {importExtractedHistory} from '../src/services/courseHistoryAutoImport.js';
const container=process.env.ISOLATED_013_CONTAINER;
if(!/^codex-013-[a-f0-9]{12}$/.test(container??'') || !process.env.MYSQL_PWD)throw Error('ISOLATION_GUARD');
function interpolate(query,params=[]){
 let i=0;const q=query.replace(/\?/g,()=>{const v=params[i++];return v==null?'NULL':typeof v==='number'?String(v):"'"+String(v).replace(/\\/g,'\\\\').replace(/'/g,"''")+"'";});
 if(i!==params.length)throw Error('PARAMETER_MISMATCH');
 return q;
}
function sql(query,params=[]){
 const q=interpolate(query,params);
 const out=execFileSync('docker',['exec','-i','--env','MYSQL_PWD',container,'mysql','-uhistory_test','-D','codex_history_test','--batch','--raw'],{input:q+';\n',encoding:'utf8',windowsHide:true,stdio:['pipe','pipe','pipe']}).trimEnd();
 if(!out)return [];
 const lines=out.split(/\r?\n/),headers=lines.shift().split('\t');return lines.map(line=>Object.fromEntries(line.split('\t').map((v,n)=>[headers[n],v==='NULL'?null:v])));
}
let stage='schema';try{
 sql('CREATE TABLE User_Profiles (user_id INT PRIMARY KEY, student_id VARCHAR(32) UNIQUE) ENGINE=InnoDB');
 stage='004';const schema=(await readFile(new URL('../migrations/004_course-history-v1.up.sql',import.meta.url),'utf8')).replace('`User_Course_History_v1_new`','`User_Course_History`');sql(schema.trim().replace(/;\s*$/,''));
 for(const f of ['011_history-source-credit.up.sql','012_local_history_attestation.up.sql','013_history_course_match.up.sql','014_unmatched_source_identity.up.sql','015_history_source_course_code.up.sql']){stage=f.slice(0,3);const text=(await readFile(new URL('../migrations/'+f,import.meta.url),'utf8')).replace(/^\s*--.*$/gm,'');for(const statement of text.split(';').map(x=>x.trim()).filter(Boolean))sql(statement);}
 stage='fixtures';
 sql('CREATE TABLE Courses (course_id VARCHAR(80) PRIMARY KEY, name VARCHAR(100), dept VARCHAR(100), subid3 VARCHAR(45))');
 sql('CREATE TABLE Course_Syllabi (source_key VARCHAR(64) PRIMARY KEY,course_code VARCHAR(45),academic_year SMALLINT,semester TINYINT)');
 sql('INSERT INTO User_Profiles VALUES (?,?),(?,?)',[1,'SYNTHETIC_A',2,'SYNTHETIC_B']);
 sql('INSERT INTO Courses VALUES (?,?,?,?),(?,?,?,?),(?,?,?,?),(?,?,?,?)',['ID1','MATCH1','CLASS1','MATCH1','ID2','AMBIG1','CLASS1','OTHER1','ID3','AMBIG1','CLASS1','OTHER2','ID4','EXIST1','CLASS1','EXIST1']);
 sql('INSERT INTO Course_Syllabi VALUES (?,?,?,?)',['SY1','SYLLABUS1',112,1]);
 sql('INSERT INTO User_Course_History (user_id,catalog_course_code,academic_year,semester,course_name,credits,passed,requirement_type,graduation_category,source) VALUES (?,?,?,?,?,?,?,?,?,?)',[1,'EXIST1',112,1,'original',3,1,'必修','required','original']);
 const identity=id=>({found:true,source:'mysql',canWriteMysqlProfile:true,numericId:id,canonicalId:id===1?'SYNTHETIC_A':'SYNTHETIC_B'});
 const row=(courseCode,extra={})=>({courseCode,courseName:courseCode,sourceClassName:'CLASS1',academicYear:112,semester:1,credits:3,sourceCreditRecord:'X',...extra});
 const db={execute:async(q,p)=>[sql(q,p)]};const run=(who,rows)=>importExtractedHistory(who,rows,fn=>fn(db));
 stage='import';const input=[row('MATCH1'),row('MATCH1',{academicYear:113}),row('MISSING1'),row('AMBIG1'),row('EXIST1',{credits:9}),row('SYLLABUS1')];
 assert.deepEqual(await run(identity(1),input),{inserted:5,skipped:1,unmatched:3,conflicts:0});
 const rows=sql('SELECT user_id,course_id,catalog_course_code,academic_year,score,passed,requirement_type,graduation_category,source_credit_record,credits FROM User_Course_History WHERE user_id=? ORDER BY catalog_course_code,academic_year',[1]);
 assert.equal(rows.length,6);const matched=rows.filter(x=>x.catalog_course_code==='MATCH1');assert.equal(matched.length,2);for(const r of matched){assert.equal(r.course_id,null);for(const k of ['score','passed','requirement_type','graduation_category'])assert.equal(r[k],null);assert.equal(r.source_credit_record,'X');}
 const original=rows.find(x=>x.catalog_course_code==='EXIST1');assert.equal(Number(original.credits),3);assert.equal(original.passed,'1');
 const pendingRows=sql("SELECT source_course_code,JSON_UNQUOTE(JSON_EXTRACT(source_payload,'$.matchReason')) AS reason FROM User_Course_History WHERE user_id=? AND catalog_course_code IS NULL ORDER BY source_course_code",[1]);assert.deepEqual(pendingRows.map(x=>x.reason),['not_found','not_found','not_found']);
 assert.deepEqual(await run(identity(1),input),{inserted:0,skipped:6,unmatched:0,conflicts:0});
 assert.equal(Number(sql('SELECT COUNT(*) AS n FROM User_Course_History WHERE user_id=? AND catalog_course_code IS NULL',[1])[0].n),3);
 assert.deepEqual(await run(identity(2),[row('MATCH1')]),{inserted:1,skipped:0,unmatched:0,conflicts:0});
 assert.equal(Number(sql('SELECT COUNT(*) AS n FROM User_Course_History WHERE user_id=?',[2])[0].n),1);
 assert.equal(Number(sql('SELECT COUNT(*) AS n FROM User_Course_History WHERE user_id=?',[1])[0].n),6);
 const cols=sql("SELECT COLUMN_NAME,IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='User_Course_History' AND COLUMN_NAME IN ('course_id','source_payload','passed','requirement_type','graduation_category')");assert.equal(cols.length,5);assert.ok(cols.every(c=>c.IS_NULLABLE==='YES'));
 assert.equal(Number(sql('SELECT COUNT(*) AS n FROM Local_History_Attestations WHERE user_id=?',[1])[0].n),5);
 stage='39_existing_16_pending';
 sql('INSERT INTO User_Profiles VALUES (?,?)',[4,'SYNTHETIC_D']);
 const keepValues=Array.from({length:39},(_,i)=>[4,'KEEP'+i,112,1,'original',3,1,'必修','required','original']);
 sql('INSERT INTO User_Course_History(user_id,catalog_course_code,academic_year,semester,course_name,credits,passed,requirement_type,graduation_category,source) VALUES '+keepValues.map(()=>'(?,?,?,?,?,?,?,?,?,?)').join(','),keepValues.flat());
 const pending16=Array.from({length:16},(_,i)=>({courseCode:'NEW'+i,courseName:'NAME'+i,sourceClassName:'CLASS',academicYear:113,semester:1,credits:3,score:null,sourceCreditRecord:'RAW'}));
 const user4={...identity(1),numericId:4,canonicalId:'SYNTHETIC_D'};
 assert.deepEqual(await run(user4,pending16),{inserted:16,skipped:0,unmatched:16,conflicts:0});
 assert.equal(Number(sql("SELECT COUNT(*) n FROM User_Course_History WHERE user_id=4 AND source='original' AND course_name='original' AND credits=3 AND passed=1")[0].n),39);
 assert.equal(Number(sql('SELECT COUNT(*) n FROM User_Course_History WHERE user_id=4 AND catalog_course_code IS NULL')[0].n),16);
 assert.equal(Number(sql("SELECT COUNT(*) n FROM User_Course_History WHERE user_id=4 AND JSON_UNQUOTE(JSON_EXTRACT(source_payload,'$.sourceRecord.sourceCreditRecord'))='RAW'")[0].n),16);
 assert.deepEqual(await run(user4,pending16),{inserted:0,skipped:16,unmatched:0,conflicts:0});
 console.log('PASS synthetic 39 existing preserved; 16 unmatched records retained and deduplicated');
 stage='transaction_rollback';
 sql('INSERT INTO User_Profiles VALUES (?,?)',[3,'SYNTHETIC_C']);
 const child=spawn('docker',['exec','-i','--env','MYSQL_PWD',container,'mysql','-uhistory_test','-D','codex_history_test','--batch','--raw','--unbuffered'],{windowsHide:true,stdio:['pipe','pipe','pipe']});
 let buffered='',pending=null;let childError=false;
 child.stderr.on('data',()=>{childError=true;});
 child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{buffered+=chunk;if(!pending)return;const marker='__done\n'+pending.token+'\n';const at=buffered.indexOf(marker);if(at<0)return;const out=buffered.slice(0,at).trimEnd();buffered=buffered.slice(at+marker.length);const done=pending;pending=null;if(childError){done.reject(Error('MYSQL_TRANSACTION_ERROR'));return;}if(!out){done.resolve([[]]);return;}const lines=out.split(/\r?\n/),headers=lines.shift().split('\t');done.resolve([lines.map(line=>Object.fromEntries(line.split('\t').map((v,n)=>[headers[n],v==='NULL'?null:v])))]);});
 const execute=(query,params=[])=>new Promise((resolve,reject)=>{if(pending)return reject(Error('CONCURRENT_TEST_QUERY'));const token='done_'+Math.random().toString(16).slice(2);pending={token,resolve,reject};child.stdin.write(interpolate(query,params)+';\nSELECT \''+token+'\' AS __done;\n');});
 let historyInserted=false;
 try{
  await execute('START TRANSACTION');
  const transactional={execute:async(q,p)=>{if(q.startsWith('INSERT INTO Local_History_Attestations')){assert.ok(historyInserted);throw Error('INJECTED_FAILURE');}const result=await execute(q,p);if(q.startsWith('INSERT INTO User_Course_History'))historyInserted=true;return result;}};
  const owner3={...identity(1),numericId:3,canonicalId:'SYNTHETIC_C'};
  await assert.rejects(importExtractedHistory(owner3,[row('MISSING1'),row('MATCH1')],fn=>fn(transactional)),/INJECTED_FAILURE/);
  await execute('ROLLBACK');
 } finally {child.stdin.end();}
 for(const table of ['User_Course_History','Unmatched_Course_History','Local_History_Attestations'])assert.equal(Number(sql('SELECT COUNT(*) AS n FROM '+table+' WHERE user_id=?',[3])[0].n),0);
 assert.equal(Number(sql('SELECT COUNT(*) AS n FROM User_Course_History WHERE user_id=?',[1])[0].n),6);
 console.log('PASS 跨語句交易：寫入修課資料後注入失敗，ROLLBACK 後三張表均無新增。');
 console.log('PASS MySQL 8.4：004/011/012/013 schema、唯一匹配、重修、未匹配／多重匹配、重複、不覆蓋、NULL 與雙使用者隔離。');
}catch(e){const number=String(e?.stderr??'').match(/ERROR (\d+)/)?.[1];console.error('FAIL 隔離 MySQL 013 驗收：'+stage+' '+(e?.name==='AssertionError'?'斷言不符 '+JSON.stringify({actual:e.actual,expected:e.expected}):number?'MySQL '+number:e?.code==='ENOENT'?'EXECUTABLE_NOT_FOUND':'SQL 或測試執行錯誤'));process.exitCode=1;}
