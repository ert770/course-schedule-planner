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
 const writes=[];let student='TEST_A';const db={execute:async(sql,p)=>{if(sql.startsWith('SELECT student_id'))return [[{student_id:student}]];if(sql.startsWith('SELECT'))return [[]];writes.push([sql,p]);return [{}];}};
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
        if (sql.includes('FROM Course_Sections')) return [[{ academic_year: 114, semester: '上學期', course_code: params[0], course_name: '程式設計' }]];
        if (sql.includes('FROM Course_Syllabi')) return [[]];
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

test('SessionImport 預檢唯讀，補號及後續匹配更新都留在同一筆紀錄', async () => {
  const stored = {
    history_id: 12, source: 'myfcu_session', catalog_course_code: null, source_course_code: 'OLD1',
    course_name: '過往課程', academic_year: 112, semester: 1, credits: 3, score: '92.00',
    source_payload: { matchReason: 'missing_term_catalog', sourceNumericScore: 92 },
  };
  const identity = { found: true, source: 'mysql', canWriteMysqlProfile: true, numericId: 1, canonicalId: 'TEST' };
  const row = { courseCode: 'OLD1', courseName: stored.course_name, academicYear: 112, semester: 1, credits: 3, score: 92 };
  let syllabus = [];
  let writes = 0;
  const db = { async execute(sql, params) {
    if (sql.startsWith('SELECT student_id')) return [[{ student_id: identity.canonicalId }]];
    if (sql.includes('FROM Course_Syllabi')) return [syllabus];
    if (sql.includes('FROM User_Course_History')) return [[stored]];
    if (sql.startsWith('SELECT')) return [[]];
    assert.match(sql, /^UPDATE User_Course_History SET catalog_course_code=\?,source_payload=\? WHERE history_id=\? AND user_id=\? AND source=\? AND catalog_course_code <=> \?/);
    assert.deepEqual(params.slice(2), [12, 1, 'myfcu_session', stored.catalog_course_code]);
    stored.catalog_course_code = params[0];
    stored.source_payload = JSON.parse(params[1]);
    writes++;
    return [{ affectedRows: 1 }];
  } };
  const sync = (dryRun = false, rows = [row]) => importExtractedHistory(identity, rows, fn => fn(db), { sessionImport: true, dryRun });
  const update = { inserted: 0, updated: 1, skipped: 0, unmatched: 0, conflicts: 0 };
  const skip = { inserted: 0, skipped: 1, unmatched: 0, conflicts: 0 };

  assert.deepEqual(await sync(true), update);
  assert.equal(writes, 0);
  assert.deepEqual(await sync(), update);
  assert.equal(stored.catalog_course_code, 'OLD1');
  assert.equal(stored.source_payload.catalogMatchStatus, 'unmatched');
  assert.equal(stored.source_payload.sourceNumericScore, 92);
  assert.deepEqual(await sync(), skip);

  syllabus = [{ academic_year: 114, semester: 1, course_code: 'OLD1' }];
  assert.deepEqual(await sync(true), update);
  assert.deepEqual(await sync(), update);
  assert.equal(stored.source_payload.catalogMatchStatus, 'matched');
  assert.deepEqual(stored.source_payload.catalogMatchEvidence, { term: '114:1', source: 'syllabus' });
  assert.equal(stored.score, '92.00');
  assert.deepEqual(await sync(), skip);
  assert.equal((await sync(true, [{ ...row, score: 91 }])).conflicts, 1);
  assert.equal(writes, 2);
});

function sessionHistoryFixture(initialHistory = []) {
  const identity = { found: true, source: 'mysql', canWriteMysqlProfile: true, numericId: 1, canonicalId: 'TEST' };
  const history = structuredClone(initialHistory);
  const writes = [];
  const db = { async execute(sql, params) {
    if (sql.startsWith('SELECT student_id')) return [[{ student_id: identity.canonicalId }]];
    if (sql.includes('FROM User_Course_History')) return [history.filter(entry => entry.user_id === params[0])];
    if (sql.startsWith('SELECT')) return [[]];
    writes.push([sql, params]);
    if (sql.startsWith('UPDATE')) {
      assert.match(sql, /catalog_course_code IS NULL AND source_course_code IS NULL/);
      const [catalog_course_code, source_course_code, payload, historyId, userId, source] = params;
      const entry = history.find(row => row.history_id === historyId && row.user_id === userId && row.source === source);
      assert.ok(entry);
      Object.assign(entry, { catalog_course_code, source_course_code, source_payload: JSON.parse(payload) });
      return [{ affectedRows: 1 }];
    }
    const [user_id, catalog_course_code, source_course_code, source_attempt_key, academic_year, semester,
      course_name, credits, score, letter_grade, passed, source, , payload] = params;
    history.push({ user_id, catalog_course_code, source_course_code, source_attempt_key, academic_year, semester,
      course_name, credits, score, letter_grade, passed, source, source_payload: JSON.parse(payload) });
    return [{}];
  } };
  const run = (rows, dryRun = true) => importExtractedHistory(identity, rows, fn => fn(db), { sessionImport: true, dryRun });
  return { history, writes, run };
}

const codedAttempt = {
  courseCode: 'NEW1', courseName: '虛構科目', sourceClassName: '資工一甲',
  academicYear: 113, semester: 1, credits: 3, score: 80,
};

test('SessionImport fills both codes on the original code-less history row only with unique evidence', async () => {
  const stored = {
    history_id: 12, user_id: 1, source: 'myfcu_session', catalog_course_code: null, source_course_code: null,
    source_attempt_key: 'original', course_name: codedAttempt.courseName, academic_year: 113, semester: 1,
    credits: '3.0', score: '80.00', passed: 1, source_payload: { sourceRecord: { ...codedAttempt, courseCode: '' } },
  };
  const otherAccount = { ...stored, history_id: 13, user_id: 2 };
  const { run, writes, history } = sessionHistoryFixture([stored, otherAccount]);
  const update = { inserted: 0, updated: 1, skipped: 0, unmatched: 0, conflicts: 0 };
  assert.deepEqual(await run([codedAttempt]), update);
  assert.equal(writes.length, 0);
  assert.deepEqual(history, [stored, otherAccount]);
  assert.deepEqual(await run([codedAttempt], false), update);
  assert.deepEqual(history, [{
    ...stored, catalog_course_code: 'NEW1', source_course_code: 'NEW1', source_payload: {
      ...stored.source_payload, sourceCourseCode: 'NEW1', catalogMatchStatus: 'unmatched',
      catalogMatchEvidence: null, matchReason: 'missing_term_catalog',
    },
  }, otherAccount]);
  assert.deepEqual(await run([codedAttempt], false), { inserted: 0, skipped: 1, unmatched: 0, conflicts: 0 });
  assert.equal(writes.length, 1);

  const occupied = { ...stored, history_id: 14, course_name: '另一科目', catalog_course_code: 'NEW1' };
  const ambiguous = { ...stored, history_id: 15 };
  for (const [initial, incoming] of [
    [[stored, occupied], codedAttempt], [[stored, ambiguous], codedAttempt],
    [[stored], { ...codedAttempt, sourceClassName: '資工一乙' }],
    [[stored], { ...codedAttempt, score: 79 }], [[stored], { ...codedAttempt, credits: 2 }],
  ]) {
    const fixture = sessionHistoryFixture(initial);
    assert.deepEqual(await fixture.run([incoming], false), { inserted: 0, skipped: 0, unmatched: 0, conflicts: 1 });
    assert.equal(fixture.writes.length, 0);
  }
});

test('SessionImport keeps equal or different grades on same-name attempts in different terms', async () => {
  for (const priorScore of [50, 80]) {
    const oldAttempt = { ...codedAttempt, courseCode: 'OLD1', academicYear: 112, score: priorScore };
    for (const split of [false, true]) {
      const { history, run, writes } = sessionHistoryFixture();
      if (split) assert.equal((await run([oldAttempt], false)).inserted, 1);
      const records = split ? [codedAttempt] : [oldAttempt, codedAttempt];
      const preflight = await run(records);
      assert.equal(preflight.conflicts, 0);
      assert.equal(preflight.inserted, records.length);
      assert.deepEqual(await run(records, false), preflight);
      assert.deepEqual(history.map(row => [row.academic_year, row.source_course_code, row.score]), [[112, 'OLD1', priorScore], [113, 'NEW1', 80]]);
      assert.equal((await run([{ ...codedAttempt, courseCode: 'NEW2', score: 79 }], false)).conflicts, 1);
      assert.equal(writes.length, 2);
    }
  }
});

test('SessionImport writes the unique code and records the merged source in either input order', async () => {
  const codeLess = { ...codedAttempt, courseCode: '' };
  for (const rows of [[codeLess, codedAttempt], [codedAttempt, codeLess]]) {
    const { history, run } = sessionHistoryFixture();
    const expected = { inserted: 1, skipped: 1, unmatched: 1, conflicts: 0 };
    assert.deepEqual(await run(rows), expected);
    assert.deepEqual(await run(rows, false), expected);
    assert.equal(history[0].catalog_course_code, codedAttempt.courseCode);
    assert.equal(history[0].source_course_code, codedAttempt.courseCode);
    assert.deepEqual(history[0].source_payload.mergedSourceRows, [codeLess]);
  }
});
