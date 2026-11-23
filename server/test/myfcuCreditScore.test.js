import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('confirmed credit records preserve numeric scores and keep special values unknown', async () => {
  const module={exports:{}};
  const script=await readFile(new URL('../src/myfcu/console-poc.js',import.meta.url),'utf8');
  new Function('module','globalThis',script)(module,{});
  const headers=['課程編碼','科目','實際修習學年','實際修習學期','實際修習學分','取得學分記錄'];
  const rows=['0','60','61','100','101','X','','60.125'].map((value,i)=>['T'+i,'虛構課程','112','1','3',value]);
  const result=module.exports.parseTable({headers,rows},'虛構分類',{creditRecordVerified:true});
  assert.deepEqual(result.records.map(row=>row.score),[0,60,61,100]);
  assert.deepEqual(result.records.map(row=>row.sourceCreditRecord),['0','60','61','100']);
  assert.ok(result.records.every(row=>row.passed===null));
  assert.equal(result.pendingRecords.length,4);
  assert.ok(result.pendingRecords.every(row=>row.score===null && row.passed===null));
  const unverified=module.exports.parseTable({headers,rows:[rows[1]]},'虛構分類',{creditRecordVerified:false});
  assert.equal(unverified.pendingRecords[0].score,null);
});
