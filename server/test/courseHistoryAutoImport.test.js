import test from 'node:test';import assert from 'node:assert/strict';import {importExtractedHistory} from '../src/services/courseHistoryAutoImport.js';
const identity={found:true,source:'mysql',canWriteMysqlProfile:true,numericId:1,canonicalId:'TEST'};
const row=(code,name,year=112)=>({courseCode:code,courseName:name,sourceClassName:'其他班',academicYear:year,semester:1,credits:3,score:null,sourceCreditRecord:'X'});
test('unmatched source records are written to history, with passed based only on verified scores',async()=>{
 const writes=[];const db={execute:async(sql,p)=>{if(sql.startsWith('SELECT student_id'))return [[{student_id:'TEST'}]];if(sql.startsWith('SELECT DISTINCT name'))return [[{name:'科目甲',subid3:'A1'},{name:'不同課名',subid3:'BAD'}]];if(sql.includes('FROM User_Course_History'))return [[{catalog_course_code:'A1',academic_year:112,semester:1}]];if(sql.includes('FROM Unmatched_Course_History'))return [[]];writes.push([sql,p]);return [{}];}};
 const inputs=[row('A1','科目甲'),row('A1','科目甲',113),{...row('MISS','沒有'),score:61,letterGrade:'B'}, {...row('BAD','科目甲'),score:60},row('','無代碼')];
 const result=await importExtractedHistory(identity,inputs,fn=>fn(db));
 assert.deepEqual(result,{inserted:4,skipped:1,unmatched:3,conflicts:1});const inserts=writes.filter(x=>x[0].startsWith('INSERT INTO User_Course_History'));assert.equal(inserts.length,4);assert.equal(inserts[0][1][1],'A1');assert.equal(inserts[1][1][1],null);assert.equal(inserts[1][1][2],'MISS');assert.equal(inserts[1][1][10],1);assert.equal(inserts[2][1][10],1);assert.equal(inserts[3][1][10],null);assert.equal(JSON.parse(inserts[1][1][13]).sourceRecord.courseName,'沒有');
});
test('MyFCU passing threshold preserves unknown and includes 60',async()=>{
 const writes=[];const db={execute:async(sql,p)=>{if(sql.startsWith('SELECT student_id'))return [[{student_id:'TEST'}]];if(sql.startsWith('SELECT DISTINCT name')||sql.includes('FROM User_Course_History')||sql.includes('FROM Unmatched_Course_History'))return [[]];writes.push([sql,p]);return [{}];}};
 const values=[59,60,61,null];await importExtractedHistory(identity,values.map((score,i)=>({...row('BOUNDARY'+i,'虛構'),score})),fn=>fn(db));
 assert.deepEqual(writes.filter(x=>x[0].startsWith('INSERT INTO User_Course_History')).map(x=>x[1][10]),[0,1,1,null]);
});
test('39 existing records are unchanged while 16 missing catalog codes enter history',async()=>{
 const existing=Array.from({length:39},(_,i)=>({catalog_course_code:'KEEP'+i,academic_year:112,semester:1}));const writes=[];
 const db={execute:async(sql,p)=>{if(sql.startsWith('SELECT student_id'))return [[{student_id:'TEST'}]];if(sql.startsWith('SELECT DISTINCT name'))return [[]];if(sql.includes('FROM User_Course_History'))return [existing];if(sql.includes('FROM Unmatched_Course_History'))return [[]];writes.push([sql,p]);return [{}];}};
 const rows=[...existing.map(r=>row(r.catalog_course_code,'existing')),...Array.from({length:16},(_,i)=>row('MISS'+i,'歷史'+i))];
 const result=await importExtractedHistory(identity,rows,fn=>fn(db));assert.deepEqual(result,{inserted:16,skipped:39,unmatched:16,conflicts:0});assert.equal(writes.filter(x=>x[0].startsWith('INSERT INTO User_Course_History')).length,16);assert.ok(writes.filter(x=>x[0].startsWith('INSERT INTO User_Course_History')).every(x=>x[1][1]===null));
});
test('a code-less duplicate merges only with one identical coded attempt, retaining its source',async()=>{
 const writes=[];const db={execute:async(q,p)=>{if(q.startsWith('SELECT student_id'))return [[{student_id:'TEST'}]];if(q.startsWith('SELECT DISTINCT name'))return [[{name:'科目甲',subid3:'A1'}]];if(q.includes('FROM User_Course_History')||q.includes('FROM Unmatched_Course_History'))return [[]];writes.push([q,p]);return [{}];}};
 const blank=row('','科目甲'),coded=row('A1','科目甲');const result=await importExtractedHistory(identity,[blank,coded],fn=>fn(db));assert.deepEqual(result,{inserted:1,skipped:1,unmatched:0,conflicts:0});const saved=writes.find(x=>x[0].startsWith('INSERT INTO User_Course_History'));assert.equal(JSON.parse(saved[1][13]).codeLessDuplicates.length,1);
});
test('incomplete legacy pending data remains pending and is reported',async()=>{
 const db={execute:async(q)=>{if(q.startsWith('SELECT student_id'))return [[{student_id:'TEST'}]];if(q.includes('FROM Unmatched_Course_History'))return [[{catalog_course_code:'OLD',academic_year:112,semester:1,source_payload:{courseName:'舊紀錄'}}]];if(q.includes('FROM User_Course_History'))return [[]];throw Error('unexpected');}};
 const result=await importExtractedHistory(identity,[],fn=>fn(db));assert.deepEqual(result,{inserted:0,skipped:0,unmatched:0,conflicts:0,legacyUnusable:1});
});
