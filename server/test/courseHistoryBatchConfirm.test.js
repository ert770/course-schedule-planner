import {test} from 'node:test';
import assert from 'node:assert/strict';
import {confirmCreditRecordScores,confirmSourceClassification,confirmSameScoreOutcome} from '../../client/src/utils/courseHistoryBatchConfirm.js';
test('credit record conversion requires confirmation and excludes invalid and conflicting entries',()=>{
 const rows=[{score:'',sourceCreditRecord:'55'},{score:'',sourceCreditRecord:'X'},{score:'',sourceCreditRecord:'101'},{score:'',sourceCreditRecord:'80',conflictingRows:[{}]},{score:70,sourceCreditRecord:'80'}];
 assert.equal(confirmCreditRecordScores(rows,false),rows);const out=confirmCreditRecordScores(rows,true);assert.deepEqual(out.map(r=>r.score),[55,'','','',70]);
});
test('explicit category confirmation only applies to single matching source, never overwrites',()=>{
 const rows=[{sourceCategories:['A'],requirementType:'',graduationCategory:''},{sourceCategories:['A','B'],requirementType:'',graduationCategory:''},{sourceCategories:['A'],requirementType:'必修',graduationCategory:'required'}];
 const out=confirmSourceClassification(rows,'A','選修','elective',true);assert.equal(out[0].graduationCategory,'elective');assert.equal(out[1].graduationCategory,'');assert.equal(out[2].requirementType,'必修');
});
test('same-score outcome requires explicit decision and never infers from threshold',()=>{
 const rows=[{score:55,passed:''},{score:55,passed:'true'},{score:70,passed:''}];assert.equal(confirmSameScoreOutcome(rows,'55','false',false),rows);assert.deepEqual(confirmSameScoreOutcome(rows,'55','false',true).map(r=>r.passed),['false','true','']);
});

test('classification batch does not combine user choices with contradictory existing fields',()=>{
 const rows=[{sourceCategories:['A'],requirementType:'必修',graduationCategory:''},{sourceCategories:['A'],requirementType:'',graduationCategory:'required'}];
 const out=confirmSourceClassification(rows,'A','選修','elective',true);assert.equal(out[0].graduationCategory,'');assert.equal(out[1].requirementType,'');
});

test('student declaration applies only to selected single source and never infers from raw grades',async()=>{
 const {confirmSourceOutcome}=await import('../../client/src/utils/courseHistoryBatchConfirm.js');
 const rows=[{sourceCategories:['A'],passed:'',score:null},{sourceCategories:['B'],passed:'',score:null},{sourceCategories:['A','B'],passed:'',score:null},{sourceCategories:['A'],passed:'false',score:null}];
 assert.deepEqual(confirmSourceOutcome(rows,'A','true',false),rows);
 const next=confirmSourceOutcome(rows,'A','true',true);assert.equal(next[0].passed,'true');assert.equal(next[0].score,null);assert.deepEqual(next.slice(1),rows.slice(1));
});
