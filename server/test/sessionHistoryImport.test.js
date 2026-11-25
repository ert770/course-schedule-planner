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

test('SessionImport 同一筆修課的課名只差 (Online) 時跳過', async (t) => {
  const identity = { found: true, source: 'mysql', canWriteMysqlProfile: true, numericId: 2, canonicalId: 'TEST_A' };
  const row = {
    courseCode: 'TEST1001', courseName: '程式設計 (Online)', academicYear: 114, semester: 1, credits: 3, score: 92,
  };
  const stored = {
    catalog_course_code: 'TEST1001', source_course_code: null, course_name: '程式設計',
    academic_year: 114, semester: 1, score: '92.00',
  };
  let writes = 0;
  const compare = (incoming, prior = stored, dryRun = true) => importExtractedHistory(
    identity,
    [incoming],
    async run => run({
      async execute(sql, params) {
        if (sql.startsWith('SELECT student_id')) return [[{ student_id: identity.canonicalId }]];
        if (sql.includes('FROM Unmatched_Course_History')) return [[]];
        if (sql.includes('FROM Courses')) return [[{ subid3: params[0], name: '程式設計' }]];
        if (sql.includes('FROM User_Course_History')) return [[prior]];
        writes += 1;
        return [{}];
      },
    }),
    { sessionImport: true, dryRun },
  );
  const skipped = { inserted: 0, skipped: 1, unmatched: 0, conflicts: 0 };

  await t.test('預檢和確認匯入都只跳過，沒有寫入', async () => {
    assert.deepEqual(await compare(row), skipped);
    assert.deepEqual(await compare(row, stored, false), skipped);
    assert.equal(writes, 0);
  });

  await t.test('已存課名有後綴，且保留的是來源課號時也可核對', async () => {
    assert.deepEqual(await compare(
      { ...row, courseName: '程式設計' },
      { ...stored, course_name: row.courseName, catalog_course_code: null, source_course_code: row.courseCode },
    ), skipped);
  });

  for (const [label, changes] of [
    ['課號不同', { courseCode: 'TEST1002' }],
    ['沒有課號', { courseCode: null, sourceClassName: '測試班' }],
    ['學年不同', { academicYear: 113 }],
    ['學期不同', { semester: 2 }],
    ['成績不同', { score: 91 }],
    ['成績未知', { score: null }],
    ['課名有其他差異', { courseName: '進階程式設計 (Online)' }],
  ]) {
    await t.test(label, async () => {
      assert.equal((await compare({ ...row, ...changes })).skipped, 0);
    });
  }
});
