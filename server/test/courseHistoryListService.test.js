import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listCourseHistory } from '../src/services/courseHistoryListService.js';

test('returns unmatched rows with source code and null values for the session user', async () => {
  const identity = { found:true, source:'mysql', canWriteMysqlProfile:true, numericId:5 };
  const result = await listCourseHistory(identity, async (query, params) => {
    assert.match(query, /WHERE user_id=\?/);
    assert.deepEqual(params, [5]);
    return [{history_id:1,catalog_course_code:null,source_course_code:'TEST123',course_name:'課程',academic_year:112,semester:1,score:null,letter_grade:null,credits:3,passed:null,requirement_type:null,graduation_category:null,general_education_category:null}];
  });
  assert.equal(result[0].sourceCourseCode, 'TEST123');
  assert.equal(result[0].catalogCourseCode, null);
  assert.equal(result[0].passed, null);
  assert.equal(result[0].score, null);
  await assert.rejects(listCourseHistory({...identity, source:'legacy'}, async () => []), e => e.status === 403);
});

test('labels missing-term coverage on existing unmatched MyFCU rows without changing their matches', async () => {
  const identity = { found:true, source:'mysql', canWriteMysqlProfile:true, numericId:5 };
  const rows = [
    { history_id:1, source:'myfcu_session', catalog_course_code:null, source_course_code:'OLD1', academic_year:111, semester:2 },
    { history_id:2, source:'myfcu_session', catalog_course_code:null, source_course_code:'ARCH1', academic_year:114, semester:1 },
    { history_id:3, source:'myfcu_session', catalog_course_code:'MATCH1', source_course_code:'MATCH1', academic_year:111, semester:2 },
  ];
  const result = await listCourseHistory(identity, async sql => {
    if (sql.includes('FROM User_Course_History')) return rows;
    if (sql.includes('FROM Course_Sections')) return [{ academic_year:114, semester:'下學期' }];
    assert.match(sql, /FROM Course_Syllabi/);
    return [{ academic_year:114, semester:1 }];
  });
  assert.equal(result[0].matchReason,'missing_term_catalog');
  assert.equal(result[1].matchReason,undefined);
  assert.equal(result[2].catalogCourseCode,'MATCH1');
  assert.equal(result[2].matchReason,undefined);
});
