import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {planHistoryByName} from '../../client/src/utils/historyNameDedup.js';
const {collect,TABS}=createRequire(import.meta.url)('../src/myfcu/console-poc.js');
test('61 synthetic rows retain excluded and duplicate details without changing outcomes',async()=>{
 const headers=['課程編碼','科目','實際修習學年','實際修習學期','實際修習學分','取得學分記錄'];
 const rows=Array.from({length:55},(_,i)=>['TEST'+i,'虛構課程'+i,'112','1','3','75']);
 const groups=[rows.slice(0,10),rows.slice(10,20),rows.slice(20,30),rows.slice(30,40),rows.slice(40,50),rows.slice(50)];
 groups[1].push(['','大學基礎英文(一)','','','',''],['','大學基礎英文(二)','','','','']);groups[3].push(['TEST9999','專題研究(二)','','','','']);groups[5].push(...rows.slice(0,3));
 const driver={load:async hash=>({category:hash,tables:[{headers,rows:groups[TABS.indexOf(hash)]}]})};
 const trace=await collect(driver,{includeTrace:true,creditRecordVerified:true});const normal=await collect(driver,{creditRecordVerified:true});
 assert.equal(trace.summary.rawRows,61);assert.equal(trace.excludedDetails.length,3);assert.equal(trace.duplicateDetails.length,3);assert.equal(trace.records.length,55);assert.equal(trace.summary.rawRows,trace.excludedDetails.length+trace.duplicateDetails.length+trace.records.length);assert.equal(planHistoryByName(trace.records).candidates.length,55);
 assert.ok(trace.excludedDetails.every(x=>x.headers.length===x.values.length&&x.courseName&&x.category&&x.reason));assert.ok(trace.duplicateDetails.every(x=>x.retained.courseName===x.merged.courseName&&x.reason==='same_attempt_identical'));
 assert.deepEqual(trace.records,normal.records);assert.equal('excludedDetails' in normal,false);assert.equal('duplicateDetails' in normal,false);
});
// 2026-11-23 團隊決定：不同學期不合併（重修同名同分各留一筆）。
test('cross-semester identical scores are kept as separate records',()=>{
 const first={courseName:'虛構',academicYear:112,semester:1,score:60};const second={...first,academicYear:113,semester:2};const plan=planHistoryByName([first,second]);assert.equal(plan.candidates.length,2);assert.equal(plan.mergedCount,0);assert.deepEqual(plan.conflicts,[]);
 const same={...first};const merged=planHistoryByName([first,same]);assert.equal(merged.candidates.length,1);assert.equal(merged.mergedCount,1);
});
