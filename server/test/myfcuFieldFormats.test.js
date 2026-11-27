import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

async function loadPoc() {
  const module={exports:{}};
  const script=await readFile(new URL('../src/myfcu/console-poc.js',import.meta.url),'utf8');
  new Function('module','globalThis',script)(module,{});
  return module.exports;
}
const headers=['課程編碼','科目','修讀班級名稱','實際修習學年','實際修習學期','實際修習學分','成績'];

test('學年、學分、學期接受明確的單位與別名', async () => {
  const {parseTable}=await loadPoc();
  const rows=[
    ['T1','虛構課程一','虛構班','114學年度','上學期','3學分','80'],
    ['T2','虛構課程二','暑修班','114','暑修','3.0','80'],
    ['T3','虛構課程三','虛構班','114學年','第二學期','2','80'],
    ['T4','虛構課程四','虛構班','114','第1學期','1','80'],
  ];
  const result=parseTable({headers,rows},'虛構分類');
  assert.equal(result.invalidRows,0);
  assert.deepEqual(result.records.map(r=>[r.academicYear,r.semester,r.credits]),[[114,1,3],[114,3,3],[114,2,2],[114,1,1]]);
});

test('只剝明確的單位，其他文字仍視為無法辨識', async () => {
  const {parseTable}=await loadPoc();
  const rows=[
    ['T1','虛構課程一','虛構班','約114','1','3','80'],
    ['T2','虛構課程二','虛構班','114','1','3學時','80'],
    ['T3','虛構課程三','虛構班','114','寒','3','80'],
  ];
  const result=parseTable({headers,rows},'虛構分類');
  assert.equal(result.records.length,0);
  assert.equal(result.invalidRows,3);
  // 無法辨識的學期文字留在診斷，方便查是哪種寫法沒被認出來。
  assert.deepEqual(result.rowDiagnostics.filter(d=>d.semesterText).map(d=>d.semesterText),['寒']);
});

test('成績為「通過」時收為待確認紀錄，分數留空', async () => {
  const {parseTable}=await loadPoc();
  const result=parseTable({headers,rows:[['T1','虛構課程一','虛構班','114','2','3','通過']]},'虛構分類');
  assert.deepEqual(result.pendingRecords.map(r=>[r.courseCode,r.score,r.sourceScore]),[['T1',null,'通過']]);
});
