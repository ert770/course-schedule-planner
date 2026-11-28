import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateStudentScope, validateStudentScopeChange } from '../src/data/studentScopeValidation.js';
import { validateRegistration } from '../src/services/accountService.js';

const wrongCollege = { department: '資訊電機學院', gradeLevel: 4, className: '資電四乙' };

test('系所、年級、班級對得上才通過', () => {
  assert.equal(validateStudentScope({ department: '資訊工程學系', gradeLevel: 4, className: '資訊四乙' }), null);
  assert.equal(validateStudentScope({ department: '不存在的系', gradeLevel: 4, className: '資訊四乙' }), '請選擇有效系所');
  assert.equal(validateStudentScope({ department: '資訊工程學系', gradeLevel: 4, className: '資電四乙' }), '班級與系所或年級不符');
  assert.equal(validateStudentScope({ department: '資訊工程學系', gradeLevel: 3, className: '資訊四乙' }), '班級與系所或年級不符');
  assert.equal(validateStudentScope({ department: '資訊工程學系', gradeLevel: 1, className: '資訊一丁' }), '班級與系所或年級不符');
});

test('把填錯的學院改成資工可以保存', () => {
  const updates = { department: '資訊工程學系', gradeLevel: 4, className: '資訊四乙' };
  assert.equal(validateStudentScopeChange(updates, wrongCollege), null);
});

test('只改系所、班級沒跟著改時擋下', () => {
  assert.equal(validateStudentScopeChange({ department: '資訊工程學系' }, wrongCollege), '班級與系所或年級不符');
});

test('沒送或沒改基本資料時不檢查，既有不完整的資料不擋其他偏好', () => {
  const legacy = { department: '資訊工程學系', gradeLevel: null, className: null };
  assert.equal(validateStudentScopeChange({ selectedTags: ['#不點名'] }, legacy), null);
  assert.equal(validateStudentScopeChange({ department: '資訊工程學系' }, legacy), null);
});

test('註冊沿用同一套規則', () => {
  const base = { studentId: 'D1234567', name: '測試', password: 'abcd1234', confirmPassword: 'abcd1234' };
  assert.equal(validateRegistration({ ...base, department: '資訊工程學系', gradeLevel: '4', className: '資訊四乙' }), null);
  assert.equal(validateRegistration({ ...base, department: '資訊工程學系', gradeLevel: '4', className: '資電四乙' }), '班級與系所或年級不符');
});
