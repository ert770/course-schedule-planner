import test from 'node:test';import assert from 'node:assert/strict';
import {saveHistorySnapshot,readHistorySnapshot,claimHistorySnapshot,releaseHistorySnapshot,setHistorySnapshotPreflight} from '../src/services/historySnapshot.js';
import {importExtractedHistory} from '../src/services/courseHistoryAutoImport.js';
import {createRequire} from 'node:module';
const {collect,TABS} = createRequire(import.meta.url)('../src/myfcu/console-poc.js');
const identity={found:true,source:'mysql',canWriteMysqlProfile:true,numericId:2,canonicalId:'FAKE_A'};
test('snapshot deduplicates, isolates owners, validates copy and cannot be reused after consumption',()=>{
 const result={allCategoriesComplete:true,records:[{courseName:'虛構'}],pendingRecords:[],rawCategories:[{category:'test'}],excludedDetails:[],duplicateDetails:[]};const first=saveHistorySnapshot(identity,result),second=saveHistorySnapshot(identity,result);assert.equal(first.hash,second.hash);assert.equal(first.createdAt,second.createdAt);assert.equal(readHistorySnapshot({...identity,numericId:3,canonicalId:'FAKE_B'}),null);const copy=readHistorySnapshot(identity);copy.result.records[0].courseName='changed';assert.equal(readHistorySnapshot(identity).result.records[0].courseName,'虛構');setHistorySnapshotPreflight(identity,first.hash,{inserted:1,conflicts:0});assert.equal(claimHistorySnapshot(identity).preflight.inserted,1);assert.equal(readHistorySnapshot(identity),null);releaseHistorySnapshot(identity,true);assert.equal(readHistorySnapshot(identity),null);
});
test('dry-run uses actual grouping but makes no writes',async()=>{
 const statements=[];const db={execute:async(sql,p)=>{statements.push(sql);if(sql.startsWith('SELECT student_id'))return [[{student_id:'FAKE_A'}]];if(sql.includes('FROM Unmatched_Course_History')||sql.includes('FROM User_Course_History')||sql.startsWith('SELECT DISTINCT'))return [[]];throw new Error('UNEXPECTED_WRITE')}};const row={courseName:'虛構',courseCode:'TEST',academicYear:112,semester:1,credits:3,score:60};const result=await importExtractedHistory(identity,[row,row],fn=>fn(db),{sessionImport:true,dryRun:true});assert.equal(result.inserted,1);assert.equal(result.skipped,1);assert.ok(statements.every(sql=>sql.startsWith('SELECT')&&!sql.includes('FOR UPDATE')));
});

test('MyFCU row warnings remain in the snapshot while only usable attempts reach import', async () => {
 const headers=['課程編碼','科目','修讀班級名稱','實際修習學年','實際修習學期','實際修習學分','取得學分記錄'];
 const groups = {
  '#/courseKind1': [
   ['', '未修通識條件', '', '', '', '2', 'X'],
   ['T1', '正常通識', '測試班', '112', '1', '2', '90'],
   ['T2', '學期缺漏', '測試班', '112', '', '2', '80'],
  ],
  '#/courseKind23': [
   ['', '未修必修條件', '', '', '', '2', 'X'],
   ['', '來源欄位缺漏', '', '', '', '2', '75'],
   ['', '未確認是否修過', '', '', '', '2', ''],
   ['T3', '正常必修', '測試班', '113', '2', '2', '79'],
  ],
 };
 const collectFixture = (blockedHash, blockedOutput) => collect({load:async hash => (
  hash === blockedHash ? blockedOutput : {category:hash,tables:[{headers,rows:groups[hash] ?? []}]}
 )},{includeTrace:true,creditRecordVerified:true});
 const result = await collectFixture();
 assert.equal(result.allCategoriesComplete,false);
 assert.deepEqual(result.categories.filter(category => category.rowReviewOnly).map(category => category.hash),['#/courseKind1','#/courseKind23']);
 assert.deepEqual(result.unresolvedDetails.map(row => row.courseName),['學期缺漏','來源欄位缺漏','未確認是否修過']);
 assert.deepEqual(result.unresolvedDetails[0].reasons,['semester_empty']);
 assert.ok(result.unresolvedDetails[1].reasons.includes('course_identity_missing'));
 assert.equal(result.excludedDetails.filter(row => row.reason === 'excluded_unattempted_requirement').length,2);
 assert.equal(result.records.length,2);

 saveHistorySnapshot(identity,result);
 const preview = readHistorySnapshot(identity).result;
 assert.equal(preview.unresolvedDetails.length,3);
 const inserted = [];
 const db = {execute:async (sql,params) => {
  if (sql.startsWith('SELECT student_id')) return [[{student_id:'FAKE_A'}]];
  if (sql.includes('FROM Course_Syllabi')) return [[{academic_year:112,semester:1,course_code:'T1'},{academic_year:113,semester:2,course_code:'T3'}]];
  if (sql.startsWith('SELECT')) return [[]];
  assert.ok(sql.startsWith('INSERT INTO User_Course_History'));
  inserted.push(params[2]);
  return [{}];
 }};
 assert.deepEqual(await importExtractedHistory(identity,[...preview.records,...preview.pendingRecords],fn=>fn(db),{sessionImport:true}),{inserted:2,skipped:0,unmatched:0,conflicts:0});
 assert.deepEqual(inserted,['T1','T3']);
 releaseHistorySnapshot(identity,true);

 const noTable = await collectFixture('#/courseKind1',{tables:[]});
 assert.throws(() => saveHistorySnapshot(identity,noTable),{message:'SNAPSHOT_INCOMPLETE'});
 const noHeaders = await collectFixture('#/courseKind23',{tables:[{headers:['科目'],rows:[]}]});
 assert.throws(() => saveHistorySnapshot(identity,noHeaders),{message:'SNAPSHOT_INCOMPLETE'});
 const unrelatedInvalidRows = await collectFixture(TABS[0],{tables:[{headers,rows:[['','異常資料','','','','','80']]}]});
 assert.throws(() => saveHistorySnapshot(identity,unrelatedInvalidRows),{message:'SNAPSHOT_INCOMPLETE'});
});
