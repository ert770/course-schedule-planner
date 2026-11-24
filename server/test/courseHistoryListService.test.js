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
