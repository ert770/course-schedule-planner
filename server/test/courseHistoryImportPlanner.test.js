import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateImportEntry, planCourseHistoryImport } from '../src/services/courseHistoryImportPlanner.js';
const entry = { courseCode:'TEST1001', courseName:'虛構課程', academicYear:112, semester:1, credits:3, score:50, passed:false, requirementType:'必修', generalEducationCategory:null, graduationCategory:'required' };
test('accepts explicitly confirmed failing grade but does not infer passing or classifications', () => {
  assert.deepEqual(validateImportEntry(entry), []);
  assert.ok(validateImportEntry({ ...entry, passed:null }).includes('pass_status_unconfirmed'));
  assert.deepEqual(validateImportEntry({ ...entry, score:null }), []);
  assert.ok(validateImportEntry({ ...entry, score:undefined }).includes('score_unconfirmed_or_invalid'));
  assert.ok(validateImportEntry({ ...entry, user_id:5 }).includes('identity_not_allowed'));
  assert.ok(validateImportEntry({ ...entry, graduationCategory:null }).includes('graduation_category_unconfirmed'));
});
test('batch plan keeps retakes, skips duplicates and prevents overwriting conflicts', () => {
  const changed = { ...entry, score:60 };
  const retake = { ...entry, semester:2 };
  const other = { ...entry, courseCode:'TEST1002' };
  const plan = planCourseHistoryImport([entry, changed, retake, other, { ...other }], [{ ...retake }]);
  assert.deepEqual(plan.items.map(x => x.status), ['conflict_input','conflict_input','duplicate_existing','new','duplicate_input']);
  const conflict = planCourseHistoryImport([entry], [changed]);
  assert.equal(conflict.items[0].status, 'conflict_existing');
});
test('rejects oversized and malformed requests without identity lookups or writes', () => {
  assert.throws(() => planCourseHistoryImport(Array(1001).fill(entry), []));
  assert.equal(planCourseHistoryImport([null], []).items[0].status, 'invalid');
});
test('matches source codes without converting unknown passed status to false', () => {
  const existing = { ...entry, courseCode:null, sourceCourseCode:entry.courseCode };
  assert.equal(planCourseHistoryImport([entry], [existing]).items[0].status, 'duplicate_existing');
  assert.equal(planCourseHistoryImport([entry], [{ ...existing, passed:null }]).items[0].status, 'conflict_existing');
  assert.equal(planCourseHistoryImport([entry], [existing, existing]).items[0].status, 'conflict_existing');
  assert.equal(planCourseHistoryImport([{ ...entry, semester:2 }], [existing]).items[0].status, 'new');
});
