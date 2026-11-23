import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {collect,TABS}=createRequire(import.meta.url)('../src/myfcu/console-poc.js');
test('61 synthetic source rows leave 55 unconfirmed records without inferred grades or pass status',async()=>{
 const headers=['課程編碼','科目','實際修習學年','實際修習學期','實際修習學分','取得學分記錄'];
 const rows=Array.from({length:55},(_,i)=>['TEST'+String(i).padStart(4,'0'),'虛構課程','112','1','3','55']);
 const groups=[rows.slice(0,10),rows.slice(10,20),rows.slice(20,30),rows.slice(30,40),rows.slice(40,50),rows.slice(50)];
 groups[1].push(['','大學基礎英文(一)','','','',''],['','大學基礎英文(二)','','','','']);
 groups[3].push(['TEST9999','專題研究(二)','','','','']);groups[5].push(...rows.slice(0,3));
 const result=await collect({load:async hash=>({category:hash,tables:[{headers,rows:groups[TABS.indexOf(hash)]}]})});
 assert.equal(result.allCategoriesComplete,true);assert.equal(result.summary.rawRows,61);assert.equal(result.duplicateRows,3);assert.equal(result.summary.excludedRows,3);assert.equal(result.summary.anomalyRows,0);assert.equal(result.pendingRecords.length,55);assert.equal(result.records.length,0);
 assert.ok(result.pendingRecords.every(r=>r.score===null&&r.passed===null));
});

