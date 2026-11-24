import test from 'node:test';
import assert from 'node:assert/strict';
import { planHistoryByName } from '../../client/src/utils/historyNameDedup.js';
import { importExtractedHistory } from '../src/services/courseHistoryAutoImport.js';
const row=(name,score,code='X')=>({courseName:name,score,courseCode:code,academicYear:112,semester:1,credits:3});
test('trim names; prefer score; merge equals; exclude conflicts',()=>{
 const p=planHistoryByName([row(' 甲 ',null),row('甲',60),row('甲',60),row('乙',null),row('乙',null),row('丙',40),row('丙',90),row('丁',60)]);
 assert.equal(p.candidates.length,3);assert.equal(p.mergedCount,3);assert.equal(p.conflicts.length,1);assert.equal(p.candidates[0].score,60);assert.equal(p.candidates[2].courseName,'丁');
});
test('session importer groups identically and does not overwrite existing user data',async()=>{
 const writes=[];const db={execute:async(sql,p)=>{if(sql.startsWith('SELECT student_id'))return [[{student_id:'FAKE'}]];if(sql.includes('FROM Unmatched_Course_History'))return [[]];if(sql.startsWith('SELECT DISTINCT'))return [[]];if(sql.includes('FROM User_Course_History'))return [[{course_name:'已修',score:80,academic_year:111,semester:1}]];writes.push([sql,p]);return [{}]}};
 const identity={found:true,source:'mysql',canWriteMysqlProfile:true,numericId:2,canonicalId:'FAKE'};
 const result=await importExtractedHistory(identity,[row('甲',null,'A'),row(' 甲 ',60,'A'),row('丙',40,'C'),row('丙',90,'C'),row('已修',30,'Z'),row('丁',61,'D')],fn=>fn(db),{sessionImport:true});
 assert.deepEqual(result,{inserted:2,skipped:1,unmatched:2,conflicts:2});const inserts=writes.filter(([sql])=>sql.startsWith('INSERT INTO User_Course_History'));assert.equal(inserts.length,2);assert.ok(inserts.every(([,p])=>p[0]===2));assert.equal(inserts[0][1][8],60);assert.ok(writes.every(([sql])=>!/^UPDATE|^DELETE/.test(sql)));
});
