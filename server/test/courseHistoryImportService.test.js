import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCourseHistoryImporter } from '../src/services/courseHistoryImportService.js';
const who={found:true,source:'mysql',canonicalId:'SYNTHETIC',numericId:'5',canWriteMysqlProfile:true};
const row={courseCode:'TEST1001',courseName:'虛構',academicYear:112,semester:1,credits:3,score:50,passed:false,requirementType:'必修',graduationCategory:'required',letterGrade:null,generalEducationCategory:null};
const body=records=>({records,consent:true,identityConfirmed:true,fieldsConfirmed:true});
function fixture(){let stored=[],fail=false;const transaction=async fn=>{let pending=[...stored];const c={execute:async(sql,params)=>{
  if(sql.startsWith('SELECT user_id'))return [[{user_id:5,student_id:'SYNTHETIC'}]];
  if(sql.startsWith('SELECT catalog'))return [pending];
  if(sql.startsWith('INSERT')){if(fail)throw new Error('synthetic failure');for(let i=0,step=sql.includes('source_credit_record')?14:13;i<params.length;i+=step)pending.push({catalog_course_code:params[i+1],academic_year:params[i+2],semester:params[i+3],course_name:params[i+4],score:params[i+5],letter_grade:params[i+6],credits:params[i+7],passed:params[i+8],requirement_type:params[i+9],general_education_category:params[i+10],graduation_category:params[i+11],source_credit_record:sql.includes('source_credit_record')?params[i+13]:null});return [{}];}throw Error('unexpected');}};const r=await fn(c);stored=pending;return r;};return {api:createCourseHistoryImporter(transaction),rows:()=>stored,fail:()=>{fail=true;}};}
test('preview, transaction insert, duplicate, and retake use same session identity',async()=>{const f=fixture();const rows=[row,{...row,semester:2}];assert.deepEqual((await f.api.preview(body(rows),who)).plan.items.map(x=>x.status),['new','new']);assert.deepEqual(await f.api.commit(body(rows),who),{inserted:2,skipped:0});assert.equal(f.rows().length,2);assert.deepEqual(await f.api.commit(body(rows),who),{inserted:0,skipped:2});});
test('rejects missing consent, impersonation, unconfirmed values and conflicts without writes',async()=>{const f=fixture();await assert.rejects(f.api.commit({...body([row]),consent:false},who));await assert.rejects(f.api.commit({...body([row]),user_id:7},who));await assert.rejects(f.api.commit(body([{...row,passed:null}]),who),{status:409});await f.api.commit(body([row]),who);await assert.rejects(f.api.commit(body([{...row,score:90}]),who),{status:409});assert.equal(f.rows().length,1);});
test('transaction failure leaves rows unchanged',async()=>{const f=fixture();f.fail();await assert.rejects(f.api.commit(body([row]),who));assert.equal(f.rows().length,0);});

test('explicit student-declared outcome permits unknown score without inventing a grade',async()=>{
 const f=fixture();const item={...row,score:null,passed:true};
 assert.deepEqual(await f.api.commit(body([item]),who),{inserted:1,skipped:0});
 assert.equal(f.rows()[0].score,null);assert.equal(f.rows()[0].passed,1);
 await assert.rejects(f.api.commit(body([{...item,semester:2,passed:null}]),who),{status:409});
});

test('original source credit field is preserved independently of grade',async()=>{
 const f=fixture();const item={...row,score:null,passed:true,sourceCreditRecord:'X'};
 await f.api.commit(body([item]),who);assert.equal(f.rows()[0].source_credit_record,'X');assert.equal(f.rows()[0].score,null);
 await assert.rejects(f.api.commit(body([{...item,semester:2,sourceCreditRecord:'x'.repeat(256)}]),who),{status:409});
});
