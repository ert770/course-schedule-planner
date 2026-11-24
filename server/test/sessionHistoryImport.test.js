import test from 'node:test';
import assert from 'node:assert/strict';
import { isSessionHistoryImport } from '../src/services/isolatedHistoryE2E.js';
import { importExtractedHistory } from '../src/services/courseHistoryAutoImport.js';
test('session import requires Windows local Aiven mode and rejects test flags',()=>{
 const env={NODE_ENV:'development',LOCAL_MYFCU_PREVIEW:'true',MYFCU_SESSION_IMPORT:'true',DB_HOST:'example.aivencloud.com',DB_SSL_CA_PATH:'ca.pem',DB_USER:'example',DB_NAME:'example'};
 assert.equal(Boolean(isSessionHistoryImport(env)),process.platform==='win32');
 for(const patch of [{NODE_ENV:'production'},{DB_HOST:'127.0.0.1'},{DB_HOST:'example.aivencloud.com.evil'},{DB_SSL_CA_PATH:''},{ISOLATED_HISTORY_MYSQL_E2E:'true'},{CONTROLLED_BROWSER_MOCK:'true'},{LOCAL_MYFCU_SELF_ATTESTED_IMPORT:'true'}]) assert.equal(Boolean(isSessionHistoryImport({...env,...patch})),false);
});
test('session import uses resolved identity and rejects mismatched profile',async()=>{
 const writes=[];let student='TEST_A';const db={execute:async(sql,p)=>{if(sql.startsWith('SELECT student_id'))return [[{student_id:student}]];if(sql.startsWith('SELECT DISTINCT name')||sql.includes('FROM User_Course_History')||sql.includes('FROM Unmatched_Course_History'))return [[]];writes.push([sql,p]);return [{}];}};
 const identity={found:true,source:'mysql',canWriteMysqlProfile:true,numericId:2,canonicalId:'TEST_A'};
 const rows=[{user_id:999,courseCode:'TEST1',courseName:'虛構',academicYear:112,semester:1,credits:3,score:60,sourceCreditRecord:'60'}];
 await importExtractedHistory(identity,rows,fn=>fn(db),{sessionImport:true});
 const insert=writes.find(([sql])=>sql.startsWith('INSERT INTO User_Course_History'));assert.equal(insert[1][0],2);assert.equal(insert[1][10],1);assert.ok(!writes.some(([sql])=>sql.includes('Local_History_Attestations')));
 student='TEST_B';await assert.rejects(importExtractedHistory(identity,rows,fn=>fn(db),{sessionImport:true}),/IDENTITY_MISMATCH/);
});
